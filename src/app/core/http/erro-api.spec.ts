import { HttpErrorResponse } from '@angular/common/http';
import { camposComErro, falhaDeRede, mensagemDeErro } from './erro-api';

describe('erro-api', () => {
  it('usa o detail do ProblemDetail', () => {
    const e = new HttpErrorResponse({ status: 409, error: { detail: 'Já existe um usuário com este e-mail.' } });
    expect(mensagemDeErro(e)).toBe('Já existe um usuário com este e-mail.');
  });

  it('status 0 vira mensagem de sem conexão', () => {
    expect(mensagemDeErro(new HttpErrorResponse({ status: 0 }))).toBe('Sem conexão com o servidor.');
  });

  it('o 504 do service worker sem rede também vira mensagem de sem conexão', () => {
    expect(mensagemDeErro(new HttpErrorResponse({ status: 504, statusText: 'Gateway Timeout' }))).toBe('Sem conexão com o servidor.');
  });

  it('falhaDeRede: status 0 e o 504 do service worker; outros erros não', () => {
    expect(falhaDeRede(new HttpErrorResponse({ status: 0 }))).toBe(true);
    expect(falhaDeRede(new HttpErrorResponse({ status: 504, statusText: 'Gateway Timeout' }))).toBe(true);
    for (const status of [401, 403, 500, 502, 503]) expect(falhaDeRede(new HttpErrorResponse({ status }))).toBe(false);
    expect(falhaDeRede(new Error('x'))).toBe(false);
  });

  it('erro desconhecido vira mensagem genérica', () => {
    expect(mensagemDeErro(new Error('x'))).toBe('Erro inesperado. Tente de novo.');
  });

  it('extrai campos de validação', () => {
    const e = new HttpErrorResponse({ status: 400, error: { codigo: 'VALIDACAO', campos: { email: 'E-mail inválido.' } } });
    expect(camposComErro(e)).toEqual({ email: 'E-mail inválido.' });
    expect(camposComErro(new Error('x'))).toEqual({});
  });
});
