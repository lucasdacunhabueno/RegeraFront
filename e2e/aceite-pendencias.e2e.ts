import { readFile } from 'node:fs/promises';
import { expect, Page, test } from '@playwright/test';
import {
  abrirApp, Api, cadastrarCliente, cpfAleatorio, interceptarCompartilhamento, novoContexto, registrosNoAparelho, UsuarioE2E,
} from './aceite-apoio';
import { semViolacaoCsp } from './apoio';

/**
 * Aceite do M1 (§19.4, §11.5): as pendências de sync aparecem e se resolvem pelas ações da tela. Cada teste prepara
 * os próprios usuários, itens e templates (carimbo único), então roda sozinho e em qualquer ordem.
 */

async function irParaPendencias(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Mais' }).click();
  await page.getByRole('link', { name: /Pendências de sync/ }).click();
  await expect(page.getByRole('heading', { name: 'Pendências de sync' })).toBeVisible();
}

test('CPF duplicado: A e B cadastram offline o mesmo CPF; A sincroniza; B resolve com "Usar cadastro existente"', async ({ browser }) => {
  test.setTimeout(90_000);
  const ts = Date.now();
  const cpf = cpfAleatorio();
  const nomeA = `Dup A ${ts}`;
  const nomeB = `Dup B ${ts}`;
  const admin = await Api.admin();
  const a = await admin.criarUsuario(`Comercial Dup A ${ts}`, `dup.a.${ts}@regera.local`, 'COMERCIAL');
  const b = await admin.criarUsuario(`Comercial Dup B ${ts}`, `dup.b.${ts}@regera.local`, 'COMERCIAL');
  const ctxA = await novoContexto(browser);
  const ctxB = await novoContexto(browser);
  const cspA = await semViolacaoCsp(ctxA);
  const cspB = await semViolacaoCsp(ctxB);
  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([abrirApp(pageA, a.email, a.senha), abrirApp(pageB, b.email, b.senha)]);

    await ctxA.setOffline(true);
    await ctxB.setOffline(true);
    await cadastrarCliente(pageA, 'PF', cpf, nomeA);
    await cadastrarCliente(pageB, 'PF', cpf, nomeB);
    const [clienteA] = await registrosNoAparelho<{ id: string }>(pageA, 'clientes', 'nome', nomeA);
    const [clienteB] = await registrosNoAparelho<{ id: string }>(pageB, 'clientes', 'nome', nomeB);

    // B também começa um rascunho para o cliente dele: a proposta depende do cadastro que vai ser trocado
    await pageB.getByRole('link', { name: 'Kanban' }).click();
    await pageB.getByRole('link', { name: 'Nova proposta' }).click();
    await pageB.locator('#busca-cliente').fill(nomeB);
    await pageB.getByTestId('escolher-cliente').filter({ hasText: nomeB }).click();
    await pageB.getByTestId('salvar-rascunho').click();
    await expect(pageB).toHaveURL(/\/propostas\/[0-9a-f-]+$/);
    const propostaB = /\/propostas\/([0-9a-f-]+)$/.exec(pageB.url())![1];

    // A sincroniza primeiro: o cadastro dele é o que fica
    await ctxA.setOffline(false);
    await pageA.getByRole('link', { name: 'Clientes' }).click();
    await expect(pageA.getByRole('listitem').filter({ hasText: nomeA })).not.toContainText('Não sincronizado', { timeout: 30_000 });
    await expect.poll(async () => (await admin.agregado('cliente', clienteA.id))?.dados['nome'], { timeout: 30_000 }).toBe(nomeA);

    // B volta: o servidor recusa o CPF repetido e a pendência oferece o cadastro existente
    await ctxB.setOffline(false);
    await irParaPendencias(pageB);
    const pendencia = pageB.getByRole('listitem').filter({ hasText: nomeB });
    await expect(pendencia).toBeVisible({ timeout: 30_000 });
    await pendencia.getByRole('button', { name: 'Usar cadastro existente' }).click();
    await expect(pageB).toHaveURL(new RegExp(`/clientes/${clienteA.id}$`));
    await expect(pageB.locator('#nome')).toHaveValue(nomeA, { timeout: 30_000 });

    // um cadastro só: o de B saiu do aparelho e nunca chegou ao servidor; o rascunho de B passou para o de A
    expect(await registrosNoAparelho(pageB, 'clientes', 'nome', nomeB)).toEqual([]);
    expect(await admin.agregado('cliente', clienteB.id)).toBeUndefined();
    await expect.poll(async () => (await admin.agregado('proposta', propostaB))?.dados['clienteId'], { timeout: 30_000 }).toBe(clienteA.id);
    await irParaPendencias(pageB);
    await expect(pageB.getByText('Nenhum conflito ou rejeição.')).toBeVisible({ timeout: 30_000 });
    await cspA.verificar();
    await cspB.verificar();
  } finally {
    await ctxA.close();
    await ctxB.close();
    await admin.fechar();
  }
});

test('conflito: dois aparelhos editam o mesmo rascunho offline; o segundo resolve com "Manter a minha"', async ({ browser }) => {
  test.setTimeout(90_000);
  const ts = Date.now();
  const admin = await Api.admin();
  const a: UsuarioE2E = await admin.criarUsuario(`Comercial Conflito ${ts}`, `conflito.${ts}@regera.local`, 'COMERCIAL');
  const item = await admin.criarItem(`CONF-${ts}`, `Item Conflito ${ts}`, 10, 20);
  const template = await admin.criarTemplate(`Template Conflito ${ts}`, 'VENDA');
  const apiA = await Api.entrar(a.email, a.senha);
  const rascunho = await apiA.criarRascunho(a.id, null, template, item);
  await apiA.fechar();
  // criado online, o rascunho já tem número (§11.3): é ele que a tela mostra
  const numero = String((await admin.proposta(rascunho.id))!.numero).padStart(6, '0');

  const ctx1 = await novoContexto(browser);
  const ctx2 = await novoContexto(browser);
  const csp1 = await semViolacaoCsp(ctx1);
  const csp2 = await semViolacaoCsp(ctx2);
  try {
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    await Promise.all([abrirApp(page1, a.email, a.senha), abrirApp(page2, a.email, a.senha)]);

    // os dois aparelhos, sem internet, mudam o prazo do mesmo rascunho
    const editar = async (page: Page, prazo: string) => {
      await page.goto(`/propostas/${rascunho.id}/editar?passo=3`);
      await expect(page.getByRole('heading', { name: 'Condições' })).toBeVisible();
      await page.locator('#prazo-execucao').fill(prazo);
      await page.getByTestId('salvar-rascunho').click();
      await expect(page).toHaveURL(new RegExp(`/propostas/${rascunho.id}$`));
      await expect(page.getByTestId('condicoes')).toContainText(prazo);
      await expect(page.locator('[data-selo="nao-sincronizada"]')).toBeVisible();
    };
    await ctx1.setOffline(true);
    await ctx2.setOffline(true);
    await editar(page1, `Prazo do aparelho 1 ${ts}`);
    await editar(page2, `Prazo do aparelho 2 ${ts}`);

    await ctx1.setOffline(false);
    await expect(page1.locator('[data-selo="nao-sincronizada"]')).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(async () => (await admin.proposta(rascunho.id))?.prazoExecucao, { timeout: 30_000 }).toBe(`Prazo do aparelho 1 ${ts}`);

    // o segundo volta: CONFLITO no detalhe e em Pendências; "Manter a minha" reenvia sobre a versão do servidor
    await ctx2.setOffline(false);
    await expect(page2.getByTestId('pendencia')).toContainText('Conflito', { timeout: 30_000 });
    await irParaPendencias(page2);
    const pendencia = page2.getByRole('listitem').filter({ hasText: `Proposta ${numero}` });
    await expect(pendencia).toContainText('Alterado por outra pessoa enquanto você editava.');
    await pendencia.getByRole('button', { name: 'Manter a minha' }).click();
    await expect(page2.getByText('Nenhum conflito ou rejeição.')).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await admin.proposta(rascunho.id))?.prazoExecucao, { timeout: 30_000 }).toBe(`Prazo do aparelho 2 ${ts}`);

    // o primeiro aparelho recebe a versão que ficou
    await page1.reload();
    await expect(page1.getByTestId('condicoes')).toContainText(`Prazo do aparelho 2 ${ts}`, { timeout: 30_000 });
    await csp1.verificar();
    await csp2.verificar();
  } finally {
    await ctx1.close();
    await ctx2.close();
    await admin.fechar();
  }
});

test('rejeição com envio offline: o item é inativado; "Corrigir e reenviar" troca o item e a proposta fica ENVIADA no servidor', async ({ browser }) => {
  test.setTimeout(90_000);
  const ts = Date.now();
  const nomeCliente = `Cliente Rejeicao ${ts}`;
  const admin = await Api.admin();
  const a = await admin.criarUsuario(`Comercial Rejeicao ${ts}`, `rejeicao.${ts}@regera.local`, 'COMERCIAL');
  const itemX = await admin.criarItem(`REJ-X-${ts}`, `Item Inativado ${ts}`, 50, 100);
  const itemY = await admin.criarItem(`REJ-Y-${ts}`, `Item Substituto ${ts}`, 60, 120);
  const template = `Template Rejeicao ${ts}`;
  await admin.criarTemplate(template, 'VENDA');

  const ctx = await novoContexto(browser);
  const csp = await semViolacaoCsp(ctx);
  // sem Web Share com arquivo: o envio cai no download (§13)
  const compartilhados = await interceptarCompartilhamento(ctx, false);
  try {
    const page = await ctx.newPage();
    await abrirApp(page, a.email, a.senha);

    // sem internet: cliente, proposta com o item X e envio (PDF com PROV baixado)
    await ctx.setOffline(true);
    await cadastrarCliente(page, 'PF', cpfAleatorio(), nomeCliente);
    await page.getByRole('link', { name: 'Kanban' }).click();
    await page.getByRole('link', { name: 'Nova proposta' }).click();
    await page.locator('#busca-cliente').fill(nomeCliente);
    await page.getByTestId('escolher-cliente').filter({ hasText: nomeCliente }).click();
    await page.getByTestId('continuar').click();
    await expect(page).toHaveURL(/\/propostas\/[0-9a-f-]+\/editar\?passo=2$/);
    const propostaId = /\/propostas\/([0-9a-f-]+)\//.exec(page.url())![1];
    await page.locator('#busca-catalogo').fill(itemX.dados.codigo);
    await page.getByRole('button', { name: `Adicionar ${itemX.dados.nome}` }).click();
    await expect(page.getByTestId('subtotal')).toHaveText(/100,00/);
    await page.getByTestId('continuar').click();
    await page.locator('#template').selectOption({ label: template });
    await page.getByTestId('continuar').click();
    await expect(page.getByRole('heading', { name: 'Revisão' })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByTestId('enviar').click();
    const baixado = await download;
    expect(baixado.suggestedFilename()).toMatch(/^Proposta-PROV-[0-9A-HJKMNP-TV-Z]{6}\.pdf$/);
    expect((await readFile(await baixado.path())).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(compartilhados).toEqual([]);
    const codigoProvisorio = baixado.suggestedFilename().slice('Proposta-'.length, -'.pdf'.length);
    await expect(page).toHaveURL(new RegExp(`/propostas/${propostaId}$`));
    await expect(page.locator('[data-status]').first()).toHaveText('Enviada');

    // enquanto A está sem internet, o admin inativa o item usado
    await admin.inativarItem(itemX);

    // A volta: a criação é recusada (item inativo) e o envio fica retido atrás dela
    await ctx.setOffline(false);
    const faixa = page.getByTestId('pendencia');
    await expect(faixa).toContainText('O servidor recusou', { timeout: 30_000 });
    await expect(faixa).toContainText('Item do catálogo inativo ou não encontrado.');
    expect(await admin.proposta(propostaId)).toBeUndefined();
    await irParaPendencias(page);
    const pendencia = page.getByRole('listitem').filter({ hasText: `Proposta ${codigoProvisorio}` });
    await expect(pendencia).toBeVisible();
    await pendencia.getByTestId('corrigir').click();

    // correção: troca o item X pelo Y e reenvia
    await expect(page).toHaveURL(new RegExp(`/propostas/${propostaId}/corrigir$`));
    await expect(page.getByRole('heading', { name: 'Corrigir proposta' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Itens', level: 2 })).toBeVisible();
    await page.getByRole('button', { name: `Remover ${itemX.dados.nome}` }).click();
    await page.locator('#busca-catalogo').fill(itemY.dados.codigo);
    await page.getByRole('button', { name: `Adicionar ${itemY.dados.nome}` }).click();
    await expect(page.getByTestId('subtotal')).toHaveText(/120,00/);
    await page.getByTestId('salvar-rascunho').click();
    await expect(page).toHaveURL(new RegExp(`/propostas/${propostaId}$`));

    // servidor: ENVIADA, com número, o item Y e o PDF; no aparelho, sem pendência e com o número
    await expect
      .poll(async () => {
        const p = await admin.proposta(propostaId);
        return p ? { status: p.status, temNumero: typeof p.numero === 'number', docs: p.documentos.length } : null;
      }, { timeout: 30_000 })
      .toEqual({ status: 'ENVIADA', temNumero: true, docs: 1 });
    const final = (await admin.proposta(propostaId))!;
    expect(final.itens.map((l) => l.itemCatalogoId)).toEqual([itemY.id]);
    expect(final.documentos[0].codigoExibido).toBe(codigoProvisorio);
    expect(await admin.baixarArquivo(final.documentos[0].arquivoId)).toEqual({ status: 200, inicio: '%PDF-' });
    const numero = String(final.numero).padStart(6, '0');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(numero, { timeout: 30_000 });
    await expect(page.getByTestId('pendencia')).toHaveCount(0);
    await csp.verificar();
  } finally {
    await ctx.close();
    await admin.fechar();
  }
});
