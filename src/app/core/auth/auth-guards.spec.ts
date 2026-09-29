import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PartialMatchRouteSnapshot, provideRouter, Route, UrlTree } from '@angular/router';
import { UsuarioSessao } from './auth-models';
import { autenticadoGuard, perfilGuard } from './auth-guards';
import { AuthService } from './auth-service';

function comUsuario(u: UsuarioSessao | null) {
  const usuario = signal(u);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { usuario, autenticado: () => usuario() !== null } },
    ],
  });
}

const executar = (guard: ReturnType<typeof perfilGuard>) =>
  TestBed.runInInjectionContext(() => guard({} as Route, [], {} as PartialMatchRouteSnapshot));

describe('guards', () => {
  it('autenticadoGuard manda para /login sem sessão', () => {
    comUsuario(null);
    const r = executar(autenticadoGuard) as UrlTree;
    expect(r.toString()).toBe('/login');
  });

  it('autenticadoGuard libera com sessão', () => {
    comUsuario({ id: '1', nome: 'A', email: 'a@a', perfil: 'TECNICO', ativo: true });
    expect(executar(autenticadoGuard)).toBe(true);
  });

  it('perfilGuard bloqueia perfil não permitido', () => {
    comUsuario({ id: '1', nome: 'A', email: 'a@a', perfil: 'COMERCIAL', ativo: true });
    const r = executar(perfilGuard('ADMIN')) as UrlTree;
    expect(r.toString()).toBe('/');
  });

  it('perfilGuard libera perfil permitido', () => {
    comUsuario({ id: '1', nome: 'A', email: 'a@a', perfil: 'ADMIN', ativo: true });
    expect(executar(perfilGuard('ADMIN', 'COMERCIAL'))).toBe(true);
  });
});
