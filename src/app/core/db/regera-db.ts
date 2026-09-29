import { Injectable } from '@angular/core';
import Dexie, { type Table } from 'dexie';

export interface MetaRegistro {
  chave: string;
  valor: unknown;
}

@Injectable({ providedIn: 'root' })
export class RegeraDb extends Dexie {
  meta!: Table<MetaRegistro, string>;

  constructor() {
    super('regera');
    this.version(1).stores({ meta: 'chave' });
  }

  async lerMeta<T>(chave: string): Promise<T | undefined> {
    return (await this.meta.get(chave))?.valor as T | undefined;
  }

  async gravarMeta(chave: string, valor: unknown): Promise<void> {
    await this.meta.put({ chave, valor });
  }

  async limparTudo(): Promise<void> {
    await this.transaction('rw', this.tables, async () => {
      await Promise.all(this.tables.map((t) => t.clear()));
    });
  }
}
