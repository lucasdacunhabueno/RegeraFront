import { HttpErrorResponse } from '@angular/common/http';
import { camposComErro, mensagemDeErro } from './erro-api';

describe('erro-api', () => {
  it('usa o detail do ProblemDetail', () => {
    const e = new HttpErrorResponse({ status: 409, error: { detail: 'Já existe um usuário com este e-mail.' } });
    expect(mensagemDeErro(e)).toBe('Já existe um usuário com este e-mail.');
  });

  it('status 0 vira mensagem de sem conexão', () => {
    expect(mensagemDeErro(new HttpErrorResponse({ status: 0 }))).toBe('Sem conexão com o servidor.');
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
