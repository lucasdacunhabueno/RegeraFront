import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, Subject } from 'rxjs';
import { vi } from 'vitest';
import type { EstadoSync } from '../os/os-repo';
import { OsRepo } from '../os/os-repo';
import { OsDados, OsLocal, paraOsLocal } from '../os/os-models';
import { PropostasRepo } from '../propostas/propostas-repo';

import { OsDoCliente } from './os-do-cliente';

/** 2026-10-02 01:30 UTC ainda é 2026-10-01 em São Paulo. */
const AGORA = new Date('2026-10-02T01:30:00Z');

const os = (id: string, extra: Partial<OsDados> = {}): OsLocal =>
  paraOsLocal(id, 1, {
    codigoProvisorio: 'OSP-K7Q2ZP', numero: null, revisao: 1, propostaId: 'p1', clienteId: 'c1', tipo: 'INSTALACAO',
    status: 'ABERTA', tecnicoId: 'u-tec', dataPrevista: '2026-10-05', urgente: false, concluiProposta: true,
    enderecoBairro: 'Sé', enderecoCidade: 'São Paulo', assinaturaRecusada: false, itens: [], notas: [], ...extra,
  });

function montar(o: { lista?: Observable<OsLocal[]>; estado?: EstadoSync } = {}) {
  const repo = {
    observarDoCliente: vi.fn(() => o.lista ?? of<OsLocal[]>([])),
    observarEstadoSync: () => of(o.estado ?? { naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() }),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: OsRepo, useValue: repo },
      { provide: PropostasRepo, useValue: { observarUsuarios: () => of([{ id: 'u-tec', nome: 'Téo Técnico', perfil: 'TECNICO' }]) } },
    ],
  });
  const fixture = TestBed.createComponent(OsDoCliente);
  fixture.componentRef.setInput('clienteId', 'c1');
  fixture.componentRef.setInput('clienteNome', 'Maria');
  fixture.detectChanges();
  return { fixture, repo, el: fixture.nativeElement as HTMLElement };
}

const secao = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-testid="os-do-cliente"]')!;
const codigos = (el: HTMLElement) => [...el.querySelectorAll('app-os-card .font-mono')].map((c) => c.textContent?.trim());

describe('OsDoCliente', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
  });
  afterEach(() => vi.useRealTimers());

  it('as OS do cliente (observarDoCliente) na ordem do repositório, com cliente, técnico, status e o link para /os/:id', () => {
    const lista = [
      os('a', { numero: 123, revisao: 2, status: 'EM_ANDAMENTO' }),
      os('b', { codigoProvisorio: 'OSP-AAAAAA', status: 'CONCLUIDA', tecnicoId: null }),
      os('c', { numero: 7, status: 'CANCELADA', tecnicoId: 'sumiu' }),
    ];
    const { el, repo } = montar({ lista: of(lista) });
    expect(repo.observarDoCliente).toHaveBeenCalledWith('c1');
    const s = secao(el);
    expect(document.getElementById(s.getAttribute('aria-labelledby')!)?.textContent?.trim()).toBe('Ordens de serviço');
    // as encerradas também: é o histórico do cliente
    expect(codigos(el)).toEqual(['OS-000123-R2', 'OSP-AAAAAA', 'OS-000007']);
    const cards = [...s.querySelectorAll('app-os-card')];
    expect(cards[0].textContent).toContain('Maria');
    expect(cards[0].querySelector('[data-status]')?.textContent?.trim()).toBe('Em andamento');
    expect(cards.map((c) => c.querySelector('[data-tecnico]')?.textContent?.trim())).toEqual([
      'Técnico: Téo Técnico', 'Sem técnico', 'Técnico: não identificado',
    ]);
    expect(cards[0].querySelector('a')?.getAttribute('href')).toBe('/os/a');
    expect(s.textContent).not.toContain('Nenhuma OS');
  });

  it('selos: Urgente, Atrasada e Não sincronizada (outbox), como na lista de OS', () => {
    const lista = [os('a', { urgente: true, dataPrevista: '2026-09-30' }), os('b')];
    const { el } = montar({ lista: of(lista), estado: { naOutbox: new Set(['b']), comPendencia: new Set<string>(), comConflito: new Set<string>() } });
    const selos = (i: number) => [...el.querySelectorAll('app-os-card')[i].querySelectorAll('[data-selo]')].map((x) => x.textContent?.trim());
    expect(selos(0)).toEqual(['Urgente', 'Atrasada']);
    expect(selos(1)).toEqual(['Não sincronizada']);
  });

  it('sem OS: o estado vazio', () => {
    const { el } = montar();
    expect(secao(el).querySelector('[role=status]')?.textContent?.trim()).toBe('Nenhuma OS para este cliente.');
    expect(el.querySelector('app-os-card')).toBeNull();
  });

  it('"Carregando…" antes da primeira leitura; troca de cliente relê', async () => {
    const lista = new Subject<OsLocal[]>();
    const { el, fixture, repo } = montar({ lista });
    const regiao = secao(el).querySelector('[role=status]');
    expect(regiao?.textContent?.trim()).toBe('Carregando…');
    expect(secao(el).textContent).not.toContain('Nenhuma OS');
    lista.next([os('a', { numero: 1 })]);
    fixture.detectChanges();
    expect(codigos(el)).toEqual(['OS-000001']);
    repo.observarDoCliente.mockReturnValue(of([]));
    fixture.componentRef.setInput('clienteId', 'c2');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(repo.observarDoCliente).toHaveBeenLastCalledWith('c2');
    expect(secao(el).textContent).toContain('Nenhuma OS para este cliente.');
    // N4: a mesma região do começo (fixa), agora com o vazio
    expect(secao(el).querySelector('[role=status]')).toBe(regiao);
    expect(regiao?.textContent?.trim()).toBe('Nenhuma OS para este cliente.');
  });
});
