import { Injectable } from '@angular/core';
import Dexie, { type Table, type Transaction } from 'dexie';
import type { ClienteLocal } from '../../features/clientes/cliente-models';
import type { ItemLocal } from '../../features/catalogo/item-models';
import type { EmpresaLocal } from '../../features/empresa/empresa-models';
import type { AnexoOsLocal, BytesAnexoOs, OsLocal } from '../../features/os/os-models';
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

interface ComId {
  id: string;
}

/**
 * Q18 / N2 do upgrade v6: o TECNICO agora só recebe os clientes ligados a ele, e o aparelho não pode ficar com a base
 * inteira do M1. Como o cursor recomeça do zero, tudo o que vem do pull (clientes, itens, propostas, templates,
 * empresa, usuários, OS) é apagado e volta no pull completo, na mesma transação do upgrade. Fica:
 * - a fila, as pendências, a sessão e o cache de arquivos (meta e arquivos não são tocados);
 * - o registro de todo agregado com mutação na fila ou pendência, que o pull também não sobrescreveria;
 * - o cliente e o template de uma proposta ou OS protegida e, se houver alguma, a empresa e os usuários (M2P2-R7): sem
 *   eles ela não abre, não mostra o responsável e o técnico, nem gera o PDF offline (o pull os traz de volta ou manda o
 *   tombstone; o servidor sobe o `sync_seq` de todo cliente, e a lista de usuários é trocada inteira a cada pull);
 * - os PDFs e anexos ainda não enviados (os bytes esperam o upload); os enviados são cópia do servidor e saem, como
 *   na troca de dono do cursor.
 * M2P2-R15: só com a sessão guardada de TECNICO (ou sem sessão, ou num formato sem perfil). O ADMIN e o COMERCIAL
 * mantêm tudo (a base offline do escritório, os PDFs enviados): o cursor zerado refaz o pull, que sobrescreve.
 */
async function limparSincronizadasV6(tx: Transaction): Promise<void> {
  // a chave `sessao` do `AuthService` (importá-lo aqui faria um ciclo)
  const perfil = ((await tx.table('meta').get('sessao')) as { valor?: { perfil?: unknown } } | undefined)?.valor?.perfil;
  if (perfil === 'ADMIN' || perfil === 'COMERCIAL') return;
  const naFila = (await tx.table('outbox').toArray()) as { agregadoId: string }[];
  const pendentes = (await tx.table('pendencias').toArray()) as { agregadoId: string }[];
  const protegidos = new Set([...naFila, ...pendentes].map((m) => m.agregadoId));
  const manter = async <T extends ComId>(tabela: string, extras: ReadonlySet<string> = new Set()): Promise<T[]> => {
    const t = tx.table<T, string>(tabela);
    await t.filter((r) => !protegidos.has(r.id) && !extras.has(r.id)).delete();
    return t.toArray();
  };
  const propostas = await manter<ComId & { clienteId?: string | null; templateId?: string | null }>('propostas');
  const oss = await manter<ComId & { clienteId?: string | null }>('os');
  const dependencias = (valores: (string | null | undefined)[]) => new Set(valores.filter((v): v is string => !!v));
  await manter('clientes', dependencias([...propostas, ...oss].map((a) => a.clienteId)));
  await manter('templates', dependencias(propostas.map((p) => p.templateId)));
  await manter('itens');
  if (propostas.length + oss.length === 0) {
    await tx.table('empresa').clear();
    await tx.table('usuarios').clear();
  }
  // `anexosOs` e `anexosOsBytes` nascem nesta versão, vazias
  await tx.table<{ enviado: boolean }>('documentos').filter((r) => r.enviado).delete();
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
  anexosOsBytes!: Table<BytesAnexoOs, string>;
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
        // os metadados e a miniatura de cada anexo. Sem índice em `enviado`: boolean não é chave do IndexedDB (o
        // registro sairia do índice); filtra-se em memória pelo `osId`, como em `documentos`
        anexosOs: 'id, osId, tipo',
        // M2P2-R16: os bytes completos (e o snapshot do PDF), pela id do anexo, até a poda depois do upload
        anexosOsBytes: 'id',
      })
      .upgrade(async (tx) => {
        // fronts P4 pularam os como entidade desconhecida e avançaram o cursor: puxa tudo de novo (a fila e as
        // pendências ficam)
        await tx.table('meta').bulkDelete(['cursor', 'cursorDono']);
        await limparSincronizadasV6(tx);
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
