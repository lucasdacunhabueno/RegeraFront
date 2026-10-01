import { BrowserContext, expect, Page } from '@playwright/test';

export interface VigiaCsp {
  /** Violações registradas até agora (sem as que só estão no `window.__violacoesCsp` de páginas abertas). */
  registradas(): readonly string[];
  /** Afirma que nenhuma página do contexto (inclusive abas/popups já fechados) teve violação de CSP. */
  verificar(): Promise<void>;
}

/**
 * Coleta as violações da Content-Security-Policy (header do Caddy) em todas as páginas do contexto, inclusive as
 * abertas depois (popups) e depois de reload: um listener de `securitypolicyviolation` injetado via `addInitScript`
 * guarda cada uma em `window.__violacoesCsp` e a repassa ao teste por um binding (o array da página some no reload);
 * o console ("Refused to ... Content Security Policy") pega o que não vira evento. Chame antes do primeiro `goto` e
 * `verificar()` no fim do teste.
 */
export async function semViolacaoCsp(context: BrowserContext): Promise<VigiaCsp> {
  const violacoes: string[] = [];
  const registrar = (descricao: string) => {
    if (!violacoes.includes(descricao)) violacoes.push(descricao);
  };
  await context.exposeBinding('__registrarViolacaoCsp', ({ page }, descricao: string) =>
    registrar(`${page.url()}: ${descricao}`),
  );
  await context.addInitScript(() => {
    const w = window as unknown as {
      __violacoesCsp: string[];
      __registrarViolacaoCsp?: (descricao: string) => Promise<void>;
    };
    w.__violacoesCsp = [];
    document.addEventListener(
      'securitypolicyviolation',
      (e) => {
        const descricao = `${e.effectiveDirective} bloqueou ${e.blockedURI || '(inline)'} (${e.sourceFile}:${e.lineNumber})`;
        w.__violacoesCsp.push(descricao);
        void w.__registrarViolacaoCsp?.(descricao);
      },
      true,
    );
  });
  context.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) registrar(`console ${msg.page()?.url() ?? '?'}: ${msg.text()}`);
  });
  return {
    registradas: () => violacoes,
    async verificar() {
      for (const pagina of context.pages()) {
        if (pagina.isClosed()) continue;
        const naPagina = await pagina
          .evaluate(() => (window as unknown as { __violacoesCsp?: string[] }).__violacoesCsp ?? [])
          .catch(() => [] as string[]);
        for (const descricao of naPagina) {
          if (!violacoes.some((v) => v.endsWith(`: ${descricao}`))) registrar(`${pagina.url()}: ${descricao}`);
        }
      }
      expect(violacoes, 'violações de Content-Security-Policy').toEqual([]);
    },
  };
}

/**
 * Espera a sincronização que o app dispara ao abrir terminar: o `ultimoSync` do Dexie `regera` (tabela `meta`) passa a
 * ser posterior ao carregamento desta página. Ele é gravado em `SyncService.executar`, depois do push e do pull.
 * A espera só deixa o teste determinístico (o que ele faz offline não se mistura com o pull inicial, que leva várias
 * páginas com o banco grande); não esconde mais bug: um `sincronizar()` pedido no meio de uma rodada agenda outra ao
 * fim dela (ver `sync-durante-pull.e2e.ts`).
 */
export async function aguardarSincronizacaoInicial(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const abertura = indexedDB.open('regera');
              abertura.onerror = () => resolve(false);
              abertura.onsuccess = () => {
                const db = abertura.result;
                if (!db.objectStoreNames.contains('meta')) {
                  db.close();
                  resolve(false);
                  return;
                }
                const leitura = db.transaction('meta').objectStore('meta').get('ultimoSync');
                leitura.onsuccess = () => {
                  db.close();
                  const valor = (leitura.result as { valor?: unknown } | undefined)?.valor;
                  resolve(typeof valor === 'string' && valor >= new Date(performance.timeOrigin).toISOString());
                };
                leitura.onerror = () => {
                  db.close();
                  resolve(false);
                };
              };
            }),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}
