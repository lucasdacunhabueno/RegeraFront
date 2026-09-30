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
    const adaptador = ADAPTADORES[p.entidade];
    const tabela = adaptador.tabela(this.db);
    try {
      await this.trazerDoServidor(p, p.agregadoId);
    } catch (e) {
      if (!(e instanceof HttpErrorResponse && e.status === 0)) throw e;
      await this.db.transaction('rw', [tabela], async () => {
        if (p.dadosServidor == null) {
          await tabela.delete(p.agregadoId);
        } else {
          await tabela.put(adaptador.paraLocal(p.agregadoId, p.versionServidor ?? null, p.dadosServidor));
        }
      });
    }
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox], () => this.limparAgregado(p));
  }

  async descartar(p: Pendencia): Promise<void> {
    const tabela = ADAPTADORES[p.entidade].tabela(this.db);
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox], () => this.limparAgregado(p));
    if (p.mutacao.baseVersion === null) {
      await tabela.delete(p.agregadoId);
      return;
    }
    await this.trazerDoServidor(p, p.agregadoId);
  }

  /** DOCUMENTO_DUPLICADO: fica com o cadastro que já existe no servidor e some com o duplicado local. */
  async usarExistente(p: Pendencia): Promise<string> {
    const idExistente = p.erro?.idExistente;
    if (!idExistente) throw new Error('Pendência sem idExistente');
    await this.trazerDoServidor(p, idExistente);
    const tabela = ADAPTADORES[p.entidade].tabela(this.db);
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, tabela], async () => {
      await this.limparAgregado(p);
      await tabela.delete(p.agregadoId);
    });
    return idExistente;
  }

  private async limparAgregado(p: Pendencia): Promise<void> {
    await this.db.pendencias.where('agregadoId').equals(p.agregadoId).delete();
    await this.db.outbox.where('agregadoId').equals(p.agregadoId).delete();
  }

  private async trazerDoServidor(p: Pendencia, id: string): Promise<void> {
    const adaptador = ADAPTADORES[p.entidade];
    const tabela = adaptador.tabela(this.db);
    try {
      const m = await firstValueFrom(this.http.get<Mudanca>(`/api/sync/agregado/${p.entidade}/${id}`));
      if (m.deleted) {
        await tabela.delete(id);
      } else {
        await tabela.put(adaptador.paraLocal(id, m.version, m.dados));
      }
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 404) {
        await tabela.delete(id);
        return;
      }
      throw e;
    }
  }
}
