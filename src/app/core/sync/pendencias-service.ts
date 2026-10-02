import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Table } from 'dexie';
import { firstValueFrom, Observable } from 'rxjs';
import { AuthService } from '../auth/auth-service';
import { observar } from '../db/observar';
import { RegeraDb } from '../db/regera-db';
import { ORDEM_PERDA_OS, type ItemPerdaOs } from '../../features/os/formatos-os';
import type { OsDados, OsLocal, StatusOs, TipoAnexoOs } from '../../features/os/os-models';
import { manterMinhaOs, quemNoServidor, rebaseFilaOs, rebaseOsLocal } from '../../features/os/rebase-os';
import type { PropostaDados } from '../../features/propostas/proposta-models';
import { EdicaoRascunho, PropostasRepo } from '../../features/propostas/propostas-repo';
import { Adaptador, adaptadorDe, RegistroLocal } from './adaptadores';
import {
  DadosUploadAnexoOs, Mudanca, MutacaoLocal, Pendencia, TIPO_UPLOAD_ANEXO_OS, TIPO_UPLOAD_DOCUMENTO,
} from './sync-models';
import { marcaDeReleitura, SyncService } from './sync-service';
import { apagarUploadsDasMutacoes, apagarUploadsDoAgregado, ehUpload, tabelasDeUpload, tipoUploadDe } from './tipos-upload';

/**
 * O upload de anexo recusado com 404 `OS_NAO_ENCONTRADA`: a OS não existe mais para este usuário (o técnico que perdeu
 * a atribuição há mais de 7 dias, M2-R3/R22, ou a OS excluída). Todo o resto da OS na fila teria a mesma recusa.
 */
export function osNaoEncontrada(p: Pendencia): boolean {
  return p.entidade === TIPO_UPLOAD_ANEXO_OS && p.erro?.codigo === 'OS_NAO_ENCONTRADA';
}

const PERDA_DO_ANEXO: Readonly<Record<TipoAnexoOs, ItemPerdaOs>> = { FOTO: 'fotos', ASSINATURA: 'assinatura', DOCUMENTO: 'pdf' };

/** A transição de uma mutação separada da OS para `status` (o comando de reabertura diz qual foi a volta). */
function perdaDaTransicao(d: OsDados): ItemPerdaOs | null {
  const porStatus: Partial<Record<StatusOs, ItemPerdaOs>> = { CONCLUIDA: 'conclusao', CANCELADA: 'cancelamento' };
  if (d.status === 'EM_ANDAMENTO') return d.motivoReabertura ? 'reabertura' : 'inicio';
  return porStatus[d.status] ?? null;
}

/**
 * M1: o trabalho que as mutações da OS (na ordem da fila) levam e o servidor `servidor` ainda não tem. Cada uma é
 * comparada com o servidor e com a anterior da fila:
 * - a transição (`iniciar`, `concluir`, cancelar, reabrir): uma mutação separada que muda o status;
 * - o resumo e a recusa da assinatura: o valor dela, preenchido e diferente do servidor;
 * - o "Precisa voltar": `concluiProposta` desmarcado, com o servidor marcado.
 * Sem o estado do servidor (a recusa de uma mutação, que não o traz), vale o que a fila leva: a primeira separada é uma
 * transição, o resumo e a recusa preenchidos contam, e o "Precisa voltar" conta na conclusão desmarcada.
 */
function perdaDasMutacoes(mutacoes: readonly MutacaoLocal[], servidor: OsDados | null | undefined): Set<ItemPerdaOs> {
  const r = new Set<ItemPerdaOs>();
  let status: StatusOs | null = servidor?.status ?? null;
  let conclui: boolean | null = servidor ? servidor.concluiProposta !== false : null;
  for (const m of mutacoes) {
    const d = m.dados as OsDados;
    const transicao = m.separada && !d.aceitarTrabalho && d.status !== status ? perdaDaTransicao(d) : null;
    if (transicao) r.add(transicao);
    if (d.resumoExecucao && d.resumoExecucao !== (servidor?.resumoExecucao ?? null)) r.add('resumo');
    if (d.assinaturaRecusada && !(servidor?.assinaturaRecusada && (servidor.motivoRecusa ?? null) === (d.motivoRecusa ?? null))) {
      r.add('recusa');
    }
    if (d.concluiProposta === false && (conclui ?? transicao === 'conclusao')) r.add('precisaVoltar');
    status = d.status;
    conclui = d.concluiProposta !== false;
  }
  return r;
}

/** Os ids das notas das mutações que o servidor ainda não tem (sem a data dele e fora das notas de `servidor`). */
function notasNovas(mutacoes: readonly OsDados[], servidor: OsDados | null | undefined): string[] {
  const doServidor = new Set((servidor?.notas ?? []).map((n) => n.id));
  return [...new Set(mutacoes.flatMap((d) => (d.notas ?? []).filter((n) => n.criadaEm == null && !doServidor.has(n.id)).map((n) => n.id)))];
}

/**
 * Decisões do usuário sobre conflitos e rejeições (§11.5). Toda ação relê a pendência gravada dentro da própria
 * transação e não faz nada se ela já não existe (toque duplo, outra aba): vale a `mutacao` gravada, não a cópia da tela.
 */
@Injectable({ providedIn: 'root' })
export class PendenciasService {
  private readonly db = inject(RegeraDb);
  private readonly http = inject(HttpClient);
  private readonly sync = inject(SyncService);
  private readonly repo = inject(PropostasRepo);
  private readonly auth = inject(AuthService);

  observar(): Observable<Pendencia[]> {
    return observar(async () => (await this.db.pendencias.toArray()).sort((a, b) => a.criadaEm.localeCompare(b.criadaEm)));
  }

  /**
   * Para os títulos e as ações da tela: as OS do aparelho que têm pendência (dela ou de um anexo dela), o tipo de cada
   * anexo com upload pendente e a revisão de cada PDF deles (sem ela, a 1: o "Gerar PDF novamente" só troca o da
   * revisão atual). Lê só os registros citados: os bytes das outras fotos não são carregados.
   */
  observarOsDasPendencias(): Observable<{
    os: ReadonlyMap<string, OsLocal>;
    tiposDeAnexo: ReadonlyMap<string, TipoAnexoOs>;
    revisoesDosPdfs: ReadonlyMap<string, number>;
  }> {
    return observar(async () => {
      const daOs = (await this.db.pendencias.toArray()).filter((p) => p.entidade === 'os' || p.entidade === TIPO_UPLOAD_ANEXO_OS);
      const ids = [...new Set(daOs.map((p) => p.agregadoId))];
      const anexoIds = [...new Set(daOs
        .filter((p) => p.entidade === TIPO_UPLOAD_ANEXO_OS)
        .map((p) => (p.mutacao.dados as DadosUploadAnexoOs | null)?.anexoId)
        .filter((id): id is string => !!id))];
      const os = (await this.db.os.bulkGet(ids)).filter((x) => !!x);
      const anexos = (await this.db.anexosOs.bulkGet(anexoIds)).filter((a) => !!a);
      return {
        os: new Map(os.map((x) => [x.id, x] as const)),
        tiposDeAnexo: new Map(anexos.map((a) => [a.id, a.tipo] as const)),
        revisoesDosPdfs: new Map(anexos.filter((a) => a.tipo === 'DOCUMENTO').map((a) => [a.id, a.revisaoOs ?? 1] as const)),
      };
    });
  }

  /**
   * P4b-R17: rebase no lugar. A mutação da pendência volta à fila no `seq` dela (na frente das que ficaram retidas
   * atrás), com outro `mutationId`, `baseVersion` = versão do servidor e os próprios `dados` e `separada`. Só esta
   * pendência sai; as mutações seguintes e os documentos ficam. Se o registro local não existe mais e nada vem atrás,
   * vai como DELETE (como antes).
   *
   * Na OS (M2P1-R19), a mutação também é rebaseada no estado do servidor (`manterMinhaOs`): os campos que o perfil não
   * altera vêm do servidor, `responsavelId` vai null e o status não volta, senão o servidor a recusaria
   * (`OS_NAO_EDITAVEL`, `TRANSICAO_INVALIDA`). As seguintes da OS na fila e a OS local passam pelo `rebaseFilaOs`: o
   * que nelas era igual ao da mutação do conflito segue o rebase dela, e o que só o aparelho tem fica.
   * `notasDescartadas`: o rebase tirou notas que o perfil não acrescenta no status do servidor (a OS foi encerrada lá:
   * o ADMIN na cancelada, o COMERCIAL na concluída ou cancelada), e a tela avisa.
   */
  async manterMinha(daTela: Pendencia): Promise<{ notasDescartadas: boolean }> {
    const adaptador = this.adaptador(daTela);
    const tabela = adaptador.tabela(this.db);
    let notasDescartadas = false;
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, tabela], async () => {
      const p = await this.db.pendencias.get(daTela.mutationId);
      if (!p) return;
      const base = p.versionServidor ?? null;
      const local = await tabela.get(p.agregadoId);
      const atras = await this.db.outbox.where('agregadoId').equals(p.agregadoId).count();
      await this.db.pendencias.delete(p.mutationId);
      if (p.entidade === 'os') {
        const rebase = await this.rebasearOs(p, local as OsLocal | undefined, base);
        if (rebase) {
          notasDescartadas = rebase.notasDescartadas;
          await this.sync.devolverAFila(p, { baseVersion: base, dados: rebase.dados });
          return;
        }
        // sem o estado do servidor (excluída lá) ou num DELETE: a regra comum, sem perder o que é só do aparelho
        if (local) await this.db.os.put({ ...(local as OsLocal), version: base });
      } else if (local) {
        await tabela.put(adaptador.paraLocal(p.agregadoId, base, adaptador.dadosDe(local)));
      }
      const excluido = !local && atras === 0;
      await this.sync.devolverAFila(p, { baseVersion: base, ...(excluido ? { op: 'DELETE' as const, dados: null } : {}) });
    });
    void this.sync.sincronizar();
    return { notasDescartadas };
  }

  /**
   * M2P1-R19: os dados da mutação da OS em conflito rebaseados (`manterMinhaOs`), com as seguintes da fila e a OS local
   * rebaseadas sobre eles, e se alguma nota nova saiu no caminho; null sem o estado do servidor ou fora de um UPSERT.
   * Roda na transação do `manterMinha`.
   */
  private async rebasearOs(
    p: Pendencia,
    local: OsLocal | undefined,
    base: number | null,
  ): Promise<{ dados: OsDados; notasDescartadas: boolean } | null> {
    const servidor = p.dadosServidor as OsDados | null | undefined;
    const enviado = p.mutacao.dados as OsDados | null;
    if (p.mutacao.op !== 'UPSERT' || !servidor || !enviado) return null;
    const u = this.auth.usuario();
    if (!u) throw new Error('Entre de novo para resolver a pendência.');
    const dados = manterMinhaOs(enviado, servidor, u.perfil, u.id);
    const seguintes = (await this.db.outbox.where('agregadoId').equals(p.agregadoId).toArray())
      .filter((m) => m.entidade === 'os' && m.op === 'UPSERT' && !!m.dados);
    const originais = seguintes.map((m) => m.dados as OsDados);
    const rebaseadas = rebaseFilaOs(enviado, dados, originais, quemNoServidor(servidor, u.perfil, u.id));
    for (const [i, m] of seguintes.entries()) {
      // reescrita = outra mutação, como no `remapearCliente`
      await this.db.outbox.update(m.seq!, { dados: rebaseadas[i], mutationId: crypto.randomUUID() });
    }
    if (local) {
      await this.db.os.put({ ...rebaseOsLocal(local, originais.at(-1) ?? enviado, rebaseadas.at(-1) ?? dados), version: base });
    }
    const ficaram = new Set([dados, ...rebaseadas].flatMap((d) => d.notas.map((n) => n.id)));
    const notasDescartadas = notasNovas([enviado, ...originais], servidor).some((id) => !ficaram.has(id));
    return { dados, notasDescartadas };
  }

  /**
   * O que "Usar a do servidor" ou "Descartar" levaria de uma OS (P4c-R15, M2-P2 M1), feito aqui e ainda não enviado, na
   * ordem canônica (`ORDEM_PERDA_OS`); vazio = nada. Conta toda mutação dela (a da pendência, as da fila, as de outras
   * pendências) e os anexos:
   * - as notas que o servidor ainda não tem;
   * - o início, a conclusão (com o resumo), o cancelamento e a reabertura, a recusa da assinatura e o "Precisa voltar"
   *   (`perdaDasMutacoes`);
   * - as fotos, a assinatura e o PDF: um anexo gravado aqui e não enviado (o de todo upload na fila ou numa pendência).
   * O Descartar do upload da OS que não existe mais (`osNaoEncontrada`, M2P2-R13) leva a OS inteira: conta o resto dela,
   * não o próprio anexo. Não escreve nada.
   */
  async perdaDaOs(p: Pendencia): Promise<ItemPerdaOs[]> {
    if (p.entidade !== 'os' && !osNaoEncontrada(p)) return [];
    const id = p.agregadoId;
    const proprio = p.entidade === TIPO_UPLOAD_ANEXO_OS ? (p.mutacao.dados as DadosUploadAnexoOs | null)?.anexoId : undefined;
    const vistas = new Set<string>();
    const mutacoes = [
      p.mutacao,
      ...(await this.db.outbox.where('agregadoId').equals(id).toArray()),
      ...(await this.db.pendencias.where('agregadoId').equals(id).toArray()).map((x) => x.mutacao),
    ].filter((m) => {
      const nova = !vistas.has(m.mutationId) && (p.entidade === 'os' || m.mutationId !== p.mutationId);
      vistas.add(m.mutationId);
      return nova;
    });
    const servidor = p.dadosServidor as OsDados | null | undefined;
    const daOs = mutacoes.filter((m) => m.entidade === 'os' && !!m.dados);
    const r = perdaDasMutacoes(daOs, servidor);
    if (notasNovas(daOs.map((m) => m.dados as OsDados), servidor).length > 0) r.add('notas');
    // todo upload na fila ou numa pendência tem o anexo dele aqui, não enviado; sem o anexo, não há bytes a perder
    const naoEnviados = await this.db.anexosOs.where('osId').equals(id).filter((a) => !a.enviado && a.id !== proprio).toArray();
    for (const a of naoEnviados) r.add(PERDA_DO_ANEXO[a.tipo]);
    return ORDEM_PERDA_OS.filter((i) => r.has(i));
  }

  /**
   * Busca o estado ATUAL do servidor (dadosServidor pode estar velho); sem rede, usa o que a pendência guardou e marca o
   * agregado para reler na próxima sincronização (M2P2-R13).
   */
  async usarServidor(daTela: Pendencia): Promise<void> {
    this.adaptador(daTela);
    const p = await this.gravada(daTela);
    if (!p) return;
    let atual: Mudanca | null | undefined;
    let fresco = true;
    try {
      atual = await this.buscarNoServidor(p, p.agregadoId);
    } catch (e) {
      if (!(e instanceof HttpErrorResponse && e.status === 0)) throw e;
      fresco = false;
      atual = p.dadosServidor == null ? null : { dados: p.dadosServidor, version: p.versionServidor ?? null, deleted: false } as unknown as Mudanca;
    }
    await this.aplicarEClear(p, p.agregadoId, atual, fresco);
  }

  /**
   * P4c-R15: "Usar a do servidor" (e o "Descartar" do excluído lá) numa proposta tira da fila tudo do agregado
   * (`limparAgregado`), inclusive o envio feito neste aparelho. true quando isso levaria um envio (a transição para
   * ENVIADA ou um UPLOAD, na fila ou numa pendência da proposta) ou um PDF gerado aqui e ainda não enviado: a tela pede
   * confirmação antes. Não escreve nada.
   * Na OS (M2-P2, carry M1), o mesmo com as fotos, a assinatura, o PDF e as notas ainda não enviados (`perdaDaOs`). A
   * pendência do próprio upload de um anexo descarta só o anexo dele: false; menos a da OS que não existe mais
   * (`osNaoEncontrada`, M2P2-R13), cujo Descartar leva a OS inteira.
   */
  async descartaEnvio(p: Pendencia): Promise<boolean> {
    if (p.entidade === 'os' || osNaoEncontrada(p)) return (await this.perdaDaOs(p)).length > 0;
    if (p.entidade !== 'proposta') return false;
    const id = p.agregadoId;
    const mutacoes = [
      p.mutacao,
      ...(await this.db.outbox.where('agregadoId').equals(id).toArray()),
      ...(await this.db.pendencias.where('agregadoId').equals(id).toArray()).map((x) => x.mutacao),
    ];
    const envio = (m: MutacaoLocal) =>
      m.entidade === TIPO_UPLOAD_DOCUMENTO
      || (m.entidade === 'proposta' && !!m.separada && (m.dados as PropostaDados | null)?.status === 'ENVIADA');
    if (mutacoes.some(envio)) return true;
    return (await this.db.documentos.where('propostaId').equals(id).filter((d) => !d.enviado).count()) > 0;
  }

  /**
   * "Descartar" de uma rejeição. A criação recusada some do aparelho. A edição recusada tira da fila tudo do agregado e
   * aplica o estado atual do servidor, que ela busca: sem rede falha e nada muda (o agregado continua protegido). O
   * upload recusado: `descartarUpload`.
   */
  async descartar(daTela: Pendencia): Promise<void> {
    const p = await this.gravada(daTela);
    if (!p) return;
    if (ehUpload(p)) return this.descartarUpload(p);
    if (p.mutacao.baseVersion === null) {
      const tabela = this.adaptador(p).tabela(this.db);
      await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, ...tabelasDeUpload(this.db), tabela], async () => {
        if (!(await this.gravada(p))) return;
        await this.limparAgregado(p);
        await this.apagarLocal(p, tabela, p.agregadoId);
      });
      return;
    }
    await this.aplicarEClear(p, p.agregadoId, await this.buscarNoServidor(p, p.agregadoId));
  }

  /**
   * DOCUMENTO_DUPLICADO: fica com o cadastro que já existe no servidor e some com o duplicado local. Se o duplicado
   * nunca chegou ao servidor (some de vez), as propostas que apontavam para ele passam a apontar para o existente,
   * inclusive as já rejeitadas por isso, que voltam à fila (P4b-R16, §11.5 "reenvia as dependentes").
   */
  async usarExistente(daTela: Pendencia): Promise<string> {
    const idExistente = daTela.erro?.idExistente;
    if (!idExistente) throw new Error('Pendência sem idExistente');
    const adaptador = this.adaptador(daTela);
    const p = await this.gravada(daTela);
    // já resolvida (toque duplo): o cadastro existente é o mesmo
    if (!p) return idExistente;
    const existente = await this.buscarNoServidor(p, idExistente);
    if (!existente || existente.deleted) throw new Error('O cadastro existente não foi encontrado no servidor.');
    // atualização: o agregado local existe no servidor, então restaura a cópia dele em vez de apagar
    const proprio = p.mutacao.baseVersion !== null ? await this.buscarNoServidor(p, p.agregadoId) : null;
    const tabela = adaptador.tabela(this.db);
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, ...tabelasDeUpload(this.db), tabela, this.db.propostas], async () => {
      if (!(await this.gravada(p))) return;
      await this.limparAgregado(p);
      if (proprio && !proprio.deleted) {
        await tabela.put(adaptador.paraLocal(p.agregadoId, proprio.version, proprio.dados));
      } else {
        await this.apagarLocal(p, tabela, p.agregadoId);
        if (p.entidade === 'cliente') await this.remapearCliente(p.agregadoId, idExistente);
      }
      await tabela.put(adaptador.paraLocal(idExistente, existente.version, existente.dados));
    });
    void this.sync.sincronizar();
    return idExistente;
  }

  /**
   * "Corrigir e reenviar" de uma proposta recusada pelo servidor (§11.5, P4b-R23), mesmo com o status otimista já
   * adiante (ex.: enviada offline: a fila é `[E recusada, T ENVIADA, UPLOAD]`): aplica a edição na recusada e nas
   * mutações `proposta` retidas atrás dela e devolve a recusada ao `seq` dela, numa transação só. O núcleo é o mesmo
   * da edição comum do rascunho com recusa e retidas (P4b-R27), por isso fica no `PropostasRepo.corrigirPendencia`,
   * que documenta as regras (só recusa VALIDACAO de dados de rascunho, P4b-R28) e os erros.
   */
  corrigirProposta(pendenciaId: string, edicao: Partial<EdicaoRascunho>): Promise<void> {
    return this.repo.corrigirPendencia(pendenciaId, edicao);
  }

  /**
   * O cliente `de` deixou de existir no aparelho em favor de `para`: troca o `clienteId` nas propostas locais e nos
   * `dados` das mutações de proposta na fila. A mutação reescrita ganha outro `mutationId` (e deixa de estar em voo):
   * o resultado de um envio em curso com o id antigo não é aplicado por cima, e ela sai de novo.
   */
  private async remapearCliente(de: string, para: string): Promise<void> {
    const trocar = (d: unknown): PropostaDados => ({ ...(d as PropostaDados), clienteId: para });
    const doCliente = (x: { entidade: string; dados: unknown }) =>
      x.entidade === 'proposta' && (x.dados as PropostaDados | null)?.clienteId === de;
    await this.db.propostas.where('clienteId').equals(de).modify({ clienteId: para });
    const naFila = await this.db.outbox.filter(doCliente).toArray();
    for (const m of naFila) {
      await this.db.outbox.update(m.seq!, { dados: trocar(m.dados), mutationId: crypto.randomUUID(), enviando: false });
    }
    // dependentes já recusadas (ex.: "Cliente não encontrado"): voltam à fila no lugar delas; num conflito, só a
    // mutação guardada é corrigida (a decisão continua com o usuário)
    for (const x of await this.db.pendencias.filter((x) => doCliente(x.mutacao)).toArray()) {
      if (x.tipo === 'REJEITADO') {
        await this.db.pendencias.delete(x.mutationId);
        await this.sync.devolverAFila(x, { dados: trocar(x.mutacao.dados) });
      } else {
        await this.db.pendencias.update(x.mutationId, { mutacao: { ...x.mutacao, dados: trocar(x.mutacao.dados) } });
      }
    }
  }

  /**
   * Upload recusado (PDF da proposta ou anexo da OS): some com o envio — a pendência e o registro local ainda não
   * enviado. O agregado e as mutações dele na fila ficam e voltam a sair.
   * M2P2-R13: enquanto o upload estava na fila, o pull pulou as mudanças do agregado (o cursor passou delas), e uma
   * recusa não traz o estado do servidor (o OK, o upload aceito e o "Usar a do servidor" trazem). Então o agregado fica
   * marcado para reler e, se nada mais dele está na fila, é relido já (`relerDesprotegidos`, com internet; sem ela, na
   * próxima sincronização): a OS reaberta lá volta em andamento, e a que saiu do técnico sai do aparelho.
   * O 404 `OS_NAO_ENCONTRADA` (`osNaoEncontrada`): a OS não existe mais para este usuário, e cada upload que viesse
   * atrás teria a mesma recusa, um Descartar por foto. Então este Descartar leva tudo dela na fila (`limparAgregado`,
   * com a confirmação do P4c-R15 na tela) e a relê, o que a tira do aparelho.
   */
  private async descartarUpload(p: Pendencia): Promise<void> {
    const tipo = tipoUploadDe(p.entidade)!;
    if (osNaoEncontrada(p)) {
      await this.limparEMarcar(p);
    } else {
      const id = tipo.idDe(p.mutacao.dados);
      await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, this.db.meta, ...tipo.tabelas(this.db)], async () => {
        if (!(await this.gravada(p))) return;
        await this.db.pendencias.delete(p.mutationId);
        await this.sync.marcarParaReler([marcaDeReleitura(tipo.agregado, p.agregadoId)]);
        if (!id) return;
        await this.db.outbox.filter((m) => m.entidade === tipo.entidade && tipo.idDe(m.dados) === id).delete();
        const registro = await tipo.tabela(this.db).get(id);
        if (registro && !registro.enviado) await tipo.apagar(this.db, [id]);
      });
    }
    await this.sync.relerDesprotegidos();
    void this.sync.sincronizar();
  }

  /**
   * Tira da fila e das pendências tudo do agregado (`limparAgregado`) sem o estado do servidor e o marca para reler
   * (M2P2-R13); o registro local fica até a releitura.
   */
  private async limparEMarcar(p: Pendencia): Promise<void> {
    const agregado = tipoUploadDe(p.entidade)?.agregado ?? p.entidade;
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, this.db.meta, ...tabelasDeUpload(this.db)], async () => {
      if (!(await this.gravada(p))) return;
      await this.limparAgregado(p);
      await this.sync.marcarParaReler([marcaDeReleitura(agregado, p.agregadoId)]);
    });
  }

  /** A pendência como está gravada; undefined se já foi resolvida. */
  private gravada(p: Pendencia): Promise<Pendencia | undefined> {
    return this.db.pendencias.get(p.mutationId);
  }

  /** O adaptador da entidade da pendência; o upload não tem (só "Descartar" vale para ele). */
  private adaptador(p: Pendencia): Adaptador {
    const adaptador = adaptadorDe(p.entidade);
    if (!adaptador) throw new Error('Esta ação não vale para esta pendência.');
    return adaptador;
  }

  /**
   * Apaga o registro local da pendência. P4b-R30: se é uma proposta, os PDFs dela saem junto, enviados ou não (têm
   * valores, e o tombstone que os apagaria já passou pelo cursor); numa OS, os anexos dela. Nada dele fica na fila
   * depois de `limparAgregado`. Precisa das tabelas de upload (`tabelasDeUpload`) na transação.
   */
  private async apagarLocal(p: Pendencia, tabela: Table<RegistroLocal, string>, id: string): Promise<void> {
    await tabela.delete(id);
    await apagarUploadsDoAgregado(this.db, p.entidade, id);
  }

  /**
   * Tira da fila e das pendências tudo do agregado. P4b-R14: os uploads (PDF da proposta, anexo da OS) que saem junto
   * não têm mais como ser enviados, então os registros locais deles ainda não enviados são apagados; os já enviados
   * ficam (cópia do servidor) enquanto o agregado local fica; quando ele também sai, `apagarLocal` leva todos
   * (P4b-R30). Precisa das tabelas de upload (`tabelasDeUpload`) na transação.
   */
  private async limparAgregado(p: Pendencia): Promise<void> {
    const naFila = await this.db.outbox.where('agregadoId').equals(p.agregadoId).toArray();
    const pendentes = await this.db.pendencias.where('agregadoId').equals(p.agregadoId).toArray();
    const mutacoes = [...naFila, ...pendentes.map((x) => x.mutacao)];
    await this.db.pendencias.where('agregadoId').equals(p.agregadoId).delete();
    await this.db.outbox.where('agregadoId').equals(p.agregadoId).delete();
    await apagarUploadsDasMutacoes(this.db, mutacoes, (r) => !r.enviado);
  }

  /**
   * Aplica o estado do servidor (null/deleted = apagar) e limpa o agregado, tudo numa transação. `fresco`: lido agora
   * do servidor, e a marca de releitura sai; senão (o guardado na pendência, sem rede), fica marcado (M2P2-R13).
   */
  private async aplicarEClear(p: Pendencia, id: string, m: Mudanca | null, fresco = true): Promise<void> {
    const adaptador = this.adaptador(p);
    const tabela = adaptador.tabela(this.db);
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, this.db.meta, ...tabelasDeUpload(this.db), tabela], async () => {
      if (!(await this.gravada(p))) return;
      await this.limparAgregado(p);
      const marca = [marcaDeReleitura(p.entidade, id)];
      await (fresco ? this.sync.desmarcarReleitura(marca) : this.sync.marcarParaReler(marca));
      if (!m || m.deleted) {
        await this.apagarLocal(p, tabela, id);
      } else {
        await tabela.put(adaptador.paraLocal(id, m.version, m.dados));
      }
    });
  }

  /** null = 404. Não escreve nada. */
  private async buscarNoServidor(p: Pendencia, id: string): Promise<Mudanca | null> {
    try {
      return await firstValueFrom(this.http.get<Mudanca>(`/api/sync/agregado/${p.entidade}/${id}`));
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 404) return null;
      throw e;
    }
  }
}
