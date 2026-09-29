import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth-service';
import { LoginPage } from './login-page';

function montar(login: ReturnType<typeof vi.fn>) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthService, useValue: { usuario: signal(null), login } }],
  });
  const fixture = TestBed.createComponent(LoginPage);
  fixture.detectChanges();
  return fixture;
}

function preencher(el: HTMLElement, email: string, senha: string) {
  const inputEmail = el.querySelector<HTMLInputElement>('#email')!;
  const inputSenha = el.querySelector<HTMLInputElement>('#senha')!;
  inputEmail.value = email;
  inputEmail.dispatchEvent(new Event('input'));
  inputSenha.value = senha;
  inputSenha.dispatchEvent(new Event('input'));
  el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
}

describe('LoginPage', () => {
  it('entra e navega para a raiz', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    const fixture = montar(login);
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    preencher(fixture.nativeElement, 'ana@regera.test', 'senha-1');
    expect(login).toHaveBeenCalledWith('ana@regera.test', 'senha-1');
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/'));
  });

  it('mostra a mensagem do servidor quando falha', async () => {
    const erro = new HttpErrorResponse({ status: 401, error: { detail: 'E-mail ou senha incorretos.' } });
    const fixture = montar(vi.fn().mockRejectedValue(erro));

    preencher(fixture.nativeElement, 'ana@regera.test', 'errada');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('E-mail ou senha incorretos.');
    });
  });

  it('não envia com e-mail inválido', async () => {
    const login = vi.fn();
    const fixture = montar(login);

    preencher(fixture.nativeElement, 'nao-e-email', 'x');

    expect(login).not.toHaveBeenCalled();
  });
});
