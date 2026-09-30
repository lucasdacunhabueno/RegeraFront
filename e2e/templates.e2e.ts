import { APIRequestContext, devices, expect, Page, test } from '@playwright/test';
import { aguardarSincronizacaoInicial } from './apoio';

const EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@regera.local';
const SENHA = process.env['E2E_ADMIN_SENHA'] ?? 'admin-local-123';
const SENHA_COMERCIAL = 'comercial-e2e-123';

interface TemplateGravado {
  nome: string;
  tipoProposta: string;
  padrao: boolean;
  blocos: { tipo: string; config: unknown }[];
}

async function entrar(page: Page, email = EMAIL, senha = SENHA) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/kanban$/);
}

/** Templates com este nome no IndexedDB do app (o Dexie `regera`), lidos direto pela API do navegador. */
function templatesNoAparelho(page: Page, nome: string): Promise<TemplateGravado[]> {
  return page.evaluate(
    (nome) =>
      new Promise<TemplateGravado[]>((resolve, reject) => {
        const abertura = indexedDB.open('regera');
        abertura.onerror = () => reject(abertura.error);
        abertura.onsuccess = () => {
          const db = abertura.result;
          if (!db.objectStoreNames.contains('templates')) {
            db.close();
            resolve([]);
            return;
          }
          const leitura = db.transaction('templates').objectStore('templates').getAll();
          leitura.onsuccess = () => {
            db.close();
            resolve((leitura.result as TemplateGravado[]).filter((t) => t.nome === nome));
          };
          leitura.onerror = () => {
            db.close();
            reject(leitura.error);
          };
        };
      }),
    nome,
  );
}

/** Cria um usuário COMERCIAL pela API, autenticado como admin. */
async function criarComercial(request: APIRequestContext, email: string) {
  const login = await request.post('/api/auth/login', { data: { email: EMAIL, senha: SENHA } });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = (await login.json()) as { accessToken: string };
  const criacao = await request.post('/api/usuarios', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { nome: 'Comercial E2E', email, perfil: 'COMERCIAL', senha: SENHA_COMERCIAL },
  });
  expect(criacao.status()).toBe(201);
}

test('admin monta template sem internet, gera a prévia offline e o comercial recebe o template', async ({
  page,
  context,
  browser,
  baseURL,
  request,
}) => {
  test.setTimeout(150_000);
  await entrar(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await aguardarSincronizacaoInicial(page);

  const ts = Date.now();
  const nome = `Template E2E ${ts}`;
  await context.setOffline(true);

  // Mais → Templates → Novo template
  await page.getByRole('link', { name: 'Mais' }).click();
  await page.getByRole('link', { name: 'Templates de proposta' }).click();
  await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible();
  await page.getByRole('link', { name: 'Novo template' }).click();
  await expect(page.getByRole('heading', { name: 'Novo template' })).toBeVisible();

  await page.locator('#nome').fill(nome);
  await page.locator('#tipo').selectOption({ label: 'Serviço' });
  await page.locator('#padrao').check();

  // bloco de quebra de página entra no fim; ↑ o põe antes da assinatura
  const tiposDosBlocos = page.getByTestId('bloco-tipo');
  await expect(tiposDosBlocos).toHaveText(['Cabeçalho', 'Texto', 'Itens', 'Totais', 'Assinatura']);
  await page.getByRole('button', { name: '+ Bloco' }).click();
  await page.getByRole('menuitem', { name: 'Quebra de página' }).click();
  await expect(tiposDosBlocos).toHaveText(['Cabeçalho', 'Texto', 'Itens', 'Totais', 'Assinatura', 'Quebra de página']);
  const blocos = page.getByRole('list', { name: 'Blocos do template' }).locator(':scope > li');
  await blocos.last().getByRole('button', { name: 'Mover bloco para cima' }).click();
  await expect(tiposDosBlocos).toHaveText(['Cabeçalho', 'Texto', 'Itens', 'Totais', 'Quebra de página', 'Assinatura']);

  // texto rico: trecho em negrito e a variável do nome do cliente
  await blocos.nth(1).getByTestId('abrir-bloco').click();
  const texto = page.getByRole('textbox', { name: 'Texto do bloco' });
  await texto.click();
  await page.keyboard.type('Proposta ');
  await page.getByRole('button', { name: 'Negrito', exact: true }).click();
  await page.keyboard.type('exclusiva');
  await page.getByRole('button', { name: 'Negrito', exact: true }).click();
  await page.keyboard.type(' para ');
  await page.getByRole('button', { name: 'Inserir variável' }).click();
  await page.getByRole('option', { name: 'Nome do cliente' }).click();
  await expect(texto.locator('strong')).toHaveText('exclusiva');
  await expect(texto.locator('span[data-variavel="cliente.nome"]')).toBeVisible();

  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page).toHaveURL(/\/templates$/);
  const card = page.getByRole('listitem').filter({ hasText: nome });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Serviço');
  await expect(card).toContainText('6 blocos');
  await expect(card).toContainText('Padrão');
  await expect(card).toContainText('Não sincronizado');

  // o que foi gravado no aparelho: ordem dos blocos, negrito e variável no JSON do Tiptap
  const [gravado] = await templatesNoAparelho(page, nome);
  expect(gravado.tipoProposta).toBe('SERVICO');
  expect(gravado.padrao).toBe(true);
  expect(gravado.blocos.map((b) => b.tipo)).toEqual(['CABECALHO', 'TEXTO', 'ITENS', 'TOTAIS', 'QUEBRA_PAGINA', 'ASSINATURA']);
  const conteudo = JSON.stringify(gravado.blocos[1].config);
  expect(conteudo).toContain('"type":"bold"');
  expect(conteudo).toContain('"type":"variavel"');
  expect(conteudo).toContain('"nome":"cliente.nome"');

  // prévia offline no celular: abre em nova aba
  await card.getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Editar template' })).toBeVisible();
  await expect(page.locator('#nome')).toHaveValue(nome);
  const aba = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Gerar prévia' }).click();
  const popup = await aba;
  await expect(page.getByText('A prévia foi aberta em uma nova aba.')).toBeVisible({ timeout: 30_000 });
  // a aba só fecha depois de voltar a internet: fechar um popup com o contexto offline devolve o
  // navigator.onLine=true à página (efeito do Chromium/Playwright), e o app sincronizaria sem rede

  // prévia offline no desktop: iframe com um blob que é um PDF de verdade
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Gerar prévia' }).click();
  const iframe = page.locator('iframe[title="Prévia do PDF"]');
  await expect(iframe).toHaveAttribute('src', /^blob:/, { timeout: 30_000 });
  const inicio = await page.evaluate(async () => {
    const src = document.querySelector<HTMLIFrameElement>('iframe[title="Prévia do PDF"]')!.src;
    const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
    return new TextDecoder().decode(bytes.slice(0, 5));
  });
  expect(inicio).toBe('%PDF-');

  // volta a internet: o selo some
  await page.getByRole('link', { name: '← Templates' }).click();
  await expect(page).toHaveURL(/\/templates$/);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await context.setOffline(false);
  await popup.close();
  await expect(card).not.toContainText('Não sincronizado', { timeout: 30_000 });
  await expect(card).toBeVisible();

  // comercial: recebe o template no pull, mas a tela de templates não abre
  const emailComercial = `comercial.e2e.${ts}@regera.local`;
  await criarComercial(request, emailComercial);
  const outro = await browser.newContext({ ...devices['Pixel 7'], baseURL, ignoreHTTPSErrors: true });
  try {
    const pagina2 = await outro.newPage();
    await entrar(pagina2, emailComercial, SENHA_COMERCIAL);
    await expect.poll(async () => (await templatesNoAparelho(pagina2, nome)).length, { timeout: 30_000 }).toBe(1);

    await pagina2.goto('/templates');
    await expect(pagina2).toHaveURL(/\/kanban$/);
    await expect(pagina2.getByRole('heading', { name: 'Templates' })).toHaveCount(0);
    await pagina2.getByRole('link', { name: 'Mais' }).click();
    await expect(pagina2.getByRole('heading', { name: 'Mais' })).toBeVisible();
    await expect(pagina2.getByRole('link', { name: 'Templates de proposta' })).toHaveCount(0);
  } finally {
    await outro.close();
  }
});
