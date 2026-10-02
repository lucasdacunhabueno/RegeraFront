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

test('admin cria item do catálogo sem internet e ele sincroniza ao voltar', async ({ page, context }) => {
  const csp = await semViolacaoCsp(context);
  await entrar(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await aguardarSincronizacaoInicial(page);
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
  await csp.verificar();
});

// PNG 8x8 RGBA: metade azul opaca, metade transparente (o JPEG do upload precisa sair com fundo branco)
const PNG_TRANSPARENTE =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGOQ9bvxHxkzoIORoQAAU1FIQaOqvhEAAAAASUVORK5CYII=';

test('admin cria item com foto online e a lista mostra a imagem', async ({ page, context }) => {
  const csp = await semViolacaoCsp(context);
  await entrar(page);
  await page.goto('/catalogo');
  await expect(page.getByRole('heading', { name: 'Catálogo' })).toBeVisible();
  await page.getByRole('link', { name: 'Novo item' }).click();
  await expect(page.getByRole('heading', { name: 'Novo item' })).toBeVisible();

  const codigo = `FOTO-${Date.now()}`;
  await page.locator('#foto').setInputFiles({
    name: 'item.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_TRANSPARENTE, 'base64'),
  });
  // upload concluído: a pré-visualização aparece e o campo volta a aceitar arquivo
  await expect(page.getByAltText('Foto do item')).toHaveAttribute('src', /^blob:/, { timeout: 30_000 });
  await expect(page.locator('#foto')).toBeEnabled();

  await page.locator('#codigo').fill(codigo);
  await page.locator('#nome').fill(`Item ${codigo}`);
  await page.locator('#precoVenda').fill('99,90');
  await page.getByRole('button', { name: 'Salvar' }).click();

  await expect(page).toHaveURL(/\/catalogo$/);
  const item = page.getByRole('listitem').filter({ hasText: codigo });
  await expect(item).toBeVisible();
  await expect(item.locator('img')).toHaveAttribute('src', /^blob:/);
  await csp.verificar();
});

test('tela da empresa abre para o admin', async ({ page, context }) => {
  const csp = await semViolacaoCsp(context);
  await entrar(page);
  await page.goto('/empresa');
  await expect(page.getByRole('heading', { name: 'Empresa' })).toBeVisible();
  await expect(page.locator('#razaoSocial')).toBeVisible();
  await csp.verificar();
});
