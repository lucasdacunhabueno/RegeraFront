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
  codigoProvisorio: 'OSP-0Z9XY7', tipo: 'INSTALACAO', status: 'ABERTA', urgente: false, assinaturaRecusada: false,
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

  it('upgrade de v5 para v6 apaga o cursor, preserva a fila, as pendências e o resto, e cria os e anexosOs', async () => {
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
