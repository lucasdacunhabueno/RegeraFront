import { devices, expect, Page, test } from '@playwright/test';
import { aguardarSincronizacaoInicial } from './apoio';

const EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@regera.local';
const SENHA = process.env['E2E_ADMIN_SENHA'] ?? 'admin-local-123';

function cpfAleatorio(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (base.every((d) => d === base[0])) base[0] = (base[0] + 1) % 10;
  const dv = (nums: number[], pesoInicial: number) => {
    const resto = nums.reduce((acc, n, i) => acc + n * (pesoInicial - i), 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = dv(base, 10);
  const d2 = dv([...base, d1], 11);
  return [...base, d1, d2].join('');
}

async function entrar(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/kanban$/);
}

test('cliente criado sem internet sincroniza ao voltar e aparece em outro aparelho', async ({ page, context, browser, baseURL }) => {
  await entrar(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await aguardarSincronizacaoInicial(page);
  await page.goto('/clientes');
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();

  const nome = `Cliente E2E ${Date.now()}`;
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Novo cliente' }).click();
  await page.locator('#documento').fill(cpfAleatorio());
  await page.locator('#nome').fill(nome);
  await page.getByRole('button', { name: 'Salvar' }).click();

  const item = page.getByRole('listitem').filter({ hasText: nome });
  await expect(item).toBeVisible();
  await expect(item).toContainText('Não sincronizado');

  await context.setOffline(false);
  await expect(item).not.toContainText('Não sincronizado', { timeout: 30_000 });
  await expect(item).toBeVisible();

  const outro = await browser.newContext({ ...devices['Pixel 7'], baseURL, ignoreHTTPSErrors: true });
  try {
    const pagina2 = await outro.newPage();
    await entrar(pagina2);
    await pagina2.goto('/clientes');
    await pagina2.getByRole('searchbox', { name: 'Buscar clientes' }).fill(nome);
    await expect(pagina2.getByText(nome)).toBeVisible({ timeout: 30_000 });
  } finally {
    await outro.close();
  }
});
