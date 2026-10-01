import { CdkDrag, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';
import { vi } from 'vitest';
import type { UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import type { UsuarioResumo } from '../../core/sync/sync-models';
import { ErroCampo } from '../../core/util/erro-campo';
import { Toasts } from '../../shared/ui/toasts';
import { ClienteLocal, paraClienteLocal } from '../clientes/cliente-models';
import { ClientesRepo } from '../clientes/clientes-repo';
import { PropostaLocal, StatusProposta } from '../propostas/proposta-models';
import { EstadoSync, PropostasRepo } from '../propostas/propostas-repo';

import { KanbanPage } from './kanban-page';

const ADMIN: UsuarioSessao = { id: 'u-adm', nome: 'Ana Admin', email: 'ana@regera.com', perfil: 'ADMIN', ativo: true };
const COMERCIAL: UsuarioSessao = { id: 'u-com', nome: 'Carla Comercial', email: 'carla@regera.com', perfil: 'COMERCIAL', ativo: true };
const BETO = 'u-beto';

const AGORA = new Date('2026-10-02T01:30:00Z');

function proposta(id: string, p: Partial<PropostaLocal> = {}): PropostaLocal {
  return {
    id, version: 1, codigoProvisorio: `PROV-${id.toUpperCase().padEnd(6, '0')}`, numero: null, revisao: null, tipo: 'VENDA',
    status: 'RASCUNHO', clienteId: 'c1', templateId: 't1', responsavelId: COMERCIAL.id, tecnicoId: null,
    dataEmissao: '2026-09-20', validadeAte: '2026-10-05', condicoesPagamento: null, prazoExecucao: null, observacoes: null,
    descontoGeralCentesimos: null, totalItensCentavos: 150000, totalDescontosCentavos: 0, totalCentavos: 150000,
    motivoEncerramento: null, itens: [], historico: [], documentos: [], atualizadoEm: null, ...p,
  };
}

const cliente = (id: string, nome: string, documento: string): ClienteLocal =>
  paraClienteLocal(id, 1, {
    tipo: documento.length === 14 ? 'PJ' : 'PF', documento, nome, nomeFantasia: null, inscricaoEstadual: null,
    inscricaoMunicipal: null, email: null, telefone: null, whatsapp: null, contatoNome: null, observacoes: null, enderecos: [],
  });

const CLIENTES = [cliente('c1', 'Padaria São João', '11444777000161'), cliente('c2', 'Maria Souza', '52998224725')];
const USUARIOS: UsuarioResumo[] = [
  { id: COMERCIAL.id, nome: COMERCIAL.nome, perfil: 'COMERCIAL' },
  { id: ADMIN.id, nome: ADMIN.nome, perfil: 'ADMIN' },
  { id: BETO, nome: 'Beto Vendas', perfil: 'COMERCIAL' },
  { id: 'u-tec', nome: 'Téo Técnico', perfil: 'TECNICO' },
];

/** Fora de ordem de propósito: a coluna ordena por atualizadoEm desc. */
const LISTA: PropostaLocal[] = [
  proposta('a', { numero: 277, status: 'ENVIADA', tipo: 'SERVICO', dataEmissao: '2026-09-10', atualizadoEm: '2026-09-28T10:00:00Z' }),
  proposta('b', { clienteId: 'c2', status: 'RASCUNHO', totalCentavos: 99, atualizadoEm: '2026-09-29T10:00:00Z' }),
  proposta('c', { numero: 12, status: 'APROVADA', tipo: 'LOCACAO', responsavelId: ADMIN.id, dataEmissao: '2026-09-25', atualizadoEm: '2026-09-27T10:00:00Z' }),
  proposta('d', { numero: 13, status: 'CANCELADA', motivoEncerramento: 'Desistiu' }),
  proposta('e', { numero: 14, status: 'RECUSADA', motivoEncerramento: 'Caro' }),
  proposta('g', { numero: 15, status: 'ENVIADA', totalCentavos: 50000, atualizadoEm: '2026-09-30T10:00:00Z' }),
  proposta('h', { numero: 16, status: 'EM_EXECUCAO', totalCentavos: 200000 }),
  proposta('i', { numero: 17, status: 'FINALIZADA' }),
  proposta('k', { numero: 18, status: 'ENVIADA', responsavelId: BETO, totalCentavos: 10000, atualizadoEm: '2026-09-26T10:00:00Z' }),
];

const VAZIO: EstadoSync = { naOutbox: new Set(), comPendencia: new Set(), comConflito: new Set() };

interface Opcoes {
  usuario?: UsuarioSessao;
  desktop?: boolean;
  todas?: Observable<PropostaLocal[]>;
  estado?: Observable<EstadoSync>;
  transicionar?: (id: string, para: StatusProposta, motivo?: string | null) => Promise<void>;
}

const originalMatchMedia = window.matchMedia;

function montar(o: Opcoes = {}) {
  const consultas: string[] = [];
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: o.desktop
      ? (q: string) => {
          consultas.push(q);
          return { matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined };
        }
      : undefined,
  });
  const repo = {
    observarTodas: vi.fn(() => o.todas ?? of(LISTA)),
    observarEstadoSync: () => o.estado ?? of(VAZIO),
    observarUsuarios: () => of(USUARIOS),
    transicionar: vi.fn(o.transicionar ?? (async () => undefined)),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { usuario: signal(o.usuario ?? ADMIN) } },
      { provide: PropostasRepo, useValue: repo },
      { provide: ClientesRepo, useValue: { observarTodos: () => of(CLIENTES) } },
    ],
  });
  const router = TestBed.inject(Router);
  const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const toasts = TestBed.inject(Toasts);
  const erro = vi.spyOn(toasts, 'erro');
  const fixture = TestBed.createComponent(KanbanPage);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, repo, navegar, erro, consultas };
}

type Fixture = ComponentFixture<KanbanPage>;

const coluna = (el: HTMLElement, s: StatusProposta) => el.querySelector<HTMLElement>(`[data-coluna="${s}"]`);
const titulosColunas = (el: HTMLElement) => [...el.querySelectorAll('[data-coluna] h2')].map((h) => h.textContent?.trim());
const codigos = (raiz: Element | null) => [...(raiz?.querySelectorAll('app-proposta-card .font-mono') ?? [])].map((c) => c.textContent!.trim());
const cartao = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-proposta="${id}"]`);
const gatilhoDe = (el: HTMLElement, id: string) => cartao(el, id)?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ?? null;
const botao = (el: HTMLElement, texto: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);

function abrirMenu(fixture: Fixture, el: HTMLElement, id: string): string[] {
  gatilhoDe(el, id)!.click();
  fixture.detectChanges();
  return [...cartao(el, id)!.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent!.trim());
}

function escolher(fixture: Fixture, el: HTMLElement, id: string, rotulo: string): void {
  abrirMenu(fixture, el, id);
  [...cartao(el, id)!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.trim() === rotulo)!.click();
  fixture.detectChanges();
}

function alterar(fixture: Fixture, el: HTMLElement, seletor: string, valor: string, evento = 'change'): void {
  const campo = el.querySelector<HTMLInputElement | HTMLSelectElement>(seletor)!;
  campo.value = valor;
  campo.dispatchEvent(new Event(evento));
  fixture.detectChanges();
}

describe('KanbanPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: originalMatchMedia });
  });

  it('enquanto o banco não respondeu, "Carregando…" (sem piscar colunas vazias)', () => {
    const { el } = montar({ desktop: true, todas: new Subject<PropostaLocal[]>() });
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Kanban');
    expect(el.textContent).toContain('Carregando…');
    expect(el.querySelector('[data-coluna]')).toBeNull();
  });

  describe('desktop (≥ 1024 px e ponteiro fino)', () => {
    it('consulta a largura e o ponteiro; colunas do fluxo lado a lado, sem as encerradas', () => {
      const { el, consultas } = montar({ desktop: true });
      expect(consultas).toContain('(min-width: 1024px) and (pointer: fine)');
      expect(titulosColunas(el)).toEqual(['Rascunho', 'Enviada', 'Aprovada', 'Em execução', 'Finalizada']);
      expect(el.querySelector('[role="tablist"]')).toBeNull();
    });

    it('cada coluna mostra a contagem e a soma dos totais; dentro dela, atualizadoEm desc', () => {
      const { el } = montar({ desktop: true });
      const enviada = coluna(el, 'ENVIADA')!;
      expect(codigos(enviada)).toEqual(['000015', '000277', '000018']);
      expect(enviada.querySelector('[data-quantidade]')?.textContent?.trim()).toBe('3');
      expect(enviada.querySelector('[data-total]')?.textContent?.trim()).toBe('R$ 2.100,00');
      expect(coluna(el, 'RASCUNHO')!.querySelector('[data-total]')?.textContent?.trim()).toBe('R$ 0,99');
      expect(codigos(coluna(el, 'RASCUNHO'))).toEqual(['PROV-B00000']);
      expect(coluna(el, 'FINALIZADA')!.querySelector('[data-quantidade]')?.textContent?.trim()).toBe('1');
    });

    it('"Nova proposta" leva a /propostas/nova', () => {
      const { el } = montar({ desktop: true });
      const link = [...el.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Nova proposta');
      expect(link?.getAttribute('href')).toBe('/propostas/nova');
    });

    it('fora de ADMIN e COMERCIAL (segunda trava além do guard): nenhum valor, nem nas colunas, e nada se move', () => {
      const { el, fixture } = montar({ desktop: true, usuario: { ...COMERCIAL, perfil: 'TECNICO' } });
      expect(el.textContent).not.toContain('R$');
      expect(el.querySelector('[data-total]')).toBeNull();
      expect(el.querySelector('button[aria-haspopup="menu"]')).toBeNull();
      expect(fixture.debugElement.queryAll(By.directive(CdkDrag)).every((d) => d.injector.get(CdkDrag).disabled)).toBe(true);
    });

    it('o card do kanban é o proposta-card: cliente, tipo, total e responsável', () => {
      const { el } = montar({ desktop: true });
      const c = cartao(el, 'a')!;
      expect(c.textContent).toContain('Padaria São João');
      expect(c.textContent).toContain('Serviço');
      expect(c.textContent).toContain('R$ 1.500,00');
      expect(c.textContent).toContain('Carla Comercial');
      expect(c.querySelector('a')?.getAttribute('href')).toBe('/propostas/a');
    });

    it('"Mostrar encerradas" acrescenta Recusada e Cancelada; desligar tira de novo', () => {
      const { el, fixture } = montar({ desktop: true });
      const toggle = botao(el, 'Mostrar encerradas')!;
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      toggle.click();
      fixture.detectChanges();
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      expect(titulosColunas(el)).toEqual(['Rascunho', 'Enviada', 'Aprovada', 'Em execução', 'Finalizada', 'Recusada', 'Cancelada']);
      expect(codigos(coluna(el, 'CANCELADA'))).toEqual(['000013']);
      expect(codigos(coluna(el, 'RECUSADA'))).toEqual(['000014']);
      toggle.click();
      fixture.detectChanges();
      expect(coluna(el, 'CANCELADA')).toBeNull();
    });

    describe('arrastar e soltar (CDK)', () => {
      const listas = (fixture: Fixture) =>
        new Map(fixture.debugElement.queryAll(By.directive(CdkDropList)).map((d) => {
          const l = d.injector.get(CdkDropList) as CdkDropList<StatusProposta>;
          return [l.data, l] as const;
        }));
      const arrastos = (fixture: Fixture) =>
        new Map(fixture.debugElement.queryAll(By.directive(CdkDrag)).map((d) => {
          const g = d.injector.get(CdkDrag) as CdkDrag<PropostaLocal>;
          return [g.data.id, g] as const;
        }));

      it('as colunas estão num cdkDropListGroup, sem reordenar dentro da coluna', () => {
        const { fixture } = montar({ desktop: true });
        const l = listas(fixture);
        expect([...l.keys()]).toEqual(['RASCUNHO', 'ENVIADA', 'APROVADA', 'EM_EXECUCAO', 'FINALIZADA']);
        expect([...l.values()].every((x) => x.sortingDisabled)).toBe(true);
        const grupo = fixture.debugElement.query(By.directive(CdkDropListGroup));
        expect(grupo).not.toBeNull();
        expect(fixture.debugElement.queryAll(By.directive(CdkDropList)).every((d) => grupo.nativeElement.contains(d.nativeElement))).toBe(true);
      });

      it('o predicado de entrada vem do podeSoltar (a própria coluna aceita a volta)', () => {
        const { fixture } = montar({ desktop: true });
        const l = listas(fixture);
        const a = arrastos(fixture).get('a')!;
        const aceita = (s: StatusProposta) => l.get(s)!.enterPredicate(a, l.get(s)!);
        expect(aceita('ENVIADA')).toBe(true);
        expect(aceita('RASCUNHO')).toBe(true);
        expect(aceita('APROVADA')).toBe(true);
        expect(aceita('EM_EXECUCAO')).toBe(false);
        expect(aceita('FINALIZADA')).toBe(false);
      });

      it('não arrasta o card sem destino permitido (encerrada, ou de outro responsável para o comercial)', () => {
        const { fixture } = montar({ desktop: true, usuario: COMERCIAL });
        const g = arrastos(fixture);
        expect(g.get('i')!.disabled).toBe(true);
        expect(g.get('k')!.disabled).toBe(true);
        expect(g.get('c')!.disabled).toBe(true);
        expect(g.get('a')!.disabled).toBe(false);
        expect(g.get('h')!.disabled).toBe(false);
      });

      it('durante o arrasto, as colunas proibidas ficam esmaecidas', () => {
        const { fixture, el } = montar({ desktop: true });
        const a = arrastos(fixture).get('a')!;
        a.started.emit({ source: a } as never);
        fixture.detectChanges();
        const proibidas = [...el.querySelectorAll('[data-coluna][data-proibida]')].map((c) => c.getAttribute('data-coluna'));
        expect(proibidas).toEqual(['EM_EXECUCAO', 'FINALIZADA']);
        a.ended.emit({ source: a } as never);
        fixture.detectChanges();
        expect(el.querySelectorAll('[data-proibida]').length).toBe(0);
      });

      it('soltar numa coluna permitida transiciona; na mesma coluna ou numa proibida, nada muda', async () => {
        const { fixture, repo, el } = montar({ desktop: true });
        const l = listas(fixture);
        const soltar = (id: string, de: StatusProposta, para: StatusProposta) => {
          l.get(para)!.dropped.emit({
            previousContainer: l.get(de)!, container: l.get(para)!, item: arrastos(fixture).get(id)!, previousIndex: 0, currentIndex: 0,
            isPointerOverContainer: true, distance: { x: 0, y: 0 }, dropPoint: { x: 0, y: 0 }, event: new MouseEvent('mouseup'),
          } as never);
          fixture.detectChanges();
        };
        soltar('a', 'ENVIADA', 'ENVIADA');
        soltar('a', 'ENVIADA', 'FINALIZADA');
        soltar('i', 'FINALIZADA', 'RASCUNHO');
        expect(repo.transicionar).not.toHaveBeenCalled();
        expect(codigos(coluna(el, 'ENVIADA'))).toEqual(['000015', '000277', '000018']);
        soltar('a', 'ENVIADA', 'APROVADA');
        await fixture.whenStable();
        expect(repo.transicionar).toHaveBeenCalledExactlyOnceWith('a', 'APROVADA');
      });

      it('soltar RASCUNHO em Enviada abre o wizard no passo de envio (o card não se move)', () => {
        const { fixture, repo, navegar } = montar({ desktop: true });
        const l = listas(fixture);
        l.get('ENVIADA')!.dropped.emit({ previousContainer: l.get('RASCUNHO')!, container: l.get('ENVIADA')!, item: arrastos(fixture).get('b')! } as never);
        expect(navegar).toHaveBeenCalledWith(['/propostas', 'b', 'editar'], { queryParams: { passo: 4 } });
        expect(repo.transicionar).not.toHaveBeenCalled();
      });

      it('soltar em Recusada pede o motivo; cancelar o diálogo não move', async () => {
        const { fixture, repo, el } = montar({ desktop: true, usuario: ADMIN });
        botao(el, 'Mostrar encerradas')!.click();
        fixture.detectChanges();
        const l = listas(fixture);
        l.get('RECUSADA')!.dropped.emit({ previousContainer: l.get('ENVIADA')!, container: l.get('RECUSADA')!, item: arrastos(fixture).get('a')! } as never);
        fixture.detectChanges();
        expect(el.querySelector('[role="dialog"] h2')?.textContent?.trim()).toBe('Recusar proposta');
        botao(el, 'Cancelar')!.click();
        fixture.detectChanges();
        expect(el.querySelector('[role="dialog"]')).toBeNull();
        expect(repo.transicionar).not.toHaveBeenCalled();
        expect(codigos(coluna(el, 'ENVIADA'))).toContain('000277');
      });
    });
  });

  describe('"Mover para…"', () => {
    it('lista só os destinos permitidos ao perfil e à posse', () => {
      const admin = montar({ desktop: true });
      expect(abrirMenu(admin.fixture, admin.el, 'h')).toEqual(['Finalizada', 'Cancelada']);
      expect(abrirMenu(admin.fixture, admin.el, 'a')).toEqual(['Rascunho', 'Aprovada', 'Recusada', 'Cancelada']);
      expect(abrirMenu(admin.fixture, admin.el, 'k')).toEqual(['Rascunho', 'Aprovada', 'Recusada', 'Cancelada']);
      expect(gatilhoDe(admin.el, 'i')).toBeNull();

      TestBed.resetTestingModule();
      const com = montar({ desktop: true, usuario: COMERCIAL });
      // Review Focus #2: EM_EXECUCAO→CANCELADA não aparece para o comercial
      expect(abrirMenu(com.fixture, com.el, 'h')).toEqual(['Finalizada']);
      expect(abrirMenu(com.fixture, com.el, 'b')).toEqual(['Enviada', 'Cancelada']);
      expect(gatilhoDe(com.el, 'k')).toBeNull();
      expect(gatilhoDe(com.el, 'c')).toBeNull();
    });

    it('mover transiciona: o card vai para a nova coluna na hora, com "Não sincronizada", e o aria-live anuncia', async () => {
      const todas = new BehaviorSubject<PropostaLocal[]>(LISTA);
      const estado = new BehaviorSubject<EstadoSync>(VAZIO);
      const { fixture, el, repo } = montar({
        desktop: true,
        todas,
        estado,
        transicionar: async (id, para) => {
          // o repositório é otimista: grava no Dexie e a outbox ganha a mutação
          todas.next(LISTA.map((p) => (p.id === id ? { ...p, status: para, atualizadoEm: AGORA.toISOString() } : p)));
          estado.next({ ...VAZIO, naOutbox: new Set([id]) });
        },
      });
      escolher(fixture, el, 'a', 'Aprovada');
      await fixture.whenStable();
      fixture.detectChanges();
      expect(repo.transicionar).toHaveBeenCalledExactlyOnceWith('a', 'APROVADA');
      expect(codigos(coluna(el, 'APROVADA'))).toEqual(['000277', '000012']);
      expect(codigos(coluna(el, 'ENVIADA'))).toEqual(['000015', '000018']);
      expect([...cartao(el, 'a')!.querySelectorAll('[data-selo]')].map((s) => s.textContent?.trim())).toEqual(['Não sincronizada']);
      const anuncio = el.querySelector('[aria-live="polite"][data-anuncio]')!;
      expect(anuncio.textContent?.trim()).toBe('Proposta 000277 movida para Aprovada.');
      // o foco segue o card até a nova coluna
      await vi.waitFor(() => expect(document.activeElement).toBe(gatilhoDe(el, 'a')));
      expect(coluna(el, 'APROVADA')!.contains(document.activeElement)).toBe(true);
    });

    it('Recusada e Cancelada pedem o motivo; cancelar não move; confirmar transiciona com o motivo', async () => {
      const { fixture, el, repo } = montar({ desktop: true });
      escolher(fixture, el, 'a', 'Recusada');
      const dialogo = () => el.querySelector('[role="dialog"]');
      expect(dialogo()?.querySelector('h2')?.textContent?.trim()).toBe('Recusar proposta');
      botao(el, 'Cancelar')!.click();
      fixture.detectChanges();
      expect(dialogo()).toBeNull();
      expect(repo.transicionar).not.toHaveBeenCalled();

      escolher(fixture, el, 'h', 'Cancelada');
      expect(dialogo()?.querySelector('h2')?.textContent?.trim()).toBe('Cancelar proposta');
      botao(el, 'Voltar')!.click();
      fixture.detectChanges();
      expect(repo.transicionar).not.toHaveBeenCalled();

      escolher(fixture, el, 'a', 'Recusada');
      botao(el, 'Recusar')!.click();
      fixture.detectChanges();
      expect(repo.transicionar).not.toHaveBeenCalled();
      expect(dialogo()?.textContent).toContain('Informe o motivo');
      const campo = dialogo()!.querySelector('textarea')!;
      campo.value = '  Cliente achou caro ';
      campo.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      botao(el, 'Recusar')!.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(repo.transicionar).toHaveBeenCalledExactlyOnceWith('a', 'RECUSADA', 'Cliente achou caro');
      expect(dialogo()).toBeNull();
      expect(el.querySelector('[data-anuncio]')?.textContent?.trim()).toBe('Proposta 000277 movida para Recusada.');
    });

    it('RASCUNHO → Enviada abre o wizard no passo de envio, sem transicionar', () => {
      const { fixture, el, repo, navegar } = montar({ usuario: COMERCIAL });
      escolher(fixture, el, 'b', 'Enviada');
      expect(navegar).toHaveBeenCalledWith(['/propostas', 'b', 'editar'], { queryParams: { passo: 4 } });
      expect(repo.transicionar).not.toHaveBeenCalled();
    });

    it('erro do repositório vira toast e o card fica onde estava', async () => {
      const { fixture, el, erro } = montar({
        desktop: true,
        transicionar: async () => {
          throw new ErroCampo('proposta', 'Você só altera as propostas em que é o responsável.');
        },
      });
      escolher(fixture, el, 'a', 'Aprovada');
      await fixture.whenStable();
      fixture.detectChanges();
      expect(erro).toHaveBeenCalledWith('Você só altera as propostas em que é o responsável.');
      expect(codigos(coluna(el, 'ENVIADA'))).toContain('000277');
      expect(el.querySelector('[data-anuncio]')?.textContent?.trim()).toBe('');
    });

    it('com CONFLITO: sem arrastar e "Mover para…" desabilitado, com "Resolva a pendência primeiro"', () => {
      const { fixture, el } = montar({ desktop: true, estado: of({ ...VAZIO, comPendencia: new Set(['a']), comConflito: new Set(['a']) }) });
      const g = gatilhoDe(el, 'a')!;
      expect(g.disabled).toBe(true);
      expect(cartao(el, 'a')!.textContent).toContain('Resolva a pendência primeiro.');
      const drag = fixture.debugElement.queryAll(By.directive(CdkDrag)).map((d) => d.injector.get(CdkDrag) as CdkDrag<PropostaLocal>);
      expect(drag.find((d) => d.data.id === 'a')!.disabled).toBe(true);
      // rejeição (sem conflito) não trava
      expect(gatilhoDe(el, 'g')!.disabled).toBe(false);
    });
  });

  describe('filtros', () => {
    const todosCodigos = (el: HTMLElement) => codigos(el).sort();

    it('tipo', () => {
      const { fixture, el } = montar({ desktop: true });
      alterar(fixture, el, '#tipo-kanban', 'SERVICO');
      expect(todosCodigos(el)).toEqual(['000277']);
      alterar(fixture, el, '#tipo-kanban', 'TODOS');
      expect(todosCodigos(el).length).toBe(7);
    });

    it('período de emissão (de/até, inclusive)', () => {
      const { fixture, el } = montar({ desktop: true });
      alterar(fixture, el, '#emissao-de', '2026-09-15', 'input');
      expect(todosCodigos(el)).not.toContain('000277');
      expect(todosCodigos(el)).toContain('000012');
      alterar(fixture, el, '#emissao-ate', '2026-09-24', 'input');
      expect(todosCodigos(el)).not.toContain('000012');
      expect(todosCodigos(el)).toContain('PROV-B00000');
      alterar(fixture, el, '#emissao-de', '', 'input');
      alterar(fixture, el, '#emissao-ate', '', 'input');
      expect(todosCodigos(el).length).toBe(7);
    });

    it('busca (número, PROV, cliente)', () => {
      const { fixture, el } = montar({ desktop: true });
      alterar(fixture, el, '#busca-kanban', '277', 'input');
      expect(todosCodigos(el)).toEqual(['000277']);
      alterar(fixture, el, '#busca-kanban', 'maria', 'input');
      expect(todosCodigos(el)).toEqual(['PROV-B00000']);
      expect(coluna(el, 'ENVIADA')!.querySelector('[data-quantidade]')?.textContent?.trim()).toBe('0');
    });

    it('responsável (só o admin), com os usuários ADMIN e COMERCIAL', () => {
      const { fixture, el } = montar({ desktop: true });
      const opcoes = [...el.querySelectorAll<HTMLOptionElement>('#responsavel-kanban option')].map((o) => o.textContent?.trim());
      expect(opcoes).toEqual(['Todos os responsáveis', 'Ana Admin', 'Beto Vendas', 'Carla Comercial']);
      alterar(fixture, el, '#responsavel-kanban', ADMIN.id);
      expect(todosCodigos(el)).toEqual(['000012']);
      alterar(fixture, el, '#responsavel-kanban', BETO);
      expect(todosCodigos(el)).toEqual(['000018']);
    });

    it('o comercial não vê o filtro de responsável', () => {
      const { el } = montar({ desktop: true, usuario: COMERCIAL });
      expect(el.querySelector('#responsavel-kanban')).toBeNull();
      expect(el.querySelector('#tipo-kanban')).not.toBeNull();
    });
  });

  describe('celular', () => {
    const abas = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const painel = (el: HTMLElement) => el.querySelector<HTMLElement>('[role="tabpanel"]')!;

    it('uma coluna por vez, com abas (tablist/tab/tabpanel), a contagem em cada aba e sem arrastar', () => {
      const { el, fixture } = montar();
      expect(el.querySelector('[role="tablist"]')).not.toBeNull();
      expect(abas(el).map((a) => a.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
        'Rascunho 1', 'Enviada 3', 'Aprovada 1', 'Em execução 1', 'Finalizada 1',
      ]);
      expect(abas(el).map((a) => a.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
      expect(abas(el).map((a) => a.tabIndex)).toEqual([0, -1, -1, -1, -1]);
      expect(painel(el).getAttribute('aria-labelledby')).toBe(abas(el)[0].id);
      expect(abas(el)[0].getAttribute('aria-controls')).toBe(painel(el).id);
      expect(codigos(painel(el))).toEqual(['PROV-B00000']);
      expect(fixture.debugElement.queryAll(By.directive(CdkDrag)).length).toBe(0);
      expect(el.querySelectorAll('[data-coluna]').length).toBe(1);
    });

    it('tocar numa aba mostra a coluna dela, com o total; setas, Home e End trocam de aba', () => {
      const { el, fixture } = montar();
      abas(el)[1].click();
      fixture.detectChanges();
      expect(abas(el)[1].getAttribute('aria-selected')).toBe('true');
      expect(codigos(painel(el))).toEqual(['000015', '000277', '000018']);
      expect(painel(el).querySelector('[data-total]')?.textContent?.trim()).toBe('R$ 2.100,00');
      const tecla = (key: string) => {
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        fixture.detectChanges();
      };
      abas(el)[1].focus();
      tecla('ArrowRight');
      expect(abas(el)[2].getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(abas(el)[2]);
      tecla('ArrowLeft');
      tecla('ArrowLeft');
      tecla('ArrowLeft');
      expect(document.activeElement).toBe(abas(el)[4]);
      tecla('Home');
      expect(document.activeElement).toBe(abas(el)[0]);
      tecla('End');
      expect(abas(el)[4].getAttribute('aria-selected')).toBe('true');
    });

    it('com a aba de uma encerrada aberta, desligar as encerradas volta para a primeira', () => {
      const { el, fixture } = montar();
      botao(el, 'Mostrar encerradas')!.click();
      fixture.detectChanges();
      expect(abas(el).length).toBe(7);
      abas(el)[6].click();
      fixture.detectChanges();
      expect(codigos(painel(el))).toEqual(['000013']);
      botao(el, 'Mostrar encerradas')!.click();
      fixture.detectChanges();
      expect(abas(el)[0].getAttribute('aria-selected')).toBe('true');
      expect(codigos(painel(el))).toEqual(['PROV-B00000']);
      // religar não volta sozinho para a encerrada
      botao(el, 'Mostrar encerradas')!.click();
      fixture.detectChanges();
      expect(abas(el)[0].getAttribute('aria-selected')).toBe('true');
    });

    it('"Mover para…" em cada card; o card sai da aba e o foco vai ao painel', async () => {
      const todas = new BehaviorSubject<PropostaLocal[]>(LISTA);
      const { el, fixture, repo } = montar({
        todas,
        transicionar: async (id, para) => todas.next(LISTA.map((p) => (p.id === id ? { ...p, status: para } : p))),
      });
      abas(el)[1].click();
      fixture.detectChanges();
      expect(abrirMenu(fixture, el, 'a')).toEqual(['Rascunho', 'Aprovada', 'Recusada', 'Cancelada']);
      [...cartao(el, 'a')!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')][1].click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(repo.transicionar).toHaveBeenCalledWith('a', 'APROVADA');
      expect(codigos(painel(el))).toEqual(['000015', '000018']);
      expect(abas(el)[2].textContent).toContain('2');
      expect(el.querySelector('[data-anuncio]')?.textContent?.trim()).toBe('Proposta 000277 movida para Aprovada.');
      await vi.waitFor(() => expect(document.activeElement).toBe(painel(el)));
    });
  });
});
