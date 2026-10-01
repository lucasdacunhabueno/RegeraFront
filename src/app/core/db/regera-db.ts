import { Injectable } from '@angular/core';
import Dexie, { type Table } from 'dexie';
import type { ClienteLocal } from '../../features/clientes/cliente-models';
import type { ItemLocal } from '../../features/catalogo/item-models';
import type { EmpresaLocal } from '../../features/empresa/empresa-models';
import type { AnexoOsLocal, OsLocal } from '../../features/os/os-models';
import type { DocumentoLocal, PropostaLocal } from '../../features/propostas/proposta-models';
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
  propostas!: Table<PropostaLocal, string>;
  documentos!: Table<DocumentoLocal, string>;
  os!: Table<OsLocal, string>;
  anexosOs!: Table<AnexoOsLocal, string>;
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
    this.version(5)
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
        propostas: 'id, status, clienteId, responsavelId, tecnicoId, codigoProvisorio, numero',
        // o PDF (bytes) de cada envio; `enviado`/`arquivoId` dizem se o upload já foi aceito
        documentos: 'id, propostaId',
      })
      .upgrade(async (tx) => {
        // fronts P4a pularam proposta como entidade desconhecida e avançaram o cursor: puxa tudo de novo
        await tx.table('meta').bulkDelete(['cursor', 'cursorDono']);
      });
    this.version(6)
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
        propostas: 'id, status, clienteId, responsavelId, tecnicoId, codigoProvisorio, numero',
        documentos: 'id, propostaId',
        os: 'id, status, tecnicoId, responsavelId, propostaId, clienteId, codigoProvisorio, numero, dataPrevista',
        // os bytes de cada anexo até o upload, e a miniatura depois. Sem índice em `enviado`: boolean não é chave do
        // IndexedDB (o registro sairia do índice); filtra-se em memória pelo `osId`, como em `documentos`
        anexosOs: 'id, osId, tipo',
      })
      .upgrade(async (tx) => {
        // fronts P4 pularam os como entidade desconhecida e avançaram o cursor: puxa tudo de novo (a fila e as
        // pendências ficam)
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
