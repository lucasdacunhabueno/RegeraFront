import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { Perfil } from './auth-models';
import { AuthService } from './auth-service';

export const autenticadoGuard: CanMatchFn = () => {
  const auth = inject(AuthService);
  return auth.autenticado() ? true : inject(Router).createUrlTree(['/login']);
};

export function perfilGuard(...perfis: Perfil[]): CanMatchFn {
  return () => {
    const usuario = inject(AuthService).usuario();
    return usuario && perfis.includes(usuario.perfil) ? true : inject(Router).createUrlTree(['/']);
  };
}
