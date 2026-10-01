import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CanMatchFn, provideRouter, Route, UrlTree } from '@angular/router';
import type { Perfil } from './core/auth/auth-models';
import { AuthService } from './core/auth/auth-service';
import { routes } from './app.routes';
import { alteracoesGuard } from './core/navegacao/alteracoes-guard';
import { PropostaDetalhePage } from './features/propostas/proposta-detalhe-page';
import { PropostasPage } from './features/propostas/propostas-page';
import { WizardPropostaPage } from './features/propostas/wizard-proposta-page';

const filhas = (routes.find((r) => r.path === '' && r.children)?.children ?? []) as Route[];
const rota = (path: string) => filhas.find((r) => r.path === path);

describe('app.routes', () => {
  it.each(['templates/novo', 'templates/:id', 'catalogo/novo', 'catalogo/:id', 'clientes/novo', 'clientes/:id', 'empresa'])(
    '%s avisa das alterações não salvas ao sair',
    (path) => {
      expect(rota(path)?.canDeactivate).toContain(alteracoesGuard);
    },
  );

  it('rotas específicas de templates antes da genérica, todas só para ADMIN', () => {
    const ordem = filhas.map((r) => r.path);
    expect(ordem.indexOf('templates/novo')).toBeLessThan(ordem.indexOf('templates'));
    expect(ordem.indexOf('templates/:id')).toBeLessThan(ordem.indexOf('templates'));
    for (const p of ['templates/novo', 'templates/:id', 'templates']) expect(rota(p)?.canMatch?.length).toBe(1);
  });

  it('/propostas: lazy, para os três perfis (sem canMatch próprio), a página de propostas', async () => {
    const r = rota('propostas')!;
    expect(r.canMatch).toBeUndefined();
    expect(r.component).toBeUndefined();
    const componente = await (r.loadComponent as () => Promise<unknown>)();
    expect(componente).toBe(PropostasPage);
  });

  it.each(['propostas/nova', 'propostas/:id/editar'])('%s: wizard lazy em modo rascunho, ADMIN e COMERCIAL, com aviso ao sair', async (path) => {
    const r = rota(path)!;
    expect(r.canMatch?.length).toBe(1);
    expect(r.canDeactivate).toContain(alteracoesGuard);
    expect(r.data?.['modo']).toBe('rascunho');
    expect(await (r.loadComponent as () => Promise<unknown>)()).toBe(WizardPropostaPage);
  });

  it.each(['propostas/nova', 'propostas/:id/editar'])('%s: entram ADMIN e COMERCIAL; o técnico e sem sessão, não', (path) => {
    const guard = rota(path)!.canMatch![0] as CanMatchFn;
    const passa = (perfil: Perfil | null) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideRouter([]), { provide: AuthService, useValue: { usuario: signal(perfil ? { id: 'u', perfil } : null) } }],
      });
      return TestBed.runInInjectionContext(() => guard({} as Route, [], {} as never));
    };
    expect(passa('ADMIN')).toBe(true);
    expect(passa('COMERCIAL')).toBe(true);
    expect(passa('TECNICO')).toBeInstanceOf(UrlTree);
    expect(passa(null)).toBeInstanceOf(UrlTree);
  });

  it('propostas/:id/corrigir: o wizard em modo correção (P4c-R4), ADMIN e COMERCIAL, com aviso ao sair', async () => {
    const r = rota('propostas/:id/corrigir')!;
    expect(r.data?.['modo']).toBe('corrigir');
    expect(r.canDeactivate).toContain(alteracoesGuard);
    expect(await (r.loadComponent as () => Promise<unknown>)()).toBe(WizardPropostaPage);
    const guard = r.canMatch![0] as CanMatchFn;
    const passa = (perfil: Perfil) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideRouter([]), { provide: AuthService, useValue: { usuario: signal({ id: 'u', perfil }) } }],
      });
      return TestBed.runInInjectionContext(() => guard({} as Route, [], {} as never));
    };
    expect(passa('ADMIN')).toBe(true);
    expect(passa('COMERCIAL')).toBe(true);
    expect(passa('TECNICO')).toBeInstanceOf(UrlTree);
  });

  it('a ordem do P4c: propostas/nova, propostas/:id/editar, propostas/:id/corrigir, propostas/:id', () => {
    const ordem = filhas.map((r) => r.path);
    const posicoes = ['propostas/nova', 'propostas/:id/editar', 'propostas/:id/corrigir', 'propostas/:id'].map((p) => ordem.indexOf(p));
    expect(posicoes.every((i) => i > -1)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
  });

  it('/propostas/:id: o detalhe lazy, para os três perfis (sem canMatch)', async () => {
    const r = rota('propostas/:id')!;
    expect(r.canMatch).toBeUndefined();
    expect(r.component).toBeUndefined();
    expect(await (r.loadComponent as () => Promise<unknown>)()).toBe(PropostaDetalhePage);
  });

  it('kanban continua só para ADMIN e COMERCIAL', () => {
    expect(rota('kanban')?.canMatch?.length).toBe(1);
  });
});
