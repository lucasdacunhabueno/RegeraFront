import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import type { Table } from 'dexie';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { gerarCodigoProvisorioOs } from '../../features/os/codigo-provisorio-os';
import type { OsDados } from '../../features/os/os-models';
import { quemNoServidor, rebaseFilaOs, rebaseOsLocal } from '../../features/os/rebase-os';
import { gerarCodigoProvisorio } from '../../features/propostas/codigo-provisorio';
import { Toasts } from '../../shared/ui/toasts';
import { ArquivosService } from '../arquivos/arquivos-service';
import { AuthService } from '../auth/auth-service';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { observar } from '../db/observar';
import { RegeraDb } from '../db/regera-db';
import { falhaDeRede, mensagemDeErro } from '../http/erro-api';
import { ADAPTADORES, adaptadorDe } from './adaptadores';
import {
  Entidade, EntidadeUpload, Mudanca, MutacaoLocal, Operacao, Pendencia, RespostaPull, RespostaPush, ResultadoMutacao,
  TIPO_UPLOAD_ANEXO_OS, TIPO_UPLOAD_DOCUMENTO,
} from './sync-models';
import {
  apagarUploadsDoAgregado, ehUpload, tabelasDeUpload, TipoUpload, tiposUpload, tipoUploadDe, TIPOS_UPLOAD,
} from './tipos-upload';

const CHAVE_CURSOR = 'cursor';
const CHAVE_CURSOR_DONO = 'cursorDono';
const CHAVE_ULTIMO_SYNC = 'ultimoSync';
/** M2P2-R13: `entidade:id` dos agregados a reler do servidor quando não houver nada deles na fila nem nas pendências. */
const CHAVE_RELER = 'relerAoDesproteger';
const LOTE = 100;
const LIMITE_PULL = 500;
const MAX_RODADAS_PUSH = 50;
/** Rodadas extras pedidas por `sincronizar()` durante uma rodada em andamento. */
const MAX_REPETICOES = 3;
/** Rejeições que o servidor não grava: é seguro reenviar a mesma mutação depois. */
const CODIGOS_TRANSITORIOS = new Set(['ERRO_INTERNO', 'INTEGRIDADE']);
/** Trocas automáticas de código provisório por proposta ou OS numa sincronização, antes de virar pendência. */
const MAX_TROCAS_CODIGO = 3;
/** Os agregados com código provisório gerado no aparelho (`PROV-` e `OSP-`) e o gerador de cada um. */
const GERA_CODIGO_PROVISORIO: Readonly<Partial<Record<Entidade, () => string>>> = {
  proposta: gerarCodigoProvisorio,
  os: gerarCodigoProvisorioOs,
};

/**
 * Como terminou uma sincronização: `sem-rede` quando um pedido não chegou ao servidor (`falhaDeRede`, ou o 401 cuja
 * renovação não chegou lá: a sessão não expirou); `falhou` com outro erro (o aviso já saiu, menos no 401); `ignorada`
 * sem internet, sem sessão ou com a sessão expirada.
 */
export type FimSincronizacao = 'concluida' | 'sem-rede' | 'falhou' | 'ignorada';

/** A marca de releitura (`CHAVE_RELER`) de um agregado. */
export function marcaDeReleitura(entidade: string, id: string): string {
  return `${entidade}:${id}`;
}

function semSeq(m: MutacaoLocal): MutacaoLocal {
  const copia = { ...m };
  delete copia.seq;
  return copia;
}

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly http = inject(HttpClient);
  private readonly db = inject(RegeraDb);
  private readonly auth = inject(AuthService);
  private readonly conectividade = inject(ConectividadeService);
  private readonly toasts = inject(Toasts);
  private readonly arquivos = inject(ArquivosService);
  private emAndamento: Promise<FimSincronizacao> | null = null;
  /** Alguém pediu `sincronizar()` enquanto uma rodada rodava: o que ele quer enviar pode ter ficado de fora. */
  private repetir = false;
  /** A releitura em curso (`relerDesprotegidos`), para a próxima esperar. */
  private releitura: Promise<void> = Promise.resolve();

  readonly sincronizando = signal(false);
  readonly ultimoSync = signal<string | null>(null);
  /** Mutações na outbox. */
  readonly naoSincronizados = signal(0);
  /** Conflitos e rejeições esperando decisão do usuário. */
  readonly problemas = signal(0);

  constructor() {
    // até o injetor ser destruído (no app, nunca; nos testes, a cada teste: senão as consultas se acumulam)
    observar(() => this.db.outbox.count()).pipe(takeUntilDestroyed()).subscribe((n) => this.naoSincronizados.set(n));
    observar(() => this.db.pendencias.count()).pipe(takeUntilDestroyed()).subscribe((n) => this.problemas.set(n));
    void this.db.lerMeta<string>(CHAVE_ULTIMO_SYNC).then((v) => this.ultimoSync.set(v ?? null));
  }

  /**
   * Enfileira uma mutação. Coalesce com a última mutação do agregado na fila se ela ainda não foi enviada, é da mesma
   * entidade e não é `separada`. Com `separada` (transição de status), sempre cria uma mutação nova, que também nunca
   * recebe coalescência: a edição seguinte vira outra mutação, atrás dela, e a ordem da fila é a ordem dos fatos.
   */
  async registrar(
    entidade: Entidade,
    agregadoId: string,
    op: Operacao,
    dados: unknown | null,
    baseVersion: number | null,
    opcoes: { separada?: boolean } = {},
  ): Promise<void> {
    await this.db.transaction('rw', this.db.outbox, async () => {
      const doAgregado = await this.db.outbox.where('agregadoId').equals(agregadoId).toArray();
      const emVoo = doAgregado.some((m) => m.enviando);
      const primeira = doAgregado[0];
      if (op === 'DELETE' && !emVoo && primeira && primeira.entidade === entidade && primeira.baseVersion === null) {
        // criado offline e excluído antes de chegar ao servidor: nada a enviar
        await this.db.outbox.bulkDelete(doAgregado.map((m) => m.seq!));
        return;
      }
      const ultima = doAgregado.at(-1);
      if (!opcoes.separada && ultima && !ultima.enviando && !ultima.separada && ultima.entidade === entidade) {
        await this.db.outbox.update(ultima.seq!, { op, dados, mutationId: crypto.randomUUID() });
        return;
      }
      await this.db.outbox.add({
        mutationId: crypto.randomUUID(),
        entidade,
        agregadoId,
        op,
        baseVersion,
        dados,
        ...(opcoes.separada ? { separada: true } : {}),
        criadaEm: new Date().toISOString(),
      });
    });
  }

  /**
   * Enfileira o upload do PDF `documentoId` (tabela `documentos`) da proposta, atrás das mutações dela já na fila:
   * sai depois delas (FIFO do agregado) e nunca é coalescido.
   */
  registrarUpload(propostaId: string, documentoId: string): Promise<void> {
    return this.enfileirarUpload(TIPO_UPLOAD_DOCUMENTO, propostaId, documentoId);
  }

  /**
   * Enfileira o upload do anexo `anexoId` (tabela `anexosOs`: foto, assinatura ou o PDF) da OS, atrás das mutações
   * dela já na fila: sai depois da que deixou a OS no status que o servidor exige, e nunca é coalescido. Como o
   * `registrarUpload`, usa só a `outbox`: quem grava o anexo e o upload juntos abre a transação com as duas tabelas.
   */
  registrarUploadAnexoOs(osId: string, anexoId: string): Promise<void> {
    return this.enfileirarUpload(TIPO_UPLOAD_ANEXO_OS, osId, anexoId);
  }

  private async enfileirarUpload(entidade: EntidadeUpload, agregadoId: string, id: string): Promise<void> {
    await this.db.outbox.add({
      mutationId: crypto.randomUUID(),
      entidade,
      agregadoId,
      op: 'UPLOAD',
      baseVersion: null,
      dados: TIPOS_UPLOAD[entidade].dados(id),
      separada: true,
      criadaEm: new Date().toISOString(),
    });
  }

  /**
   * Devolve a mutação da pendência à fila no lugar dela — o `seq` original, na frente das que ficaram retidas atrás —,
   * com `mudancas`, outro `mutationId` e fora de voo. Sem `seq` livre, refaz a fila do agregado: ela primeiro e as
   * outras na mesma ordem (a ordem entre agregados não importa). Precisa de `outbox` na transação de quem chama.
   */
  async devolverAFila(p: Pendencia, mudancas: Partial<MutacaoLocal>): Promise<void> {
    const m: MutacaoLocal = { ...p.mutacao, ...mudancas, mutationId: crypto.randomUUID(), enviando: false };
    if (m.seq !== undefined && !(await this.db.outbox.get(m.seq))) {
      await this.db.outbox.put(m);
      return;
    }
    const atras = await this.db.outbox.where('agregadoId').equals(p.agregadoId).toArray();
    await this.db.outbox.bulkDelete(atras.map((x) => x.seq!));
    await this.db.outbox.bulkAdd([m, ...atras].map(semSeq));
  }

  /**
   * M2P2-R13: marca os agregados para reler do servidor (`relerDesprotegidos`) assim que nada deles estiver na fila nem
   * nas pendências. Precisa de `meta` na transação de quem chama.
   */
  async marcarParaReler(marcas: readonly string[]): Promise<void> {
    if (marcas.length === 0) return;
    const atuais = (await this.db.lerMeta<string[]>(CHAVE_RELER)) ?? [];
    const novas = [...new Set([...atuais, ...marcas])];
    if (novas.length !== atuais.length) await this.db.gravarMeta(CHAVE_RELER, novas);
  }

  /** O estado do servidor já está no aparelho: tira as marcas. Precisa de `meta` na transação de quem chama. */
  async desmarcarReleitura(marcas: readonly string[]): Promise<void> {
    const atuais = (await this.db.lerMeta<string[]>(CHAVE_RELER)) ?? [];
    const fora = new Set(marcas);
    const restantes = atuais.filter((x) => !fora.has(x));
    if (restantes.length !== atuais.length) await this.db.gravarMeta(CHAVE_RELER, restantes);
  }

  /**
   * M2P2-R13: relê do servidor (`GET /api/sync/agregado/{entidade}/{id}`) cada agregado marcado que não tem mais nada
   * na fila nem nas pendências, e aplica como o "Usar a do servidor": 404 ou excluído apaga o local e os uploads dele
   * (o tombstone); senão grava o do servidor, se não for mais velho que o local. É o reparo das mudanças do pull que o
   * aparelho pulou enquanto o agregado estava protegido (o cursor passou delas): sem ele, um upload recusado e
   * descartado deixaria a OS como estava (a reaberta continuaria concluída, a de outro técnico ficaria no aparelho).
   * Roda ao fim de toda sincronização e depois das ações de pendência que liberam o agregado. Sem internet ou sem
   * sessão não faz nada; com erro de rede ou do servidor, para e deixa as marcas para a próxima. Nunca falha.
   */
  relerDesprotegidos(): Promise<void> {
    // uma leitura de cada vez: a segunda (a da pendência durante a sincronização) já vê as marcas que a primeira tirou
    const vez = this.releitura.then(() => this.relerAgora());
    this.releitura = vez.catch(() => undefined);
    return vez;
  }

  private async relerAgora(): Promise<void> {
    if (!this.conectividade.online() || !this.auth.autenticado() || this.auth.sessaoExpirada()) return;
    for (const marca of (await this.db.lerMeta<string[]>(CHAVE_RELER)) ?? []) {
      const corte = marca.indexOf(':');
      const entidade = marca.slice(0, corte);
      const id = marca.slice(corte + 1);
      const adaptador = adaptadorDe(entidade);
      if (!adaptador || corte < 0) {
        await this.db.transaction('rw', this.db.meta, () => this.desmarcarReleitura([marca]));
        continue;
      }
      if (await this.protegido(id)) continue;
      let atual: Mudanca | null;
      try {
        atual = await firstValueFrom(this.http.get<Mudanca>(`/api/sync/agregado/${entidade}/${id}`));
      } catch (e) {
        if (!(e instanceof HttpErrorResponse)) return;
        if (e.status !== 404) return;
        atual = null;
      }
      const tabela = adaptador.tabela(this.db);
      await this.db.transaction('rw', [this.db.meta, this.db.outbox, this.db.pendencias, tabela, ...tabelasDeUpload(this.db)], async () => {
        // algo do agregado entrou na fila durante a leitura: o OK dela traz o estado, e a marca fica
        if (await this.protegido(id)) return;
        await this.desmarcarReleitura([marca]);
        if (!atual || atual.deleted) {
          await tabela.delete(id);
          await apagarUploadsDoAgregado(this.db, entidade, id);
          return;
        }
        const local = (await tabela.get(id)) as { version?: number | null } | undefined;
        if (local && (local.version ?? -1) > atual.version) return;
        await tabela.put(adaptador.paraLocal(id, atual.version, atual.dados));
      });
    }
  }

  /** O agregado tem mutação na fila ou pendência (o pull não o sobrescreve). */
  private async protegido(id: string): Promise<boolean> {
    return (await this.db.outbox.where('agregadoId').equals(id).count()) + (await this.db.pendencias.where('agregadoId').equals(id).count()) > 0;
  }

  /**
   * Inicia uma sincronização ou, se já houver uma em curso, pede mais uma rodada ao fim dela (o push dela pode já ter
   * passado da mutação que motivou a chamada) e devolve a promessa do laço inteiro, com o fim da última rodada.
   */
  sincronizar(): Promise<FimSincronizacao> {
    if (this.emAndamento) {
      this.repetir = true;
      return this.emAndamento;
    }
    this.emAndamento = this.rodadas().finally(() => (this.emAndamento = null));
    return this.emAndamento;
  }

  private async rodadas(): Promise<FimSincronizacao> {
    this.repetir = false;
    let fim = await this.executar();
    for (let i = 0; i < MAX_REPETICOES && this.repetir; i++) {
      this.repetir = false;
      if (!this.conectividade.online() || !(await this.temEnvioElegivel())) break;
      fim = await this.executar();
    }
    this.repetir = false;
    return fim;
  }

  /** Há mutação na outbox de agregado sem pendência (a mesma regra de `enviar`). */
  private async temEnvioElegivel(): Promise<boolean> {
    const bloqueados = new Set((await this.db.pendencias.toArray()).map((p) => p.agregadoId));
    return (await this.db.outbox.filter((m) => !bloqueados.has(m.agregadoId)).count()) > 0;
  }

  /** Espera a sincronização em curso (se houver), com teto de 5 s. */
  async aguardarOciosa(): Promise<void> {
    const atual = this.emAndamento;
    if (!atual) return;
    await Promise.race([atual.catch(() => undefined), new Promise<void>((r) => setTimeout(r, 5000))]);
  }

  async contarNaoSincronizados(): Promise<number> {
    return (await this.db.outbox.count()) + (await this.db.pendencias.count());
  }

  private async executar(): Promise<FimSincronizacao> {
    if (!this.conectividade.online() || !this.auth.autenticado() || this.auth.sessaoExpirada()) return 'ignorada';
    this.sincronizando.set(true);
    try {
      await this.purgarDocumentosDoTecnico();
      await this.enviar();
      const aplicou = await this.receber();
      await this.relerDesprotegidos();
      if (aplicou && this.conectividade.online()) {
        this.prefetchArquivos().catch(() => undefined);
      }
      const agora = new Date().toISOString();
      this.ultimoSync.set(agora);
      await this.db.gravarMeta(CHAVE_ULTIMO_SYNC, agora);
      return 'concluida';
    } catch (erro) {
      if (falhaDeRede(erro)) return 'sem-rede';
      const recusado = erro instanceof HttpErrorResponse && erro.status === 401;
      // M1: o 401 de verdade já marcou a sessão expirada; sem a marca, a renovação do interceptor é que não chegou
      if (recusado && !this.auth.sessaoExpirada()) return 'sem-rede';
      if (!recusado) this.toasts.erro(`Falha ao sincronizar: ${mensagemDeErro(erro)}`);
      return 'falhou';
    } finally {
      this.sincronizando.set(false);
    }
  }

  /**
   * Em rodadas: a primeira mutação de cada agregado sem pendência. As de dados vão num lote do push; os uploads, um a
   * um, por multipart. Uma rejeição transitória (ou 5xx no upload) encerra o envio desta sincronização.
   */
  private async enviar(): Promise<void> {
    const trocasDeCodigo = new Map<string, number>();
    for (let rodada = 0; rodada < MAX_RODADAS_PUSH; rodada++) {
      const lote = await this.db.transaction('rw', [this.db.outbox, this.db.pendencias], async () => {
        const bloqueados = new Set((await this.db.pendencias.toArray()).map((p) => p.agregadoId));
        const vistos = new Set<string>();
        const escolhidas: MutacaoLocal[] = [];
        for (const m of await this.db.outbox.orderBy('seq').toArray()) {
          if (bloqueados.has(m.agregadoId) || vistos.has(m.agregadoId)) continue;
          vistos.add(m.agregadoId);
          escolhidas.push(m);
          if (escolhidas.length === LOTE) break;
        }
        await this.marcarEnviando(escolhidas, true);
        return escolhidas;
      });
      if (lote.length === 0) return;

      const mutacoes = lote.filter((m) => !ehUpload(m));
      const uploads = lote.filter(ehUpload);
      let tentados = 0;
      try {
        let transitorio = mutacoes.length > 0 && (await this.enviarLote(mutacoes, trocasDeCodigo));
        for (const m of uploads) {
          tentados++;
          if (!(await this.enviarUpload(m))) transitorio = true;
        }
        if (transitorio) return;
      } catch (erro) {
        // M2: os uploads do lote que nem saíram voltam a ficar fora de voo (senão "está sendo enviado" trava o PDF e a
        // exclusão até a próxima sincronização chegar ao servidor); o que saiu pode ter chegado e fica em voo, inclusive o
        // que saiu numa sincronização anterior (o lote guarda o `enviando` de antes desta rodada)
        for (const m of uploads.slice(tentados)) if (!m.enviando) await this.liberar(m);
        throw erro;
      }
    }
  }

  /** Um lote do push. true = houve rejeição transitória. */
  private async enviarLote(lote: MutacaoLocal[], trocasDeCodigo: Map<string, number>): Promise<boolean> {
    const resp = await firstValueFrom(
      this.http.post<RespostaPush>('/api/sync/push', {
        mutacoes: lote.map((m) => ({
          mutationId: m.mutationId,
          entidade: m.entidade,
          id: m.agregadoId,
          op: m.op,
          baseVersion: m.baseVersion,
          dados: m.dados,
        })),
      }),
    );
    const porId = new Map(lote.map((m) => [m.mutationId, m]));
    let transitorio = false;
    for (const r of resp.resultados) {
      const m = porId.get(r.mutationId);
      if (!m) continue;
      if (r.status === 'REJEITADO' && r.erro && CODIGOS_TRANSITORIOS.has(r.erro.codigo)) {
        // não foi gravado no servidor: volta a ser elegível e não se tenta de novo nesta sincronização
        await this.liberar(m);
        transitorio = true;
        continue;
      }
      if (r.status === 'REJEITADO' && r.erro?.codigo === 'CODIGO_PROVISORIO_DUPLICADO' && Object.hasOwn(GERA_CODIGO_PROVISORIO, m.entidade)) {
        const trocas = trocasDeCodigo.get(m.agregadoId) ?? 0;
        if (trocas < MAX_TROCAS_CODIGO) {
          // colisão do código gerado no aparelho: gera outro e reenvia na próxima rodada, sem pendência
          trocasDeCodigo.set(m.agregadoId, trocas + 1);
          await this.trocarCodigoProvisorio(m);
          continue;
        }
      }
      await this.aplicarResultado(m, r);
    }
    return transitorio;
  }

  /** Devolve a mutação à fila (`enviando: false`), se ela não mudou durante o envio. */
  private async liberar(m: MutacaoLocal): Promise<void> {
    await this.db.transaction('rw', this.db.outbox, async () => {
      const atual = await this.db.outbox.get(m.seq!);
      if (atual?.mutationId === m.mutationId) await this.db.outbox.update(m.seq!, { enviando: false });
    });
  }

  /**
   * CODIGO_PROVISORIO_DUPLICADO: o código gerado no aparelho (`PROV-` da proposta, `OSP-` da OS, M2-P2 M2) já existe no
   * servidor. Gera outro e o grava no registro local e em todas as mutações dele na fila que levam o antigo (senão a
   * seguinte mudaria o código); a rejeitada ganha outro `mutationId` e volta a ser elegível. Se ela mudou durante o
   * envio (outro `mutationId`), a recusa é de uma versão que não existe mais: nada muda, e a versão nova sai e tem a
   * própria resposta. Na OS, um PDF já gerado com o código antigo volta `CODIGO_EXIBIDO_INVALIDO` (o servidor só aceita
   * o código dela): a pendência dele tem o "Gerar PDF novamente" (`OsRepo.regerarPdf`).
   */
  private async trocarCodigoProvisorio(m: MutacaoLocal): Promise<void> {
    const entidade = m.entidade as Entidade;
    const antigo = (m.dados as { codigoProvisorio?: string } | null)?.codigoProvisorio;
    const novo = GERA_CODIGO_PROVISORIO[entidade]!();
    const tabela = ADAPTADORES[entidade].tabela(this.db) as unknown as Table<{ id: string; codigoProvisorio: string }, string>;
    await this.db.transaction('rw', [this.db.outbox, tabela], async () => {
      if ((await this.db.outbox.get(m.seq!))?.mutationId !== m.mutationId) return;
      for (const x of await this.db.outbox.where('agregadoId').equals(m.agregadoId).toArray()) {
        const d = x.dados as { codigoProvisorio?: string } | null;
        if (x.entidade !== entidade || !d || d.codigoProvisorio !== antigo) continue;
        const dados = { ...d, codigoProvisorio: novo };
        if (x.mutationId === m.mutationId) {
          await this.db.outbox.update(x.seq!, { dados, mutationId: crypto.randomUUID(), enviando: false });
        } else {
          await this.db.outbox.update(x.seq!, { dados });
        }
      }
      const local = await tabela.get(m.agregadoId);
      if (local && local.codigoProvisorio === antigo) await tabela.update(m.agregadoId, { codigoProvisorio: novo });
    });
  }

  /**
   * Upload (multipart: `arquivo` e `metadados`) do tipo da mutação (`tipos-upload.ts`), fora do lote do push. false =
   * falha transitória (5xx, 408, 429): fica na fila para a próxima sincronização. Erro de rede (`falhaDeRede`, inclusive
   * o 504 do service worker) e 401 sem renovação propagam, como no push; as outras recusas viram pendência REJEITADO
   * (com "Descartar"), que segura o agregado.
   */
  private async enviarUpload(m: MutacaoLocal): Promise<boolean> {
    const tipo = tipoUploadDe(m.entidade)!;
    const id = tipo.idDe(m.dados);
    const registro = id ? await tipo.tabela(this.db).get(id) : undefined;
    const envio = registro ? await tipo.envio(this.db, registro) : null;
    if (!registro || !envio) {
      await this.aplicarResultado(m, { mutationId: m.mutationId, status: 'REJEITADO', erro: tipo.ausente });
      return true;
    }
    const corpo = new FormData();
    corpo.append('arquivo', envio.arquivo, envio.nomeArquivo);
    corpo.append('metadados', new Blob([JSON.stringify(envio.metadados)], { type: 'application/json' }));
    let resp: unknown;
    try {
      resp = await firstValueFrom(this.http.post<unknown>(tipo.url(m.agregadoId), corpo));
    } catch (e) {
      if (!(e instanceof HttpErrorResponse) || falhaDeRede(e) || e.status === 401) throw e;
      if (e.status >= 500 || e.status === 408 || e.status === 429) {
        await this.liberar(m);
        return false;
      }
      await this.aplicarResultado(m, { mutationId: m.mutationId, status: 'REJEITADO', erro: tipo.erro(e, registro) });
      return true;
    }
    await this.aplicarUpload(m, tipo, registro.id, resp);
    return true;
  }

  /**
   * Upload aceito (P4b-R9): a mutação sai da fila; o registro local fica `enviado`, com o `arquivoId`; o agregado
   * local recebe o anexo e a versão depois do upload (ele "toca" o agregado no servidor); e a próxima mutação dele na
   * fila passa a ter essa versão como base, senão voltaria CONFLITO.
   * P4b-R24: o toque sobe a versão em exatamente 1. Se a devolvida não é `baseVersion + 1`, alguém escreveu no agregado
   * entre a mutação anterior e o upload: a base fica `baseVersion + 1` (o que este aparelho conhece), e a próxima
   * mutação recebe CONFLITO em vez de desfazer em silêncio a escrita alheia.
   * M2P2-R3: o upload primeiro da fila não tem `baseVersion` (ex.: a foto de uma OS já sincronizada); a base conhecida
   * é então a versão do agregado local, que o pull não sobrescreve enquanto o upload está na fila. Só sem nenhuma das
   * duas (o agregado não está no aparelho, ou nunca foi ao servidor) a versão devolvida é adotada.
   * P4b-R26: a poda dos bytes é a do tipo (`enviado` e `podar`).
   */
  private async aplicarUpload(m: MutacaoLocal, tipo: TipoUpload, id: string, resp: unknown): Promise<void> {
    const devolvida = tipo.versao(resp);
    const tabela = tipo.tabela(this.db);
    const agregados = ADAPTADORES[tipo.agregado].tabela(this.db);
    await this.db.transaction('rw', [this.db.outbox, ...tipo.tabelas(this.db), agregados], async () => {
      const local = await agregados.get(m.agregadoId);
      const base = m.baseVersion ?? (local as { version?: number | null } | undefined)?.version ?? null;
      const esperada = base === null ? null : base + 1;
      const versao = esperada !== null && devolvida !== esperada ? esperada : devolvida;
      const atual = await this.db.outbox.get(m.seq!);
      if (atual?.mutationId === m.mutationId) await this.db.outbox.delete(m.seq!);
      // put do registro inteiro: o `update` do Dexie clona o objeto e, no IndexedDB dos testes, perde os bytes
      const registro = await tabela.get(id);
      if (registro) await tabela.put(tipo.enviado(registro, resp));
      await tipo.podar(this.db, id, m.agregadoId, resp);
      const proxima = await this.db.outbox.where('agregadoId').equals(m.agregadoId).first();
      if (proxima) await this.db.outbox.update(proxima.seq!, { baseVersion: versao });
      if (local) await agregados.update(m.agregadoId, tipo.noAgregado(local, resp, versao, this.auth.usuario?.() ?? undefined));
    });
  }

  private async marcarEnviando(lote: MutacaoLocal[], enviando: boolean): Promise<void> {
    await this.db.outbox.bulkUpdate(lote.map((m) => ({ key: m.seq!, changes: { enviando } })));
  }

  /** Resultado de uma mutação (do push, ou a recusa de um upload, que não tem adaptador). */
  private async aplicarResultado(m: MutacaoLocal, r: ResultadoMutacao): Promise<void> {
    const adaptador = adaptadorDe(m.entidade);
    const tabelas = adaptador ? [adaptador.tabela(this.db)] : [];
    await this.db.transaction('rw', [this.db.outbox, this.db.pendencias, ...tabelas], async () => {
      const atual = await this.db.outbox.get(m.seq!);
      const intacta = atual?.mutationId === m.mutationId;
      if (intacta) await this.db.outbox.delete(m.seq!);
      if (r.status === 'OK') {
        const seguintes = await this.db.outbox.where('agregadoId').equals(m.agregadoId).toArray();
        const proxima = seguintes[0];
        if (!intacta) {
          // alguém alterou a mutação durante o envio: não apagar nem sobrescrever o local
          if (atual) await this.db.outbox.update(atual.seq!, { baseVersion: r.version ?? null });
          return;
        }
        if (proxima) {
          // há outra mutação na fila (edição durante o envio, transição seguinte, upload): vai sobre esta versão
          await this.db.outbox.update(proxima.seq!, { baseVersion: r.version ?? null });
          const soUploads = seguintes.every(ehUpload);
          if (m.entidade === 'os') await this.rebasearSeguintesDaOs(m, r, seguintes, !soUploads);
          // o upload não leva dados da proposta: se só há uploads atrás, o local já recebe o do servidor (o número)
          if (!soUploads) return;
        }
        if (!adaptador) return;
        const tabela = adaptador.tabela(this.db);
        if (m.op === 'DELETE' || r.dados == null) {
          await tabela.delete(m.agregadoId);
        } else {
          await tabela.put(adaptador.paraLocal(m.agregadoId, r.version ?? null, r.dados));
        }
        return;
      }
      if (!intacta) return;
      await this.db.pendencias.put({
        mutationId: m.mutationId,
        entidade: m.entidade,
        agregadoId: m.agregadoId,
        tipo: r.status,
        mutacao: { ...m, enviando: false },
        dadosServidor: r.dadosServidor,
        versionServidor: r.versionServidor,
        erro: r.erro,
        criadaEm: new Date().toISOString(),
      });
    });
  }

  /**
   * OK de uma mutação da OS com outras atrás na fila. O resultado pode não ser o que foi enviado: no envio desatualizado
   * do técnico, o servidor fica com o cabeçalho do escritório, o status dele e o "Precisa voltar" dele (M2P1-R30, e a
   * OS encerrada do R26). As mutações seguintes da OS e, se for o caso, a OS local (que só é substituída com a fila
   * vazia) passam pelo `rebaseFilaOs`: o que não mudou desde o envio passa a ser o do servidor, e o que o perfil não
   * altera no status do servidor também (como o servidor faz no R26 e no R30). Senão a seguinte, já com a versão nova
   * como base, levaria os valores velhos e seria recusada (`OS_NAO_EDITAVEL`, `TRANSICAO_INVALIDA`), ou desfaria em
   * silêncio a mudança do escritório num campo que o técnico também edita. Roda na transação do `aplicarResultado`.
   */
  private async rebasearSeguintesDaOs(m: MutacaoLocal, r: ResultadoMutacao, seguintes: MutacaoLocal[], local: boolean): Promise<void> {
    const enviado = m.dados as OsDados | null;
    const servidor = r.dados as OsDados | null | undefined;
    if (m.op !== 'UPSERT' || !enviado || !servidor) return;
    const u = this.auth.usuario?.();
    const daOs = seguintes.filter((s) => s.entidade === 'os' && s.op === 'UPSERT' && !!s.dados);
    const originais = daOs.map((s) => s.dados as OsDados);
    const rebaseadas = rebaseFilaOs(enviado, servidor, originais, u ? quemNoServidor(servidor, u.perfil, u.id) : undefined);
    for (const [i, s] of daOs.entries()) {
      if (JSON.stringify(rebaseadas[i]) !== JSON.stringify(s.dados)) await this.db.outbox.update(s.seq!, { dados: rebaseadas[i] });
    }
    const atual = local ? await this.db.os.get(m.agregadoId) : undefined;
    if (atual) await this.db.os.put(rebaseOsLocal(atual, originais.at(-1) ?? enviado, rebaseadas.at(-1) ?? servidor));
  }

  /**
   * O técnico nunca vê valores (§10), e o PDF da proposta tem valores: com o perfil TECNICO (ex.: um comercial
   * rebaixado), apaga todos os documentos locais, enviados ou não, e os uploads deles na outbox e nas pendências
   * (falhariam com ACESSO_NEGADO). Roda antes do push, para o upload não sair. Os anexos da OS (sem valores) não são
   * tocados: seguem as regras de visibilidade de sempre. Os outros perfis seguem a regra da troca de dono em `receber`.
   */
  private async purgarDocumentosDoTecnico(): Promise<void> {
    if (this.auth.usuario?.()?.perfil !== 'TECNICO') return;
    const comValores = tiposUpload().filter((t) => t.temValores);
    const doTipo = (m: { entidade: string }) => comValores.some((t) => t.entidade === m.entidade);
    const tabelas = comValores.flatMap((t) => t.tabelas(this.db));
    await this.db.transaction('rw', [...tabelas, this.db.outbox, this.db.pendencias], async () => {
      await Promise.all(tabelas.map((t) => t.clear()));
      await this.db.outbox.filter(doTipo).delete();
      await this.db.pendencias.filter(doTipo).delete();
    });
  }

  /** true se aplicou alguma mudança do servidor. */
  private async receber(): Promise<boolean> {
    // o que o servidor manda depende do perfil (ex.: preço de custo): trocou o perfil, o cache local não vale mais
    const usuario = this.auth.usuario?.();
    const dono = usuario ? `${usuario.id}:${usuario.perfil}` : null;
    const cursorGravado = await this.db.lerMeta<number>(CHAVE_CURSOR);
    let cursor = cursorGravado ?? 0;
    let aplicou = false;
    if (cursorGravado !== undefined && (await this.db.lerMeta<string | null>(CHAVE_CURSOR_DONO)) !== dono) {
      // cursor de outra sessão/perfil (ou gravado no formato antigo, só o id): recomeça do zero
      cursor = 0;
      const tabelas = [...Object.values(ADAPTADORES).map((a) => a.tabela(this.db)), this.db.usuarios];
      await this.db.transaction('rw', [...tabelas, ...tabelasDeUpload(this.db)], async () => {
        await Promise.all(tabelas.map((t) => t.clear()));
        // o PDF ou o anexo já enviado é cópia do servidor (e o novo perfil pode não poder vê-lo); o não enviado espera
        // o upload
        for (const t of tiposUpload()) await t.apagar(this.db, await t.tabela(this.db).filter((r) => r.enviado).primaryKeys());
      });
      this.arquivos.limpar();
    }
    for (;;) {
      const resp = await firstValueFrom(
        this.http.get<RespostaPull>('/api/sync/pull', { params: { cursor, limite: LIMITE_PULL } }),
      );
      await this.aplicarMudancas(resp.mudancas);
      aplicou ||= resp.mudancas.length > 0;
      await this.db.transaction('rw', this.db.usuarios, async () => {
        await this.db.usuarios.clear();
        await this.db.usuarios.bulkPut(resp.usuarios);
      });
      const avancou = resp.cursor > cursor;
      cursor = resp.cursor;
      await this.db.transaction('rw', this.db.meta, async () => {
        await this.db.gravarMeta(CHAVE_CURSOR, cursor);
        await this.db.gravarMeta(CHAVE_CURSOR_DONO, dono);
      });
      if (!resp.temMais || !avancou) return aplicou;
    }
  }

  /**
   * Depois de um pull com mudanças: baixa para o cache local o logo da empresa e as fotos dos itens ativos,
   * para aparecerem (e irem no PDF) offline. Em segundo plano, dois por vez, sem propagar erro.
   */
  private async prefetchArquivos(): Promise<void> {
    const empresas = await this.db.empresa.toArray();
    const itens = await this.db.itens.filter((i) => i.ativo && !!i.fotoArquivoId).toArray();
    const ids = [...new Set([...empresas.map((e) => e.logoArquivoId), ...itens.map((i) => i.fotoArquivoId)])]
      .filter((id): id is string => !!id);
    // logout ou troca de sessão no meio: para, sem pedir arquivos sem token nem para outra sessão
    const geracao = this.arquivos.geracaoAtual();
    const trabalhador = async () => {
      for (let id = ids.shift(); id !== undefined; id = ids.shift()) {
        if (!this.conectividade.online() || !this.auth.autenticado() || this.arquivos.geracaoAtual() !== geracao) return;
        await this.arquivos.garantirCache(id);
      }
    };
    await Promise.all([trabalhador(), trabalhador()]);
  }

  /**
   * Uma transação por página do pull; registro com mutação na outbox ou pendência local não é sobrescrito.
   * P4b-R26: o tombstone de uma proposta (excluída, ou que deixou de ser visível: troca de responsável, técnico
   * desatribuído) apaga também os PDFs já enviados dela (têm valores; o servidor não os serve mais a este usuário). Um
   * PDF não enviado tem o UPLOAD na fila ou numa pendência, então a proposta está protegida e o tombstone nem é aplicado.
   * O mesmo vale para a OS e os anexos dela: os não enviados sobem antes, e só depois o tombstone é aplicado (M2-R3).
   * M2P2-R13: o que foi pulado por estar protegido fica marcado para reler (`relerDesprotegidos`), porque o cursor passa
   * da mudança; o que foi aplicado perde a marca (o pull trouxe o estado atual).
   */
  private async aplicarMudancas(mudancas: Mudanca[]): Promise<void> {
    const conhecidas = mudancas.flatMap((mu) => {
      const adaptador = adaptadorDe(mu.entidade);
      return adaptador ? [{ mu, adaptador }] : [];
    });
    if (conhecidas.length === 0) return;
    const tabelas = [...new Set(conhecidas.map(({ adaptador }) => adaptador.tabela(this.db)))];
    await this.db.transaction('rw', [this.db.meta, this.db.outbox, this.db.pendencias, ...tabelasDeUpload(this.db), ...tabelas], async () => {
      const ids = [...new Set(conhecidas.map(({ mu }) => mu.id))];
      const naFila = await this.db.outbox.where('agregadoId').anyOf(ids).toArray();
      const pendentes = await this.db.pendencias.where('agregadoId').anyOf(ids).toArray();
      const protegidos = new Set([...naFila, ...pendentes].map((m) => m.agregadoId));
      const pulados = conhecidas.filter(({ mu }) => protegidos.has(mu.id)).map(({ mu }) => marcaDeReleitura(mu.entidade, mu.id));
      await this.desmarcarReleitura(conhecidas.filter(({ mu }) => !protegidos.has(mu.id)).map(({ mu }) => marcaDeReleitura(mu.entidade, mu.id)));
      await this.marcarParaReler(pulados);
      for (const { mu, adaptador } of conhecidas) {
        if (protegidos.has(mu.id)) continue;
        const tabela = adaptador.tabela(this.db);
        if (mu.deleted) {
          await tabela.delete(mu.id);
          await apagarUploadsDoAgregado(this.db, mu.entidade, mu.id, (r) => r.enviado);
        } else {
          await tabela.put(adaptador.paraLocal(mu.id, mu.version, mu.dados));
        }
      }
    });
  }
}
