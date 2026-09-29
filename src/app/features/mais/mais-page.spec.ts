import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { Perfil } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { MaisPage } from './mais-page';

function montar(perfil: Perfil, logout = vi.fn().mockResolvedValue(undefined)) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { usuario: signal({ id: '1', nome: 'A', email: 'a@a', perfil, ativo: true }), logout } },
    ],
  });
  const fixture = TestBed.createComponent(MaisPage);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, fixture, logout };
}

describe('MaisPage', () => {
  it('admin vê Usuários e Empresa', () => {
    const { el } = montar('ADMIN');
    expect(el.textContent).toContain('Usuários');
    expect(el.textContent).toContain('Empresa');
  });

  it('comercial não vê Usuários nem Empresa', () => {
    const { el } = montar('COMERCIAL');
    expect(el.textContent).not.toContain('Usuários');
    expect(el.textContent).not.toContain('Empresa');
    expect(el.textContent).toContain('Trocar senha');
  });

  it('sair faz logout e vai para o login', async () => {
    const { el, logout } = montar('COMERCIAL');
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    el.querySelector<HTMLButtonElement>('[data-testid=sair]')!.click();
    expect(logout).toHaveBeenCalled();
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/login'));
  });
});
