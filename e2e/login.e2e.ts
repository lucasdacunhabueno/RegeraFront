import { expect, test } from '@playwright/test';

const EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@regera.local';
const SENHA = process.env['E2E_ADMIN_SENHA'] ?? 'admin-local-123';

async function entrar(page: import('@playwright/test').Page, senha = SENHA) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('senha errada mostra erro e continua no login', async ({ page }) => {
  await entrar(page, 'senha-errada');
  await expect(page.getByRole('alert')).toHaveText('E-mail ou senha incorretos.');
  await expect(page).toHaveURL(/\/login$/);
});

test('admin entra e o app abre sem internet', async ({ page, context }) => {
  await entrar(page);
  await expect(page).toHaveURL(/\/kanban$/);
  await expect(page.getByText('Administrador').first()).toBeVisible();

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByTestId('status-conexao')).toHaveText(/Online/);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByTestId('status-conexao')).toHaveText(/Offline/);
  await expect(page.getByText('Administrador').first()).toBeVisible();
  await expect(page).toHaveURL(/\/kanban$/);
});
