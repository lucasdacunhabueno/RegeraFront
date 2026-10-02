import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { RegeraDb } from '../../core/db/regera-db';
import { SyncService } from '../../core/sync/sync-service';
import { ErroCampo } from '../../core/util/erro-campo';
import { CatalogoRepo } from './catalogo-repo';
import { ItemCatalogoDados, paraItemLocal } from './item-models';

const dados = (codigo = 'pnl-1', nome = 'Painel'): ItemCatalogoDados => ({
  natureza: 'PRODUTO', codigo, nome, descricao: null, unidade: 'un', precoCusto: 10, precoVenda: 20,
  locavel: false, precoLocacaoMensal: null, fotoArquivoId: null, ativo: true,
});

describe('CatalogoRepo', () => {
  let repo: CatalogoRepo;
  let db: RegeraDb;
  let sincronizar: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { autenticado: () => true, sessaoExpirada: () => false, usuario: () => null } },
        { provide: ConectividadeService, useValue: { online: signal(false) } },
      ],
    });
    repo = TestBed.inject(CatalogoRepo);
    db = TestBed.inject(RegeraDb);
    sincronizar = vi.spyOn(TestBed.inject(SyncService), 'sincronizar').mockResolvedValue('concluida');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.limparTudo();
  });

  it('salvar novo normaliza o código, grava local e enfileira UPSERT sem versão', async () => {
    const id = await repo.salvar(dados(' pnl-1 '));
    expect(await db.itens.get(id)).toMatchObject({ codigo: 'PNL-1', version: null });
    expect((await db.outbox.toArray())[0]).toMatchObject({ entidade: 'item_catalogo', op: 'UPSERT', baseVersion: null });
    expect((await db.outbox.toArray())[0].dados).toMatchObject({ codigo: 'PNL-1' });
    expect(sincronizar).toHaveBeenCalled();
  });

  it('usa a versão carregada pelo formulário como base', async () => {
    await db.itens.put(paraItemLocal('i1', 5, dados('A')));
    await repo.salvar(dados('A', 'Novo nome'), 'i1', 3);
    expect((await db.outbox.toArray())[0].baseVersion).toBe(3);
  });

  it('recusa código repetido neste aparelho, ignorando maiúsculas', async () => {
    await db.itens.put(paraItemLocal('i1', 0, dados('ABC')));
    await expect(repo.salvar(dados('abc', 'Outro'))).rejects.toBeInstanceOf(ErroCampo);
    expect(await db.outbox.count()).toBe(0);
  });

  it('excluir remove local, limpa rejeição e enfileira DELETE', async () => {
    await db.itens.put(paraItemLocal('i1', 2, dados('A')));
    await db.pendencias.put({
      mutationId: 'm1', entidade: 'item_catalogo', agregadoId: 'i1', tipo: 'REJEITADO', criadaEm: '',
      mutacao: { mutationId: 'm1', entidade: 'item_catalogo', agregadoId: 'i1', op: 'UPSERT', baseVersion: 2, dados: null, criadaEm: '' },
    });
    await repo.excluir('i1', 2);
    expect(await db.itens.get('i1')).toBeUndefined();
    expect(await db.pendencias.count()).toBe(0);
    expect((await db.outbox.toArray())[0]).toMatchObject({ op: 'DELETE', baseVersion: 2 });
  });

  it('salvar e excluir só removem pendências de item do catálogo', async () => {
    await db.itens.put(paraItemLocal('i1', 2, dados('A')));
    await db.pendencias.put({
      mutationId: 'mx', entidade: 'cliente', agregadoId: 'i1', tipo: 'REJEITADO', criadaEm: '',
      mutacao: { mutationId: 'mx', entidade: 'cliente', agregadoId: 'i1', op: 'UPSERT', baseVersion: 2, dados: null, criadaEm: '' },
    });
    await repo.salvar(dados('A'), 'i1');
    expect(await db.pendencias.count()).toBe(1);
    await repo.excluir('i1');
    expect(await db.pendencias.count()).toBe(1);
  });

  it('editar mantendo o mesmo código não acusa duplicado', async () => {
    await db.itens.put(paraItemLocal('i1', 2, dados('PNL-1')));
    await expect(repo.salvar(dados('pnl-1', 'Painel novo'), 'i1', 2)).resolves.toBe('i1');
    expect(await db.itens.get('i1')).toMatchObject({ codigo: 'PNL-1', nome: 'Painel novo' });
  });

  it('excluir sem versão carregada usa a versão local', async () => {
    await db.itens.put(paraItemLocal('i1', 7, dados('A')));
    await repo.excluir('i1');
    expect((await db.outbox.toArray())[0]).toMatchObject({ op: 'DELETE', baseVersion: 7 });
  });
});
