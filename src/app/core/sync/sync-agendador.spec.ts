import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth-service';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { SyncAgendador } from './sync-agendador';
import { SyncService } from './sync-service';

describe('SyncAgendador', () => {
  const online = signal(false);
  const autenticado = signal(true);
  let renovar: ReturnType<typeof vi.fn>;
  let sincronizar: ReturnType<typeof vi.fn>;
  let agendador: SyncAgendador;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    online.set(false);
    autenticado.set(true);
    renovar = vi.fn().mockResolvedValue(true);
    sincronizar = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: ConectividadeService, useValue: { online } },
        { provide: AuthService, useValue: { autenticado, renovar } },
        { provide: SyncService, useValue: { sincronizar } },
      ],
    });
    agendador = TestBed.inject(SyncAgendador);
  });

  afterEach(() => {
    agendador.parar();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ao ficar online renova a sessão e depois sincroniza', async () => {
    agendador.iniciar();
    TestBed.tick();
    expect(renovar).not.toHaveBeenCalled();

    online.set(true);
    TestBed.tick();
    await vi.waitFor(() => expect(sincronizar).toHaveBeenCalled());
    expect(renovar).toHaveBeenCalledBefore(sincronizar);
  });

  it('não faz nada sem usuário autenticado', async () => {
    autenticado.set(false);
    online.set(true);
    agendador.iniciar();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(renovar).not.toHaveBeenCalled();
    expect(sincronizar).not.toHaveBeenCalled();
  });

  it('sincroniza a cada 60 s com a aba visível', async () => {
    agendador.iniciar();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sincronizar).toHaveBeenCalledTimes(1);
  });

  it('iniciar duas vezes não duplica o intervalo', async () => {
    agendador.iniciar();
    agendador.iniciar();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sincronizar).toHaveBeenCalledTimes(1);
  });
});
