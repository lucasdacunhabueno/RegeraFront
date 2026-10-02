import { BrowserContext, expect, Page, test } from '@playwright/test';
import {
  abrirApp, ADMIN_EMAIL, ADMIN_SENHA, Api, ArquivoCompartilhado, cadastrarCliente, cnpjAlfanumericoAleatorio, cpfAleatorio,
  interceptarCompartilhamento, ItemE2E, novoContexto, PropostaServidor, recarregarESincronizar, registroNoAparelho, registrosNoAparelho, SENHA_E2E,
  textoDaPagina, TIPOS, UsuarioE2E,
} from './aceite-apoio';
import { semViolacaoCsp, VigiaCsp } from './apoio';

/**
 * Aceite do M1 (§19, §15 E2E), em sequência sobre uma mesma proposta: o admin prepara; o comercial A, sem internet,
 * cadastra clientes PF e PJ (CNPJ alfanumérico), monta a proposta, vê a prévia e envia (PDF com PROV compartilhado);
 * de volta online ela ganha número, o PDF chega ao servidor e o kanban do admin (outro aparelho) a mostra em até 60 s
 * (mais a margem do pull) depois que o servidor a confirma; o técnico T atribuído trabalha pela OS ("Minhas OS",
 * M2-P3), sem nenhum valor (nem os preços do catálogo), sem a proposta e sem PDF; o comercial B não a vê; A não vê custo; e o kanban leva a proposta até FINALIZADA
 * pelo "Mover para…" (Recusar pede o motivo; o comercial não cancela em execução); o PDF abre pelo detalhe. Zero
 * violação de CSP em todos os aparelhos (§8 do plano).
 */
test.describe.serial('aceite do M1: proposta offline do comercial até FINALIZADA', () => {
  const ts = Date.now();
  const nomePf = `PF Aceite ${ts}`;
  const nomePj = `PJ Aceite ${ts}`;
  const cnpj = cnpjAlfanumericoAleatorio();
  const cpf = cpfAleatorio();
  const codigoItem = `ACEITE-${ts}`;
  const nomeItem = `Item Aceite ${ts}`;
  const nomeTemplate = (tipo: string) => `Template Aceite ${tipo} ${ts}`;

  let admin: Api;
  let comercialA: UsuarioE2E;
  let comercialB: UsuarioE2E;
  let tecnico: UsuarioE2E;
  let item: ItemE2E;
  /** A logo da empresa (a existente, se tem; ou a da empresa de teste); null = a empresa existente não tem logo. */
  let logoId: string | null;

  let ctxAdmin: BrowserContext;
  let pageAdmin: Page;
  let cspAdmin: VigiaCsp;
  let ctxA: BrowserContext;
  let pageA: Page;
  let cspA: VigiaCsp;
  let compartilhados: ArquivoCompartilhado[];
  /** A aba da prévia aberta sem internet: só fecha online (fechar um popup offline devolve `onLine = true`). */
  let abaPrevia: Page | undefined;

  let propostaId: string;
  let codigoProvisorio: string;
  let numero: string;
  let arquivoId: string;

  test.beforeAll(async () => {
    admin = await Api.admin();
  });

  test.afterAll(async () => {
    await ctxA?.close();
    await ctxAdmin?.close();
    await admin?.fechar();
  });

  test('1. admin: empresa, usuários dos três perfis, item do catálogo e um template por tipo', async ({ browser }) => {
    test.setTimeout(90_000);
    // pela API: a empresa (a existente fica como está, M8), os dois comerciais, o item e os templates
    logoId = await admin.garantirEmpresa();
    comercialA = await admin.criarUsuario(`Comercial A ${ts}`, `aceite.a.${ts}@regera.local`, 'COMERCIAL');
    comercialB = await admin.criarUsuario(`Comercial B ${ts}`, `aceite.b.${ts}@regera.local`, 'COMERCIAL');
    item = await admin.criarItem(codigoItem, nomeItem, 800, 1250.5);
    for (const tipo of TIPOS) await admin.criarTemplate(nomeTemplate(tipo), tipo);

    // pela tela: o técnico
    ctxAdmin = await novoContexto(browser);
    cspAdmin = await semViolacaoCsp(ctxAdmin);
    pageAdmin = await ctxAdmin.newPage();
    await abrirApp(pageAdmin, ADMIN_EMAIL, ADMIN_SENHA);
    const emailTecnico = `aceite.t.${ts}@regera.local`;
    await pageAdmin.getByRole('link', { name: 'Mais' }).click();
    await pageAdmin.getByRole('link', { name: 'Usuários' }).click();
    await pageAdmin.getByRole('link', { name: 'Novo usuário' }).click();
    await pageAdmin.locator('#nome').fill(`Tecnico T ${ts}`);
    await pageAdmin.locator('#email').fill(emailTecnico);
    await pageAdmin.locator('#perfil').selectOption('TECNICO');
    await pageAdmin.locator('#senha').fill(SENHA_E2E);
    await pageAdmin.getByRole('button', { name: 'Salvar' }).click();
    await expect(pageAdmin).toHaveURL(/\/usuarios$/);
    await expect(pageAdmin.getByRole('listitem').filter({ hasText: emailTecnico })).toBeVisible();
    const t = await admin.usuarioPorEmail(emailTecnico);
    expect(t?.perfil).toBe('TECNICO');
    tecnico = { id: t!.id, nome: t!.nome, email: emailTecnico, senha: SENHA_E2E, perfil: 'TECNICO' };

    // o admin vê o que a API gravou: o item no catálogo e os quatro templates
    await recarregarESincronizar(pageAdmin);
    // M2-P3: no celular o Catálogo fica em "Mais" (a barra inferior tem Kanban, Propostas, OS, Clientes e Mais)
    await pageAdmin.getByRole('link', { name: 'Mais' }).click();
    await pageAdmin.getByRole('link', { name: 'Catálogo' }).click();
    await pageAdmin.getByRole('searchbox', { name: 'Buscar no catálogo' }).fill(codigoItem);
    await expect(pageAdmin.getByRole('listitem').filter({ hasText: codigoItem })).toContainText('1.250,50');
    await pageAdmin.getByRole('link', { name: 'Mais' }).click();
    await pageAdmin.getByRole('link', { name: 'Templates de proposta' }).click();
    for (const tipo of TIPOS) await expect(pageAdmin.getByRole('listitem').filter({ hasText: nomeTemplate(tipo) })).toBeVisible();
    await pageAdmin.getByRole('link', { name: 'Kanban' }).click();
    await expect(pageAdmin.getByRole('heading', { name: 'Kanban' })).toBeVisible();
    await cspAdmin.verificar();
  });

  test('2. comercial A sem internet: clientes PF e PJ alfanumérico, wizard, prévia e envio com PROV compartilhado', async ({ browser }) => {
    test.setTimeout(90_000);
    ctxA = await novoContexto(browser);
    cspA = await semViolacaoCsp(ctxA);
    compartilhados = await interceptarCompartilhamento(ctxA);
    pageA = await ctxA.newPage();
    await abrirApp(pageA, comercialA.email, comercialA.senha);
    // a logo da empresa, se ela tem, fica no aparelho (o PDF offline a usa; o pdfmake não carrega URL)
    if (logoId) {
      const logo = logoId;
      await expect.poll(async () => !!(await registroNoAparelho(pageA, 'arquivos', logo)), { timeout: 30_000 }).toBe(true);
    }

    await ctxA.setOffline(true);
    await expect(pageA.getByTestId('status-conexao')).toHaveText(/Offline/);

    // clientes PF e PJ (CNPJ alfanumérico) sem internet
    await cadastrarCliente(pageA, 'PF', cpf, nomePf);
    await cadastrarCliente(pageA, 'PJ', cnpj, nomePj);
    const pj = pageA.getByRole('listitem').filter({ hasText: nomePj });
    await expect(pj).toContainText('Não sincronizado');
    await expect(pageA.getByRole('listitem').filter({ hasText: nomePf })).toContainText('Não sincronizado');

    // wizard: tipo e cliente
    await pageA.getByRole('link', { name: 'Kanban' }).click();
    await pageA.getByRole('link', { name: 'Nova proposta' }).click();
    await pageA.locator('#tipo-proposta').selectOption('VENDA');
    await pageA.locator('#busca-cliente').fill(nomePj);
    await pageA.getByTestId('escolher-cliente').filter({ hasText: nomePj }).click();
    await expect(pageA.getByTestId('cliente-selecionado')).toContainText(nomePj);
    await pageA.getByTestId('continuar').click();
    await expect(pageA).toHaveURL(/\/propostas\/[0-9a-f-]+\/editar\?passo=2$/);
    propostaId = /\/propostas\/([0-9a-f-]+)\//.exec(pageA.url())![1];

    // itens: 2 × R$ 1.250,50
    await pageA.locator('#busca-catalogo').fill(codigoItem);
    await pageA.getByRole('button', { name: `Adicionar ${nomeItem}` }).click();
    const quantidade = pageA.locator('input[data-campo=quantidade]');
    await expect(quantidade).toBeFocused();
    await quantidade.fill('2');
    await expect(pageA.getByTestId('subtotal')).toHaveText(/2\.501,00/);
    await expect(pageA.getByTestId('custo')).toHaveCount(0);
    await pageA.getByTestId('continuar').click();

    // condições: o template VENDA do teste
    await pageA.locator('#template').selectOption({ label: nomeTemplate('VENDA') });
    await pageA.locator('#prazo-execucao').fill('15 dias úteis');
    await pageA.getByTestId('continuar').click();

    // revisão: a prévia (aba nova no celular) é um PDF de verdade, gerado sem internet
    await expect(pageA.getByRole('heading', { name: 'Revisão' })).toBeVisible();
    await expect(pageA.getByTestId('revisao-cliente')).toContainText(nomePj);
    await expect(pageA.getByTestId('total-total')).toHaveText(/2\.501,00/);
    const aba = pageA.waitForEvent('popup');
    await pageA.getByRole('button', { name: 'Ver prévia' }).click();
    abaPrevia = await aba;
    await expect(pageA.getByText('A prévia foi aberta em uma nova aba.')).toBeVisible({ timeout: 30_000 });
    // a aba recebe o blob do PDF; o "Baixar PDF" ao lado aponta para o mesmo blob, que lemos aqui
    const baixarPrevia = pageA.getByRole('link', { name: 'Baixar PDF' });
    await expect(baixarPrevia).toHaveAttribute('href', /^blob:/);
    await expect(baixarPrevia).toHaveAttribute('download', /^previa-PROV-[0-9A-HJKMNP-TV-Z]{6}\.pdf$/);
    const inicioPrevia = await pageA.evaluate(async (href) => {
      const bytes = new Uint8Array(await (await fetch(href)).arrayBuffer());
      return new TextDecoder().decode(bytes.slice(0, 5));
    }, (await baixarPrevia.getAttribute('href'))!);
    expect(inicioPrevia).toBe('%PDF-');
    expect(compartilhados).toEqual([]);

    // enviar: PDF oficial com PROV, entregue ao Web Share
    await pageA.getByTestId('enviar').click();
    await expect(pageA).toHaveURL(new RegExp(`/propostas/${propostaId}$`), { timeout: 30_000 });
    expect(compartilhados).toHaveLength(1);
    const [pdf] = compartilhados;
    expect(pdf.nome).toMatch(/^Proposta-PROV-[0-9A-HJKMNP-TV-Z]{6}\.pdf$/);
    expect(pdf.tipo).toBe('application/pdf');
    expect(pdf.inicio).toBe('%PDF-');
    expect(pdf.tamanho).toBeGreaterThan(1000);
    codigoProvisorio = pdf.nome.slice('Proposta-'.length, -'.pdf'.length);

    const titulo = pageA.getByRole('heading', { level: 1 });
    await expect(titulo).toHaveText(codigoProvisorio);
    await expect(pageA.locator('[data-status]').first()).toHaveText('Enviada');
    await expect(pageA.locator('[data-selo="nao-sincronizada"]')).toBeVisible();
    await expect(pageA.getByTestId('documentos')).toContainText(codigoProvisorio);
    await expect(pageA.getByTestId('documentos')).toContainText('Aguardando envio');
    expect(await pageA.evaluate(() => navigator.onLine)).toBe(false);
    await cspA.verificar();
  });

  test('3. de volta online: número, ENVIADA, PDF no servidor e o kanban do admin mostra a proposta em até 60 s', async () => {
    test.setTimeout(120_000);
    // o kanban do admin (outro aparelho, aberto desde o passo 1) já filtrado pelo cliente: só o timer de 60 s o atualiza
    await pageAdmin.getByRole('tab', { name: /^Enviada/ }).click();
    await pageAdmin.locator('#busca-kanban').fill(nomePj);
    const cardAdmin = pageAdmin.locator(`[data-coluna="ENVIADA"] [data-proposta="${propostaId}"]`);
    await expect(cardAdmin).toHaveCount(0);

    await ctxA.setOffline(false);
    await abaPrevia?.close();

    // P4c-R17: os 60 s contam da confirmação do servidor (a proposta numerada e ENVIADA lá), não do setOffline: o push
    // de A (refresh, criação, transição e PDF) leva alguns segundos, e o timer do admin tem fase qualquer
    await expect
      .poll(async () => {
        const p = await admin.proposta(propostaId);
        return typeof p?.numero === 'number' && p.status === 'ENVIADA';
      }, { timeout: 30_000, intervals: [250] })
      .toBe(true);
    const confirmadaEm = Date.now();

    // A: o número chega, com a referência ao PROV do PDF
    const titulo = pageA.getByRole('heading', { level: 1 });
    await expect(titulo).toHaveText(new RegExp(`^\\s*\\d{6}\\s*\\(ref\\. ${codigoProvisorio}\\)$`), { timeout: 30_000 });
    numero = /^(\d{6})/.exec((await titulo.innerText()).trim())![1];
    await expect(pageA.locator('[data-selo="nao-sincronizada"]')).toHaveCount(0, { timeout: 30_000 });
    await expect(pageA.getByTestId('documentos')).toContainText('Enviado', { timeout: 30_000 });

    // servidor: ENVIADA, com número, o PDF com o PROV, e os clientes sem duplicar
    let noServidor: PropostaServidor | undefined;
    await expect
      .poll(async () => {
        noServidor = await admin.proposta(propostaId);
        return noServidor?.documentos.length ?? 0;
      }, { timeout: 30_000 })
      .toBe(1);
    expect(noServidor!.status).toBe('ENVIADA');
    expect(String(noServidor!.numero).padStart(6, '0')).toBe(numero);
    expect(noServidor!.codigoProvisorio).toBe(codigoProvisorio);
    expect(noServidor!.documentos[0].codigoExibido).toBe(codigoProvisorio);
    expect(noServidor!.historico.map((h) => h.statusPara)).toEqual(['RASCUNHO', 'ENVIADA']);
    arquivoId = noServidor!.documentos[0].arquivoId;
    expect(await admin.baixarArquivo(arquivoId)).toEqual({ status: 200, inicio: '%PDF-' });
    // os dois clientes chegaram uma vez cada, e o servidor aceitou o CNPJ alfanumérico como foi digitado (§7.2)
    for (const [nome, documento] of [[nomePj, cnpj], [nomePf, cpf]] as const) {
      const locais = await registrosNoAparelho<{ id: string }>(pageA, 'clientes', 'nome', nome);
      expect(locais).toHaveLength(1);
      const cliente = await admin.agregado('cliente', locais[0].id);
      expect(cliente?.dados['nome']).toBe(nome);
      expect(cliente?.dados['documento']).toBe(documento);
    }
    expect((await admin.agregado('cliente', noServidor!.clienteId))?.dados['nome']).toBe(nomePj);

    // A: card em ENVIADA no kanban dele
    await pageA.getByRole('link', { name: 'Kanban' }).click();
    await pageA.getByRole('tab', { name: /^Enviada/ }).click();
    await expect(pageA.locator(`[data-coluna="ENVIADA"] [data-proposta="${propostaId}"]`)).toContainText(numero);

    // admin, outro aparelho, sem recarregar: o `setInterval` de 60 s do agendador do sync (sync-agendador.ts) dispara no
    // máximo 60 s depois da confirmação; os 15 s de margem são o pull dele (o banco local é grande) e a tela
    const PRAZO_DO_TIMER = 60_000;
    const MARGEM_DO_PULL = 15_000;
    await expect(cardAdmin).toBeVisible({ timeout: Math.max(1_000, PRAZO_DO_TIMER + MARGEM_DO_PULL - (Date.now() - confirmadaEm)) });
    await expect(cardAdmin).toContainText(numero);
    await expect(cardAdmin).toContainText(nomePj);
    await expect(cardAdmin).toContainText('2.501,00');
    await cspA.verificar();
    await cspAdmin.verificar();
  });

  test('4. admin atribui o técnico T; T trabalha pela OS ("Minhas OS"), sem nenhum R$ (nem no catálogo), e não abre a proposta nem o PDF', async ({ browser }) => {
    test.setTimeout(90_000);
    await pageAdmin.goto(`/propostas/${propostaId}`);
    await expect(pageAdmin.getByRole('heading', { level: 1 })).toContainText(numero);
    await pageAdmin.getByRole('button', { name: 'Atribuir técnico' }).click();
    await pageAdmin.locator('#tecnico-atribuir').selectOption({ label: tecnico.nome });
    await pageAdmin.getByRole('button', { name: 'Salvar técnico' }).click();
    await expect(pageAdmin.getByTestId('tecnico')).toContainText(tecnico.nome);
    await expect.poll(async () => (await admin.proposta(propostaId))?.tecnicoId, { timeout: 30_000 }).toBe(tecnico.id);

    const ctxT = await novoContexto(browser);
    const cspT = await semViolacaoCsp(ctxT);
    try {
      const pageT = await ctxT.newPage();
      // M2-P3 (M2P3-R1): o técnico cai em "Minhas OS" e não tem mais a lista de propostas; a proposta ainda não tem OS
      await abrirApp(pageT, tecnico.email, tecnico.senha, /\/os$/);
      await expect(pageT.getByRole('heading', { name: 'Minhas OS' })).toBeVisible();
      await expect(pageT.getByText('Nenhuma OS atribuída a você.', { exact: true })).toBeVisible();
      const nav = pageT.getByRole('navigation', { name: 'Navegação inferior' });
      await expect(nav.getByRole('link')).toHaveText(['Minhas OS', 'Mais']);
      expect(await textoDaPagina(pageT)).not.toContain('R$');

      // a proposta (nem a lista, nem o detalhe) não abre para ele: o link direto cai em "Minhas OS"
      for (const rota of ['/propostas', `/propostas/${propostaId}`]) {
        await pageT.goto(rota);
        await expect(pageT).toHaveURL(/\/os$/);
        await expect(pageT.getByRole('heading', { name: 'Minhas OS' })).toBeVisible();
      }
      expect(await textoDaPagina(pageT)).not.toContain('R$');

      // no aparelho do técnico, nenhum valor nem documento; no servidor, o PDF responde 404 para ele
      const local = await registroNoAparelho<{ totalCentavos: number | null; documentos: unknown[]; itens: { precoUnitarioCentavos: number | null }[] }>(
        pageT, 'propostas', propostaId,
      );
      expect(local?.totalCentavos ?? null).toBeNull();
      expect(local?.documentos ?? []).toEqual([]);
      expect((local?.itens ?? []).map((l) => l.precoUnitarioCentavos ?? null).filter((v) => v !== null)).toEqual([]);
      // §19.5: o catálogo do técnico também não tem preço — nem no aparelho, nem no servidor, nem a tela abre
      const itemT = await registroNoAparelho<{ codigo: string; precoVenda: unknown; precoCusto: unknown; precoLocacaoMensal: unknown }>(
        pageT, 'itens', item.id,
      );
      expect(itemT?.codigo).toBe(codigoItem);
      expect(itemT?.precoVenda ?? null).toBeNull();
      expect(itemT?.precoCusto ?? null).toBeNull();
      expect(itemT?.precoLocacaoMensal ?? null).toBeNull();
      await pageT.goto(`/catalogo/${item.id}`);
      await expect(pageT).toHaveURL(/\/os$/);
      expect(await textoDaPagina(pageT)).not.toContain('R$');

      const apiT = await Api.entrar(tecnico.email, tecnico.senha);
      try {
        expect([403, 404]).toContain((await apiT.baixarArquivo(arquivoId)).status);
        const vista = await apiT.proposta(propostaId);
        expect(vista?.documentos).toEqual([]);
        expect(vista?.total).toBeUndefined();
        expect(vista?.itens[0].precoUnitario).toBeUndefined();
        const itemServidor = await apiT.agregado('item_catalogo', item.id);
        expect(itemServidor?.dados['codigo']).toBe(codigoItem);
        for (const campo of ['precoVenda', 'precoCusto', 'precoLocacaoMensal']) expect(itemServidor?.dados).not.toHaveProperty(campo);
      } finally {
        await apiT.fechar();
      }
      await cspT.verificar();
    } finally {
      await ctxT.close();
    }
    await cspAdmin.verificar();
  });

  test('5. comercial B não vê a proposta de A (pull e tela); A não vê custo no catálogo nem na proposta', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctxB = await novoContexto(browser);
    const cspB = await semViolacaoCsp(ctxB);
    try {
      const pageB = await ctxB.newPage();
      await abrirApp(pageB, comercialB.email, comercialB.senha);
      // pull completo de B (o da abertura) sem a proposta; e o servidor nega o agregado a ele
      expect(await registroNoAparelho(pageB, 'propostas', propostaId)).toBeUndefined();
      const apiB = await Api.entrar(comercialB.email, comercialB.senha);
      try {
        expect(await apiB.agregado('proposta', propostaId)).toBeUndefined();
      } finally {
        await apiB.fechar();
      }
      // tela: o kanban e a lista não a mostram, e o link direto não abre
      await pageB.locator('#busca-kanban').fill(nomePj);
      await expect(pageB.locator(`[data-proposta="${propostaId}"]`)).toHaveCount(0);
      await pageB.getByRole('link', { name: 'Propostas' }).click();
      await pageB.locator('#busca-propostas').fill(numero);
      // B é novo e não tem proposta nenhuma: o vazio da lista (não o "Nenhuma proposta encontrada." de uma busca)
      await expect(pageB.getByText('Nenhuma proposta ainda. Crie a primeira em Nova proposta.', { exact: true })).toBeVisible();
      await pageB.goto(`/propostas/${propostaId}`);
      await expect(pageB.getByText('Proposta não encontrada neste aparelho.')).toBeVisible();
      await cspB.verificar();
    } finally {
      await ctxB.close();
    }

    // A: catálogo sem custo (tela, aparelho e servidor) e proposta sem custo; no celular o Catálogo fica em "Mais"
    await pageA.getByRole('link', { name: 'Mais' }).click();
    await pageA.getByRole('link', { name: 'Catálogo' }).click();
    await pageA.getByRole('searchbox', { name: 'Buscar no catálogo' }).fill(codigoItem);
    const linha = pageA.getByRole('listitem').filter({ hasText: codigoItem });
    await expect(linha).toContainText('1.250,50');
    let texto = await textoDaPagina(pageA);
    expect(texto).not.toMatch(/custo/i);
    expect(texto).not.toContain('800,00');
    const itemLocal = await registroNoAparelho<{ precoCusto: unknown; precoVenda: unknown }>(pageA, 'itens', item.id);
    expect(itemLocal?.precoVenda).not.toBeNull();
    expect(itemLocal?.precoCusto ?? null).toBeNull();
    await pageA.goto(`/catalogo/${item.id}`);
    await expect(pageA).toHaveURL(/\/kanban$/);

    await pageA.goto(`/propostas/${propostaId}`);
    await expect(pageA.getByRole('heading', { level: 1 })).toContainText(numero);
    await expect(pageA.getByTestId('itens-cards')).toContainText(nomeItem);
    texto = await textoDaPagina(pageA);
    expect(texto).not.toMatch(/custo/i);
    expect(texto).not.toContain('800,00');
    const propostaLocal = await registroNoAparelho<{ itens: { precoCustoCentavos: number | null }[] }>(pageA, 'propostas', propostaId);
    expect(propostaLocal?.itens.map((l) => l.precoCustoCentavos ?? null)).toEqual([null]);

    const apiA = await Api.entrar(comercialA.email, comercialA.senha);
    try {
      const itemServidor = await apiA.agregado('item_catalogo', item.id);
      expect(itemServidor?.dados['precoVenda']).toBeDefined();
      expect(itemServidor?.dados).not.toHaveProperty('precoCusto');
      const propostaServidor = await apiA.proposta(propostaId);
      expect(propostaServidor?.itens[0]).not.toHaveProperty('precoCusto');
      expect(propostaServidor?.itens[0].precoUnitario).toBeDefined();
    } finally {
      await apiA.fechar();
    }
    await cspA.verificar();
  });

  test('6. kanban no celular: Recusar pede o motivo; ENVIADA → APROVADA → EM_EXECUCAO → FINALIZADA pelo "Mover para…"', async () => {
    test.setTimeout(90_000);
    // abrir o app sincroniza: A recebe a versão com o técnico atribuído pelo admin antes de mover
    await pageA.goto('/kanban');
    await recarregarESincronizar(pageA);
    await pageA.locator('#busca-kanban').fill(numero);

    // §19.6: "Recusada" pelo "Mover para…" pede o motivo; desistir não muda nada (e o motivo digitado não some num
    // toque fora, M10)
    await pageA.getByRole('tab', { name: /^Enviada/ }).click();
    const naEnviada = pageA.locator(`[data-coluna="ENVIADA"] [data-proposta="${propostaId}"]`);
    await naEnviada.getByRole('button', { name: /Mover para…/ }).click();
    await naEnviada.getByRole('menuitem', { name: 'Recusada' }).click();
    const dialogo = pageA.getByRole('dialog', { name: 'Recusar proposta' });
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole('button', { name: 'Recusar', exact: true }).click();
    await expect(dialogo.getByRole('alert')).toHaveText('Informe o motivo (de 3 a 500 caracteres).');
    await dialogo.getByLabel('Motivo').fill('Motivo que não vai ser gravado');
    await pageA.locator('app-dialogo-motivo').click({ position: { x: 8, y: 8 } });
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByLabel('Motivo')).toHaveValue('Motivo que não vai ser gravado');
    await dialogo.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(naEnviada).toBeVisible();
    expect((await registroNoAparelho<{ status: string }>(pageA, 'propostas', propostaId))?.status).toBe('ENVIADA');

    const passos: [string, string, string][] = [
      ['Enviada', 'Aprovada', 'APROVADA'],
      ['Aprovada', 'Em execução', 'EM_EXECUCAO'],
      ['Em execução', 'Finalizada', 'FINALIZADA'],
    ];
    for (const [de, para, status] of passos) {
      await pageA.getByRole('tab', { name: new RegExp(`^${de}`) }).click();
      const card = pageA.locator(`[data-proposta="${propostaId}"]`);
      await expect(card).toContainText(numero);
      await card.getByRole('button', { name: /Mover para…/ }).click();
      if (status === 'FINALIZADA') {
        // §19.6: em execução, só o ADMIN cancela; o comercial tem só "Finalizada"
        await expect(card.getByRole('menuitem')).toHaveText(['Finalizada']);
        await expect(card.getByRole('menuitem', { name: 'Cancelada' })).toHaveCount(0);
      }
      await card.getByRole('menuitem', { name: para }).click();
      await pageA.getByRole('tab', { name: new RegExp(`^${para}`) }).click();
      await expect(pageA.locator(`[data-coluna="${status}"] [data-proposta="${propostaId}"]`)).toBeVisible();
      await expect.poll(async () => (await admin.proposta(propostaId))?.status, { timeout: 30_000 }).toBe(status);
    }

    // FINALIZADA é terminal: o card não tem mais para onde ir
    await expect(pageA.locator(`[data-proposta="${propostaId}"]`).getByRole('button', { name: /Mover para…/ })).toHaveCount(0);
    const final = await admin.proposta(propostaId);
    expect(final!.historico.map((h) => h.statusPara)).toEqual(['RASCUNHO', 'ENVIADA', 'APROVADA', 'EM_EXECUCAO', 'FINALIZADA']);

    // o PDF pelo "Abrir" do detalhe: no celular, numa aba aberta no toque, com "Baixar PDF" ao lado
    await pageA.goto(`/propostas/${propostaId}`);
    const documentos = pageA.getByTestId('documentos');
    await expect(documentos).toContainText(codigoProvisorio);
    const aba = pageA.waitForEvent('popup');
    await documentos.getByRole('button', { name: `Abrir ${codigoProvisorio}` }).click();
    const abaPdf = await aba;
    await expect(documentos.getByText('O PDF foi aberto em uma nova aba.')).toBeVisible({ timeout: 30_000 });
    const baixar = documentos.getByRole('link', { name: 'Baixar PDF' });
    await expect(baixar).toHaveAttribute('download', `Proposta-${codigoProvisorio}.pdf`);
    const inicio = await pageA.evaluate(async (href) => {
      const bytes = new Uint8Array(await (await fetch(href)).arrayBuffer());
      return new TextDecoder().decode(bytes.slice(0, 5));
    }, (await baixar.getAttribute('href'))!);
    expect(inicio).toBe('%PDF-');
    await abaPdf.close();
    await cspA.verificar();
    await cspAdmin.verificar();
  });
});
