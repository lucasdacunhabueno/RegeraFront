import { TestBed } from '@angular/core/testing';
import { RegeraDb } from './regera-db';

describe('RegeraDb', () => {
  let db: RegeraDb;

  beforeEach(() => {
    db = TestBed.inject(RegeraDb);
  });

  afterEach(async () => {
    await db.limparTudo();
  });

  it('grava e lê metadados', async () => {
    await db.gravarMeta('cursor', 42);
    expect(await db.lerMeta<number>('cursor')).toBe(42);
  });

  it('devolve undefined para chave inexistente', async () => {
    expect(await db.lerMeta('nada')).toBeUndefined();
  });

  it('limparTudo apaga todas as tabelas', async () => {
    await db.gravarMeta('a', 1);
    await db.limparTudo();
    expect(await db.meta.count()).toBe(0);
  });
});
