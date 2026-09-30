import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { SyncService } from '../../core/sync/sync-service';
import { LoginPage } from './login-page';

const ANA: UsuarioSessao = { id: 'u1', nome: 'Ana', email: 'ana@regera.test', perfil: 'COMERCIAL', ativo: true };

function montar(login: ReturnType<typeof vi.fn>, anterior?: UsuarioSessao, pendentes = 0) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: AuthService,
        useValue: { usuario: signal(null), login, sessaoLocal: vi.fn().mockResolvedValue(anterior) },
      },
      { provide: SyncService, useValue: { contarNaoSincronizados: vi.fn().mockResolvedValue(pendentes) } },
    ],
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
  afterEach(() => vi.restoreAllMocks());

  it('entra e navega para a raiz', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    const fixture = montar(login);
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    preencher(fixture.nativeElement, 'ana@regera.test', 'senha-1');

    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/'));
    expect(login).toHaveBeenCalledWith('ana@regera.test', 'senha-1');
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

  it('não envia com e-mail inválido', () => {
    const login = vi.fn();
    const fixture = montar(login);
    preencher(fixture.nativeElement, 'nao-e-email', 'x');
    expect(login).not.toHaveBeenCalled();
  });

  it('outro usuário com dados pendentes: recusar a confirmação não faz login', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const login = vi.fn();
    const fixture = montar(login, ANA, 3);

    preencher(fixture.nativeElement, 'bia@regera.test', 'senha-1');

    await vi.waitFor(() => expect(confirmar).toHaveBeenCalled());
    expect(confirmar.mock.calls[0][0]).toContain('Ana');
    expect(login).not.toHaveBeenCalled();
  });

  it('mesmo usuário com dados pendentes entra sem perguntar', async () => {
    const confirmar = vi.spyOn(window, 'confirm');
    const login = vi.fn().mockResolvedValue(undefined);
    const fixture = montar(login, ANA, 3);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    preencher(fixture.nativeElement, 'ANA@regera.test', 'senha-1');

    await vi.waitFor(() => expect(login).toHaveBeenCalled());
    expect(confirmar).not.toHaveBeenCalled();
  });
});
