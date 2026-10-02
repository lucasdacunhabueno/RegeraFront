import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import type { UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import type { UsuarioResumo } from '../../core/sync/sync-models';
import { Toasts } from '../../shared/ui/toasts';
import type { PropostaLocal, StatusProposta } from '../propostas/proposta-models';
import { PropostasRepo } from '../propostas/propostas-repo';
import { ErroOs } from './erro-os';
import { OsDados, OsLocal, paraOsLocal, StatusOs } from './os-models';
import { EstadoSync, OpcoesGerarOs, OsRepo } from './os-repo';
import { OsDaProposta } from './os-da-proposta';

const ADMIN: UsuarioSessao = { id: 'u-adm', nome: 'Ana Admin', email: 'ana@regera.com', perfil: 'ADMIN', ativo: true };
const COMERCIAL: UsuarioSessao = { id: 'u-com', nome: 'Carla Comercial', email: 'carla@regera.com', perfil: 'COMERCIAL', ativo: true };
const OUTRO_COMERCIAL: UsuarioSessao = { id: 'u-com2', nome: 'Caio Comercial', email: 'caio@regera.com', perfil: 'COMERCIAL', ativo: true };
const TECNICO: UsuarioSessao = { id: 'u-tec', nome: 'Téo Técnico', email: 'teo@regera.com', perfil: 'TECNICO', ativo: true };

const USUARIOS: UsuarioResumo[] = [
  { id: ADMIN.id, nome: ADMIN.nome, perfil: 'ADMIN' },
  { id: COMERCIAL.id, nome: COMERCIAL.nome, perfil: 'COMERCIAL' },
  { id: TECNICO.id, nome: TECNICO.nome, perfil: 'TECNICO' },
  { id: 'u-tec-off', nome: 'Tito Inativo', perfil: 'TECNICO', ativo: false },
];

function proposta(p: Partial<PropostaLocal> = {}): PropostaLocal {
  return {
    id: 'p1', version: 3, codigoProvisorio: 'PROV-ABC123', numero: 277, revisao: 1, tipo: 'SERVICO', status: 'APROVADA',
    clienteId: 'c1', templateId: 't1', responsavelId: COMERCIAL.id, tecnicoId: TECNICO.id, dataEmissao: '2026-09-20',
    validadeAte: '2026-10-05', condicoesPagamento: null, prazoExecucao: '30 dias', observacoes: 'Telhado de laje',
    descontoGeralCentesimos: 0, totalItensCentavos: 100, totalDescontosCentavos: 0, totalCentavos: 100, motivoEncerramento: null,
    itens: [], historico: [], documentos: [], atualizadoEm: null, ...p,
  };
}

const os = (id: string, status: StatusOs, extra: Partial<OsDados> = {}): OsLocal =>
  paraOsLocal(id, 1, {
    codigoProvisorio: `OSP-${id.toUpperCase().padEnd(6, '0')}`, numero: null, propostaId: 'p1', clienteId: 'c1', tipo: 'SERVICO',
    status, responsavelId: COMERCIAL.id, tecnicoId: TECNICO.id, urgente: false, concluiProposta: true, assinaturaRecusada: false,
    itens: [], notas: [], atualizadoEm: '2026-10-01T10:00:00Z', ...extra,
  });

const SEM_ESTADO: EstadoSync = { naOutbox: new Set(), comPendencia: new Set(), comConflito: new Set() };

interface Opcoes {
  usuario?: UsuarioSessao;
  proposta?: PropostaLocal;
  oss?: OsLocal[];
}

async function montar(o: Opcoes = {}) {
  const lista$ = new BehaviorSubject<OsLocal[]>(o.oss ?? []);
  const repo = {
    observarDaProposta: vi.fn(() => lista$.asObservable()),
    observarEstadoSync: () => of(SEM_ESTADO),
    gerarDaProposta: vi.fn<(id: string, opcoes?: OpcoesGerarOs) => Promise<string>>(async () => 'o-nova'),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { usuario: signal(o.usuario ?? COMERCIAL) } },
      { provide: OsRepo, useValue: repo },
      { provide: PropostasRepo, useValue: { observarUsuarios: () => of(USUARIOS) } },
    ],
  });
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const toast = vi.spyOn(TestBed.inject(Toasts), 'mostrar');
  const toastErro = vi.spyOn(TestBed.inject(Toasts), 'erro');
  const fixture = TestBed.createComponent(OsDaProposta);
  fixture.componentRef.setInput('proposta', o.proposta ?? proposta());
  fixture.componentRef.setInput('clienteNome', 'Padaria São João');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  await ate(fixture, () => expect(el.textContent).not.toContain('Carregando'));
  return { fixture, el, repo, lista$, navegar, toast, toastErro };
}

async function ate(fixture: ComponentFixture<unknown>, verificar: () => void) {
  await vi.waitFor(() => {
    fixture.detectChanges();
    verificar();
  });
}

const botao = (el: HTMLElement, texto: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === texto);
const codigos = (el: HTMLElement) => [...el.querySelectorAll('app-os-card .font-mono')].map((c) => c.textContent?.trim());

describe('OsDaProposta', () => {
  it('lista as OS da proposta (observarDaProposta) com o card, o técnico e o status', async () => {
    const { el, repo } = await montar({ oss: [os('a', 'EM_ANDAMENTO'), os('b', 'CANCELADA', { tecnicoId: null })] });
    expect(repo.observarDaProposta).toHaveBeenCalledWith('p1');
    expect(el.querySelector('h2')!.textContent).toContain('Ordens de serviço');
    expect(codigos(el)).toEqual(['OSP-A00000', 'OSP-B00000']);
    expect(el.textContent).toContain('Técnico: Téo Técnico');
    expect(el.textContent).toContain('Sem técnico');
    expect(el.querySelector('a[href="/os/a"]')).not.toBeNull();
  });

  it('sem OS: o aviso', async () => {
    const { el } = await montar();
    expect(el.textContent).toContain('Nenhuma OS para esta proposta.');
  });

  it('a lista acompanha o repositório (a OS gerada ou sincronizada aparece)', async () => {
    const { fixture, el, lista$ } = await montar();
    lista$.next([os('a', 'ABERTA')]);
    await ate(fixture, () => expect(codigos(el)).toEqual(['OSP-A00000']));
  });

  it('o COMERCIAL não vê a OS de outro comercial (o filtro do observarTodas)', async () => {
    const { el } = await montar({
      usuario: COMERCIAL,
      oss: [os('a', 'ABERTA'), os('b', 'ABERTA', { responsavelId: OUTRO_COMERCIAL.id })],
    });
    expect(codigos(el)).toEqual(['OSP-A00000']);
  });

  describe('"Gerar OS" por perfil e status', () => {
    const todos: StatusProposta[] = ['RASCUNHO', 'ENVIADA', 'APROVADA', 'EM_EXECUCAO', 'FINALIZADA', 'RECUSADA', 'CANCELADA'];
    const casos: [string, UsuarioSessao, StatusProposta, boolean][] = [
      ...todos.map((s): [string, UsuarioSessao, StatusProposta, boolean] => ['ADMIN', ADMIN, s, s === 'APROVADA' || s === 'EM_EXECUCAO']),
      ...todos.map((s): [string, UsuarioSessao, StatusProposta, boolean] =>
        ['COMERCIAL responsável', COMERCIAL, s, s === 'APROVADA' || s === 'EM_EXECUCAO']),
      ['outro COMERCIAL', OUTRO_COMERCIAL, 'APROVADA', false],
      ['outro COMERCIAL', OUTRO_COMERCIAL, 'EM_EXECUCAO', false],
      ['TECNICO', TECNICO, 'APROVADA', false],
    ];
    it.each(casos)('%s com a proposta %s: %s', async (_quem, usuario, status, esperado) => {
      const { el } = await montar({ usuario, proposta: proposta({ status }) });
      expect(!!botao(el, 'Gerar OS')).toBe(esperado);
    });
  });

  it('gera com as opções do diálogo, avisa e navega para a OS nova', async () => {
    const { fixture, el, repo, navegar, toast } = await montar();
    botao(el, 'Gerar OS')!.click();
    fixture.detectChanges();
    const dialogo = el.querySelector('app-dialogo-gerar-os')!;
    expect(dialogo).not.toBeNull();
    // o pré-preenchimento para revisão (M2P2-R17)
    expect(dialogo.querySelector<HTMLTextAreaElement>('textarea[name=descricao]')!.value).toBe('Telhado de laje\n\nPrazo de execução: 30 dias');
    const conclui = dialogo.querySelector<HTMLInputElement>('input[name=conclui]')!;
    conclui.checked = false;
    conclui.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    botao(dialogo as HTMLElement, 'Gerar OS')!.click();
    await vi.waitFor(() => expect(repo.gerarDaProposta).toHaveBeenCalledExactlyOnceWith('p1', {
      tipo: 'SERVICO', tecnicoId: TECNICO.id, dataPrevista: null, urgente: false, concluiProposta: false,
      descricao: 'Telhado de laje\n\nPrazo de execução: 30 dias',
    }));
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/os', 'o-nova']));
    expect(toast).toHaveBeenCalledWith('OS gerada.');
  });

  it('o padrão do "conclui a proposta" é sim', async () => {
    const { fixture, el, repo } = await montar();
    botao(el, 'Gerar OS')!.click();
    fixture.detectChanges();
    botao(el.querySelector('app-dialogo-gerar-os') as HTMLElement, 'Gerar OS')!.click();
    await vi.waitFor(() => expect(repo.gerarDaProposta).toHaveBeenCalled());
    expect(repo.gerarDaProposta.mock.calls[0][1]!.concluiProposta).toBe(true);
  });

  it('o técnico do diálogo: só os ativos', async () => {
    const { fixture, el } = await montar();
    botao(el, 'Gerar OS')!.click();
    fixture.detectChanges();
    const opcoes = [...el.querySelectorAll<HTMLOptionElement>('select[name=tecnico] option')].map((x) => x.textContent?.trim());
    expect(opcoes).toEqual(['Nenhum (atribuir depois)', 'Téo Técnico']);
  });

  it('com OS em curso, o diálogo avisa', async () => {
    const { fixture, el } = await montar({ proposta: proposta({ status: 'EM_EXECUCAO' }), oss: [os('a', 'EM_ANDAMENTO'), os('b', 'CONCLUIDA')] });
    botao(el, 'Gerar OS')!.click();
    fixture.detectChanges();
    expect(el.querySelector('app-dialogo-gerar-os')!.textContent).toContain('Esta proposta já tem 1 OS aberta ou em andamento.');
  });

  it('a recusa do repositório vira toast pelo mensagemErroOs, e o diálogo fica aberto', async () => {
    const { fixture, el, repo, toastErro, navegar } = await montar();
    repo.gerarDaProposta.mockRejectedValueOnce(ErroOs.de({
      codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { propostaId: 'A proposta precisa estar aprovada ou em execução.' },
    }));
    botao(el, 'Gerar OS')!.click();
    fixture.detectChanges();
    botao(el.querySelector('app-dialogo-gerar-os') as HTMLElement, 'Gerar OS')!.click();
    await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('A proposta precisa estar aprovada ou em execução.'));
    fixture.detectChanges();
    expect(el.querySelector('app-dialogo-gerar-os')).not.toBeNull();
    expect(navegar).not.toHaveBeenCalled();
  });

  it('Voltar fecha o diálogo sem gerar', async () => {
    const { fixture, el, repo } = await montar();
    botao(el, 'Gerar OS')!.click();
    fixture.detectChanges();
    botao(el, 'Voltar')!.click();
    fixture.detectChanges();
    expect(el.querySelector('app-dialogo-gerar-os')).toBeNull();
    expect(repo.gerarDaProposta).not.toHaveBeenCalled();
  });
});
