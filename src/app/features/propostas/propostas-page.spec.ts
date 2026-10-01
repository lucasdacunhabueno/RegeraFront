import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, Subject } from 'rxjs';
import { vi } from 'vitest';
import type { UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import type { UsuarioResumo } from '../../core/sync/sync-models';
import { ClienteLocal, paraClienteLocal } from '../clientes/cliente-models';
import { ClientesRepo } from '../clientes/clientes-repo';
import { PropostaLocal } from './proposta-models';
import { EstadoSync, PropostasRepo } from './propostas-repo';

import { PropostasPage } from './propostas-page';

const ADMIN: UsuarioSessao = { id: 'u-adm', nome: 'Ana Admin', email: 'ana@regera.com', perfil: 'ADMIN', ativo: true };
const COMERCIAL: UsuarioSessao = { id: 'u-com', nome: 'Carla Comercial', email: 'carla@regera.com', perfil: 'COMERCIAL', ativo: true };
const TECNICO: UsuarioSessao = { id: 'u-tec', nome: 'Téo Técnico', email: 'teo@regera.com', perfil: 'TECNICO', ativo: true };

/** 2026-10-02 01:30 UTC ainda é 2026-10-01 em São Paulo: a validade 2026-10-01 não venceu, a de 09-30 sim. */
const AGORA = new Date('2026-10-02T01:30:00Z');

function proposta(id: string, p: Partial<PropostaLocal> = {}): PropostaLocal {
  return {
    id, version: 1, codigoProvisorio: `PROV-${id.toUpperCase().padEnd(6, '0')}`, numero: null, revisao: null, tipo: 'VENDA',
    status: 'RASCUNHO', clienteId: 'c1', templateId: null, responsavelId: COMERCIAL.id, tecnicoId: TECNICO.id,
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
];

/** Já na ordem do repositório (atualizadoEm desc). */
const LISTA: PropostaLocal[] = [
  proposta('a', { numero: 277, revisao: 2, status: 'ENVIADA', validadeAte: '2026-09-30', tipo: 'SERVICO', atualizadoEm: '2026-09-30T10:00:00Z' }),
  proposta('b', { clienteId: 'c2', status: 'RASCUNHO', tipo: 'VENDA', totalCentavos: 99, atualizadoEm: '2026-09-29T10:00:00Z' }),
  proposta('c', { numero: 12, status: 'APROVADA', tipo: 'LOCACAO', responsavelId: ADMIN.id, atualizadoEm: '2026-09-28T10:00:00Z' }),
  proposta('d', { numero: 13, status: 'CANCELADA', motivoEncerramento: 'Desistiu', atualizadoEm: '2026-09-27T10:00:00Z' }),
  proposta('e', { numero: 14, status: 'RECUSADA', motivoEncerramento: 'Caro', clienteId: 'c2', atualizadoEm: '2026-09-26T10:00:00Z' }),
  proposta('f', { status: 'ENVIADA', validadeAte: '2026-10-01', clienteId: null, atualizadoEm: '2026-09-25T10:00:00Z' }),
];

interface Opcoes {
  usuario?: UsuarioSessao;
  usuarioSinal?: WritableSignal<UsuarioSessao | null>;
  todas?: Observable<PropostaLocal[]>;
  doTecnico?: Observable<PropostaLocal[]>;
  estado?: EstadoSync;
}

function montar(o: Opcoes = {}) {
  const repo = {
    observarTodas: vi.fn(() => o.todas ?? of(LISTA)),
    observarDoTecnico: vi.fn((usuarioId: string) => (usuarioId ? (o.doTecnico ?? of(LISTA)) : of([]))),
    observarEstadoSync: () => of(o.estado ?? { naOutbox: new Set(['b']), comPendencia: new Set(['c']), comConflito: new Set<string>() }),
    observarUsuarios: () => of(USUARIOS),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { usuario: o.usuarioSinal ?? signal(o.usuario ?? ADMIN) } },
      { provide: PropostasRepo, useValue: repo },
      { provide: ClientesRepo, useValue: { observarTodos: () => of(CLIENTES) } },
    ],
  });
  const fixture = TestBed.createComponent(PropostasPage);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, repo };
}

const codigos = (el: HTMLElement) => [...el.querySelectorAll('li app-proposta-card')].map((c) => c.querySelector('.font-mono')!.textContent!.trim());
const card = (el: HTMLElement, codigo: string) =>
  [...el.querySelectorAll('li app-proposta-card')].find((c) => c.querySelector('.font-mono')!.textContent!.trim() === codigo)!;
const botao = (el: HTMLElement, texto: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);

async function ate(fixture: ReturnType<typeof montar>['fixture'], verificar: () => void) {
  await vi.waitFor(() => {
    fixture.detectChanges();
    verificar();
  });
}

describe('PropostasPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ADMIN e COMERCIAL', () => {
    it('lista todas na ordem do repositório (atualizadoEm desc), sem as encerradas', () => {
      const { el, repo } = montar();
      expect(el.querySelector('h1')?.textContent?.trim()).toBe('Propostas');
      expect(repo.observarTodas).toHaveBeenCalled();
      expect(repo.observarDoTecnico).not.toHaveBeenCalled();
      expect(codigos(el)).toEqual(['000277-R2', 'PROV-B00000', '000012', 'PROV-F00000']);
    });

    it('card com cliente, tipo, total e o nome do responsável vindo de usuarios', () => {
      const { el } = montar();
      const c = card(el, '000012');
      expect(c.textContent).toContain('Padaria São João');
      expect(c.textContent).toContain('Locação');
      expect(c.textContent).toContain('R$ 1.500,00');
      expect(c.textContent).toContain('Ana Admin');
      expect(card(el, 'PROV-B00000').textContent).toContain('Maria Souza');
      expect(card(el, 'PROV-F00000').textContent).toContain('Sem cliente');
      expect(c.querySelector('a')?.getAttribute('href')).toBe('/propostas/c');
    });

    it('selos: Expirada (validade antes de hoje em São Paulo), Não sincronizada (outbox) e Pendência', () => {
      const { el } = montar();
      const selos = (codigo: string) => [...card(el, codigo).querySelectorAll('[data-selo]')].map((s) => s.textContent?.trim());
      expect(selos('000277-R2')).toEqual(['Expirada']);
      expect(selos('PROV-F00000')).toEqual([]);
      expect(selos('PROV-B00000')).toEqual(['Não sincronizada']);
      expect(selos('000012')).toEqual(['Pendência']);
    });

    it('"Nova proposta" leva a /propostas/nova', () => {
      for (const usuario of [ADMIN, COMERCIAL]) {
        TestBed.resetTestingModule();
        const { el } = montar({ usuario });
        const link = [...el.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Nova proposta');
        expect(link?.getAttribute('href')).toBe('/propostas/nova');
      }
    });

    it('o comercial vê só as dele: a página mostra o que o repositório devolve, sem filtrar por conta própria', () => {
      const minhas = [proposta('m', { numero: 50, responsavelId: COMERCIAL.id })];
      const { el, repo } = montar({ usuario: COMERCIAL, todas: of(minhas) });
      expect(repo.observarTodas).toHaveBeenCalled();
      expect(codigos(el)).toEqual(['000050']);
      expect(el.textContent).toContain('R$ 1.500,00');
    });

    it('busca por número, PROV, nome e documento do cliente', async () => {
      const { fixture, el } = montar();
      const busca = el.querySelector<HTMLInputElement>('input[type=search]')!;
      const buscar = async (texto: string, esperado: string[]) => {
        busca.value = texto;
        busca.dispatchEvent(new Event('input'));
        await ate(fixture, () => expect(codigos(el)).toEqual(esperado));
      };
      await buscar('277', ['000277-R2']);
      await buscar('prov-b', ['PROV-B00000']);
      await buscar('maria', ['PROV-B00000']);
      await buscar('11.444.777/0001', ['000277-R2', '000012']);
      await buscar('sao joao', ['000277-R2', '000012']);
      await buscar('nada disso', []);
      expect(el.textContent).toContain('Nenhuma proposta encontrada.');
      await buscar('', ['000277-R2', 'PROV-B00000', '000012', 'PROV-F00000']);
    });

    it('chips de status com aria-pressed; RECUSADA e CANCELADA só com "Mostrar encerradas"', async () => {
      const { fixture, el } = montar();
      const chips = () => [...el.querySelectorAll('[role=group][aria-label="Filtrar por status"] button')].map((b) => b.textContent?.trim());
      expect(chips()).toEqual(['Todas', 'Rascunho', 'Enviada', 'Aprovada', 'Em execução', 'Finalizada']);
      expect(botao(el, 'Todas')?.getAttribute('aria-pressed')).toBe('true');

      botao(el, 'Enviada')!.click();
      await ate(fixture, () => expect(codigos(el)).toEqual(['000277-R2', 'PROV-F00000']));
      expect(botao(el, 'Enviada')?.getAttribute('aria-pressed')).toBe('true');
      expect(botao(el, 'Todas')?.getAttribute('aria-pressed')).toBe('false');

      const encerradas = botao(el, 'Mostrar encerradas')!;
      expect(encerradas.getAttribute('aria-pressed')).toBe('false');
      encerradas.click();
      await ate(fixture, () => expect(chips()).toContain('Recusada'));
      expect(chips()).toContain('Cancelada');
      expect(encerradas.getAttribute('aria-pressed')).toBe('true');

      botao(el, 'Todas')!.click();
      await ate(fixture, () => expect(codigos(el)).toEqual(['000277-R2', 'PROV-B00000', '000012', '000013', '000014', 'PROV-F00000']));

      botao(el, 'Cancelada')!.click();
      await ate(fixture, () => expect(codigos(el)).toEqual(['000013']));

      // esconder as encerradas com uma delas escolhida volta para Todas
      encerradas.click();
      await ate(fixture, () => expect(codigos(el)).toEqual(['000277-R2', 'PROV-B00000', '000012', 'PROV-F00000']));
      expect(botao(el, 'Todas')?.getAttribute('aria-pressed')).toBe('true');
      expect(chips()).not.toContain('Cancelada');
    });

    it('filtro de tipo', async () => {
      const { fixture, el } = montar();
      const tipo = el.querySelector<HTMLSelectElement>('select#tipo-propostas')!;
      expect(el.querySelector('label[for=tipo-propostas]')?.textContent).toContain('Tipo');
      tipo.value = 'LOCACAO';
      tipo.dispatchEvent(new Event('change'));
      await ate(fixture, () => expect(codigos(el)).toEqual(['000012']));
      tipo.value = 'TODOS';
      tipo.dispatchEvent(new Event('change'));
      await ate(fixture, () => expect(codigos(el)).toHaveLength(4));
    });

    it('a busca tem rótulo e h-12; a contagem é anunciada', async () => {
      const { fixture, el } = montar();
      const busca = el.querySelector<HTMLInputElement>('input[type=search]')!;
      expect(busca.id).toBeTruthy();
      expect(el.querySelector(`label[for=${busca.id}]`)?.textContent?.trim()).toBeTruthy();
      expect(busca.className).toContain('h-12');
      const contagem = el.querySelector('[aria-live=polite]')!;
      expect(contagem.textContent?.trim()).toBe('4 propostas');
      busca.value = '277';
      busca.dispatchEvent(new Event('input'));
      await ate(fixture, () => expect(contagem.textContent?.trim()).toBe('1 proposta'));
    });

    it('no desktop (lg) a busca e o tipo ficam na mesma linha; no celular, empilhados', () => {
      const { el } = montar();
      const busca = el.querySelector<HTMLInputElement>('input[type=search]')!;
      const tipo = el.querySelector<HTMLSelectElement>('select#tipo-propostas')!;
      const linha = busca.closest<HTMLElement>('[data-filtros]')!;
      expect(linha.contains(tipo)).toBe(true);
      expect(linha.className).toContain('flex-col');
      expect(linha.className).toContain('lg:flex-row');
      expect(busca.className).toContain('lg:flex-1');
      expect(tipo.className).toContain('lg:w-56');
      expect(el.querySelector('label[for=tipo-propostas]')?.textContent).toContain('Tipo');
    });

    it('sem nenhuma encerrada visível: dica para mostrar as encerradas', async () => {
      const { fixture, el } = montar({ todas: of([LISTA[3]]) });
      expect(codigos(el)).toEqual([]);
      expect(el.textContent).toContain('Nenhuma proposta encontrada.');
      expect(el.textContent).toContain('As recusadas e canceladas estão ocultas.');
      botao(el, 'Mostrar encerradas')!.click();
      await ate(fixture, () => expect(codigos(el)).toEqual(['000013']));
    });

    it('vazio do comercial', () => {
      const { el } = montar({ usuario: COMERCIAL, todas: of([]) });
      expect(el.textContent).toContain('Nenhuma proposta ainda. Crie a primeira em Nova proposta.');
    });

    it('"Carregando…" antes da primeira emissão', async () => {
      const todas = new Subject<PropostaLocal[]>();
      const { fixture, el } = montar({ todas });
      expect(el.textContent).toContain('Carregando…');
      expect(el.textContent).not.toContain('Nenhuma proposta');
      todas.next(LISTA);
      await ate(fixture, () => expect(codigos(el)).toHaveLength(4));
      expect(el.textContent).not.toContain('Carregando…');
    });
  });

  describe('hoje (selo Expirada)', () => {
    /** 23:59 de 2026-10-01 em São Paulo: a validade 2026-10-01 da 'f' ainda vale. */
    const QUASE_MEIA_NOITE = new Date('2026-10-02T02:59:00Z');
    const selosDeF = (el: HTMLElement) => [...card(el, 'PROV-F00000').querySelectorAll('[data-selo]')].map((s) => s.textContent?.trim());

    beforeEach(() => {
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(QUASE_MEIA_NOITE);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('vira à meia-noite de São Paulo com a tela aberta', () => {
      const { fixture, el } = montar();
      expect(selosDeF(el)).toEqual([]);
      vi.advanceTimersByTime(59_000);
      fixture.detectChanges();
      expect(selosDeF(el)).toEqual([]);
      vi.advanceTimersByTime(2_000);
      fixture.detectChanges();
      expect(selosDeF(el)).toEqual(['Expirada']);
    });

    it('confere de novo quando a aba volta a ficar visível', () => {
      const visibilidade = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      const { fixture, el } = montar();
      vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();
      expect(selosDeF(el)).toEqual([]);
      visibilidade.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();
      expect(selosDeF(el)).toEqual(['Expirada']);
    });

    it('ao sair da tela, o timer e o listener são desfeitos', () => {
      const remover = vi.spyOn(document, 'removeEventListener');
      const { fixture } = montar();
      expect(vi.getTimerCount()).toBe(1);
      fixture.destroy();
      expect(vi.getTimerCount()).toBe(0);
      expect(remover).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });
  });

  describe('restrito acompanha usuario()', () => {
    const titulo = (el: HTMLElement) => el.querySelector('h1')?.textContent?.trim();

    it('a troca de perfil muda a visão e a fonte dos dados', async () => {
      const usuario = signal<UsuarioSessao | null>(ADMIN);
      const { fixture, el, repo } = montar({ usuarioSinal: usuario });
      expect(titulo(el)).toBe('Propostas');
      expect(el.textContent).toMatch(/R\$/);
      usuario.set(TECNICO);
      await ate(fixture, () => expect(titulo(el)).toBe('Minhas propostas'));
      expect(repo.observarDoTecnico).toHaveBeenCalledWith(TECNICO.id);
      expect(el.textContent).not.toMatch(/R\$/);
      expect(el.querySelector('a[href="/propostas/nova"]')).toBeNull();
    });

    it('sem sessão: a visão restrita, sem valores', () => {
      const { el, repo } = montar({ usuarioSinal: signal<UsuarioSessao | null>(null) });
      expect(titulo(el)).toBe('Minhas propostas');
      expect(repo.observarTodas).not.toHaveBeenCalled();
      expect(el.textContent).not.toMatch(/R\$/);
    });
  });

  describe('TECNICO', () => {
    it('"Minhas propostas", só as atribuídas a ele, sem nenhum valor e sem botão de criar', () => {
      const { el, repo } = montar({ usuario: TECNICO });
      expect(el.querySelector('h1')?.textContent?.trim()).toBe('Minhas propostas');
      expect(repo.observarDoTecnico).toHaveBeenCalledWith(TECNICO.id);
      expect(repo.observarTodas).not.toHaveBeenCalled();
      expect(codigos(el)).toHaveLength(4);
      expect(el.textContent).not.toMatch(/R\$/);
      expect(el.textContent).not.toContain('Nova proposta');
      expect(el.querySelector('a[href="/propostas/nova"]')).toBeNull();
    });

    it('nem com as encerradas à mostra aparece valor', async () => {
      const { fixture, el } = montar({ usuario: TECNICO });
      botao(el, 'Mostrar encerradas')!.click();
      await ate(fixture, () => expect(codigos(el)).toHaveLength(6));
      expect(el.textContent).not.toMatch(/R\$/);
    });

    it('vazio do técnico', () => {
      const { el } = montar({ usuario: TECNICO, doTecnico: of([]) });
      expect(el.textContent).toContain('Nenhuma proposta atribuída a você.');
      expect(el.textContent).not.toContain('Nova proposta');
    });
  });
});
