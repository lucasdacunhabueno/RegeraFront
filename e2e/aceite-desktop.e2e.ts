import { expect, test } from '@playwright/test';
import {
  abrirApp, Api, cpfAleatorio, interceptarCompartilhamento, novoContextoDesktop,
} from './aceite-apoio';
import { semViolacaoCsp } from './apoio';

/**
 * Aceite do M1 no desktop (§13, M7 da revisão final do P4c): 1280 px com mouse (ponteiro fino), sob a CSP aplicada.
 * Prepara pela API um rascunho do comercial (carimbo único) e, pela tela: envia com o navegador recusando o primeiro
 * compartilhamento (o painel "PDF pronto" pede o toque, P4c-R8); abre o PDF no iframe do detalhe; e, no kanban com as
 * encerradas à mostra, confere que a página não rola para o lado e arrasta o card de Enviada para Aprovada.
 */
test('desktop 1280 px: envio pelo painel "PDF pronto", PDF no iframe do detalhe e kanban sem rolagem lateral com arrastar', async ({ browser }) => {
  test.setTimeout(90_000);
  const ts = Date.now();
  const admin = await Api.admin();
  const comercial = await admin.criarUsuario(`Comercial Desktop ${ts}`, `desktop.${ts}@regera.local`, 'COMERCIAL');
  const item = await admin.criarItem(`DESK-${ts}`, `Item Desktop ${ts}`, 40, 321.5);
  const template = await admin.criarTemplate(`Template Desktop ${ts}`, 'VENDA');
  const apiC = await Api.entrar(comercial.email, comercial.senha);
  const clienteId = await apiC.criarClientePf(`Cliente Desktop ${ts}`, cpfAleatorio());
  const rascunho = await apiC.criarRascunho(comercial.id, clienteId, template, item);
  await apiC.fechar();
  // criado online, o rascunho já tem número (§11.3): é o código do PDF
  const numero = String((await admin.proposta(rascunho.id))!.numero).padStart(6, '0');

  const ctx = await novoContextoDesktop(browser);
  const csp = await semViolacaoCsp(ctx);
  // o primeiro share recusa com NotAllowedError, como o navegador depois de uma geração demorada (sem gesto)
  const compartilhados = await interceptarCompartilhamento(ctx, true, 1);
  try {
    const page = await ctx.newPage();
    await abrirApp(page, comercial.email, comercial.senha);

    // envio: o detalhe leva ao passo 4 do wizard; o share recusado vira o painel "PDF pronto"
    await page.goto(`/propostas/${rascunho.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(numero);
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/propostas/${rascunho.id}/editar\\?passo=4$`));
    await page.getByTestId('enviar').click();
    const painel = page.getByRole('dialog', { name: 'PDF pronto' });
    await expect(painel).toBeVisible({ timeout: 30_000 });
    await expect(painel).toContainText(`Proposta-${numero}.pdf`);
    expect(compartilhados).toEqual([]);
    // o toque no painel chama o share de novo, agora dentro do gesto: compartilha e vai ao detalhe
    await painel.getByRole('button', { name: 'Compartilhar' }).click();
    await expect(page).toHaveURL(new RegExp(`/propostas/${rascunho.id}$`), { timeout: 30_000 });
    expect(compartilhados).toHaveLength(1);
    expect(compartilhados[0]).toMatchObject({ nome: `Proposta-${numero}.pdf`, tipo: 'application/pdf', inicio: '%PDF-' });
    await expect(page.locator('[data-status]').first()).toHaveText('Enviada');

    // M1: o Voltar não passa pelo wizard da proposta já enviada (a saída trocou a entrada do histórico)
    const urls: string[] = [];
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) urls.push(f.url());
    });
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(numero);
    expect(urls.filter((u) => u.includes('/editar'))).toEqual([]);

    // "Abrir" no desktop: o PDF num iframe do próprio detalhe (blob:, sob a CSP aplicada)
    const documentos = page.getByTestId('documentos');
    await expect(documentos).toContainText('Enviado', { timeout: 30_000 });
    await documentos.getByRole('button', { name: `Abrir ${numero}` }).click();
    const iframe = documentos.locator(`iframe[title="PDF ${numero}"]`);
    await expect(iframe).toBeVisible({ timeout: 30_000 });
    await expect(iframe).toHaveAttribute('src', /^blob:/);
    await expect.poll(async () => (await admin.proposta(rascunho.id))?.status, { timeout: 30_000 }).toBe('ENVIADA');

    // kanban em colunas, com as encerradas: o quadro rola por dentro, a página não rola para o lado
    await page.goto('/kanban');
    await expect(page.getByRole('heading', { name: 'Kanban' })).toBeVisible();
    await page.getByRole('button', { name: 'Mostrar encerradas' }).click();
    for (const status of ['RASCUNHO', 'ENVIADA', 'APROVADA', 'EM_EXECUCAO', 'FINALIZADA', 'RECUSADA', 'CANCELADA']) {
      await expect(page.locator(`section[data-coluna="${status}"]`)).toHaveCount(1);
    }
    await expect(page.getByRole('tablist')).toHaveCount(0);
    const semRolagemLateral = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await semRolagemLateral()).toBe(true);
    await page.locator('#busca-kanban').fill(numero);
    const card = page.locator(`[data-coluna="ENVIADA"] [data-proposta="${rascunho.id}"]`);
    await expect(card).toBeVisible();
    expect(await semRolagemLateral()).toBe(true);

    // arrastar com o mouse para Aprovada (destino permitido): o card muda de coluna e o servidor recebe a transição
    const alvo = page.locator('[data-coluna="APROVADA"] ul');
    await alvo.scrollIntoViewIfNeeded();
    const de = (await card.boundingBox())!;
    const para = (await alvo.boundingBox())!;
    await page.mouse.move(de.x + de.width / 2, de.y + 16);
    await page.mouse.down();
    await page.mouse.move(de.x + de.width / 2 + 12, de.y + 28, { steps: 4 });
    await page.mouse.move(para.x + para.width / 2, para.y + 40, { steps: 20 });
    await page.mouse.move(para.x + para.width / 2, para.y + 48, { steps: 2 });
    await page.mouse.up();
    await expect(page.locator(`[data-coluna="APROVADA"] [data-proposta="${rascunho.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-coluna="ENVIADA"] [data-proposta="${rascunho.id}"]`)).toHaveCount(0);
    await expect(page).toHaveURL(/\/kanban$/);
    await expect.poll(async () => (await admin.proposta(rascunho.id))?.status, { timeout: 30_000 }).toBe('APROVADA');
    expect(await semRolagemLateral()).toBe(true);
    await csp.verificar();
  } finally {
    await ctx.close();
    await admin.fechar();
  }
});
