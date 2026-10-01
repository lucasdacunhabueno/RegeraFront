import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Table } from 'dexie';
import { firstValueFrom, Observable } from 'rxjs';
import { observar } from '../db/observar';
import { RegeraDb } from '../db/regera-db';
import type { PropostaDados } from '../../features/propostas/proposta-models';
import { EdicaoRascunho, PropostasRepo } from '../../features/propostas/propostas-repo';
import { Adaptador, adaptadorDe, RegistroLocal } from './adaptadores';
import { Mudanca, MutacaoLocal, Pendencia, TIPO_UPLOAD_DOCUMENTO } from './sync-models';
import { SyncService } from './sync-service';
import { ehUpload, tabelasDeUpload, tiposUpload, tipoUploadDe } from './tipos-upload';

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

  observar(): Observable<Pendencia[]> {
    return observar(async () => (await this.db.pendencias.toArray()).sort((a, b) => a.criadaEm.localeCompare(b.criadaEm)));
  }

  /**
   * P4b-R17: rebase no lugar. A mutação da pendência volta à fila no `seq` dela (na frente das que ficaram retidas
   * atrás), com outro `mutationId`, `baseVersion` = versão do servidor e os próprios `dados` e `separada`. Só esta
   * pendência sai; as mutações seguintes e os documentos ficam. Se o registro local não existe mais e nada vem atrás,
   * vai como DELETE (como antes).
   */
  async manterMinha(daTela: Pendencia): Promise<void> {
    const adaptador = this.adaptador(daTela);
    const tabela = adaptador.tabela(this.db);
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, tabela], async () => {
      const p = await this.db.pendencias.get(daTela.mutationId);
      if (!p) return;
      const base = p.versionServidor ?? null;
      const local = await tabela.get(p.agregadoId);
      const atras = await this.db.outbox.where('agregadoId').equals(p.agregadoId).count();
      await this.db.pendencias.delete(p.mutationId);
      if (local) {
        await tabela.put(adaptador.paraLocal(p.agregadoId, base, adaptador.dadosDe(local)));
      }
      const excluido = !local && atras === 0;
      await this.sync.devolverAFila(p, { baseVersion: base, ...(excluido ? { op: 'DELETE' as const, dados: null } : {}) });
    });
    void this.sync.sincronizar();
  }

  /** Busca o estado ATUAL do servidor (dadosServidor pode estar velho); sem rede, usa o que a pendência guardou. */
  async usarServidor(daTela: Pendencia): Promise<void> {
    this.adaptador(daTela);
    const p = await this.gravada(daTela);
    if (!p) return;
    let atual: Mudanca | null | undefined;
    try {
      atual = await this.buscarNoServidor(p, p.agregadoId);
    } catch (e) {
      if (!(e instanceof HttpErrorResponse && e.status === 0)) throw e;
      atual = p.dadosServidor == null ? null : { dados: p.dadosServidor, version: p.versionServidor ?? null, deleted: false } as unknown as Mudanca;
    }
    await this.aplicarEClear(p, p.agregadoId, atual);
  }

  /**
   * P4c-R15: "Usar a do servidor" (e o "Descartar" do excluído lá) numa proposta tira da fila tudo do agregado
   * (`limparAgregado`), inclusive o envio feito neste aparelho. true quando isso levaria um envio (a transição para
   * ENVIADA ou um UPLOAD, na fila ou numa pendência da proposta) ou um PDF gerado aqui e ainda não enviado: a tela pede
   * confirmação antes. Não escreve nada.
   */
  async descartaEnvio(p: Pendencia): Promise<boolean> {
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
   */
  private async descartarUpload(p: Pendencia): Promise<void> {
    const tipo = tipoUploadDe(p.entidade)!;
    const id = tipo.idDe(p.mutacao.dados);
    const tabela = tipo.tabela(this.db);
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, tabela], async () => {
      if (!(await this.gravada(p))) return;
      await this.db.pendencias.delete(p.mutationId);
      if (!id) return;
      await this.db.outbox.filter((m) => m.entidade === tipo.entidade && tipo.idDe(m.dados) === id).delete();
      const registro = await tabela.get(id);
      if (registro && !registro.enviado) await tabela.delete(id);
    });
    void this.sync.sincronizar();
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
    for (const t of tiposUpload(p.entidade)) await t.tabela(this.db).where(t.campoAgregado).equals(id).delete();
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
    for (const t of tiposUpload()) {
      const ids = mutacoes
        .filter((m) => m.entidade === t.entidade)
        .map((m) => t.idDe(m.dados))
        .filter((id): id is string => !!id);
      if (ids.length > 0) await t.tabela(this.db).where('id').anyOf(ids).filter((r) => !r.enviado).delete();
    }
  }

  /** Aplica o estado do servidor (null/deleted = apagar) e limpa o agregado, tudo numa transação. */
  private async aplicarEClear(p: Pendencia, id: string, m: Mudanca | null): Promise<void> {
    const adaptador = this.adaptador(p);
    const tabela = adaptador.tabela(this.db);
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, ...tabelasDeUpload(this.db), tabela], async () => {
      if (!(await this.gravada(p))) return;
      await this.limparAgregado(p);
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
