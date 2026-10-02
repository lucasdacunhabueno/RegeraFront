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
    sincronizar = vi.fn().mockResolvedValue('concluida');
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

  it('login sem recarregar (autenticado false para true) com internet dispara renovar e sincronizar', async () => {
    online.set(true);
    autenticado.set(false);
    agendador.iniciar();
    TestBed.tick();
    expect(sincronizar).not.toHaveBeenCalled();

    autenticado.set(true);
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
  /**
   * O evento `online` não garante rede: no E2E, o `setOffline(false)` do Playwright devolve a rede à página antes do
   * service worker, e a renovação e o push saem pelo service worker ainda offline (ele responde 504). No aparelho, a
   * rede pode subir antes de responder. A reconexão não pode ficar numa tentativa só esperando os 60 s do intervalo.
   */
  it('reconexão que para por falta de rede tenta de novo, renovando antes, com espera crescente até concluir', async () => {
    renovar.mockResolvedValue(false);
    sincronizar.mockResolvedValueOnce('sem-rede').mockResolvedValueOnce('sem-rede').mockResolvedValue('concluida');
    agendador.iniciar();
    online.set(true);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(500);
    expect(sincronizar).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(renovar).toHaveBeenCalledTimes(2);
    expect(sincronizar).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sincronizar).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(renovar).toHaveBeenCalledTimes(3);
    expect(sincronizar).toHaveBeenCalledTimes(3);

    // concluiu: não tenta mais (o intervalo de 60 s segue por conta própria)
    await vi.advanceTimersByTimeAsync(50_000);
    expect(sincronizar).toHaveBeenCalledTimes(3);
  });

  it('não repete a reconexão que concluiu ou falhou por outro motivo (o aviso já saiu)', async () => {
    sincronizar.mockResolvedValue('falhou');
    agendador.iniciar();
    online.set(true);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(55_000);
    expect(sincronizar).toHaveBeenCalledTimes(1);
  });

  it('desiste depois das esperas (1, 2, 4, 8 e 16 s) e deixa para o intervalo de 60 s', async () => {
    sincronizar.mockResolvedValue('sem-rede');
    agendador.iniciar();
    online.set(true);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(31_500);
    expect(sincronizar).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(28_000);
    expect(sincronizar).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(500);
    expect(sincronizar).toHaveBeenCalledTimes(7);
  });

  it('cair a internet interrompe as novas tentativas; voltar recomeça', async () => {
    sincronizar.mockResolvedValue('sem-rede');
    agendador.iniciar();
    online.set(true);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(500);
    expect(sincronizar).toHaveBeenCalledTimes(1);

    online.set(false);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(sincronizar).toHaveBeenCalledTimes(1);

    online.set(true);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(500);
    expect(sincronizar).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sincronizar).toHaveBeenCalledTimes(3);
  });

  it('sair da sessão ou parar interrompe as novas tentativas', async () => {
    sincronizar.mockResolvedValue('sem-rede');
    agendador.iniciar();
    online.set(true);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(500);
    autenticado.set(false);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(sincronizar).toHaveBeenCalledTimes(1);

    autenticado.set(true);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(500);
    expect(sincronizar).toHaveBeenCalledTimes(2);
    agendador.parar();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(sincronizar).toHaveBeenCalledTimes(2);
  });
});
