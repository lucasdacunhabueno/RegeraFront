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
      { path: 'clientes', canMatch: [perfilGuard('ADMIN', 'COMERCIAL')], loadComponent: emBreve, data: { titulo: 'Clientes' } },
      { path: 'catalogo', canMatch: [perfilGuard('ADMIN', 'COMERCIAL')], loadComponent: emBreve, data: { titulo: 'Catálogo' } },
      { path: 'empresa', canMatch: [perfilGuard('ADMIN')], loadComponent: emBreve, data: { titulo: 'Empresa' } },
      { path: 'pendencias', loadComponent: emBreve, data: { titulo: 'Pendências de sync' } },
      // Placeholders preenchidos na Task 10.
      { path: 'usuarios', canMatch: [perfilGuard('ADMIN')], loadComponent: emBreve, data: { titulo: 'Usuários' } },
      { path: 'usuarios/novo', canMatch: [perfilGuard('ADMIN')], loadComponent: emBreve, data: { titulo: 'Novo usuário' } },
      { path: 'usuarios/:id', canMatch: [perfilGuard('ADMIN')], loadComponent: emBreve, data: { titulo: 'Usuário' } },
      { path: 'perfil/senha', loadComponent: emBreve, data: { titulo: 'Trocar senha' } },
      { path: 'mais', loadComponent: () => import('./features/mais/mais-page').then((m) => m.MaisPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
