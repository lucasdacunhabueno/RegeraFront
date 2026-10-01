import { Route } from '@angular/router';
import { routes } from './app.routes';
import { alteracoesGuard } from './core/navegacao/alteracoes-guard';
import { PropostasPage } from './features/propostas/propostas-page';

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

  it('kanban continua só para ADMIN e COMERCIAL', () => {
    expect(rota('kanban')?.canMatch?.length).toBe(1);
  });
});
