import Dexie from 'dexie';
import type { AnexoOsLocal, OsDados, OsLocal } from '../../features/os/os-models';
import { ADAPTADORES } from '../sync/adaptadores';
import { RegeraDb } from './regera-db';

const V5 = {
  meta: 'chave', clientes: 'id, documento, nomeBusca', outbox: '++seq, agregadoId', pendencias: 'mutationId, agregadoId',
  usuarios: 'id', itens: 'id, codigo, nomeBusca', empresa: 'id', arquivos: 'id', templates: 'id, tipoProposta, nomeBusca',
  propostas: 'id, status, clienteId, responsavelId, tecnicoId, codigoProvisorio, numero', documentos: 'id, propostaId',
};

const osDados = (extra: Partial<OsDados> = {}): OsDados => ({
  codigoProvisorio: 'OSP-0Z9XY7', tipo: 'INSTALACAO', status: 'ABERTA', urgente: false, concluiProposta: true, assinaturaRecusada: false,
  itens: [], notas: [], ...extra,
});

function anexo(id: string, osId: string, enviado: boolean): AnexoOsLocal {
  return {
    id, osId, tipo: 'FOTO', sha256: 'ab'.repeat(32), legenda: null, momento: 'ANTES', tiradaEm: '2026-10-01T10:00:00Z',
    assinanteNome: null, assinantePapel: null, revisaoOs: null, codigoExibido: null,
    bytes: new Uint8Array([0xff, 0xd8, 0xff]).buffer, miniatura: new Uint8Array([0xff, 0xd8]).buffer,
    enviado, arquivoId: enviado ? 'a1' : null,
  };
}

describe('RegeraDb v6', () => {
  beforeEach(async () => {
    // outros specs do mesmo worker podem ter deixado o banco 'regera' já em v6
    await Dexie.delete('regera');
  });

  afterEach(async () => {
    await Dexie.delete('regera');
  });

  it('upgrade de v5 para v6 apaga o cursor, preserva a fila e as pendências, mantém o que a fila protege e cria os e anexosOs', async () => {
    const v5 = new Dexie('regera');
    v5.version(5).stores(V5);
    await v5.table('meta').bulkPut([
      { chave: 'cursor', valor: 99 }, { chave: 'cursorDono', valor: 'u1:TECNICO' }, { chave: 'sessao', valor: { id: 'u1' } },
    ]);
    await v5.table('propostas').put({ id: 'p1', status: 'ENVIADA' });
    await v5.table('documentos').put({ id: 'd1', propostaId: 'p1', bytes: new Uint8Array([0x25]).buffer, enviado: false });
    await v5.table('outbox').bulkAdd([
      { mutationId: 'm1', agregadoId: 'p1', entidade: 'proposta', op: 'UPSERT' },
      { mutationId: 'm2', agregadoId: 'p1', entidade: 'documento_proposta', op: 'UPLOAD', dados: { documentoId: 'd1' } },
    ]);
    await v5.table('pendencias').put({ mutationId: 'm0', agregadoId: 'c1', tipo: 'REJEITADO' });
    v5.close();

    const db = new RegeraDb();
    expect(await db.lerMeta('cursor')).toBeUndefined();
    expect(await db.lerMeta('cursorDono')).toBeUndefined();
    expect(await db.lerMeta('sessao')).toEqual({ id: 'u1' });
    expect((await db.outbox.orderBy('seq').toArray()).map((m) => m.mutationId)).toEqual(['m1', 'm2']);
    expect((await db.pendencias.toArray()).map((p) => p.mutationId)).toEqual(['m0']);
    expect(await db.propostas.count()).toBe(1);
    expect(new Uint8Array((await db.documentos.get('d1'))!.bytes!)).toEqual(new Uint8Array([0x25]));
    expect(await db.os.count()).toBe(0);
    expect(await db.anexosOs.count()).toBe(0);
    expect(db.os.schema.primKey.name).toBe('id');
    expect(db.os.schema.indexes.map((i) => i.name).sort()).toEqual(
      ['clienteId', 'codigoProvisorio', 'dataPrevista', 'numero', 'propostaId', 'responsavelId', 'status', 'tecnicoId'],
    );
    expect(db.anexosOs.schema.primKey.name).toBe('id');
    // `enviado` (boolean) não é chave válida do IndexedDB: filtrado em memória, como em `documentos`
    expect(db.anexosOs.schema.indexes.map((i) => i.name).sort()).toEqual(['osId', 'tipo']);
    db.close();
  });

  it('N2 (Q18): o upgrade limpa as tabelas sincronizadas, menos o que a fila ou as pendências protegem', async () => {
    const v5 = new Dexie('regera');
    v5.version(5).stores(V5);
    await v5.table('meta').bulkPut([
      { chave: 'cursor', valor: 99 }, { chave: 'cursorDono', valor: 'u1:COMERCIAL' }, { chave: 'sessao', valor: { id: 'u1' } },
      { chave: 'ultimoSync', valor: '2026-10-01T10:00:00Z' },
    ]);
    await v5.table('clientes').bulkPut([
      { id: 'c-fila', documento: '1', nomeBusca: 'fila' }, // mutação na fila
      { id: 'c-da-proposta', documento: '2', nomeBusca: 'da proposta' }, // cliente da proposta protegida
      { id: 'c-outro', documento: '3', nomeBusca: 'outro' },
      { id: 'c-mais-um', documento: '4', nomeBusca: 'mais um' },
    ]);
    await v5.table('propostas').bulkPut([
      { id: 'p-doc', status: 'ENVIADA', clienteId: 'c-da-proposta', templateId: 't-da-proposta' }, // PDF não enviado
      { id: 'p-pendente', status: 'RASCUNHO', clienteId: null, templateId: null }, // pendência
      { id: 'p-livre', status: 'ENVIADA', clienteId: 'c-outro', templateId: 't-outro' },
    ]);
    await v5.table('documentos').bulkPut([
      { id: 'd-nao-enviado', propostaId: 'p-doc', bytes: new Uint8Array([0x25]).buffer, enviado: false, arquivoId: null },
      { id: 'd-enviado-protegida', propostaId: 'p-doc', bytes: new Uint8Array([0x26]).buffer, enviado: true, arquivoId: 'a1' },
      { id: 'd-enviado', propostaId: 'p-livre', bytes: new Uint8Array([0x27]).buffer, enviado: true, arquivoId: 'a2' },
    ]);
    await v5.table('templates').bulkPut([
      { id: 't-da-proposta', tipoProposta: 'VENDA', nomeBusca: 'a' }, { id: 't-outro', tipoProposta: 'VENDA', nomeBusca: 'b' },
    ]);
    await v5.table('itens').bulkPut([{ id: 'i-fila', codigo: 'A', nomeBusca: 'a' }, { id: 'i-outro', codigo: 'B', nomeBusca: 'b' }]);
    await v5.table('empresa').put({ id: 'empresa-1', razaoSocial: 'Regera' });
    await v5.table('usuarios').bulkPut([{ id: 'u1', nome: 'Ana' }, { id: 'u2', nome: 'Tito' }]);
    await v5.table('arquivos').put({ id: 'logo-1', mime: 'image/png', bytes: new Uint8Array([1]).buffer });
    await v5.table('outbox').bulkAdd([
      { mutationId: 'm1', agregadoId: 'c-fila', entidade: 'cliente', op: 'UPSERT', baseVersion: 2 },
      { mutationId: 'm2', agregadoId: 'p-doc', entidade: 'documento_proposta', op: 'UPLOAD', dados: { documentoId: 'd-nao-enviado' } },
      { mutationId: 'm3', agregadoId: 'i-fila', entidade: 'item_catalogo', op: 'UPSERT', baseVersion: 1 },
    ]);
    await v5.table('pendencias').put({ mutationId: 'm0', agregadoId: 'p-pendente', entidade: 'proposta', tipo: 'CONFLITO' });
    v5.close();

    const db = new RegeraDb();
    const ids = async (t: { toCollection(): { primaryKeys(): Promise<unknown[]> } }) =>
      ((await t.toCollection().primaryKeys()) as string[]).sort();
    // fila, pendências, sessão e o cache de arquivos ficam como estavam; o cursor recomeça do zero
    expect((await db.outbox.orderBy('seq').toArray()).map((m) => m.mutationId)).toEqual(['m1', 'm2', 'm3']);
    expect((await db.pendencias.toArray()).map((p) => p.mutationId)).toEqual(['m0']);
    expect(await db.lerMeta('sessao')).toEqual({ id: 'u1' });
    expect(await db.lerMeta('ultimoSync')).toBe('2026-10-01T10:00:00Z');
    expect(await db.lerMeta('cursor')).toBeUndefined();
    expect(await db.arquivos.count()).toBe(1);
    // o protegido fica (e o cliente e o template da proposta protegida, para ela abrir offline); o resto vem no pull
    expect(await ids(db.clientes)).toEqual(['c-da-proposta', 'c-fila']);
    expect(await ids(db.propostas)).toEqual(['p-doc', 'p-pendente']);
    expect(await ids(db.templates)).toEqual(['t-da-proposta']);
    expect(await ids(db.itens)).toEqual(['i-fila']);
    // com proposta protegida, a empresa (o PDF offline) e os usuários (nomes do responsável e do técnico, a escolha do
    // técnico) ficam até o pull (M2P2-R7)
    expect(await db.empresa.count()).toBe(1);
    expect(await ids(db.usuarios)).toEqual(['u1', 'u2']);
    // o PDF não enviado fica com os bytes; os enviados são cópia do servidor e saem, como na troca de dono do cursor
    expect(await ids(db.documentos)).toEqual(['d-nao-enviado']);
    expect(new Uint8Array((await db.documentos.get('d-nao-enviado'))!.bytes!)).toEqual(new Uint8Array([0x25]));
    db.close();
  });

  it('N2: sem nada protegido, todas as tabelas sincronizadas ficam vazias (inclusive a empresa e os usuários)', async () => {
    const v5 = new Dexie('regera');
    v5.version(5).stores(V5);
    await v5.table('meta').put({ chave: 'sessao', valor: { id: 't1' } });
    await v5.table('clientes').bulkPut([{ id: 'c1', documento: '1', nomeBusca: 'a' }, { id: 'c2', documento: '2', nomeBusca: 'b' }]);
    await v5.table('propostas').put({ id: 'p1', status: 'APROVADA', clienteId: 'c1', templateId: 't1' });
    await v5.table('templates').put({ id: 't1', tipoProposta: 'VENDA', nomeBusca: 't' });
    await v5.table('itens').put({ id: 'i1', codigo: 'A', nomeBusca: 'a' });
    await v5.table('empresa').put({ id: 'empresa-1', razaoSocial: 'Regera' });
    await v5.table('usuarios').put({ id: 'u1', nome: 'Ana' });
    await v5.table('documentos').put({ id: 'd1', propostaId: 'p1', bytes: null, enviado: true, arquivoId: 'a1' });
    v5.close();

    const db = new RegeraDb();
    for (const t of [db.clientes, db.propostas, db.templates, db.itens, db.empresa, db.usuarios, db.documentos, db.os, db.anexosOs]) {
      expect(await t.count(), t.name).toBe(0);
    }
    expect(await db.lerMeta('sessao')).toEqual({ id: 't1' });
    db.close();
  });

  it('a OS passa pelo adaptador do sync, ignora campos que não conhece e é achada pelos índices', async () => {
    const db = new RegeraDb();
    const a = ADAPTADORES.os;
    expect(a.tabela(db)).toBe(db.os);
    // um servidor mais novo pode mandar campos a mais: não quebra e não entram no registro
    const local = a.paraLocal('o1', 3, {
      ...osDados({ tecnicoId: 't1', dataPrevista: '2026-10-05', propostaId: 'p1', clienteId: 'c1', responsavelId: 'u1' }),
      campoNovo: 'x', anexos: [{ id: 'x1', tipo: 'FOTO', arquivoId: 'a1', sha256: 'ab', autorId: 't1', criadoEm: '', extra: 1 }],
    }) as OsLocal;
    expect(local).not.toHaveProperty('campoNovo');
    expect(local.anexos[0]).not.toHaveProperty('extra');
    await a.tabela(db).put(local);
    await db.os.put({ ...local, id: 'o2', numero: 123, codigoProvisorio: 'OSP-0000AB', tecnicoId: null, dataPrevista: null });
    expect((await db.os.where('codigoProvisorio').equals('OSP-0Z9XY7').first())?.id).toBe('o1');
    expect((await db.os.where('numero').equals(123).first())?.id).toBe('o2');
    expect((await db.os.where('tecnicoId').equals('t1').toArray()).map((o) => o.id)).toEqual(['o1']);
    expect(await db.os.where('dataPrevista').above('2026-10-01').count()).toBe(1);
    expect(await db.os.where('status').equals('ABERTA').count()).toBe(2);
    expect(await db.os.where('propostaId').equals('p1').count()).toBe(2);
    expect(a.dadosDe((await db.os.get('o1'))!)).toMatchObject({ codigoProvisorio: 'OSP-0Z9XY7', tecnicoId: 't1', itens: [] });
    db.close();
  });

  it('anexosOs guardam bytes e miniatura e são achados pela OS', async () => {
    const db = new RegeraDb();
    await db.anexosOs.bulkPut([anexo('f1', 'o1', true), anexo('f2', 'o1', false), anexo('f3', 'o2', false)]);
    const doO1 = await db.anexosOs.where('osId').equals('o1').toArray();
    expect(doO1.map((x) => x.id).sort()).toEqual(['f1', 'f2']);
    expect(doO1.filter((x) => !x.enviado).map((x) => x.id)).toEqual(['f2']);
    const f2 = doO1.find((x) => x.id === 'f2')!;
    expect(new Uint8Array(f2.bytes!)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect(new Uint8Array(f2.miniatura!)).toEqual(new Uint8Array([0xff, 0xd8]));
    expect(await db.anexosOs.where('tipo').equals('FOTO').count()).toBe(3);
    db.close();
  });

  it('limparTudo apaga as OS e os anexos', async () => {
    const db = new RegeraDb();
    await db.os.put(ADAPTADORES.os.paraLocal('o1', 1, osDados()) as OsLocal);
    await db.anexosOs.put(anexo('f1', 'o1', false));
    await db.limparTudo();
    expect(await db.os.count()).toBe(0);
    expect(await db.anexosOs.count()).toBe(0);
    db.close();
  });
});
