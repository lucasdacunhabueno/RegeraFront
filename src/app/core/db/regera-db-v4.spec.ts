import Dexie from 'dexie';
import { RegeraDb } from './regera-db';

describe('RegeraDb v4', () => {
  beforeEach(async () => {
    // outros specs do mesmo worker podem ter deixado o banco 'regera' já em v4
    await Dexie.delete('regera');
  });

  afterEach(async () => {
    await Dexie.delete('regera');
  });

  it('upgrade de v3 para v4 apaga o cursor para forçar pull completo e mantém o resto', async () => {
    const v3 = new Dexie('regera');
    v3.version(3).stores({
      meta: 'chave', clientes: 'id, documento, nomeBusca', outbox: '++seq, agregadoId',
      pendencias: 'mutationId, agregadoId', usuarios: 'id', itens: 'id, codigo, nomeBusca', empresa: 'id', arquivos: 'id',
    });
    await v3.table('meta').bulkPut([
      { chave: 'cursor', valor: 99 }, { chave: 'cursorDono', valor: 'u1' }, { chave: 'sessao', valor: { id: 'u1' } },
    ]);
    await v3.table('clientes').put({ id: 'c1', documento: '1', nomeBusca: 'x' });
    await v3.table('itens').put({ id: 'i1', codigo: 'A', nomeBusca: 'a' });
    // com mutações na fila: o v6 (N2) apaga as tabelas sincronizadas, menos o que a fila protege
    await v3.table('outbox').bulkAdd([{ mutationId: 'm1', agregadoId: 'c1' }, { mutationId: 'm2', agregadoId: 'i1' }]);
    v3.close();

    const db = new RegeraDb();
    expect(await db.lerMeta('cursor')).toBeUndefined();
    expect(await db.lerMeta('cursorDono')).toBeUndefined();
    expect(await db.lerMeta('sessao')).toEqual({ id: 'u1' });
    expect(await db.clientes.count()).toBe(1);
    expect(await db.itens.count()).toBe(1);
    expect(await db.templates.count()).toBe(0);
    expect(db.templates.schema.indexes.map((i) => i.name).sort()).toEqual(['nomeBusca', 'tipoProposta']);
    db.close();
  });
});
