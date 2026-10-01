import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Toasts } from '../../shared/ui/toasts';
import { ArquivosService } from '../arquivos/arquivos-service';
import { AuthService } from '../auth/auth-service';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { observar } from '../db/observar';
import { RegeraDb } from '../db/regera-db';
import { mensagemDeErro } from '../http/erro-api';
import { ADAPTADORES } from './adaptadores';
import {
  Entidade, Mudanca, MutacaoLocal, Operacao, RespostaPull, RespostaPush, ResultadoMutacao, TIPO_UPLOAD_DOCUMENTO,
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

  /** Enfileira uma mutação, coalescendo com a pendente (não enviada) do mesmo agregado. */
  async registrar(
    entidade: Entidade,
    agregadoId: string,
    op: Operacao,
    dados: unknown | null,
    baseVersion: number | null,
  ): Promise<void> {
    await this.db.transaction('rw', this.db.outbox, async () => {
      const doAgregado = await this.db.outbox.where('agregadoId').equals(agregadoId).toArray();
      const naoEnviada = doAgregado.find((m) => !m.enviando);
      const emVoo = doAgregado.some((m) => m.enviando);
      if (!naoEnviada) {
        await this.db.outbox.add({
          mutationId: crypto.randomUUID(),
          entidade,
          agregadoId,
          op,
          baseVersion,
          dados,
          criadaEm: new Date().toISOString(),
        });
        return;
      }
      if (op === 'DELETE' && naoEnviada.baseVersion === null && !emVoo) {
        // criado offline e excluído antes de chegar ao servidor: nada a enviar
        await this.db.outbox.delete(naoEnviada.seq!);
        return;
      }
      await this.db.outbox.update(naoEnviada.seq!, { op, dados, mutationId: crypto.randomUUID() });
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

  private async enviar(): Promise<void> {
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
          await this.db.transaction('rw', this.db.outbox, async () => {
            const atual = await this.db.outbox.get(m.seq!);
            if (atual?.mutationId === m.mutationId) await this.db.outbox.update(m.seq!, { enviando: false });
          });
          transitorio = true;
          continue;
        }
        await this.aplicarResultado(m, r);
      }
      if (transitorio) return;
    }
  }

  private async marcarEnviando(lote: MutacaoLocal[], enviando: boolean): Promise<void> {
    await this.db.outbox.bulkUpdate(lote.map((m) => ({ key: m.seq!, changes: { enviando } })));
  }

  private async aplicarResultado(m: MutacaoLocal, r: ResultadoMutacao): Promise<void> {
    const adaptador = ADAPTADORES[m.entidade];
    const tabela = adaptador.tabela(this.db);
    await this.db.transaction('rw', [this.db.outbox, this.db.pendencias, tabela], async () => {
      const atual = await this.db.outbox.get(m.seq!);
      const intacta = atual?.mutationId === m.mutationId;
      if (intacta) await this.db.outbox.delete(m.seq!);
      if (r.status === 'OK') {
        const proxima = await this.db.outbox.where('agregadoId').equals(m.agregadoId).first();
        if (!intacta) {
          // alguém alterou a mutação durante o envio: não apagar nem sobrescrever o local
          if (atual) await this.db.outbox.update(atual.seq!, { baseVersion: r.version ?? null });
          return;
        }
        if (proxima) {
          // houve edição durante o envio: ela vai por cima da versão que o servidor acabou de gravar
          await this.db.outbox.update(proxima.seq!, { baseVersion: r.version ?? null });
          return;
        }
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
    const ehUpload = (m: { entidade: string }) => m.entidade === TIPO_UPLOAD_DOCUMENTO;
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
    const conhecidas = mudancas.filter((mu) => !!ADAPTADORES[mu.entidade]);
    if (conhecidas.length === 0) return;
    const tabelas = [...new Set(conhecidas.map((mu) => ADAPTADORES[mu.entidade].tabela(this.db)))];
    await this.db.transaction('rw', [this.db.outbox, this.db.pendencias, ...tabelas], async () => {
      const ids = [...new Set(conhecidas.map((mu) => mu.id))];
      const naFila = await this.db.outbox.where('agregadoId').anyOf(ids).toArray();
      const pendentes = await this.db.pendencias.where('agregadoId').anyOf(ids).toArray();
      const protegidos = new Set([...naFila, ...pendentes].map((m) => m.agregadoId));
      for (const mu of conhecidas) {
        if (protegidos.has(mu.id)) continue;
        const adaptador = ADAPTADORES[mu.entidade];
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
