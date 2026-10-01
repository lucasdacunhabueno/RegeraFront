import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { RegeraDb } from '../../core/db/regera-db';
import { SyncService } from '../../core/sync/sync-service';
import { ClienteDados, paraClienteLocal } from './cliente-models';
import { ClientesRepo, ErroCampo } from './clientes-repo';

const dados = (documento = '52998224725', nome = 'Maria'): ClienteDados => ({
  tipo: 'PF', documento, nome, nomeFantasia: null, inscricaoEstadual: null, inscricaoMunicipal: null,
  email: null, telefone: null, whatsapp: null, contatoNome: null, observacoes: null, enderecos: [],
});

describe('ClientesRepo', () => {
  let repo: ClientesRepo;
  let db: RegeraDb;
  let sincronizar: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { autenticado: () => true, sessaoExpirada: () => false } },
        { provide: ConectividadeService, useValue: { online: signal(false) } },
      ],
    });
    repo = TestBed.inject(ClientesRepo);
    db = TestBed.inject(RegeraDb);
    sincronizar = vi.spyOn(TestBed.inject(SyncService), 'sincronizar').mockResolvedValue();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.limparTudo();
  });

  it('cliente do TECNICO sem documento (Q14) grava no Dexie, é encontrado e não atrapalha o índice de documento', async () => {
    const doTecnico: Partial<ClienteDados> = dados('52998224725', 'Téo');
    delete doTecnico.documento;
    await db.clientes.put(paraClienteLocal('t1', 1, doTecnico as ClienteDados));
    expect(await repo.buscar('t1')).toMatchObject({ documento: null, nome: 'Téo' });
    expect(await db.clientes.orderBy('nomeBusca').primaryKeys()).toEqual(['t1']);
    const id = await repo.salvar(dados('529.982.247-25'));
    expect(await db.clientes.where('documento').equals('52998224725').primaryKeys()).toEqual([id]);
  });

  it('salvar novo grava local com UUID v7, enfileira UPSERT sem versão e sincroniza', async () => {
    const id = await repo.salvar(dados('529.982.247-25'));

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    const local = await db.clientes.get(id);
    expect(local).toMatchObject({ documento: '52998224725', version: null, nomeBusca: 'maria' });
    const fila = await db.outbox.toArray();
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ entidade: 'cliente', agregadoId: id, op: 'UPSERT', baseVersion: null });
    expect(sincronizar).toHaveBeenCalled();
  });

  it('editar usa a versão conhecida do servidor como base', async () => {
    await db.clientes.put(paraClienteLocal('c1', 4, dados()));
    await repo.salvar(dados('52998224725', 'Maria Souza'), 'c1');

    expect((await db.clientes.get('c1'))?.nome).toBe('Maria Souza');
    expect((await db.outbox.toArray())[0].baseVersion).toBe(4);
  });

  it('recusa documento repetido neste aparelho', async () => {
    await db.clientes.put(paraClienteLocal('c1', 0, dados()));
    await expect(repo.salvar(dados('52998224725', 'Outra'))).rejects.toBeInstanceOf(ErroCampo);
    expect(await db.outbox.count()).toBe(0);
  });

  it('salvar de novo resolve rejeição pendente do mesmo cliente', async () => {
    await db.clientes.put(paraClienteLocal('c1', null, dados()));
    await db.pendencias.put({
      mutationId: 'm1', entidade: 'cliente', agregadoId: 'c1', tipo: 'REJEITADO',
      mutacao: { mutationId: 'm1', entidade: 'cliente', agregadoId: 'c1', op: 'UPSERT', baseVersion: null, dados: null, criadaEm: '' },
      erro: { codigo: 'VALIDACAO', mensagem: 'x' }, criadaEm: '',
    });
    expect(await repo.temPendencia('c1')).toBe(true);

    await repo.salvar(dados('52998224725', 'Corrigido'), 'c1');

    expect(await db.pendencias.count()).toBe(0);
    expect(await repo.temPendencia('c1')).toBe(false);
  });

  it('excluir remove local e enfileira DELETE com a versão', async () => {
    await db.clientes.put(paraClienteLocal('c1', 2, dados()));
    await repo.excluir('c1');

    expect(await db.clientes.get('c1')).toBeUndefined();
    expect((await db.outbox.toArray())[0]).toMatchObject({ op: 'DELETE', baseVersion: 2 });
  });

  it('salvar com versaoCarregada usa ela como base mesmo se o local já avançou', async () => {
    await db.clientes.put(paraClienteLocal('c1', 3, dados()));
    await repo.salvar(dados('52998224725', 'Editado'), 'c1', 2);

    expect((await db.outbox.toArray())[0].baseVersion).toBe(2);
    expect((await db.clientes.get('c1'))?.version).toBe(2);
  });

  it('excluir com versaoCarregada usa ela como base', async () => {
    await db.clientes.put(paraClienteLocal('c1', 3, dados()));
    await repo.excluir('c1', 2);

    expect((await db.outbox.toArray())[0]).toMatchObject({ op: 'DELETE', baseVersion: 2 });
  });

  it('excluir limpa rejeições pendentes do cliente', async () => {
    await db.clientes.put(paraClienteLocal('c1', 2, dados()));
    await db.pendencias.put({
      mutationId: 'm1', entidade: 'cliente', agregadoId: 'c1', tipo: 'REJEITADO',
      mutacao: { mutationId: 'm1', entidade: 'cliente', agregadoId: 'c1', op: 'UPSERT', baseVersion: 2, dados: null, criadaEm: '' },
      erro: { codigo: 'VALIDACAO', mensagem: 'x' }, criadaEm: '',
    });
    await repo.excluir('c1');

    expect(await db.pendencias.count()).toBe(0);
  });

  it('salvar e excluir só removem pendências de cliente', async () => {
    await db.clientes.put(paraClienteLocal('c1', 2, dados()));
    await db.pendencias.put({
      mutationId: 'mx', entidade: 'item_catalogo', agregadoId: 'c1', tipo: 'REJEITADO',
      mutacao: { mutationId: 'mx', entidade: 'item_catalogo', agregadoId: 'c1', op: 'UPSERT', baseVersion: 2, dados: null, criadaEm: '' },
      erro: { codigo: 'VALIDACAO', mensagem: 'x' }, criadaEm: '',
    });
    await repo.salvar(dados(), 'c1');
    expect(await db.pendencias.count()).toBe(1);
    await repo.excluir('c1');
    expect(await db.pendencias.count()).toBe(1);
  });

  it('observa a lista e os ids não sincronizados', async () => {
    const listas: string[][] = [];
    const sub = repo.observarTodos().subscribe((l) => listas.push(l.map((c) => c.nome)));
    const ids: Set<string>[] = [];
    const sub2 = repo.observarNaoSincronizados().subscribe((s) => ids.push(s));

    const id = await repo.salvar(dados());

    await vi.waitFor(() => expect(listas.at(-1)).toEqual(['Maria']));
    await vi.waitFor(() => expect(ids.at(-1)?.has(id)).toBe(true));
    sub.unsubscribe();
    sub2.unsubscribe();
  });
});
