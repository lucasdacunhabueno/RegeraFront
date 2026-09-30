import { expect, Page, test } from '@playwright/test';

const EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@regera.local';
const SENHA = process.env['E2E_ADMIN_SENHA'] ?? 'admin-local-123';

async function entrar(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/kanban$/);
}

test('admin cria item do catálogo sem internet e ele sincroniza ao voltar', async ({ page, context }) => {
  await entrar(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.goto('/catalogo');
  await expect(page.getByRole('heading', { name: 'Catálogo' })).toBeVisible();

  const codigo = `E2E-${Date.now()}`;
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Novo item' }).click();
  await expect(page.locator('#foto')).toBeDisabled();
  await page.locator('#codigo').fill(codigo.toLowerCase());
  await page.locator('#nome').fill(`Item ${codigo}`);
  await page.locator('#precoCusto').fill('800');
  await page.locator('#precoVenda').fill('1.250,50');
  await page.getByRole('button', { name: 'Salvar' }).click();

  await expect(page).toHaveURL(/\/catalogo$/);
  const item = page.getByRole('listitem').filter({ hasText: codigo });
  await expect(item).toBeVisible();
  await expect(item).toContainText('R$');
  await expect(item).toContainText('1.250,50');
  await expect(item).toContainText('Não sincronizado');

  await context.setOffline(false);
  await expect(item).not.toContainText('Não sincronizado', { timeout: 30_000 });

  await page.getByRole('searchbox', { name: 'Buscar no catálogo' }).fill(codigo.slice(0, 8).toLowerCase());
  await expect(item).toBeVisible();
});

test('tela da empresa abre para o admin', async ({ page }) => {
  await entrar(page);
  await page.goto('/empresa');
  await expect(page.getByRole('heading', { name: 'Empresa' })).toBeVisible();
  await expect(page.locator('#razaoSocial')).toBeVisible();
});
