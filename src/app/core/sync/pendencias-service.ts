import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { observar } from '../db/observar';
import { RegeraDb } from '../db/regera-db';
import { ADAPTADORES } from './adaptadores';
import { Mudanca, Pendencia } from './sync-models';
import { SyncService } from './sync-service';

/** Decisões do usuário sobre conflitos e rejeições (§11.5). */
@Injectable({ providedIn: 'root' })
export class PendenciasService {
  private readonly db = inject(RegeraDb);
  private readonly http = inject(HttpClient);
  private readonly sync = inject(SyncService);

  observar(): Observable<Pendencia[]> {
    return observar(async () => (await this.db.pendencias.toArray()).sort((a, b) => a.criadaEm.localeCompare(b.criadaEm)));
  }

  async manterMinha(p: Pendencia): Promise<void> {
    const adaptador = ADAPTADORES[p.entidade];
    const tabela = adaptador.tabela(this.db);
    const base = p.versionServidor ?? null;
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, tabela], async () => {
      const local = await tabela.get(p.agregadoId);
      await this.db.pendencias.delete(p.mutationId);
      await this.db.outbox.where('agregadoId').equals(p.agregadoId).delete();
      if (local) {
        await tabela.put(adaptador.paraLocal(p.agregadoId, base, adaptador.dadosDe(local)));
      }
      await this.sync.registrar(p.entidade, p.agregadoId, local ? 'UPSERT' : 'DELETE', local ? adaptador.dadosDe(local) : null, base);
    });
    void this.sync.sincronizar();
  }

  /** Busca o estado ATUAL do servidor (dadosServidor pode estar velho); sem rede, usa o que a pendência guardou. */
  async usarServidor(p: Pendencia): Promise<void> {
    let atual: Mudanca | null | undefined;
    try {
      atual = await this.buscarNoServidor(p, p.agregadoId);
    } catch (e) {
      if (!(e instanceof HttpErrorResponse && e.status === 0)) throw e;
      atual = p.dadosServidor == null ? null : { dados: p.dadosServidor, version: p.versionServidor ?? null, deleted: false } as unknown as Mudanca;
    }
    await this.aplicarEClear(p, p.agregadoId, atual);
  }

  async descartar(p: Pendencia): Promise<void> {
    if (p.mutacao.baseVersion === null) {
      const tabela = ADAPTADORES[p.entidade].tabela(this.db);
      await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, tabela], async () => {
        await this.limparAgregado(p);
        await tabela.delete(p.agregadoId);
      });
      return;
    }
    await this.aplicarEClear(p, p.agregadoId, await this.buscarNoServidor(p, p.agregadoId));
  }

  /** DOCUMENTO_DUPLICADO: fica com o cadastro que já existe no servidor e some com o duplicado local. */
  async usarExistente(p: Pendencia): Promise<string> {
    const idExistente = p.erro?.idExistente;
    if (!idExistente) throw new Error('Pendência sem idExistente');
    const existente = await this.buscarNoServidor(p, idExistente);
    if (!existente || existente.deleted) throw new Error('O cadastro existente não foi encontrado no servidor.');
    const adaptador = ADAPTADORES[p.entidade];
    const tabela = adaptador.tabela(this.db);
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, tabela], async () => {
      await this.limparAgregado(p);
      await tabela.delete(p.agregadoId);
      await tabela.put(adaptador.paraLocal(idExistente, existente.version, existente.dados));
    });
    return idExistente;
  }

  private async limparAgregado(p: Pendencia): Promise<void> {
    await this.db.pendencias.where('agregadoId').equals(p.agregadoId).delete();
    await this.db.outbox.where('agregadoId').equals(p.agregadoId).delete();
  }

  /** Aplica o estado do servidor (null/deleted = apagar) e limpa o agregado, tudo numa transação. */
  private async aplicarEClear(p: Pendencia, id: string, m: Mudanca | null): Promise<void> {
    const adaptador = ADAPTADORES[p.entidade];
    const tabela = adaptador.tabela(this.db);
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, tabela], async () => {
      await this.limparAgregado(p);
      if (!m || m.deleted) {
        await tabela.delete(id);
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
