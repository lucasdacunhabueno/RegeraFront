import { expect, Page, test } from '@playwright/test';
import { aguardarSincronizacaoInicial, semViolacaoCsp } from './apoio';

const EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@regera.local';
const SENHA = process.env['E2E_ADMIN_SENHA'] ?? 'admin-local-123';

async function entrar(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  // bcrypt no login: com os outros testes em paralelo, passa dos 5 s padrão (ver `entrar` em aceite-apoio.ts)
  await expect(page).toHaveURL(/\/kanban$/, { timeout: 30_000 });
}

test('item salvo enquanto o pull está em curso sincroniza ao fim da rodada, sem esperar o timer', async ({ page, context }) => {
  const csp = await semViolacaoCsp(context);
  await entrar(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await aguardarSincronizacaoInicial(page);

  // segura o primeiro pull da próxima abertura do app; `context.route` porque, com o service worker no controle,
  // quem faz a requisição de rede é ele (o `page.route` não a vê)
  let liberar!: () => void;
  const liberado = new Promise<void>((r) => (liberar = r));
  let avisarSegurado!: () => void;
  const segurado = new Promise<void>((r) => (avisarSegurado = r));
  let primeiro = true;
  await context.route('**/api/sync/pull**', async (route) => {
    if (primeiro) {
      primeiro = false;
      avisarSegurado();
      await liberado;
    }
    await route.continue();
  });

  try {
    await page.goto('/catalogo');
    await expect(page.getByRole('heading', { name: 'Catálogo' })).toBeVisible();
    await segurado;

    const codigo = `PULL-${Date.now()}`;
    await page.getByRole('link', { name: 'Novo item' }).click();
    await page.locator('#codigo').fill(codigo);
    await page.locator('#nome').fill(`Item ${codigo}`);
    await page.locator('#precoVenda').fill('10,00');
    await page.getByRole('button', { name: 'Salvar' }).click();

    await expect(page).toHaveURL(/\/catalogo$/);
    const item = page.getByRole('listitem').filter({ hasText: codigo });
    await expect(item).toContainText('Não sincronizado');

    liberar();
    // bem abaixo dos 60 s do timer: a rodada pedida no meio da anterior roda assim que ela termina
    await expect(item).not.toContainText('Não sincronizado', { timeout: 20_000 });
  } finally {
    liberar();
    await context.unroute('**/api/sync/pull**');
  }
  await csp.verificar();
});
