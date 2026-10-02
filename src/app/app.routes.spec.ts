import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CanMatchFn, provideRouter, Route, Router, RouterOutlet, Routes, UrlTree } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Perfil } from './core/auth/auth-models';
import { AuthService } from './core/auth/auth-service';
import { routes } from './app.routes';
import { alteracoesGuard } from './core/navegacao/alteracoes-guard';
import { KanbanPage } from './features/kanban/kanban-page';
import { OsExecucaoPage } from './features/os/os-execucao-page';
import { OsListaPage } from './features/os/os-lista-page';
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

  /** O `canMatch` da rota com o usuário `perfil` (null = sem sessão): true ou o UrlTree do desvio. */
  const passaNo = (path: string, perfil: Perfil | null) => {
    const guard = rota(path)!.canMatch![0] as CanMatchFn;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { usuario: signal(perfil ? { id: 'u', perfil } : null) } }],
    });
    return TestBed.runInInjectionContext(() => guard({} as Route, [], {} as never));
  };

  it.each([
    ['propostas', PropostasPage],
    ['propostas/:id', PropostaDetalhePage],
  ])('M2-P3: %s é lazy e só do ADMIN e do COMERCIAL (o técnico trabalha pela OS)', async (path, pagina) => {
    const r = rota(path)!;
    expect(r.component).toBeUndefined();
    expect(await (r.loadComponent as () => Promise<unknown>)()).toBe(pagina);
    expect(r.canMatch?.length).toBe(1);
    expect(passaNo(path, 'ADMIN')).toBe(true);
    expect(passaNo(path, 'COMERCIAL')).toBe(true);
    expect(passaNo(path, 'TECNICO')).toBeInstanceOf(UrlTree);
    expect(passaNo(path, null)).toBeInstanceOf(UrlTree);
  });

  it('M2-P3: /os é lazy e de todos os perfis (sem canMatch próprio: a página filtra o que cada um vê)', async () => {
    const r = rota('os')!;
    expect(r.canMatch).toBeUndefined();
    expect(r.component).toBeUndefined();
    expect(await (r.loadComponent as () => Promise<unknown>)()).toBe(OsListaPage);
  });

  it('M2-P3: /os/:id é lazy e de todos os perfis (a página mostra a execução ou a leitura conforme o perfil)', async () => {
    const r = rota('os/:id')!;
    expect(r.canMatch).toBeUndefined();
    expect(r.component).toBeUndefined();
    expect(await (r.loadComponent as () => Promise<unknown>)()).toBe(OsExecucaoPage);
  });

  it('M2-P3: as rotas específicas da OS (os/nova, os/:id/editar, da T4) vêm antes de os/:id', () => {
    const ordem = filhas.map((r) => r.path);
    const generica = ordem.indexOf('os/:id');
    expect(generica).toBeGreaterThan(ordem.indexOf('os'));
    for (const especifica of ['os/nova', 'os/:id/editar']) {
      const i = ordem.indexOf(especifica);
      if (i > -1) expect(i).toBeLessThan(generica);
    }
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

  it('/kanban: o kanban lazy, só para ADMIN e COMERCIAL (o técnico e sem sessão voltam para a raiz)', async () => {
    const r = rota('kanban')!;
    expect(r.component).toBeUndefined();
    expect(await (r.loadComponent as () => Promise<unknown>)()).toBe(KanbanPage);
    expect(r.canMatch?.length).toBe(1);
    const guard = r.canMatch![0] as CanMatchFn;
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

  it('a raiz: o técnico cai em /os (M2-P3); ADMIN e COMERCIAL, no kanban', () => {
    const raiz = filhas.find((r) => r.path === '' && r.redirectTo)!;
    const destino = (perfil: Perfil) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: { usuario: signal({ id: 'u', perfil }) } }] });
      return TestBed.runInInjectionContext(() => (raiz.redirectTo as () => string)());
    };
    expect(destino('TECNICO')).toBe('os');
    expect(destino('ADMIN')).toBe('kanban');
    expect(destino('COMERCIAL')).toBe('kanban');
  });

  it('clientes/:id (e a seção "Propostas do cliente") não abre para o técnico', () => {
    const guard = rota('clientes/:id')!.canMatch![0] as CanMatchFn;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { usuario: signal({ id: 'u', perfil: 'TECNICO' }) } }],
    });
    expect(TestBed.runInInjectionContext(() => guard({} as Route, [], {} as never))).toBeInstanceOf(UrlTree);
  });

  describe('navegação de verdade (guards, redirecionamentos e ordem das rotas reais; as telas trocadas por um esboço)', () => {
    @Component({ selector: 'app-esboco', imports: [RouterOutlet], template: '<router-outlet />' })
    class Esboco {}

    /** As rotas reais com cada `loadComponent` trocado pelo esboço: valem os guards, os redirecionamentos e a ordem. */
    const semTelas = (lista: Routes): Routes =>
      lista.map((r) => ({
        ...r,
        ...(r.loadComponent ? { loadComponent: () => Promise.resolve(Esboco) } : {}),
        ...(r.children ? { children: semTelas(r.children) } : {}),
      }));

    async function navegar(perfil: Perfil, url: string): Promise<string> {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter(semTelas(routes)),
          { provide: AuthService, useValue: { autenticado: () => true, usuario: signal({ id: 'u', perfil }) } },
        ],
      });
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl(url);
      return TestBed.inject(Router).url;
    }

    it('o técnico que abre um link /propostas/x é recusado e cai em Minhas OS', async () => {
      expect(await navegar('TECNICO', '/propostas/0198a1b2-0000-7000-8000-000000000001')).toBe('/os');
      expect(await navegar('TECNICO', '/propostas')).toBe('/os');
      expect(await navegar('TECNICO', '/propostas/x/editar')).toBe('/os');
    });

    it('a raiz e /os por perfil; o escritório abre a proposta', async () => {
      expect(await navegar('TECNICO', '/')).toBe('/os');
      expect(await navegar('TECNICO', '/os')).toBe('/os');
      expect(await navegar('ADMIN', '/')).toBe('/kanban');
      expect(await navegar('COMERCIAL', '/os')).toBe('/os');
      expect(await navegar('COMERCIAL', '/propostas/x')).toBe('/propostas/x');
      expect(await navegar('ADMIN', '/propostas')).toBe('/propostas');
    });

    it('a OS (/os/:id) abre para todos os perfis', async () => {
      const id = '0198a1b2-0000-7000-8000-000000000001';
      for (const perfil of ['TECNICO', 'ADMIN', 'COMERCIAL'] as Perfil[]) {
        expect(await navegar(perfil, `/os/${id}`)).toBe(`/os/${id}`);
      }
    });
  });
});
