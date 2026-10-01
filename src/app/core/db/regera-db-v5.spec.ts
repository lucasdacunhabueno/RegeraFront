import Dexie from 'dexie';
import { DocumentoLocal } from '../../features/propostas/proposta-models';
import { ADAPTADORES } from '../sync/adaptadores';
import { RegeraDb } from './regera-db';

const V4 = {
  meta: 'chave', clientes: 'id, documento, nomeBusca', outbox: '++seq, agregadoId', pendencias: 'mutationId, agregadoId',
  usuarios: 'id', itens: 'id, codigo, nomeBusca', empresa: 'id', arquivos: 'id', templates: 'id, tipoProposta, nomeBusca',
};

function documento(id: string, propostaId: string, enviado: boolean): DocumentoLocal {
  return {
    id, propostaId, revisao: 1, codigoExibido: 'PROV-0Z9XY7', sha256: 'ab'.repeat(32), geradoEm: '2026-10-01T10:00:00Z',
    geradoPor: 'u1', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
    enviado, arquivoId: enviado ? 'a1' : null,
  };
}

describe('RegeraDb v5', () => {
  beforeEach(async () => {
    // outros specs do mesmo worker podem ter deixado o banco 'regera' já em v5
    await Dexie.delete('regera');
  });

  afterEach(async () => {
    await Dexie.delete('regera');
  });

  it('upgrade de v4 para v5 apaga o cursor para forçar pull completo, mantém o que a fila protege e cria propostas e documentos', async () => {
    const v4 = new Dexie('regera');
    v4.version(4).stores(V4);
    await v4.table('meta').bulkPut([
      { chave: 'cursor', valor: 99 }, { chave: 'cursorDono', valor: 'u1:ADMIN' }, { chave: 'sessao', valor: { id: 'u1' } },
    ]);
    await v4.table('clientes').put({ id: 'c1', documento: '1', nomeBusca: 'x' });
    await v4.table('templates').put({ id: 't1', tipoProposta: 'VENDA', nomeBusca: 't' });
    await v4.table('outbox').add({ mutationId: 'm1', agregadoId: 'c1' });
    v4.close();

    const db = new RegeraDb();
    expect(await db.lerMeta('cursor')).toBeUndefined();
    expect(await db.lerMeta('cursorDono')).toBeUndefined();
    expect(await db.lerMeta('sessao')).toEqual({ id: 'u1' });
    // o c1 tem mutação na fila; o template não, e o v6 (N2) o apaga: volta no pull completo
    expect(await db.clientes.count()).toBe(1);
    expect(await db.templates.count()).toBe(0);
    expect(await db.outbox.count()).toBe(1);
    expect(await db.propostas.count()).toBe(0);
    expect(await db.documentos.count()).toBe(0);
    expect(db.propostas.schema.primKey.name).toBe('id');
    expect(db.propostas.schema.indexes.map((i) => i.name).sort())
      .toEqual(['clienteId', 'codigoProvisorio', 'numero', 'responsavelId', 'status', 'tecnicoId']);
    expect(db.documentos.schema.primKey.name).toBe('id');
    expect(db.documentos.schema.indexes.map((i) => i.name)).toEqual(['propostaId']);
    db.close();
  });

  it('a proposta passa pelo adaptador do sync e é encontrada pelos índices (null fica fora do índice)', async () => {
    const db = new RegeraDb();
    const a = ADAPTADORES.proposta;
    expect(a.tabela(db)).toBe(db.propostas);
    const local = a.paraLocal('p1', 3, {
      codigoProvisorio: 'PROV-0Z9XY7', numero: null, tipo: 'VENDA', status: 'RASCUNHO', clienteId: 'c1', responsavelId: 'u1',
      tecnicoId: null, dataEmissao: '2026-10-01', descontoGeralPercentual: 0, itens: [], historico: [], documentos: [],
    });
    await a.tabela(db).put(local);
    await db.propostas.put({ ...(await db.propostas.get('p1'))!, id: 'p2', numero: 277, codigoProvisorio: 'PROV-0000AB' });
    expect((await db.propostas.where('codigoProvisorio').equals('PROV-0Z9XY7').first())?.id).toBe('p1');
    expect((await db.propostas.where('numero').equals(277).first())?.id).toBe('p2');
    expect(await db.propostas.where('numero').above(0).count()).toBe(1);
    expect(await db.propostas.where('status').equals('RASCUNHO').count()).toBe(2);
    expect(a.dadosDe((await db.propostas.get('p1'))!)).toMatchObject({ codigoProvisorio: 'PROV-0Z9XY7', clienteId: 'c1', itens: [] });
    db.close();
  });

  it('documentos guardam os bytes do PDF e são achados pela proposta', async () => {
    const db = new RegeraDb();
    await db.documentos.bulkPut([documento('d1', 'p1', true), documento('d2', 'p1', false), documento('d3', 'p2', false)]);
    const doP1 = await db.documentos.where('propostaId').equals('p1').toArray();
    expect(doP1.map((d) => d.id).sort()).toEqual(['d1', 'd2']);
    const d2 = doP1.find((d) => d.id === 'd2')!;
    expect(d2.enviado).toBe(false);
    expect(d2.arquivoId).toBeNull();
    expect(new TextDecoder().decode(d2.bytes!)).toBe('%PDF');
    db.close();
  });

  it('limparTudo apaga propostas e documentos', async () => {
    const db = new RegeraDb();
    await db.propostas.put(ADAPTADORES.proposta.paraLocal('p1', 1, {
      codigoProvisorio: 'PROV-0Z9XY7', tipo: 'VENDA', status: 'RASCUNHO', responsavelId: 'u1', dataEmissao: '2026-10-01',
      descontoGeralPercentual: 0, itens: [],
    }) as never);
    await db.documentos.put(documento('d1', 'p1', false));
    await db.limparTudo();
    expect(await db.propostas.count()).toBe(0);
    expect(await db.documentos.count()).toBe(0);
    db.close();
  });
});
