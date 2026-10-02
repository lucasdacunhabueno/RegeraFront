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
import { PropostasRepo } from '../propostas/propostas-repo';
import { OsDados, OsLocal, paraOsLocal } from './os-models';
import { EstadoSync, OsRepo } from './os-repo';

import { OsListaPage } from './os-lista-page';

const ADMIN: UsuarioSessao = { id: 'u-adm', nome: 'Ana Admin', email: 'ana@regera.com', perfil: 'ADMIN', ativo: true };
const COMERCIAL: UsuarioSessao = { id: 'u-com', nome: 'Carla Comercial', email: 'carla@regera.com', perfil: 'COMERCIAL', ativo: true };
const TECNICO: UsuarioSessao = { id: 'u-tec', nome: 'Téo Técnico', email: 'teo@regera.com', perfil: 'TECNICO', ativo: true };
const TECNICO_2: UsuarioSessao = { id: 'u-tec2', nome: 'Rui Reparo', email: 'rui@regera.com', perfil: 'TECNICO', ativo: true };

/** 2026-10-02 01:30 UTC ainda é 2026-10-01 em São Paulo. */
const AGORA = new Date('2026-10-02T01:30:00Z');

/** UUIDv7 com o instante 2026-09-28T12:00:00Z: todas criadas em 09-28 (prazo da urgente 10-05, da normal 10-18). */
const id = (sufixo: string) => {
  const h = Date.parse('2026-09-28T12:00:00Z').toString(16).padStart(12, '0');
  return `${h.slice(0, 8)}-${h.slice(8)}-7000-8000-${sufixo.padStart(12, '0')}`;
};

function os(sufixo: string, extra: Partial<OsDados> = {}): OsLocal {
  return paraOsLocal(id(sufixo), 1, {
    codigoProvisorio: `OSP-${sufixo.toUpperCase().padEnd(6, sufixo.toUpperCase())}`, numero: null, revisao: 1, clienteId: 'c1',
    tipo: 'INSTALACAO', status: 'ABERTA', responsavelId: COMERCIAL.id, tecnicoId: TECNICO.id, dataPrevista: null,
    urgente: false, concluiProposta: true, assinaturaRecusada: false, enderecoBairro: 'Centro', enderecoCidade: 'Campinas',
    enderecoLogradouro: 'Rua das Flores', enderecoNumero: '10', itens: [], notas: [], anexos: [], historico: [], ...extra,
  });
}

const cliente = (cid: string, nome: string, documento: string): ClienteLocal =>
  paraClienteLocal(cid, 1, {
    tipo: documento.length === 14 ? 'PJ' : 'PF', documento, nome, nomeFantasia: null, inscricaoEstadual: null,
    inscricaoMunicipal: null, email: null, telefone: null, whatsapp: null, contatoNome: null, observacoes: null, enderecos: [],
  });

const CLIENTES = [cliente('c1', 'Padaria São João', '11444777000161'), cliente('c2', 'Maria Souza', '52998224725')];
const USUARIOS: UsuarioResumo[] = [
  { id: COMERCIAL.id, nome: COMERCIAL.nome, perfil: 'COMERCIAL' },
  { id: ADMIN.id, nome: ADMIN.nome, perfil: 'ADMIN' },
  { id: TECNICO_2.id, nome: TECNICO_2.nome, perfil: 'TECNICO' },
  { id: TECNICO.id, nome: TECNICO.nome, perfil: 'TECNICO' },
  { id: 'u-tec3', nome: 'Zeca Antigo', perfil: 'TECNICO', ativo: false },
];

/** O escritório, já na ordem do repositório (atualizadoEm desc). */
const LISTA: OsLocal[] = [
  os('a', { numero: 101, urgente: true, dataPrevista: '2026-09-30', tipo: 'INSTALACAO' }),
  os('b', { clienteId: 'c2', tecnicoId: null, tipo: 'MANUTENCAO', dataPrevista: '2026-10-10', enderecoBairro: null, enderecoCidade: 'Santos' }),
  os('c', { numero: 103, status: 'EM_ANDAMENTO', tipo: 'CORRETIVA', tecnicoId: TECNICO_2.id, dataPrevista: '2026-10-03' }),
  os('d', { numero: 104, status: 'CONCLUIDA', clienteId: 'c2', dataPrevista: '2026-09-25' }),
  os('e', { numero: 105, status: 'CANCELADA', tipo: 'ENTREGA', dataPrevista: '2026-09-20' }),
];

/** O técnico, fora de ordem de propósito: a página ordena (`ordenarParaTecnico`). */
const DO_TECNICO: OsLocal[] = [
  os('t1', { numero: 201, dataPrevista: '2026-10-05' }),
  os('t5', { numero: 205, status: 'CONCLUIDA', dataPrevista: '2026-09-01', atualizadoEm: '2026-09-02T10:00:00Z' }),
  os('t2', { numero: 202, dataPrevista: '2026-10-03', status: 'EM_ANDAMENTO' }),
  os('t4', { numero: 204, dataPrevista: null }),
  os('t6', { numero: 206, status: 'CANCELADA', dataPrevista: '2026-09-15', atualizadoEm: '2026-09-16T10:00:00Z' }),
  os('t3', { numero: 203, dataPrevista: '2026-10-03', urgente: true }),
];

interface Opcoes {
  usuario?: UsuarioSessao;
  usuarioSinal?: WritableSignal<UsuarioSessao | null>;
  todas?: Observable<OsLocal[]>;
  doTecnico?: Observable<OsLocal[]>;
  estado?: EstadoSync;
}

function montar(o: Opcoes = {}) {
  const repo = {
    observarTodas: vi.fn(() => o.todas ?? of(LISTA)),
    observarDoTecnico: vi.fn((usuarioId: string) => (usuarioId ? (o.doTecnico ?? of(DO_TECNICO)) : of([]))),
    observarEstadoSync: () =>
      of(o.estado ?? { naOutbox: new Set([id('b'), id('t2')]), comPendencia: new Set<string>(), comConflito: new Set<string>() }),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { usuario: o.usuarioSinal ?? signal(o.usuario ?? ADMIN) } },
      { provide: OsRepo, useValue: repo },
      { provide: PropostasRepo, useValue: { observarUsuarios: () => of(USUARIOS) } },
      { provide: ClientesRepo, useValue: { observarTodos: () => of(CLIENTES) } },
    ],
  });
  const fixture = TestBed.createComponent(OsListaPage);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, repo };
}

const codigos = (el: HTMLElement) => [...el.querySelectorAll('li app-os-card')].map((c) => c.querySelector('.font-mono')!.textContent!.trim());
const card = (el: HTMLElement, codigo: string) =>
  [...el.querySelectorAll('li app-os-card')].find((c) => c.querySelector('.font-mono')!.textContent!.trim() === codigo)!;
const selos = (el: HTMLElement, codigo: string) => [...card(el, codigo).querySelectorAll('[data-selo]')].map((s) => s.textContent?.trim());
const botao = (el: HTMLElement, texto: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);

async function ate(fixture: ReturnType<typeof montar>['fixture'], verificar: () => void) {
  await vi.waitFor(() => {
    fixture.detectChanges();
    verificar();
  });
}

describe('OsListaPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('TECNICO ("Minhas OS")', () => {
    it('só as atribuídas a ele, por data prevista com as urgentes primeiro no mesmo dia (sem data no fim), sem as encerradas', () => {
      const { el, repo } = montar({ usuario: TECNICO });
      expect(el.querySelector('h1')?.textContent?.trim()).toBe('Minhas OS');
      expect(repo.observarDoTecnico).toHaveBeenCalledWith(TECNICO.id);
      expect(repo.observarTodas).not.toHaveBeenCalled();
      expect(codigos(el)).toEqual(['OS-000203', 'OS-000202', 'OS-000201', 'OS-000204']);
    });

    it('"Mostrar encerradas": as concluídas e canceladas vêm depois das abertas, as mais recentes primeiro', async () => {
      const { fixture, el } = montar({ usuario: TECNICO });
      const alternar = botao(el, 'Mostrar encerradas')!;
      expect(alternar.getAttribute('aria-pressed')).toBe('false');
      alternar.click();
      await ate(fixture, () => expect(codigos(el)).toEqual(['OS-000203', 'OS-000202', 'OS-000201', 'OS-000204', 'OS-000206', 'OS-000205']));
      expect(alternar.getAttribute('aria-pressed')).toBe('true');
    });

    it('selos Urgente, Atrasada e Não sincronizada', () => {
      vi.setSystemTime(new Date('2026-10-04T15:00:00Z'));
      const { el } = montar({ usuario: TECNICO });
      // 10-04: a 203 (urgente, 10-03) já passou; a 202 (10-03) passou e está na outbox; a 201 (10-05) não
      expect(selos(el, 'OS-000203')).toEqual(['Urgente', 'Atrasada']);
      expect(selos(el, 'OS-000202')).toEqual(['Atrasada', 'Não sincronizada']);
      expect(selos(el, 'OS-000201')).toEqual([]);
      expect(selos(el, 'OS-000204')).toEqual([]);
    });

    it('sem nenhum valor, sem o CPF/CNPJ do cliente, sem busca e sem a linha do técnico', async () => {
      const { fixture, el } = montar({ usuario: TECNICO });
      botao(el, 'Mostrar encerradas')!.click();
      await ate(fixture, () => expect(codigos(el)).toHaveLength(6));
      const texto = el.textContent ?? '';
      expect(texto).not.toMatch(/R\$/);
      for (const doc of ['11444777000161', '11.444.777/0001-61', '52998224725', '529.982.247-25']) expect(texto).not.toContain(doc);
      expect(texto).not.toContain('CPF');
      expect(texto).not.toContain('CNPJ');
      expect(el.innerHTML).not.toContain('11444777');
      expect(el.querySelector('input[type=search]')).toBeNull();
      expect(el.querySelector('[data-tecnico]')).toBeNull();
      expect(texto).not.toContain('Nova OS avulsa');
      expect(card(el, 'OS-000201').textContent).toContain('Padaria São João');
      expect(card(el, 'OS-000201').textContent).toContain('Centro · Campinas');
    });

    it('vazio: "Nenhuma OS atribuída a você."', () => {
      const { el } = montar({ usuario: TECNICO, doTecnico: of([]) });
      expect(el.textContent).toContain('Nenhuma OS atribuída a você.');
      expect(el.querySelector('[aria-live=polite]')?.textContent?.trim()).toBe('0 OS');
    });

    it('só encerradas: nenhuma em aberto, com a dica para mostrá-las', async () => {
      const { fixture, el } = montar({ usuario: TECNICO, doTecnico: of([DO_TECNICO[1]]) });
      expect(codigos(el)).toEqual([]);
      expect(el.textContent).toContain('Nenhuma OS em aberto.');
      expect(el.textContent).toContain('As concluídas e canceladas estão ocultas.');
      botao(el, 'Mostrar encerradas')!.click();
      await ate(fixture, () => expect(codigos(el)).toEqual(['OS-000205']));
    });

    it('sem sessão ou perfil desconhecido: a visão do técnico, sem ler as do escritório', () => {
      const { el, repo } = montar({ usuarioSinal: signal<UsuarioSessao | null>(null) });
      expect(el.querySelector('h1')?.textContent?.trim()).toBe('Minhas OS');
      expect(repo.observarTodas).not.toHaveBeenCalled();
      expect(el.textContent).toContain('Nenhuma OS atribuída a você.');
    });
  });

  describe('ADMIN e COMERCIAL (escritório)', () => {
    it('todas as que o perfil vê, na ordem do repositório, sem as encerradas; card com o técnico', () => {
      const { el, repo } = montar();
      expect(el.querySelector('h1')?.textContent?.trim()).toBe('Ordens de serviço');
      expect(repo.observarTodas).toHaveBeenCalled();
      expect(repo.observarDoTecnico).not.toHaveBeenCalled();
      expect(codigos(el)).toEqual(['OS-000101', 'OSP-BBBBBB', 'OS-000103']);
      expect(card(el, 'OS-000101').querySelector('[data-tecnico]')?.textContent?.trim()).toBe('Técnico: Téo Técnico');
      expect(card(el, 'OSP-BBBBBB').querySelector('[data-tecnico]')?.textContent?.trim()).toBe('Sem técnico');
      expect(card(el, 'OSP-BBBBBB').textContent).toContain('Maria Souza');
      expect(card(el, 'OSP-BBBBBB').textContent).toContain('Santos');
      expect(card(el, 'OS-000101').querySelector('a')?.getAttribute('href')).toBe(`/os/${id('a')}`);
    });

    it('técnico atribuído que não está na lista de usuários do aparelho: "não identificado", nunca "Sem técnico"', () => {
      const { el } = montar({ todas: of([os('x', { numero: 401, tecnicoId: 'u-sumido' })]) });
      expect(card(el, 'OS-000401').querySelector('[data-tecnico]')?.textContent?.trim()).toBe('Técnico: não identificado');
    });

    it('selos no escritório também; nenhum CPF/CNPJ nem valor nos cards', () => {
      const { el } = montar();
      expect(selos(el, 'OS-000101')).toEqual(['Urgente', 'Atrasada']);
      expect(selos(el, 'OSP-BBBBBB')).toEqual(['Não sincronizada']);
      expect(selos(el, 'OS-000103')).toEqual([]);
      const cards = [...el.querySelectorAll('app-os-card')].map((c) => c.textContent).join(' ');
      expect(cards).not.toMatch(/R\$/);
      expect(cards).not.toMatch(/11\.?444\.?777|529\.?982\.?247/);
    });

    it('"Nova OS avulsa" leva a /os/nova, para ADMIN e COMERCIAL', () => {
      for (const usuario of [ADMIN, COMERCIAL]) {
        TestBed.resetTestingModule();
        const { el } = montar({ usuario });
        const link = [...el.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Nova OS avulsa');
        expect(link?.getAttribute('href')).toBe('/os/nova');
        expect(link?.className).toContain('min-h-12');
      }
    });

    it('o comercial vê o que o repositório devolve, sem filtro de técnico', () => {
      const { el, repo } = montar({ usuario: COMERCIAL, todas: of([LISTA[0]]) });
      expect(repo.observarTodas).toHaveBeenCalled();
      expect(codigos(el)).toEqual(['OS-000101']);
      expect(el.querySelector('select#tecnico-os')).toBeNull();
      expect(card(el, 'OS-000101').querySelector('[data-tecnico]')).not.toBeNull();
    });

    it('busca por código, OSP, cliente e CPF/CNPJ, com rótulo e h-12; a contagem é anunciada', async () => {
      const { fixture, el } = montar();
      const busca = el.querySelector<HTMLInputElement>('input[type=search]')!;
      expect(el.querySelector(`label[for=${busca.id}]`)?.textContent?.trim()).toBeTruthy();
      expect(busca.className).toContain('h-12');
      const contagem = el.querySelector('[aria-live=polite]')!;
      expect(contagem.textContent?.trim()).toBe('3 OS');
      const buscar = async (texto: string, esperado: string[]) => {
        busca.value = texto;
        busca.dispatchEvent(new Event('input'));
        await ate(fixture, () => expect(codigos(el)).toEqual(esperado));
      };
      await buscar('101', ['OS-000101']);
      expect(contagem.textContent?.trim()).toBe('1 OS');
      await buscar('osp-b', ['OSP-BBBBBB']);
      await buscar('maria', ['OSP-BBBBBB']);
      await buscar('11.444.777', ['OS-000101', 'OS-000103']);
      await buscar('nada disso', []);
      expect(el.textContent).toContain('Nenhuma OS encontrada.');
      await buscar('', ['OS-000101', 'OSP-BBBBBB', 'OS-000103']);
    });

    it('chips de status com aria-pressed; Concluída e Cancelada só com "Mostrar encerradas"', async () => {
      const { fixture, el } = montar();
      const chips = () => [...el.querySelectorAll('[role=group][aria-label="Filtrar por status"] button')].map((b) => b.textContent?.trim());
      expect(chips()).toEqual(['Todas', 'Aberta', 'Em andamento']);
      expect(botao(el, 'Todas')?.getAttribute('aria-pressed')).toBe('true');
      for (const b of el.querySelectorAll('[role=group] button')) expect(b.className).toContain('min-h-12');

      botao(el, 'Em andamento')!.click();
      await ate(fixture, () => expect(codigos(el)).toEqual(['OS-000103']));
      expect(botao(el, 'Em andamento')?.getAttribute('aria-pressed')).toBe('true');
      expect(botao(el, 'Todas')?.getAttribute('aria-pressed')).toBe('false');

      const encerradas = botao(el, 'Mostrar encerradas')!;
      encerradas.click();
      await ate(fixture, () => expect(chips()).toEqual(['Todas', 'Aberta', 'Em andamento', 'Concluída', 'Cancelada']));
      botao(el, 'Todas')!.click();
      await ate(fixture, () => expect(codigos(el)).toEqual(['OS-000101', 'OSP-BBBBBB', 'OS-000103', 'OS-000104', 'OS-000105']));
      botao(el, 'Concluída')!.click();
      await ate(fixture, () => expect(codigos(el)).toEqual(['OS-000104']));

      // esconder as encerradas com uma delas escolhida volta para Todas
      encerradas.click();
      await ate(fixture, () => expect(codigos(el)).toEqual(['OS-000101', 'OSP-BBBBBB', 'OS-000103']));
      expect(botao(el, 'Todas')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('filtro de tipo, com rótulo', async () => {
      const { fixture, el } = montar();
      const tipo = el.querySelector<HTMLSelectElement>('select#tipo-os')!;
      expect(el.querySelector('label[for=tipo-os]')?.textContent).toContain('Tipo');
      expect([...tipo.options].map((o) => o.textContent?.trim())).toEqual([
        'Todos os tipos', 'Instalação', 'Manutenção', 'Corretiva', 'Preventiva', 'Entrega', 'Retirada', 'Serviço',
      ]);
      tipo.value = 'CORRETIVA';
      tipo.dispatchEvent(new Event('change'));
      await ate(fixture, () => expect(codigos(el)).toEqual(['OS-000103']));
      tipo.value = 'TODOS';
      tipo.dispatchEvent(new Event('change'));
      await ate(fixture, () => expect(codigos(el)).toHaveLength(3));
    });

    it('ADMIN: filtro de técnico (os técnicos por nome, o inativo marcado, e "Sem técnico")', async () => {
      const { fixture, el } = montar();
      const tecnico = el.querySelector<HTMLSelectElement>('select#tecnico-os')!;
      expect(el.querySelector('label[for=tecnico-os]')?.textContent).toContain('Técnico');
      expect(tecnico.className).toContain('h-12');
      expect([...tecnico.options].map((o) => o.textContent?.trim())).toEqual([
        'Todos os técnicos', 'Sem técnico', 'Rui Reparo', 'Téo Técnico', 'Zeca Antigo (inativo)',
      ]);
      tecnico.value = TECNICO_2.id;
      tecnico.dispatchEvent(new Event('change'));
      await ate(fixture, () => expect(codigos(el)).toEqual(['OS-000103']));
      tecnico.value = 'SEM';
      tecnico.dispatchEvent(new Event('change'));
      await ate(fixture, () => expect(codigos(el)).toEqual(['OSP-BBBBBB']));
      tecnico.value = TECNICO.id;
      tecnico.dispatchEvent(new Event('change'));
      await ate(fixture, () => expect(codigos(el)).toEqual(['OS-000101']));
      tecnico.value = 'TODOS';
      tecnico.dispatchEvent(new Event('change'));
      await ate(fixture, () => expect(codigos(el)).toHaveLength(3));
    });

    it('sem nenhuma aberta visível: a dica das encerradas', async () => {
      const { fixture, el } = montar({ todas: of([LISTA[3]]) });
      expect(el.textContent).toContain('Nenhuma OS encontrada.');
      expect(el.textContent).toContain('As concluídas e canceladas estão ocultas.');
      botao(el, 'Mostrar encerradas')!.click();
      await ate(fixture, () => expect(codigos(el)).toEqual(['OS-000104']));
    });

    it('vazio do escritório: "Nenhuma OS ainda."', () => {
      const { el } = montar({ todas: of([]) });
      expect(el.textContent).toContain('Nenhuma OS ainda.');
      expect(el.textContent).not.toContain('Nenhuma OS encontrada.');
    });

    it('"Carregando…" antes da primeira emissão, sem piscar o vazio', async () => {
      const todas = new Subject<OsLocal[]>();
      const { fixture, el } = montar({ todas });
      expect(el.textContent).toContain('Carregando…');
      expect(el.textContent).not.toContain('Nenhuma OS');
      expect(el.querySelector('[aria-live=polite]')?.textContent?.trim()).toBe('');
      todas.next(LISTA);
      await ate(fixture, () => expect(codigos(el)).toHaveLength(3));
      expect(el.textContent).not.toContain('Carregando…');
    });

    it('a troca de perfil troca a visão e a fonte dos dados', async () => {
      const usuario = signal<UsuarioSessao | null>(ADMIN);
      const { fixture, el, repo } = montar({ usuarioSinal: usuario });
      expect(el.querySelector('h1')?.textContent?.trim()).toBe('Ordens de serviço');
      usuario.set(TECNICO);
      await ate(fixture, () => expect(el.querySelector('h1')?.textContent?.trim()).toBe('Minhas OS'));
      expect(repo.observarDoTecnico).toHaveBeenCalledWith(TECNICO.id);
      await ate(fixture, () => expect(codigos(el)).toEqual(['OS-000203', 'OS-000202', 'OS-000201', 'OS-000204']));
      expect(el.querySelector('[data-tecnico]')).toBeNull();
      expect(el.querySelector('input[type=search]')).toBeNull();
    });
  });

  describe('hoje (selo Atrasada) com o relógio fixo', () => {
    /** 23:59 de 2026-10-01 em São Paulo (02:59 UTC de 10-02): a OS prevista para 10-01 ainda está no dia. */
    const QUASE_MEIA_NOITE = new Date('2026-10-02T02:59:00Z');
    const HOJE: OsLocal[] = [os('h', { numero: 301, dataPrevista: '2026-10-01' })];

    beforeEach(() => {
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(QUASE_MEIA_NOITE);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('vira à meia-noite de São Paulo com a tela aberta (e não à meia-noite UTC)', () => {
      const { fixture, el } = montar({ usuario: TECNICO, doTecnico: of(HOJE) });
      // 02:59 UTC já é 10-02 em UTC: pelo UTC estaria atrasada
      expect(selos(el, 'OS-000301')).toEqual([]);
      vi.advanceTimersByTime(59_000);
      fixture.detectChanges();
      expect(selos(el, 'OS-000301')).toEqual([]);
      vi.advanceTimersByTime(2_000);
      fixture.detectChanges();
      expect(selos(el, 'OS-000301')).toEqual(['Atrasada']);
    });

    it('confere de novo quando a aba volta a ficar visível', () => {
      const visibilidade = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      const { fixture, el } = montar({ usuario: TECNICO, doTecnico: of(HOJE) });
      vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();
      expect(selos(el, 'OS-000301')).toEqual([]);
      visibilidade.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();
      expect(selos(el, 'OS-000301')).toEqual(['Atrasada']);
    });

    it('ao sair da tela, o timer e o listener são desfeitos', () => {
      const remover = vi.spyOn(document, 'removeEventListener');
      const { fixture } = montar({ usuario: TECNICO, doTecnico: of(HOJE) });
      expect(vi.getTimerCount()).toBe(1);
      fixture.destroy();
      expect(vi.getTimerCount()).toBe(0);
      expect(remover).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });
  });
});
