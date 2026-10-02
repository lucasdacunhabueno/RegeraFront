import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, filter, of } from 'rxjs';
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
  bloqueado?: boolean;
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
  if (o.bloqueado !== undefined) fixture.componentRef.setInput('bloqueado', o.bloqueado);
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

  it('M7: o ADMIN vê "Trabalho em proposta cancelada" na OS da proposta cancelada; o COMERCIAL, não', async () => {
    const cancelada = proposta({ status: 'CANCELADA' });
    let { el } = await montar({ usuario: ADMIN, proposta: cancelada, oss: [os('a', 'EM_ANDAMENTO'), os('b', 'CANCELADA')] });
    const selos = (i: number) => [...el.querySelectorAll('app-os-card')[i].querySelectorAll('[data-selo]')].map((s) => s.textContent?.trim());
    expect(selos(0)).toEqual(['Trabalho em proposta cancelada']);
    expect(selos(1)).toEqual([]);
    TestBed.resetTestingModule();
    ({ el } = await montar({ usuario: COMERCIAL, proposta: cancelada, oss: [os('a', 'EM_ANDAMENTO')] }));
    expect(el.querySelector('[data-selo]')).toBeNull();
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

  it('M1: com CONFLITO da proposta, "Gerar OS" desabilitado com "Resolva a pendência primeiro"', async () => {
    const { el } = await montar({ bloqueado: true });
    const b = botao(el, 'Gerar OS')!;
    expect(b.disabled).toBe(true);
    expect(el.querySelector(`#${b.getAttribute('aria-describedby')}`)!.textContent).toContain('Resolva a pendência primeiro.');
    b.click();
    expect(el.querySelector('app-dialogo-gerar-os')).toBeNull();
  });

  it('M6: o toque duplo no "Gerar OS" do diálogo gera uma OS só', async () => {
    const { fixture, el, repo } = await montar();
    let liberar!: (id: string) => void;
    repo.gerarDaProposta.mockImplementationOnce(() => new Promise((r) => (liberar = r)));
    botao(el, 'Gerar OS')!.click();
    fixture.detectChanges();
    const dialogo = el.querySelector('app-dialogo-gerar-os') as HTMLElement;
    // o confirmar do diálogo chega duas vezes antes do primeiro desenho (o botão ainda habilitado)
    const confirmar = botao(dialogo, 'Gerar OS')!;
    confirmar.click();
    confirmar.click();
    liberar('o-nova');
    await vi.waitFor(() => expect(repo.gerarDaProposta).toHaveBeenCalledTimes(1));
    await fixture.whenStable();
    expect(repo.gerarDaProposta).toHaveBeenCalledTimes(1);
  });

  it('M3: a tela que saiu enquanto a OS era gerada não navega para ela', async () => {
    const { fixture, el, repo, navegar, toast } = await montar();
    let liberar!: (id: string) => void;
    repo.gerarDaProposta.mockImplementationOnce(() => new Promise((r) => (liberar = r)));
    botao(el, 'Gerar OS')!.click();
    fixture.detectChanges();
    botao(el.querySelector('app-dialogo-gerar-os') as HTMLElement, 'Gerar OS')!.click();
    await vi.waitFor(() => expect(repo.gerarDaProposta).toHaveBeenCalled());
    fixture.destroy();
    liberar('o-nova');
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('OS gerada.'));
    expect(navegar).not.toHaveBeenCalled();
  });

  it('N2: "Gerar OS" espera a lista de usuários (o técnico da proposta vem escolhido)', async () => {
    const usuarios$ = new BehaviorSubject<UsuarioResumo[] | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { usuario: signal(COMERCIAL) } },
        { provide: OsRepo, useValue: { observarDaProposta: () => of([]), observarEstadoSync: () => of(SEM_ESTADO), gerarDaProposta: vi.fn() } },
        { provide: PropostasRepo, useValue: { observarUsuarios: () => usuarios$.pipe(filter((u): u is UsuarioResumo[] => u !== null)) } },
      ],
    });
    const fixture = TestBed.createComponent(OsDaProposta);
    fixture.componentRef.setInput('proposta', proposta());
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(botao(el, 'Gerar OS')!.disabled).toBe(true);
    usuarios$.next(USUARIOS);
    await ate(fixture, () => expect(botao(el, 'Gerar OS')!.disabled).toBe(false));
    botao(el, 'Gerar OS')!.click();
    fixture.detectChanges();
    expect(el.querySelector<HTMLSelectElement>('select[name=tecnico]')!.value).toBe(TECNICO.id);
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
