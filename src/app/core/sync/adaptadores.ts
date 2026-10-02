import type { Table } from 'dexie';
import { ClienteDados, ClienteLocal, dadosDoCliente, paraClienteLocal } from '../../features/clientes/cliente-models';
import { dadosDoItem, ItemCatalogoDados, ItemLocal, paraItemLocal } from '../../features/catalogo/item-models';
import { dadosDaEmpresa, EmpresaDados, EmpresaLocal, paraEmpresaLocal } from '../../features/empresa/empresa-models';
import { dadosDaOs, OsDados, OsLocal, paraOsLocal } from '../../features/os/os-models';
import { dadosDaProposta, paraPropostaLocal, PropostaDados, PropostaLocal } from '../../features/propostas/proposta-models';
import { dadosDoTemplate, paraTemplateLocal, TemplateDados, TemplateLocal } from '../../features/templates/template-models';
import type { RegeraDb } from '../db/regera-db';
import { Entidade } from './sync-models';

export interface RegistroLocal {
  id: string;
}

/** Como cada entidade sincronizada é guardada no Dexie. P3/P4 acrescentam entradas aqui. */
export interface Adaptador {
  tabela(db: RegeraDb): Table<RegistroLocal, string>;
  paraLocal(id: string, version: number | null, dados: unknown): RegistroLocal;
  /** O registro de volta ao formato do sync, só para regravá-lo no aparelho (`manterMinha`); a rede usa a mutação. */
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
  template_proposta: {
    tabela: (db) => db.templates as unknown as Table<RegistroLocal, string>,
    paraLocal: (id, version, dados) => paraTemplateLocal(id, version, dados as TemplateDados),
    dadosDe: (local) => dadosDoTemplate(local as TemplateLocal),
  },
  proposta: {
    tabela: (db) => db.propostas as unknown as Table<RegistroLocal, string>,
    paraLocal: (id, version, dados) => paraPropostaLocal(id, version, dados as PropostaDados),
    // só local (a regravação do "Manter a minha"): leva a `origem` [srv], que `dadosDaProposta` não põe na rede
    dadosDe: (local) => ({ ...dadosDaProposta(local as PropostaLocal), origem: (local as PropostaLocal).origem ?? null }),
  },
  // lido campo a campo: o que um servidor mais novo mandar a mais não entra no registro
  os: {
    tabela: (db) => db.os as unknown as Table<RegistroLocal, string>,
    paraLocal: (id, version, dados) => paraOsLocal(id, version, dados as OsDados),
    dadosDe: (local) => dadosDaOs(local as OsLocal),
  },
};

/**
 * O adaptador da entidade, ou undefined se ela não tem um (ex.: o upload de documento, ou entidade nova de um
 * servidor mais novo). `Object.hasOwn`: um nome como "constructor" não pode cair no protótipo do objeto.
 */
export function adaptadorDe(entidade: string): Adaptador | undefined {
  return Object.hasOwn(ADAPTADORES, entidade) ? ADAPTADORES[entidade as Entidade] : undefined;
}
