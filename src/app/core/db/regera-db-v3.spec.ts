import Dexie from 'dexie';
import { RegeraDb } from './regera-db';

describe('RegeraDb v3', () => {
  beforeEach(async () => {
    // outros specs do mesmo worker podem ter deixado o banco 'regera' já em v3
    await Dexie.delete('regera');
  });

  afterEach(async () => {
    await Dexie.delete('regera');
  });

  it('upgrade de v2 para v3 apaga o cursor para forçar pull completo e mantém o resto', async () => {
    const v2 = new Dexie('regera');
    v2.version(2).stores({
      meta: 'chave', clientes: 'id, documento, nomeBusca', outbox: '++seq, agregadoId',
      pendencias: 'mutationId, agregadoId', usuarios: 'id',
    });
    await v2.table('meta').bulkPut([
      { chave: 'cursor', valor: 99 }, { chave: 'cursorDono', valor: 'u1' }, { chave: 'sessao', valor: { id: 'u1' } },
    ]);
    await v2.table('clientes').put({ id: 'c1', documento: '1', nomeBusca: 'x' });
    // com mutação na fila: o v6 (N2) apaga as tabelas sincronizadas, menos o que a fila protege
    await v2.table('outbox').add({ mutationId: 'm1', agregadoId: 'c1' });
    v2.close();

    const db = new RegeraDb();
    expect(await db.lerMeta('cursor')).toBeUndefined();
    expect(await db.lerMeta('cursorDono')).toBeUndefined();
    expect(await db.lerMeta('sessao')).toEqual({ id: 'u1' });
    expect(await db.clientes.count()).toBe(1);
    expect(await db.itens.count()).toBe(0);
    db.close();
  });
});
