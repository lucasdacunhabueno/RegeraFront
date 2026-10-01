import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { autenticadoGuard, perfilGuard } from './core/auth/auth-guards';
import { AuthService } from './core/auth/auth-service';
import { alteracoesGuard } from './core/navegacao/alteracoes-guard';

const wizardProposta = () => import('./features/propostas/wizard-proposta-page').then((m) => m.WizardPropostaPage);

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
      {
        path: 'kanban',
        canMatch: [perfilGuard('ADMIN', 'COMERCIAL')],
        loadComponent: () => import('./features/kanban/kanban-page').then((m) => m.KanbanPage),
      },
      { path: 'propostas', loadComponent: () => import('./features/propostas/propostas-page').then((m) => m.PropostasPage) },
      // ordem do P4c: propostas/nova, propostas/:id/editar, propostas/:id/corrigir, propostas/:id
      {
        path: 'propostas/nova',
        canMatch: [perfilGuard('ADMIN', 'COMERCIAL')],
        canDeactivate: [alteracoesGuard],
        data: { modo: 'rascunho' },
        loadComponent: wizardProposta,
      },
      {
        path: 'propostas/:id/editar',
        canMatch: [perfilGuard('ADMIN', 'COMERCIAL')],
        canDeactivate: [alteracoesGuard],
        data: { modo: 'rascunho' },
        loadComponent: wizardProposta,
      },
      {
        path: 'propostas/:id/corrigir',
        canMatch: [perfilGuard('ADMIN', 'COMERCIAL')],
        canDeactivate: [alteracoesGuard],
        data: { modo: 'corrigir' },
        loadComponent: wizardProposta,
      },
      {
        path: 'propostas/:id',
        loadComponent: () => import('./features/propostas/proposta-detalhe-page').then((m) => m.PropostaDetalhePage),
      },
      {
        path: 'clientes/novo',
        canMatch: [perfilGuard('ADMIN', 'COMERCIAL')],
        canDeactivate: [alteracoesGuard],
        loadComponent: () => import('./features/clientes/cliente-form-page').then((m) => m.ClienteFormPage),
      },
      {
        path: 'clientes/:id',
        canMatch: [perfilGuard('ADMIN', 'COMERCIAL')],
        canDeactivate: [alteracoesGuard],
        loadComponent: () => import('./features/clientes/cliente-form-page').then((m) => m.ClienteFormPage),
      },
      {
        path: 'clientes',
        canMatch: [perfilGuard('ADMIN', 'COMERCIAL')],
        loadComponent: () => import('./features/clientes/clientes-page').then((m) => m.ClientesPage),
      },
      {
        path: 'catalogo/novo',
        canMatch: [perfilGuard('ADMIN')],
        canDeactivate: [alteracoesGuard],
        loadComponent: () => import('./features/catalogo/item-form-page').then((m) => m.ItemFormPage),
      },
      {
        path: 'catalogo/:id',
        canMatch: [perfilGuard('ADMIN')],
        canDeactivate: [alteracoesGuard],
        loadComponent: () => import('./features/catalogo/item-form-page').then((m) => m.ItemFormPage),
      },
      {
        path: 'catalogo',
        canMatch: [perfilGuard('ADMIN', 'COMERCIAL')],
        loadComponent: () => import('./features/catalogo/catalogo-page').then((m) => m.CatalogoPage),
      },
      {
        path: 'templates/novo',
        canMatch: [perfilGuard('ADMIN')],
        canDeactivate: [alteracoesGuard],
        loadComponent: () => import('./features/templates/template-editor-page').then((m) => m.TemplateEditorPage),
      },
      {
        path: 'templates/:id',
        canMatch: [perfilGuard('ADMIN')],
        canDeactivate: [alteracoesGuard],
        loadComponent: () => import('./features/templates/template-editor-page').then((m) => m.TemplateEditorPage),
      },
      {
        path: 'templates',
        canMatch: [perfilGuard('ADMIN')],
        loadComponent: () => import('./features/templates/templates-page').then((m) => m.TemplatesPage),
      },
      {
        path: 'empresa',
        canMatch: [perfilGuard('ADMIN')],
        canDeactivate: [alteracoesGuard],
        loadComponent: () => import('./features/empresa/empresa-page').then((m) => m.EmpresaPage),
      },
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
