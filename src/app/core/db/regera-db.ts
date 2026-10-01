import { Injectable } from '@angular/core';
import Dexie, { type Table } from 'dexie';
import type { ClienteLocal } from '../../features/clientes/cliente-models';
import type { ItemLocal } from '../../features/catalogo/item-models';
import type { EmpresaLocal } from '../../features/empresa/empresa-models';
import type { TemplateLocal } from '../../features/templates/template-models';
import type { MutacaoLocal, Pendencia, UsuarioResumo } from '../sync/sync-models';

export interface MetaRegistro {
  chave: string;
  valor: unknown;
}

export interface ArquivoLocal {
  id: string;
  mime: string;
  bytes: ArrayBuffer;
}

@Injectable({ providedIn: 'root' })
export class RegeraDb extends Dexie {
  meta!: Table<MetaRegistro, string>;
  clientes!: Table<ClienteLocal, string>;
  outbox!: Table<MutacaoLocal, number>;
  pendencias!: Table<Pendencia, string>;
  usuarios!: Table<UsuarioResumo, string>;
  itens!: Table<ItemLocal, string>;
  empresa!: Table<EmpresaLocal, string>;
  arquivos!: Table<ArquivoLocal, string>;
  templates!: Table<TemplateLocal, string>;
  private readonly aoLimparTudo = new Set<() => void>();

  constructor() {
    super('regera');
    this.version(1).stores({ meta: 'chave' });
    this.version(2).stores({
      meta: 'chave',
      clientes: 'id, documento, nomeBusca',
      outbox: '++seq, agregadoId',
      pendencias: 'mutationId, agregadoId',
      usuarios: 'id',
    });
    this.version(3)
      .stores({
        meta: 'chave',
        clientes: 'id, documento, nomeBusca',
        outbox: '++seq, agregadoId',
        pendencias: 'mutationId, agregadoId',
        usuarios: 'id',
        itens: 'id, codigo, nomeBusca',
        empresa: 'id',
        arquivos: 'id',
      })
      .upgrade(async (tx) => {
        // fronts P2 pularam item_catalogo/empresa como entidade desconhecida e avançaram o cursor: puxa tudo de novo
        await tx.table('meta').bulkDelete(['cursor', 'cursorDono']);
      });
    this.version(4)
      .stores({
        meta: 'chave',
        clientes: 'id, documento, nomeBusca',
        outbox: '++seq, agregadoId',
        pendencias: 'mutationId, agregadoId',
        usuarios: 'id',
        itens: 'id, codigo, nomeBusca',
        empresa: 'id',
        arquivos: 'id',
        templates: 'id, tipoProposta, nomeBusca',
      })
      .upgrade(async (tx) => {
        // fronts P3 pularam template_proposta como entidade desconhecida e avançaram o cursor: puxa tudo de novo
        await tx.table('meta').bulkDelete(['cursor', 'cursorDono']);
      });
  }

  async lerMeta<T>(chave: string): Promise<T | undefined> {
    return (await this.meta.get(chave))?.valor as T | undefined;
  }

  async gravarMeta(chave: string, valor: unknown): Promise<void> {
    await this.meta.put({ chave, valor });
  }

  /** Registra quem guarda estado em memória derivado do banco (ex.: object URLs) e precisa esquecê-lo junto. */
  aoLimpar(fn: () => void): void {
    this.aoLimparTudo.add(fn);
  }

  async limparTudo(): Promise<void> {
    // antes: invalida escritas em voo (elas checam antes de gravar); depois: descarta o que foi lido durante a limpeza
    this.aoLimparTudo.forEach((fn) => fn());
    await this.transaction('rw', this.tables, async () => {
      await Promise.all(this.tables.map((t) => t.clear()));
    });
    this.aoLimparTudo.forEach((fn) => fn());
  }
}
