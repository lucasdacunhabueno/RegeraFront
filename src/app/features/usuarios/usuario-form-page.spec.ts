import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { UsuarioFormPage } from './usuario-form-page';

function montar(id?: string) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(UsuarioFormPage);
  if (id) fixture.componentRef.setInput('id', id);
  fixture.detectChanges();
  vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return fixture;
}

function digitar(fixture: ComponentFixture<unknown>, seletor: string, valor: string) {
  const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement | HTMLSelectElement>(seletor)!;
  el.value = valor;
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'));
}

const enviar = (fixture: ComponentFixture<unknown>) =>
  (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[type=submit]')!.click();

describe('UsuarioFormPage', () => {
  it('cria usuário com os dados do formulário', async () => {
    const fixture = montar();
    digitar(fixture, '#nome', 'Bia');
    digitar(fixture, '#email', 'bia@regera.test');
    digitar(fixture, '#perfil', 'TECNICO');
    digitar(fixture, '#senha', 'senha-bia-1');
    enviar(fixture);

    const req = TestBed.inject(HttpTestingController).expectOne('/api/usuarios');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ nome: 'Bia', email: 'bia@regera.test', perfil: 'TECNICO', senha: 'senha-bia-1' });
    req.flush({ id: '9', nome: 'Bia', email: 'bia@regera.test', perfil: 'TECNICO', ativo: true });
    await vi.waitFor(() => expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/usuarios'));
  });

  it('mostra erro de campo vindo do servidor', async () => {
    const fixture = montar();
    digitar(fixture, '#nome', 'Bia');
    digitar(fixture, '#email', 'bia@regera.test');
    digitar(fixture, '#senha', 'senha-bia-1');
    enviar(fixture);

    TestBed.inject(HttpTestingController)
      .expectOne('/api/usuarios')
      .flush({ codigo: 'EMAIL_DUPLICADO', detail: 'Já existe um usuário com este e-mail.' }, { status: 409, statusText: 'x' });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Já existe um usuário com este e-mail.');
    });
  });

  it('senha curta não envia', () => {
    const fixture = montar();
    digitar(fixture, '#nome', 'Bia');
    digitar(fixture, '#email', 'bia@regera.test');
    digitar(fixture, '#senha', '123');
    enviar(fixture);

    TestBed.inject(HttpTestingController).expectNone('/api/usuarios');
  });

  it('edição carrega o usuário e envia PUT sem senha', async () => {
    const fixture = montar('1');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/usuarios/1').flush({ id: '1', nome: 'Ana', email: 'ana@regera.test', perfil: 'COMERCIAL', ativo: true });
    await vi.waitFor(() =>
      expect((fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#nome')!.value).toBe('Ana'),
    );

    digitar(fixture, '#nome', 'Ana Souza');
    enviar(fixture);

    const req = http.expectOne('/api/usuarios/1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ nome: 'Ana Souza', email: 'ana@regera.test', perfil: 'COMERCIAL', ativo: true });
    req.flush({ id: '1', nome: 'Ana Souza', email: 'ana@regera.test', perfil: 'COMERCIAL', ativo: true });
  });

  it('redefinir senha envia PUT da senha e limpa o campo', async () => {
    const fixture = montar('1');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/usuarios/1').flush({ id: '1', nome: 'Ana', email: 'ana@regera.test', perfil: 'COMERCIAL', ativo: true });
    await vi.waitFor(() =>
      expect((fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#nome')!.value).toBe('Ana'),
    );

    digitar(fixture, '#novaSenha', 'nova-senha-1');
    fixture.detectChanges();
    const botao = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.includes('Redefinir senha'),
    )!;
    botao.click();

    const req = http.expectOne('/api/usuarios/1/senha');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ novaSenha: 'nova-senha-1' });
    req.flush(null);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#novaSenha')!.value).toBe('');
    });
  });

  it('erro de campo do servidor não repete a mensagem geral', async () => {
    const fixture = montar();
    digitar(fixture, '#nome', 'Bia');
    digitar(fixture, '#email', 'bia@regera.test');
    digitar(fixture, '#senha', 'senha-bia-1');
    enviar(fixture);

    TestBed.inject(HttpTestingController)
      .expectOne('/api/usuarios')
      .flush(
        { codigo: 'VALIDACAO', detail: 'Dados inválidos.', campos: { email: 'E-mail já cadastrado.' } },
        { status: 400, statusText: 'x' },
      );
    await vi.waitFor(() => {
      fixture.detectChanges();
      const texto = fixture.nativeElement.textContent as string;
      expect(texto).toContain('E-mail já cadastrado.');
      expect(texto).not.toContain('Dados inválidos.');
    });
  });
});
