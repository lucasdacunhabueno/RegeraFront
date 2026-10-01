import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
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
  DadosUpload, Entidade, ErroMutacao, Mudanca, MutacaoLocal, Operacao, RespostaDocumento, RespostaPull, RespostaPush,
  ResultadoMutacao, TIPO_UPLOAD_DOCUMENTO,
} from './sync-models';

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

const ehUpload = (m: { entidade: string }) => m.entidade === TIPO_UPLOAD_DOCUMENTO;

const DESCARTE_UPLOAD = 'Descarte este envio para liberar a sincronização da proposta.';
/** Por `codigo` do ProblemDetail do upload; completa "O PDF <código exibido> …". */
const MOTIVO_UPLOAD_POR_CODIGO: Readonly<Record<string, string>> = {
  STATUS_INVALIDO: 'não foi aceito: no servidor, a proposta está em rascunho.',
  REVISAO_INVALIDA: 'é de outra revisão da proposta e não foi aceito.',
  DOCUMENTO_DIVERGENTE: 'não foi aceito: já existe no servidor um documento com este identificador e outro conteúdo.',
  SHA_DIVERGENTE: 'chegou diferente do que foi gerado (falha de integridade) e não foi aceito.',
  // P4b-R13: típico de PROV trocado por colisão depois de o PDF ter sido gerado offline
  CODIGO_EXIBIDO_INVALIDO: 'não foi aceito. O código da proposta mudou. Gere o PDF de novo e reenvie.',
  PROPOSTA_NAO_ENCONTRADA: 'não foi aceito: a proposta não foi encontrada no servidor ou você não tem mais acesso a ela.',
};
/** Por status HTTP, quando o `codigo` não diz mais (ex.: 413/415 do limite de upload). */
const MOTIVO_UPLOAD_POR_STATUS: Readonly<Record<number, string>> = {
  403: 'não foi aceito: você não tem permissão para enviar documentos desta proposta.',
  413: 'não foi aceito: passa do limite de 10 MB.',
  415: 'não foi aceito: o arquivo não é um PDF válido.',
};

/** Recusa definitiva do upload (4xx) como erro da pendência, com mensagem em pt-BR. */
function erroDoUpload(e: HttpErrorResponse, codigoExibido: string): ErroMutacao {
  const corpo = (typeof e.error === 'object' ? e.error : null) as { codigo?: unknown; campos?: Record<string, string> } | null;
  const codigo = typeof corpo?.codigo === 'string' ? corpo.codigo : null;
  const motivo = (codigo !== null && Object.hasOwn(MOTIVO_UPLOAD_POR_CODIGO, codigo) ? MOTIVO_UPLOAD_POR_CODIGO[codigo] : undefined)
    ?? MOTIVO_UPLOAD_POR_STATUS[e.status]
    ?? 'foi recusado pelo servidor.';
  return {
    codigo: codigo ?? `HTTP_${e.status}`,
    mensagem: `O PDF ${codigoExibido} ${motivo} ${DESCARTE_UPLOAD}`,
    ...(corpo?.campos ? { campos: corpo.campos } : {}),
  };
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
    observar(() => this.db.outbox.count()).subscribe((n) => this.naoSincronizados.set(n));
    observar(() => this.db.pendencias.count()).subscribe((n) => this.problemas.set(n));
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
  async registrarUpload(propostaId: string, documentoId: string): Promise<void> {
    const dados: DadosUpload = { documentoId };
    await this.db.outbox.add({
      mutationId: crypto.randomUUID(),
      entidade: TIPO_UPLOAD_DOCUMENTO,
      agregadoId: propostaId,
      op: 'UPLOAD',
      baseVersion: null,
      dados,
      separada: true,
      criadaEm: new Date().toISOString(),
    });
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
        if (!(await this.enviarDocumento(m))) transitorio = true;
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
   * Upload do PDF (`POST /api/propostas/{id}/documentos`, multipart), fora do lote do push. false = falha transitória
   * (5xx, 408, 429): fica na fila para a próxima sincronização. Erro de rede e 401 sem renovação propagam, como no push; as
   * outras recusas viram pendência REJEITADO (com "Descartar"), que segura a proposta.
   */
  private async enviarDocumento(m: MutacaoLocal): Promise<boolean> {
    const documentoId = (m.dados as DadosUpload | null)?.documentoId;
    const doc = documentoId ? await this.db.documentos.get(documentoId) : undefined;
    if (!doc?.bytes) {
      await this.aplicarResultado(m, {
        mutationId: m.mutationId,
        status: 'REJEITADO',
        erro: { codigo: 'DOCUMENTO_AUSENTE', mensagem: `O PDF deste envio não está mais neste aparelho. ${DESCARTE_UPLOAD}` },
      });
      return true;
    }
    const corpo = new FormData();
    corpo.append('arquivo', new Blob([doc.bytes], { type: 'application/pdf' }), `${doc.codigoExibido}.pdf`);
    const metadados = {
      id: doc.id, revisao: doc.revisao, codigoExibido: doc.codigoExibido, sha256: doc.sha256, snapshot: doc.snapshot ?? {},
    };
    corpo.append('metadados', new Blob([JSON.stringify(metadados)], { type: 'application/json' }));
    let resp: RespostaDocumento;
    try {
      resp = await firstValueFrom(
        this.http.post<RespostaDocumento>(`/api/propostas/${encodeURIComponent(m.agregadoId)}/documentos`, corpo),
      );
    } catch (e) {
      if (!(e instanceof HttpErrorResponse) || e.status === 0 || e.status === 401) throw e;
      if (e.status >= 500 || e.status === 408 || e.status === 429) {
        await this.liberar(m);
        return false;
      }
      await this.aplicarResultado(m, { mutationId: m.mutationId, status: 'REJEITADO', erro: erroDoUpload(e, doc.codigoExibido) });
      return true;
    }
    await this.aplicarUpload(m, doc.id, resp);
    return true;
  }

  /**
   * Upload aceito (P4b-R9): a mutação sai da fila; o documento local fica `enviado`, com o `arquivoId`; a proposta
   * local recebe o documento e a `versaoProposta` (o upload "toca" a proposta no servidor); e a próxima mutação dela
   * na fila passa a ter essa versão como base, senão voltaria CONFLITO.
   */
  private async aplicarUpload(m: MutacaoLocal, documentoId: string, resp: RespostaDocumento): Promise<void> {
    await this.db.transaction('rw', [this.db.outbox, this.db.documentos, this.db.propostas], async () => {
      const atual = await this.db.outbox.get(m.seq!);
      if (atual?.mutationId === m.mutationId) await this.db.outbox.delete(m.seq!);
      await this.db.documentos.update(documentoId, { enviado: true, arquivoId: resp.documento.arquivoId });
      const proxima = await this.db.outbox.where('agregadoId').equals(m.agregadoId).first();
      if (proxima) await this.db.outbox.update(proxima.seq!, { baseVersion: resp.versaoProposta });
      const local = await this.db.propostas.get(m.agregadoId);
      if (local) {
        const documentos = [...local.documentos.filter((d) => d.id !== resp.documento.id), resp.documento];
        await this.db.propostas.update(m.agregadoId, { version: resp.versaoProposta, documentos });
      }
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
   * O técnico nunca vê valores (§10), e o PDF tem valores: com o perfil TECNICO (ex.: um comercial rebaixado), apaga
   * todos os documentos locais, enviados ou não, e os uploads deles na outbox e nas pendências (falhariam com
   * ACESSO_NEGADO). Roda antes do push, para o upload não sair. Os outros perfis seguem a regra da troca de dono
   * em `receber`.
   */
  private async purgarDocumentosDoTecnico(): Promise<void> {
    if (this.auth.usuario?.()?.perfil !== 'TECNICO') return;
    await this.db.transaction('rw', [this.db.documentos, this.db.outbox, this.db.pendencias], async () => {
      await this.db.documentos.clear();
      await this.db.outbox.filter(ehUpload).delete();
      await this.db.pendencias.filter(ehUpload).delete();
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
      await this.db.transaction('rw', [...tabelas, this.db.documentos], async () => {
        await Promise.all(tabelas.map((t) => t.clear()));
        // o PDF já enviado é cópia do servidor (e o novo perfil pode não poder vê-lo); o não enviado espera o upload
        await this.db.documentos.filter((d) => d.enviado).delete();
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

  /** Uma transação por página do pull; registro com mutação na outbox ou pendência local não é sobrescrito. */
  private async aplicarMudancas(mudancas: Mudanca[]): Promise<void> {
    const conhecidas = mudancas.flatMap((mu) => {
      const adaptador = adaptadorDe(mu.entidade);
      return adaptador ? [{ mu, adaptador }] : [];
    });
    if (conhecidas.length === 0) return;
    const tabelas = [...new Set(conhecidas.map(({ adaptador }) => adaptador.tabela(this.db)))];
    await this.db.transaction('rw', [this.db.outbox, this.db.pendencias, ...tabelas], async () => {
      const ids = [...new Set(conhecidas.map(({ mu }) => mu.id))];
      const naFila = await this.db.outbox.where('agregadoId').anyOf(ids).toArray();
      const pendentes = await this.db.pendencias.where('agregadoId').anyOf(ids).toArray();
      const protegidos = new Set([...naFila, ...pendentes].map((m) => m.agregadoId));
      for (const { mu, adaptador } of conhecidas) {
        if (protegidos.has(mu.id)) continue;
        const tabela = adaptador.tabela(this.db);
        if (mu.deleted) {
          await tabela.delete(mu.id);
        } else {
          await tabela.put(adaptador.paraLocal(mu.id, mu.version, mu.dados));
        }
      }
    });
  }
}
