import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { vi } from 'vitest';
import { Perfil } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { SyncAgendador } from '../../core/sync/sync-agendador';
import { SyncService } from '../../core/sync/sync-service';
import { Shell } from './shell';

function montar(perfil: Perfil, opcoes: { sessaoExpirada?: boolean; pendentes?: number; problemas?: number; ultimoSync?: string } = {}) {
  const iniciar = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideServiceWorker('ngsw-worker.js', { enabled: false }),
      {
        provide: AuthService,
        useValue: {
          usuario: signal({ id: '1', nome: 'Ana Souza', email: 'a@a', perfil, ativo: true }),
          sessaoExpirada: signal(opcoes.sessaoExpirada ?? false),
        },
      },
      {
        provide: SyncService,
        useValue: {
          sincronizando: signal(false),
          naoSincronizados: signal(opcoes.pendentes ?? 0),
          problemas: signal(opcoes.problemas ?? 0),
          ultimoSync: signal<string | null>(opcoes.ultimoSync ?? null),
        },
      },
      { provide: SyncAgendador, useValue: { iniciar } },
    ],
  });
  const fixture = TestBed.createComponent(Shell);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, iniciar };
}

describe('Shell', () => {
  it('mostra nome do usuário e status de conexão', () => {
    const { el } = montar('COMERCIAL');
    expect(el.textContent).toContain('Ana Souza');
    expect(el.querySelector('[data-testid=status-conexao]')?.textContent).toMatch(/Online|Offline/);
  });

  it('P4c-R12: no desktop o menu lateral não encolhe e a coluna do conteúdo aceita encolher (telas largas rolam dentro de si)', () => {
    const { el } = montar('ADMIN');
    const aside = el.querySelector('aside')!;
    expect(aside.classList).toContain('shrink-0');
    const coluna = el.querySelector('main')!.parentElement!;
    expect(coluna.classList).toContain('flex-1');
    expect(coluna.classList).toContain('min-w-0');
  });

  it('técnico não vê Kanban nem Clientes', () => {
    const { el } = montar('TECNICO');
    expect(el.textContent).not.toContain('Kanban');
    expect(el.textContent).not.toContain('Clientes');
    expect(el.textContent).toContain('Propostas');
  });

  it('mostra aviso quando a sessão expirou', () => {
    const { el } = montar('COMERCIAL', { sessaoExpirada: true });
    expect(el.textContent).toContain('Sua sessão expirou');
  });

  it('inicia o agendador de sync', () => {
    const { iniciar } = montar('COMERCIAL');
    expect(iniciar).toHaveBeenCalled();
  });

  it('mostra a hora do último sync ao lado do ícone só quando existe', () => {
    let { el } = montar('COMERCIAL');
    expect(el.querySelector('[data-testid=ultimo-sync]')).toBeNull();
    TestBed.resetTestingModule();
    ({ el } = montar('COMERCIAL', { ultimoSync: new Date(2026, 8, 30, 12, 34).toISOString() }));
    expect(el.querySelector('[data-testid=ultimo-sync]')?.textContent?.trim()).toBe('12:34');
  });

  it('mostra quantidade não sincronizada e destaca problemas', () => {
    let { el } = montar('COMERCIAL', { pendentes: 3 });
    expect(el.querySelector('[data-testid=sync-status]')?.textContent?.trim()).toBe('3');
    TestBed.resetTestingModule();
    ({ el } = montar('COMERCIAL', { pendentes: 3, problemas: 1 }));
    const badge = el.querySelector('[data-testid=sync-status] span');
    expect(badge?.textContent?.trim()).toBe('1');
    expect(badge?.className).toContain('bg-red-600');
  });
});
