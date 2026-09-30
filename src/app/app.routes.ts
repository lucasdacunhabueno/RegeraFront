import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { autenticadoGuard, perfilGuard } from './core/auth/auth-guards';
import { AuthService } from './core/auth/auth-service';

const emBreve = () => import('./features/em-breve/em-breve-page').then((m) => m.EmBrevePage);

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/login/login-page').then((m) => m.LoginPage) },
  {
    path: '',
    canMatch: [autenticadoGuard],
    loadComponent: () => import('./shared/layout/shell').then((m) => m.Shell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: () => (inject(AuthService).usuario()?.perfil === 'TECNICO' ? 'propostas' : 'kanban'),
      },
      { path: 'kanban', canMatch: [perfilGuard('ADMIN', 'COMERCIAL')], loadComponent: emBreve, data: { titulo: 'Kanban' } },
      { path: 'propostas', loadComponent: emBreve, data: { titulo: 'Propostas' } },
      {
        path: 'clientes/novo',
        canMatch: [perfilGuard('ADMIN', 'COMERCIAL')],
        loadComponent: () => import('./features/clientes/cliente-form-page').then((m) => m.ClienteFormPage),
      },
      {
        path: 'clientes/:id',
        canMatch: [perfilGuard('ADMIN', 'COMERCIAL')],
        loadComponent: () => import('./features/clientes/cliente-form-page').then((m) => m.ClienteFormPage),
      },
      {
        path: 'clientes',
        canMatch: [perfilGuard('ADMIN', 'COMERCIAL')],
        loadComponent: () => import('./features/clientes/clientes-page').then((m) => m.ClientesPage),
      },
      {
        path: 'catalogo',
        canMatch: [perfilGuard('ADMIN', 'COMERCIAL')],
        loadComponent: () => import('./features/catalogo/catalogo-page').then((m) => m.CatalogoPage),
      },
      { path: 'empresa', canMatch: [perfilGuard('ADMIN')], loadComponent: emBreve, data: { titulo: 'Empresa' } },
      {
        path: 'pendencias',
        loadComponent: () => import('./features/pendencias/pendencias-page').then((m) => m.PendenciasPage),
      },
      {
        path: 'usuarios',
        canMatch: [perfilGuard('ADMIN')],
        loadComponent: () => import('./features/usuarios/usuarios-page').then((m) => m.UsuariosPage),
      },
      {
        path: 'usuarios/novo',
        canMatch: [perfilGuard('ADMIN')],
        loadComponent: () => import('./features/usuarios/usuario-form-page').then((m) => m.UsuarioFormPage),
      },
      {
        path: 'usuarios/:id',
        canMatch: [perfilGuard('ADMIN')],
        loadComponent: () => import('./features/usuarios/usuario-form-page').then((m) => m.UsuarioFormPage),
      },
      {
        path: 'perfil/senha',
        loadComponent: () => import('./features/perfil/trocar-senha-page').then((m) => m.TrocarSenhaPage),
      },
      { path: 'mais', loadComponent: () => import('./features/mais/mais-page').then((m) => m.MaisPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
