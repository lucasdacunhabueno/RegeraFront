import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { AuthService } from '../auth/auth-service';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { ArquivoLocal, RegeraDb } from '../db/regera-db';

const TAMANHO_MAXIMO = 10 * 1024 * 1024;

export interface ArquivoEnviado {
  id: string;
  nome: string;
  mime: string;
  tamanho: number;
  sha256: string;
}

export async function paraBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result as ArrayBuffer);
    leitor.onerror = () => reject(leitor.error);
    leitor.readAsArrayBuffer(blob);
  });
}

/** Base64 em blocos: `String.fromCharCode(...bytes)` inteiro estoura o limite de argumentos em arquivos grandes. */
function base64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let binario = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    binario += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

/** `data:<mime>;base64,...` dos bytes, para o pdfmake (que não carrega URLs). */
export function paraDataUrl(bytes: ArrayBuffer, mime: string): string {
  return `data:${mime};base64,${base64(bytes)}`;
}

/** `baixarSemCache` recusou sem fazer o pedido: sem internet ou sem sessão (a mensagem já é para o usuário). */
export class ErroDownload extends Error {
  constructor(
    readonly motivo: 'SEM_INTERNET' | 'SEM_SESSAO',
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Upload (só online) e exibição de arquivos com cache local dos bytes, para mostrar offline. */
@Injectable({ providedIn: 'root' })
export class ArquivosService {
  private readonly http = inject(HttpClient);
  private readonly db = inject(RegeraDb);
  private readonly conectividade = inject(ConectividadeService);
  private readonly auth = inject(AuthService);
  private readonly urls = new Map<string, string>();
  /** obterUrl em andamento por id: chamadas concorrentes compartilham o mesmo download e a mesma URL. */
  private readonly pendentes = new Map<string, Promise<string | null>>();
  /** Muda a cada limpar(): resultados de chamadas iniciadas antes não entram mais nos mapas. */
  private geracao = 0;

  constructor() {
    // logout / troca de usuário apagam o banco: as URLs apontariam para bytes que não existem mais
    this.db.aoLimpar(() => this.limpar());
  }

  async enviar(blob: Blob, nome: string): Promise<ArquivoEnviado> {
    if (!this.conectividade.online()) {
      throw new Error('Sem internet: envie a imagem quando a conexão voltar.');
    }
    // acima de ~11 MB o Tomcat corta a conexão (sem 413) e o navegador veria só um erro de rede
    if (blob.size > TAMANHO_MAXIMO) throw new Error('Arquivo maior que 10 MB.');
    const geracao = this.geracao;
    const corpo = new FormData();
    corpo.append('arquivo', blob, nome);
    const enviado = await firstValueFrom(this.http.post<ArquivoEnviado>('/api/arquivos', corpo).pipe(timeout(60_000)));
    try {
      const bytes = await paraBytes(blob);
      // limpo (logout/troca de sessão) durante o upload: não gravar bytes da sessão anterior no banco novo
      if (geracao === this.geracao) await this.db.arquivos.put({ id: enviado.id, mime: enviado.mime, bytes });
    } catch {
      // o arquivo já está no servidor; sem cache local ele é baixado quando for exibido
    }
    return enviado;
  }

  obterUrl(id: string): Promise<string | null> {
    const pronta = this.urls.get(id);
    if (pronta) return Promise.resolve(pronta);
    let emAndamento = this.pendentes.get(id);
    if (!emAndamento) {
      const p = this.criarUrl(id).finally(() => {
        if (this.pendentes.get(id) === p) this.pendentes.delete(id);
      });
      this.pendentes.set(id, p);
      emAndamento = p;
    }
    return emAndamento;
  }

  /**
   * `data:<mime>;base64,...` dos bytes do cache local (ou baixados, com internet e sessão), para o pdfmake, que não
   * carrega URLs. Null se não houver bytes ou se limpar() aconteceu no meio (bytes de outra sessão). Nunca falha.
   */
  async obterDataUrl(id: string): Promise<string | null> {
    const geracao = this.geracao;
    try {
      const cache = await this.lerOuBaixar(id);
      if (!cache || geracao !== this.geracao) return null;
      return paraDataUrl(cache.bytes, cache.mime);
    } catch {
      return null;
    }
  }

  /** Garante os bytes no cache local (para exibir/gerar PDF offline) sem criar object URL. Nunca falha. */
  async garantirCache(id: string): Promise<void> {
    try {
      await this.lerOuBaixar(id);
    } catch {
      // melhor esforço: tenta de novo no próximo sync
    }
  }

  /**
   * Baixa o arquivo direto do servidor (o mesmo `GET /api/arquivos/{id}` autenticado), sem ler nem gravar o cache
   * local e sem object URL: para o PDF da proposta, que tem valores e é `no-store` também no Dexie (P4b-R6). Sem
   * internet ou sem sessão falha sem pedir nada (sem sessão o pedido voltaria 401 e marcaria a sessão expirada);
   * erro do servidor propaga.
   */
  async baixarSemCache(id: string): Promise<Blob> {
    if (!this.conectividade.online()) throw new ErroDownload('SEM_INTERNET', 'Sem internet: o arquivo não está neste aparelho.');
    if (!this.auth.autenticado()) throw new ErroDownload('SEM_SESSAO', 'Entre de novo para baixar o arquivo.');
    // o mesmo prazo do upload: o PDF chega a 10 MB numa rede móvel lenta
    return firstValueFrom(
      this.http.get(`/api/arquivos/${encodeURIComponent(id)}`, { responseType: 'blob' }).pipe(timeout(60_000)),
    );
  }

  /** Muda a cada limpar(): quem começou um trabalho em segundo plano compara para saber se deve parar. */
  geracaoAtual(): number {
    return this.geracao;
  }

  /** Revoga todas as object URLs e esquece o que está em memória. */
  limpar(): void {
    this.geracao++;
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.urls.clear();
    this.pendentes.clear();
  }

  private async criarUrl(id: string): Promise<string | null> {
    const geracao = this.geracao;
    const cache = await this.lerOuBaixar(id);
    if (!cache || geracao !== this.geracao) return null;
    const url = URL.createObjectURL(new Blob([cache.bytes], { type: cache.mime }));
    this.urls.set(id, url);
    return url;
  }

  private async lerOuBaixar(id: string): Promise<ArquivoLocal | null> {
    const geracao = this.geracao;
    const cache = await this.db.arquivos.get(id);
    if (cache) return cache;
    // sem sessão o pedido voltaria 401 e o interceptor marcaria a sessão como expirada
    if (!this.conectividade.online() || !this.auth.autenticado() || geracao !== this.geracao) return null;
    try {
      const blob = await firstValueFrom(this.http.get(`/api/arquivos/${id}`, { responseType: 'blob' }).pipe(timeout(30_000)));
      const novo = { id, mime: blob.type || 'application/octet-stream', bytes: await paraBytes(blob) };
      // limpo (logout/troca de sessão) durante o download: não regravar bytes da sessão anterior
      if (geracao !== this.geracao) return null;
      await this.db.arquivos.put(novo);
      return novo;
    } catch {
      return null;
    }
  }
}
