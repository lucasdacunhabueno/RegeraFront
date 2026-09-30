import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
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

async function paraBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result as ArrayBuffer);
    leitor.onerror = () => reject(leitor.error);
    leitor.readAsArrayBuffer(blob);
  });
}

/** Upload (só online) e exibição de arquivos com cache local dos bytes, para mostrar offline. */
@Injectable({ providedIn: 'root' })
export class ArquivosService {
  private readonly http = inject(HttpClient);
  private readonly db = inject(RegeraDb);
  private readonly conectividade = inject(ConectividadeService);
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
    const corpo = new FormData();
    corpo.append('arquivo', blob, nome);
    const enviado = await firstValueFrom(this.http.post<ArquivoEnviado>('/api/arquivos', corpo).pipe(timeout(60_000)));
    try {
      await this.db.arquivos.put({ id: enviado.id, mime: enviado.mime, bytes: await paraBytes(blob) });
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

  /** Garante os bytes no cache local (para exibir/gerar PDF offline) sem criar object URL. Nunca falha. */
  async garantirCache(id: string): Promise<void> {
    try {
      await this.lerOuBaixar(id);
    } catch {
      // melhor esforço: tenta de novo no próximo sync
    }
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
    const cache = await this.db.arquivos.get(id);
    if (cache) return cache;
    if (!this.conectividade.online()) return null;
    try {
      const blob = await firstValueFrom(this.http.get(`/api/arquivos/${id}`, { responseType: 'blob' }).pipe(timeout(30_000)));
      const novo = { id, mime: blob.type || 'application/octet-stream', bytes: await paraBytes(blob) };
      await this.db.arquivos.put(novo);
      return novo;
    } catch {
      return null;
    }
  }
}
