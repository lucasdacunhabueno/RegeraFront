import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { RegeraDb } from '../../core/db/regera-db';
import { Pendencia } from '../../core/sync/sync-models';
import { SyncService } from '../../core/sync/sync-service';
import { ErroCampo } from '../../core/util/erro-campo';
import { blocosIniciais, paraTemplateLocal, TemplateDados, TipoProposta } from './template-models';
import { TemplatesRepo } from './templates-repo';

const dados = (nome = 'Serviço', tipoProposta: TipoProposta = 'SERVICO', padrao = false): TemplateDados => ({
  nome, tipoProposta, padrao, ativo: true, blocos: blocosIniciais(),
});

const pendencia = (entidade: Pendencia['entidade'], agregadoId: string): Pendencia => ({
  mutationId: `m-${entidade}`, entidade, agregadoId, tipo: 'REJEITADO', criadaEm: '',
  mutacao: { mutationId: `m-${entidade}`, entidade, agregadoId, op: 'UPSERT', baseVersion: 1, dados: null, criadaEm: '' },
});

describe('TemplatesRepo', () => {
  let repo: TemplatesRepo;
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
    repo = TestBed.inject(TemplatesRepo);
    db = TestBed.inject(RegeraDb);
    sincronizar = vi.spyOn(TestBed.inject(SyncService), 'sincronizar').mockResolvedValue('concluida');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.limparTudo();
  });

  it('salvar novo grava local e enfileira UPSERT de template_proposta sem versão', async () => {
    const id = await repo.salvar(dados('  Serviço Padrão '));
    expect(await db.templates.get(id)).toMatchObject({ nome: 'Serviço Padrão', nomeBusca: 'servico padrao', version: null });
    const [m] = await db.outbox.toArray();
    expect(m).toMatchObject({ entidade: 'template_proposta', agregadoId: id, op: 'UPSERT', baseVersion: null });
    expect(m.dados).toMatchObject({ nome: 'Serviço Padrão', tipoProposta: 'SERVICO', padrao: false, ativo: true });
    expect((m.dados as TemplateDados).blocos).toHaveLength(5);
    expect(sincronizar).toHaveBeenCalled();
  });

  it('usa a versão carregada pelo formulário como base', async () => {
    await db.templates.put(paraTemplateLocal('t1', 5, dados()));
    await repo.salvar(dados('Outro nome'), 't1', 3);
    expect((await db.outbox.toArray())[0].baseVersion).toBe(3);
  });

  it('blocos inválidos lançam ErroCampo("blocos") e não gravam nem enfileiram', async () => {
    const invalido = { ...dados(), blocos: [{ id: 'a', tipo: 'ITENS', config: { colunas: [], agruparPorNatureza: false } }] } as TemplateDados;
    const erro = await repo.salvar(invalido).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroCampo);
    expect((erro as ErroCampo).campo).toBe('blocos');
    expect(await db.outbox.count()).toBe(0);
    expect(await db.templates.count()).toBe(0);
  });

  it('marcar B como padrão não mexe em A nem enfileira nada para A; B pendente é o padrão efetivo', async () => {
    await db.templates.bulkPut([
      paraTemplateLocal('a', 2, dados('A', 'SERVICO', true)),
      paraTemplateLocal('c', 1, dados('C', 'VENDA', true)),
    ]);
    const b = await repo.salvar(dados('B', 'SERVICO', true));
    expect(await db.templates.get('a')).toMatchObject({ padrao: true, version: 2 });
    expect((await db.outbox.toArray()).map((m) => m.agregadoId)).toEqual([b]);
    expect((await repo.padraoPorTipo('SERVICO'))?.id).toBe(b);
    expect((await repo.padraoPorTipo('VENDA'))?.id).toBe('c');
    expect(await firstValueFrom(repo.observarPadroesEfetivos())).toEqual(new Map([['SERVICO', b], ['VENDA', 'c']]));
  });

  it('depois do sync de B (sem mutação) e do pull que desmarca A, o padrão é B', async () => {
    await db.templates.bulkPut([paraTemplateLocal('a', 2, dados('A', 'SERVICO', true))]);
    const b = await repo.salvar(dados('B', 'SERVICO', true));
    await db.outbox.clear();
    await db.templates.put(paraTemplateLocal('a', 3, dados('A', 'SERVICO', false)));
    expect((await repo.padraoPorTipo('SERVICO'))?.id).toBe(b);
  });

  it('B descartado (sem pendência) com A ainda padrão: A volta a ser o padrão efetivo', async () => {
    await db.templates.bulkPut([paraTemplateLocal('a', 2, dados('A', 'SERVICO', true))]);
    const b = await repo.salvar(dados('B', 'SERVICO', true));
    await db.outbox.clear();
    expect((await db.templates.get(b))?.padrao).toBe(true);
    expect((await repo.padraoPorTipo('SERVICO'))?.id).toBe('a');
    expect(await firstValueFrom(repo.observarPadroesEfetivos())).toEqual(new Map([['SERVICO', 'a']]));
  });

  it('padrão inativo lança ErroCampo("padrao") e não enfileira', async () => {
    const erro = await repo.salvar({ ...dados('X', 'SERVICO', true), ativo: false }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroCampo);
    expect((erro as ErroCampo).campo).toBe('padrao');
    expect((erro as ErroCampo).message).toBe('Um template inativo não pode ser o padrão.');
    expect(await db.outbox.count()).toBe(0);
    expect(await db.templates.count()).toBe(0);
  });

  it('excluir remove local, limpa só rejeições de template e enfileira DELETE', async () => {
    await db.templates.put(paraTemplateLocal('t1', 2, dados()));
    await db.pendencias.bulkPut([pendencia('template_proposta', 't1'), pendencia('cliente', 't1')]);
    await repo.excluir('t1', 2);
    expect(await db.templates.get('t1')).toBeUndefined();
    expect((await db.pendencias.toArray()).map((p) => p.entidade)).toEqual(['cliente']);
    expect((await db.outbox.toArray())[0]).toMatchObject({ entidade: 'template_proposta', op: 'DELETE', baseVersion: 2, dados: null });
  });

  it('salvar limpa só rejeições de template', async () => {
    await db.templates.put(paraTemplateLocal('t1', 2, dados()));
    await db.pendencias.bulkPut([pendencia('template_proposta', 't1'), pendencia('item_catalogo', 't1')]);
    await repo.salvar(dados(), 't1');
    expect((await db.pendencias.toArray()).map((p) => p.entidade)).toEqual(['item_catalogo']);
    expect(await repo.temPendencia('t1')).toBe(true);
  });

  it('excluir sem versão carregada usa a versão local', async () => {
    await db.templates.put(paraTemplateLocal('t1', 7, dados()));
    await repo.excluir('t1');
    expect((await db.outbox.toArray())[0]).toMatchObject({ op: 'DELETE', baseVersion: 7 });
  });

  it('padraoPorTipo devolve o padrão ativo do tipo', async () => {
    await db.templates.bulkPut([
      paraTemplateLocal('a', 1, dados('A', 'SERVICO', false)),
      paraTemplateLocal('b', 1, dados('B', 'SERVICO', true)),
      paraTemplateLocal('c', 1, { ...dados('C', 'VENDA', true), ativo: false }),
    ]);
    expect((await repo.padraoPorTipo('SERVICO'))?.id).toBe('b');
    expect(await repo.padraoPorTipo('VENDA')).toBeUndefined();
    expect(await repo.padraoPorTipo('LOCACAO')).toBeUndefined();
  });

  it('observarTodos ordena por nome', async () => {
    await db.templates.bulkPut([paraTemplateLocal('z', 1, dados('Zeta')), paraTemplateLocal('a', 1, dados('Álvaro'))]);
    expect((await firstValueFrom(repo.observarTodos())).map((t) => t.id)).toEqual(['a', 'z']);
    expect((await repo.buscar('z'))?.nome).toBe('Zeta');
  });
});
