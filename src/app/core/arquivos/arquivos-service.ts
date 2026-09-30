import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { RegeraDb } from '../db/regera-db';

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

  async enviar(blob: Blob, nome: string): Promise<ArquivoEnviado> {
    if (!this.conectividade.online()) {
      throw new Error('Sem internet: envie a imagem quando a conexão voltar.');
    }
    const corpo = new FormData();
    corpo.append('arquivo', blob, nome);
    const enviado = await firstValueFrom(this.http.post<ArquivoEnviado>('/api/arquivos', corpo).pipe(timeout(60_000)));
    await this.db.arquivos.put({ id: enviado.id, mime: enviado.mime, bytes: await paraBytes(blob) });
    return enviado;
  }

  async obterUrl(id: string): Promise<string | null> {
    const pronta = this.urls.get(id);
    if (pronta) return pronta;
    let cache = await this.db.arquivos.get(id);
    if (!cache) {
      if (!this.conectividade.online()) return null;
      try {
        const blob = await firstValueFrom(this.http.get(`/api/arquivos/${id}`, { responseType: 'blob' }).pipe(timeout(30_000)));
        cache = { id, mime: blob.type || 'application/octet-stream', bytes: await paraBytes(blob) };
        await this.db.arquivos.put(cache);
      } catch {
        return null;
      }
    }
    const url = URL.createObjectURL(new Blob([cache.bytes], { type: cache.mime }));
    this.urls.set(id, url);
    return url;
  }
}
