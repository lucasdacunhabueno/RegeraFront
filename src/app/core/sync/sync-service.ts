import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { gerarCodigoProvisorio } from '../../features/propostas/codigo-provisorio';
import type { PropostaDados } from '../../features/propostas/proposta-models';
import { Toasts } from '../../shared/ui/toasts';
import { ArquivosService } from '../arquivos/arquivos-service';
import { AuthService } from '../auth/auth-service';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { observar } from '../db/observar';
import { RegeraDb } from '../db/regera-db';
import { mensagemDeErro } from '../http/erro-api';
import { ADAPTADORES, adaptadorDe } from './adaptadores';
import {
  Entidade, EntidadeUpload, Mudanca, MutacaoLocal, Operacao, Pendencia, RespostaPull, RespostaPush, ResultadoMutacao,
  TIPO_UPLOAD_ANEXO_OS, TIPO_UPLOAD_DOCUMENTO,
} from './sync-models';
import { ehUpload, tabelasDeUpload, TipoUpload, tiposUpload, tipoUploadDe, TIPOS_UPLOAD } from './tipos-upload';

const CHAVE_CURSOR = 'cursor';
const CHAVE_CURSOR_DONO = 'cursorDono';
const CHAVE_ULTIMO_SYNC = 'ultimoSync';
const LOTE = 100;
const LIMITE_PULL = 500;
const MAX_RODADAS_PUSH = 50;
/** Rodadas extras pedidas por `sincronizar()` durante uma rodada em andamento. */
const MAX_REPETICOES = 3;
/** Rejeições que o servidor não grava: é seguro reenviar a mesma mutação depois. */
const CODIGOS_TRANSITORIOS = new Set(['ERRO_INTERNO', 'INTEGRIDADE']);
/** Trocas automáticas de código provisório por proposta numa sincronização, antes de virar pendência. */
const MAX_TROCAS_CODIGO = 3;

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
  private emAndamento: Promise<void> | null = null;
  /** Alguém pediu `sincronizar()` enquanto uma rodada rodava: o que ele quer enviar pode ter ficado de fora. */
  private repetir = false;

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
   * Inicia uma sincronização ou, se já houver uma em curso, pede mais uma rodada ao fim dela (o push dela pode já ter
   * passado da mutação que motivou a chamada) e devolve a promessa do laço inteiro.
   */
  sincronizar(): Promise<void> {
    if (this.emAndamento) {
      this.repetir = true;
      return this.emAndamento;
    }
    this.emAndamento = this.rodadas().finally(() => (this.emAndamento = null));
    return this.emAndamento;
  }

  private async rodadas(): Promise<void> {
    this.repetir = false;
    await this.executar();
    for (let i = 0; i < MAX_REPETICOES && this.repetir; i++) {
      this.repetir = false;
      if (!this.conectividade.online() || !(await this.temEnvioElegivel())) break;
      await this.executar();
    }
    this.repetir = false;
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

  private async executar(): Promise<void> {
    if (!this.conectividade.online() || !this.auth.autenticado() || this.auth.sessaoExpirada()) return;
    this.sincronizando.set(true);
    try {
      await this.purgarDocumentosDoTecnico();
      await this.enviar();
      const aplicou = await this.receber();
      if (aplicou && this.conectividade.online()) {
        this.prefetchArquivos().catch(() => undefined);
      }
      const agora = new Date().toISOString();
      this.ultimoSync.set(agora);
      await this.db.gravarMeta(CHAVE_ULTIMO_SYNC, agora);
    } catch (erro) {
      const semRede = erro instanceof HttpErrorResponse && (erro.status === 0 || erro.status === 401);
      if (!semRede) this.toasts.erro(`Falha ao sincronizar: ${mensagemDeErro(erro)}`);
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
      let transitorio = mutacoes.length > 0 && (await this.enviarLote(mutacoes, trocasDeCodigo));
      for (const m of lote.filter(ehUpload)) {
        if (!(await this.enviarUpload(m))) transitorio = true;
      }
      if (transitorio) return;
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
      if (r.status === 'REJEITADO' && r.erro?.codigo === 'CODIGO_PROVISORIO_DUPLICADO' && m.entidade === 'proposta') {
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
   * CODIGO_PROVISORIO_DUPLICADO: o código gerado no aparelho já existe no servidor. Gera outro e o grava na proposta
   * local e em todas as mutações dela na fila que levam o antigo (senão a seguinte mudaria o código fora do rascunho);
   * a rejeitada ganha outro `mutationId` e volta a ser elegível. Se ela mudou durante o envio (outro `mutationId`), a
   * recusa é de uma versão que não existe mais: nada muda, e a versão nova sai e tem a própria resposta.
   */
  private async trocarCodigoProvisorio(m: MutacaoLocal): Promise<void> {
    const antigo = (m.dados as PropostaDados | null)?.codigoProvisorio;
    const novo = gerarCodigoProvisorio();
    await this.db.transaction('rw', [this.db.outbox, this.db.propostas], async () => {
      if ((await this.db.outbox.get(m.seq!))?.mutationId !== m.mutationId) return;
      for (const x of await this.db.outbox.where('agregadoId').equals(m.agregadoId).toArray()) {
        const d = x.dados as PropostaDados | null;
        if (x.entidade !== 'proposta' || !d || d.codigoProvisorio !== antigo) continue;
        const dados = { ...d, codigoProvisorio: novo };
        if (x.mutationId === m.mutationId) {
          await this.db.outbox.update(x.seq!, { dados, mutationId: crypto.randomUUID(), enviando: false });
        } else {
          await this.db.outbox.update(x.seq!, { dados });
        }
      }
      const local = await this.db.propostas.get(m.agregadoId);
      if (local && local.codigoProvisorio === antigo) await this.db.propostas.update(m.agregadoId, { codigoProvisorio: novo });
    });
  }

  /**
   * Upload (multipart: `arquivo` e `metadados`) do tipo da mutação (`tipos-upload.ts`), fora do lote do push. false =
   * falha transitória (5xx, 408, 429): fica na fila para a próxima sincronização. Erro de rede e 401 sem renovação
   * propagam, como no push; as outras recusas viram pendência REJEITADO (com "Descartar"), que segura o agregado.
   */
  private async enviarUpload(m: MutacaoLocal): Promise<boolean> {
    const tipo = tipoUploadDe(m.entidade)!;
    const id = tipo.idDe(m.dados);
    const registro = id ? await tipo.tabela(this.db).get(id) : undefined;
    if (!registro?.bytes) {
      await this.aplicarResultado(m, { mutationId: m.mutationId, status: 'REJEITADO', erro: tipo.ausente });
      return true;
    }
    const envio = tipo.montar(registro);
    const corpo = new FormData();
    corpo.append('arquivo', envio.arquivo, envio.nomeArquivo);
    corpo.append('metadados', new Blob([JSON.stringify(envio.metadados)], { type: 'application/json' }));
    let resp: unknown;
    try {
      resp = await firstValueFrom(this.http.post<unknown>(tipo.url(m.agregadoId), corpo));
    } catch (e) {
      if (!(e instanceof HttpErrorResponse) || e.status === 0 || e.status === 401) throw e;
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
    await this.db.transaction('rw', [this.db.outbox, tabela, agregados], async () => {
      const local = await agregados.get(m.agregadoId);
      const base = m.baseVersion ?? (local as { version?: number | null } | undefined)?.version ?? null;
      const esperada = base === null ? null : base + 1;
      const versao = esperada !== null && devolvida !== esperada ? esperada : devolvida;
      const atual = await this.db.outbox.get(m.seq!);
      if (atual?.mutationId === m.mutationId) await this.db.outbox.delete(m.seq!);
      // put do registro inteiro: o `update` do Dexie clona o objeto e, no IndexedDB dos testes, perde os bytes
      const registro = await tabela.get(id);
      if (registro) await tabela.put(tipo.enviado(registro, resp));
      await tipo.podar(tabela, m.agregadoId, resp);
      const proxima = await this.db.outbox.where('agregadoId').equals(m.agregadoId).first();
      if (proxima) await this.db.outbox.update(proxima.seq!, { baseVersion: versao });
      if (local) await agregados.update(m.agregadoId, tipo.noAgregado(local, resp, versao));
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
          // o upload não leva dados da proposta: se só há uploads atrás, o local já recebe o do servidor (o número)
          if (!seguintes.every(ehUpload)) return;
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
   * O técnico nunca vê valores (§10), e o PDF da proposta tem valores: com o perfil TECNICO (ex.: um comercial
   * rebaixado), apaga todos os documentos locais, enviados ou não, e os uploads deles na outbox e nas pendências
   * (falhariam com ACESSO_NEGADO). Roda antes do push, para o upload não sair. Os anexos da OS (sem valores) não são
   * tocados: seguem as regras de visibilidade de sempre. Os outros perfis seguem a regra da troca de dono em `receber`.
   */
  private async purgarDocumentosDoTecnico(): Promise<void> {
    if (this.auth.usuario?.()?.perfil !== 'TECNICO') return;
    const comValores = tiposUpload().filter((t) => t.temValores);
    const doTipo = (m: { entidade: string }) => comValores.some((t) => t.entidade === m.entidade);
    const tabelas = comValores.map((t) => t.tabela(this.db));
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
      const uploads = tabelasDeUpload(this.db);
      await this.db.transaction('rw', [...tabelas, ...uploads], async () => {
        await Promise.all(tabelas.map((t) => t.clear()));
        // o PDF ou o anexo já enviado é cópia do servidor (e o novo perfil pode não poder vê-lo); o não enviado espera
        // o upload
        for (const t of uploads) await t.filter((r) => r.enviado).delete();
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
   */
  private async aplicarMudancas(mudancas: Mudanca[]): Promise<void> {
    const conhecidas = mudancas.flatMap((mu) => {
      const adaptador = adaptadorDe(mu.entidade);
      return adaptador ? [{ mu, adaptador }] : [];
    });
    if (conhecidas.length === 0) return;
    const tabelas = [...new Set(conhecidas.map(({ adaptador }) => adaptador.tabela(this.db)))];
    await this.db.transaction('rw', [this.db.outbox, this.db.pendencias, ...tabelasDeUpload(this.db), ...tabelas], async () => {
      const ids = [...new Set(conhecidas.map(({ mu }) => mu.id))];
      const naFila = await this.db.outbox.where('agregadoId').anyOf(ids).toArray();
      const pendentes = await this.db.pendencias.where('agregadoId').anyOf(ids).toArray();
      const protegidos = new Set([...naFila, ...pendentes].map((m) => m.agregadoId));
      for (const { mu, adaptador } of conhecidas) {
        if (protegidos.has(mu.id)) continue;
        const tabela = adaptador.tabela(this.db);
        if (mu.deleted) {
          await tabela.delete(mu.id);
          for (const t of tiposUpload(mu.entidade)) {
            await t.tabela(this.db).where(t.campoAgregado).equals(mu.id).filter((r) => r.enviado).delete();
          }
        } else {
          await tabela.put(adaptador.paraLocal(mu.id, mu.version, mu.dados));
        }
      }
    });
  }
}
