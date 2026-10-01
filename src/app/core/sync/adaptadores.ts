import type { Table } from 'dexie';
import { ClienteDados, ClienteLocal, dadosDoCliente, paraClienteLocal } from '../../features/clientes/cliente-models';
import { dadosDoItem, ItemCatalogoDados, ItemLocal, paraItemLocal } from '../../features/catalogo/item-models';
import { dadosDaEmpresa, EmpresaDados, EmpresaLocal, paraEmpresaLocal } from '../../features/empresa/empresa-models';
import type { RegeraDb } from '../db/regera-db';
import { Entidade } from './sync-models';

export interface RegistroLocal {
  id: string;
}

/** Como cada entidade sincronizada é guardada no Dexie. P3/P4 acrescentam entradas aqui. */
export interface Adaptador {
  tabela(db: RegeraDb): Table<RegistroLocal, string>;
  paraLocal(id: string, version: number | null, dados: unknown): RegistroLocal;
  dadosDe(local: RegistroLocal): unknown;
}

export const ADAPTADORES: Record<Entidade, Adaptador> = {
  cliente: {
    tabela: (db) => db.clientes as unknown as Table<RegistroLocal, string>,
    paraLocal: (id, version, dados) => paraClienteLocal(id, version, dados as ClienteDados),
    dadosDe: (local) => dadosDoCliente(local as ClienteLocal),
  },
  item_catalogo: {
    tabela: (db) => db.itens as unknown as Table<RegistroLocal, string>,
    paraLocal: (id, version, dados) => paraItemLocal(id, version, dados as ItemCatalogoDados),
    dadosDe: (local) => dadosDoItem(local as ItemLocal),
  },
  empresa: {
    tabela: (db) => db.empresa as unknown as Table<RegistroLocal, string>,
    paraLocal: (id, version, dados) => paraEmpresaLocal(id, version, dados as Partial<EmpresaDados>),
    dadosDe: (local) => dadosDaEmpresa(local as EmpresaLocal),
  },
};
