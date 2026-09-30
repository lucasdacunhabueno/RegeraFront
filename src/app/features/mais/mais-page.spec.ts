import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { Perfil } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { SyncService } from '../../core/sync/sync-service';
import { MaisPage } from './mais-page';

function montar(perfil: Perfil, contagens: number[] = [0], online = true) {
  const logout = vi.fn().mockResolvedValue(undefined);
  const contar = vi.fn();
  contagens.forEach((n) => contar.mockResolvedValueOnce(n));
  contar.mockResolvedValue(contagens.at(-1));
  const sincronizar = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { usuario: signal({ id: '1', nome: 'A', email: 'a@a', perfil, ativo: true }), logout } },
      { provide: ConectividadeService, useValue: { online: signal(online) } },
      {
        provide: SyncService,
        useValue: { naoSincronizados: signal(contagens[0]), problemas: signal(0), contarNaoSincronizados: contar, sincronizar },
      },
    ],
  });
  const fixture = TestBed.createComponent(MaisPage);
  fixture.detectChanges();
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return { el: fixture.nativeElement as HTMLElement, logout, sincronizar, navegar };
}

describe('MaisPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('admin vê Usuários e Empresa', () => {
    const { el } = montar('ADMIN');
    expect(el.textContent).toContain('Usuários');
    expect(el.textContent).toContain('Empresa');
  });

  it('comercial não vê Usuários nem Empresa', () => {
    const { el } = montar('COMERCIAL');
    expect(el.textContent).not.toContain('Usuários');
    expect(el.textContent).toContain('Trocar senha');
  });

  it('mostra o contador de pendências', () => {
    const { el } = montar('COMERCIAL', [4]);
    expect(el.querySelector('[data-testid=contador-pendencias]')?.textContent?.trim()).toBe('4');
  });

  it('sem pendências sai direto', async () => {
    const { el, logout, navegar } = montar('COMERCIAL', [0]);
    el.querySelector<HTMLButtonElement>('[data-testid=sair]')!.click();
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/login'));
    expect(logout).toHaveBeenCalled();
  });

  it('com pendências tenta sincronizar e, se sobrar algo e o usuário recusar, não sai', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { el, logout, sincronizar } = montar('COMERCIAL', [2, 1]);
    el.querySelector<HTMLButtonElement>('[data-testid=sair]')!.click();
    await vi.waitFor(() => expect(confirmar).toHaveBeenCalled());
    expect(sincronizar).toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it('com pendências e confirmação, sai', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { el, logout } = montar('COMERCIAL', [2, 2], false);
    el.querySelector<HTMLButtonElement>('[data-testid=sair]')!.click();
    await vi.waitFor(() => expect(logout).toHaveBeenCalled());
  });
});
