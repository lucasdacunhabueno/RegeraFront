import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth-service';
import { TrocarSenhaPage } from './trocar-senha-page';

function montar() {
  const auth = { logout: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: auth },
    ],
  });
  const fixture = TestBed.createComponent(TrocarSenhaPage);
  fixture.detectChanges();
  vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return { fixture, auth };
}

function preencher(fixture: ComponentFixture<unknown>, atual: string, nova: string, confirmacao: string) {
  const el = fixture.nativeElement as HTMLElement;
  for (const [id, valor] of [['#senhaAtual', atual], ['#novaSenha', nova], ['#confirmacao', confirmacao]]) {
    const input = el.querySelector<HTMLInputElement>(id)!;
    input.value = valor;
    input.dispatchEvent(new Event('input'));
  }
  el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
}

describe('TrocarSenhaPage', () => {
  it('confirmação diferente não envia', () => {
    const { fixture, auth } = montar();
    preencher(fixture, 'senha-atual', 'nova-senha-1', 'outra-senha-1');
    fixture.detectChanges();

    TestBed.inject(HttpTestingController).expectNone('/api/me/senha');
    expect(auth.logout).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('As senhas não conferem.');
  });

  it('envia troca, encerra a sessão e vai para o login', async () => {
    const { fixture, auth } = montar();
    preencher(fixture, 'senha-atual', 'nova-senha-1', 'nova-senha-1');

    const req = TestBed.inject(HttpTestingController).expectOne('/api/me/senha');
    expect(req.request.body).toEqual({ senhaAtual: 'senha-atual', novaSenha: 'nova-senha-1' });
    req.flush(null);
    await vi.waitFor(() => expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/login'));
    expect(auth.logout).toHaveBeenCalled();
  });

  it.each([
    ['', 'nova-senha-1', 'nova-senha-1', 'Informe a senha atual.'],
    ['senha-atual', 'curta', 'curta', 'A nova senha deve ter entre 8 e 72 caracteres.'],
    ['senha-atual', 'nova-senha-1', '', 'Confirme a nova senha.'],
  ])('mensagem específica (%#)', (atual, nova, confirmacao, mensagem) => {
    const { fixture } = montar();
    preencher(fixture, atual, nova, confirmacao);
    fixture.detectChanges();

    TestBed.inject(HttpTestingController).expectNone('/api/me/senha');
    expect(fixture.nativeElement.textContent).toContain(mensagem);
  });
});
