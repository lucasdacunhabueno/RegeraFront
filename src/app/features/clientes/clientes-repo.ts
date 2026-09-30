import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { observar } from '../../core/db/observar';
import { RegeraDb } from '../../core/db/regera-db';
import { SyncService } from '../../core/sync/sync-service';
import { normalizarDocumento } from '../../core/util/documentos';
import { uuidv7 } from '../../core/util/uuid';
import { observarNaoSincronizados } from '../../core/sync/nao-sincronizados';
import { ErroCampo } from '../../core/util/erro-campo';
import { ClienteDados, ClienteLocal, paraClienteLocal } from './cliente-models';

export { ErroCampo } from '../../core/util/erro-campo';

/** Único ponto de leitura e escrita de clientes para a UI: tudo local, o sync leva ao servidor. */
@Injectable({ providedIn: 'root' })
export class ClientesRepo {
  private readonly db = inject(RegeraDb);
  private readonly sync = inject(SyncService);

  observarTodos(): Observable<ClienteLocal[]> {
    return observar(() => this.db.clientes.orderBy('nomeBusca').toArray());
  }

  observarNaoSincronizados(): Observable<Set<string>> {
    return observarNaoSincronizados(this.db);
  }

  buscar(id: string): Promise<ClienteLocal | undefined> {
    return this.db.clientes.get(id);
  }

  async temPendencia(id: string): Promise<boolean> {
    return (await this.db.pendencias.where('agregadoId').equals(id).count()) > 0;
  }

  /** `versaoCarregada`: versão que o formulário leu; vira a baseVersion para o servidor detectar edição concorrente. */
  async salvar(dados: ClienteDados, id?: string, versaoCarregada?: number | null): Promise<string> {
    const documento = normalizarDocumento(dados.documento);
    const agregadoId = id ?? uuidv7();
    const normalizados: ClienteDados = { ...dados, documento };
    await this.db.transaction('rw', [this.db.clientes, this.db.outbox, this.db.pendencias], async () => {
      const mesmoDocumento = await this.db.clientes.where('documento').equals(documento).first();
      if (mesmoDocumento && mesmoDocumento.id !== agregadoId) {
        throw new ErroCampo('documento', 'Já existe um cliente com este CPF/CNPJ neste aparelho.');
      }
      const atual = await this.db.clientes.get(agregadoId);
      const version = versaoCarregada !== undefined ? versaoCarregada : (atual?.version ?? null);
      await this.db.clientes.put(paraClienteLocal(agregadoId, version, normalizados));
      await this.db.pendencias
        .where('agregadoId')
        .equals(agregadoId)
        .filter((p) => p.tipo === 'REJEITADO' && p.entidade === 'cliente')
        .delete();
      await this.sync.registrar('cliente', agregadoId, 'UPSERT', normalizados, version);
    });
    void this.sync.sincronizar();
    return agregadoId;
  }

  async excluir(id: string, versaoCarregada?: number | null): Promise<void> {
    await this.db.transaction('rw', [this.db.clientes, this.db.outbox, this.db.pendencias], async () => {
      const atual = await this.db.clientes.get(id);
      const version = versaoCarregada !== undefined ? versaoCarregada : (atual?.version ?? null);
      await this.db.clientes.delete(id);
      await this.db.pendencias
        .where('agregadoId')
        .equals(id)
        .filter((p) => p.tipo === 'REJEITADO' && p.entidade === 'cliente')
        .delete();
      await this.sync.registrar('cliente', id, 'DELETE', null, version);
    });
    void this.sync.sincronizar();
  }
}
