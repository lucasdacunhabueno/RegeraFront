import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { observar } from '../../core/db/observar';
import { RegeraDb } from '../../core/db/regera-db';
import { observarNaoSincronizados } from '../../core/sync/nao-sincronizados';
import { SyncService } from '../../core/sync/sync-service';
import { ErroCampo } from '../../core/util/erro-campo';
import { uuidv7 } from '../../core/util/uuid';
import { ItemCatalogoDados, ItemLocal, paraItemLocal } from './item-models';

@Injectable({ providedIn: 'root' })
export class CatalogoRepo {
  private readonly db = inject(RegeraDb);
  private readonly sync = inject(SyncService);

  observarTodos(): Observable<ItemLocal[]> {
    return observar(() => this.db.itens.orderBy('nomeBusca').toArray());
  }

  observarNaoSincronizados(): Observable<Set<string>> {
    return observarNaoSincronizados(this.db);
  }

  buscar(id: string): Promise<ItemLocal | undefined> {
    return this.db.itens.get(id);
  }

  async temPendencia(id: string): Promise<boolean> {
    return (await this.db.pendencias.where('agregadoId').equals(id).count()) > 0;
  }

  /** versaoCarregada: versão que o formulário carregou — usada como base para o servidor detectar conflito. */
  async salvar(dados: ItemCatalogoDados, id?: string, versaoCarregada?: number | null): Promise<string> {
    const codigo = dados.codigo.trim().toUpperCase();
    const agregadoId = id ?? uuidv7();
    const normalizados: ItemCatalogoDados = { ...dados, codigo };
    await this.db.transaction('rw', [this.db.itens, this.db.outbox, this.db.pendencias], async () => {
      const mesmoCodigo = await this.db.itens.where('codigo').equals(codigo).toArray();
      if (mesmoCodigo.some((i) => i.id !== agregadoId)) {
        throw new ErroCampo('codigo', 'Já existe um item com este código neste aparelho.');
      }
      const atual = await this.db.itens.get(agregadoId);
      const version = versaoCarregada !== undefined ? versaoCarregada : (atual?.version ?? null);
      await this.db.itens.put(paraItemLocal(agregadoId, version, normalizados));
      await this.db.pendencias.where('agregadoId').equals(agregadoId).filter((p) => p.tipo === 'REJEITADO').delete();
      await this.sync.registrar('item_catalogo', agregadoId, 'UPSERT', normalizados, version);
    });
    void this.sync.sincronizar();
    return agregadoId;
  }

  async excluir(id: string, versaoCarregada?: number | null): Promise<void> {
    await this.db.transaction('rw', [this.db.itens, this.db.outbox, this.db.pendencias], async () => {
      const atual = await this.db.itens.get(id);
      const version = versaoCarregada !== undefined ? versaoCarregada : (atual?.version ?? null);
      await this.db.itens.delete(id);
      await this.db.pendencias.where('agregadoId').equals(id).filter((p) => p.tipo === 'REJEITADO').delete();
      await this.sync.registrar('item_catalogo', id, 'DELETE', null, version);
    });
    void this.sync.sincronizar();
  }
}
