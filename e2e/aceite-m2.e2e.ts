import { BrowserContext, expect, Page, test } from '@playwright/test';
import {
  abrirApp, ADMIN_EMAIL, ADMIN_SENHA, Api, ArquivoCompartilhado, assinarNaTela, codigoOs, cpfAleatorio, EnderecoE2E,
  interceptarCompartilhamento, ItemE2E, jpegDeTeste, novoContexto, OsServidor, recarregarESincronizar, registroNoAparelho,
  textoDaPagina, tirarFoto, UsuarioE2E,
} from './aceite-apoio';
import { semViolacaoCsp, VigiaCsp } from './apoio';

/**
 * Aceite do M2 (spec M2 §10, §14), em sequência sobre os mesmos dados (carimbo único; nada aqui olha para o que o teste
 * não criou — o banco local tem os dados reais do ensaio do SIGEM):
 * 1. o admin gera a OS da proposta aprovada (criada pela API) — "Esta OS conclui a proposta?" marcado (Q17) — e
 *    atribui o técnico T;
 * 2. T, em modo avião, inicia, anota, tira 2 fotos (o seletor do `<input capture>` recebe um JPEG gerado no teste),
 *    assina no quadro e conclui: o PDF vai para o Web Share (interceptado) e começa com `%PDF-`;
 * 3. de volta online, a proposta fica FINALIZADA no kanban do admin (outro aparelho, só o timer) em até 60 s da
 *    confirmação do servidor (P4c-R17), com o selo "OS concluída"; fotos, assinatura e PDF estão no servidor;
 * 4. o comercial dono vê a OS; o outro comercial não a vê (nem a API, nem a tela);
 * 5. T não vê `R$` nem o CPF do cliente em nenhuma tela da OS (vê telefone e endereço, Q14);
 * 6. OS avulsa (Q6): o comercial cria, T conclui com a recusa da assinatura, e nenhuma proposta muda;
 * 7. Q21: "Precisa voltar" deixa a proposta EM_EXECUCAO, com o selo "Retorno pendente";
 * 8. reatribuição (M2-R3): as notas offline de T chegam ao servidor depois de o admin passar a OS a T2, e a OS sai
 *    do aparelho de T.
 * Zero violação de CSP em todos os aparelhos, conferida no fim de cada passo.
 */
test.describe.serial('aceite do M2: OS da proposta aprovada até FINALIZADA, executada em modo avião', () => {
  const ts = Date.now();
  const nomeCliente = `Cliente M2 ${ts}`;
  const cpf = cpfAleatorio();
  const cpfFormatado = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
  const telefone = '11987654321';
  const endereco: EnderecoE2E = { cep: '01310100', logradouro: `Rua Aceite M2 ${ts}`, numero: '100', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP' };
  const nomeItem = `Item M2 ${ts}`;
  const notaCampo = `Nota de campo ${ts}`;
  const resumo = `Instalação concluída no aceite ${ts}`;
  const assinante = `Assinante M2 ${ts}`;

  let admin: Api;
  let comercialA: UsuarioE2E;
  let comercialB: UsuarioE2E;
  let tecnico: UsuarioE2E;
  let tecnico2: UsuarioE2E;
  let item: ItemE2E;
  let clienteId: string;
  let logoId: string | null;
  /** p1: a do caminho completo; p2: a do "Precisa voltar" (Q21). */
  let p1: string;
  let p2: string;

  let ctxAdmin: BrowserContext;
  let pageAdmin: Page;
  let cspAdmin: VigiaCsp;
  let ctxT: BrowserContext;
  let pageT: Page;
  let cspT: VigiaCsp;
  let compartilhados: ArquivoCompartilhado[];
  let ctxA: BrowserContext;
  let pageA: Page;
  let cspA: VigiaCsp;

  let osId: string;
  let codigo: string;

  /** O texto da tela do técnico não tem valor nem o CPF do cliente (spec §6, Q14). */
  async function semValorNemDocumento(page: Page): Promise<void> {
    const texto = await textoDaPagina(page);
    expect(texto).not.toContain('R$');
    expect(texto).not.toContain(cpf);
    expect(texto).not.toContain(cpfFormatado);
    const titulo = await page.title();
    expect(titulo).not.toContain(cpf);
    expect(titulo).not.toContain(cpfFormatado);
  }

  /** Abre a OS pelo card de "Minhas OS" (ou da lista do escritório) com o código; a encerrada, com "Mostrar encerradas". */
  async function abrirOsPelaLista(page: Page, id: string, codigoDaOs: string, encerrada = false): Promise<void> {
    await page.goto('/os');
    if (encerrada) await page.getByRole('button', { name: 'Mostrar encerradas' }).click();
    await page.getByRole('link').filter({ hasText: codigoDaOs }).click();
    await expect(page).toHaveURL(new RegExp(`/os/${id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(codigoDaOs);
  }

  async function concluirComRecusa(page: Page, motivo: string, opcoes: { precisaVoltar?: boolean } = {}): Promise<void> {
    await page.getByRole('button', { name: 'Cliente não pôde assinar' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Cliente não pôde assinar' });
    await dialogo.getByLabel('Motivo').fill(motivo);
    await dialogo.getByRole('button', { name: 'Registrar' }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(page.getByTestId('assinatura')).toContainText(`Cliente não pôde assinar: ${motivo}`);
    if (opcoes.precisaVoltar) await page.getByLabel('Precisa voltar').check();
    await page.locator('#resumo').fill(`${resumo} (${motivo})`);
    await page.getByRole('button', { name: 'Concluir e gerar PDF' }).click();
    await expect(page.locator('[data-status]').first()).toHaveText('Concluída', { timeout: 30_000 });
  }

  async function aguardarOs(id: string, condicao: (o: OsServidor) => boolean, timeout = 30_000): Promise<OsServidor> {
    let atual: OsServidor | undefined;
    await expect
      .poll(async () => {
        atual = await admin.os(id);
        return !!atual && condicao(atual);
      }, { timeout })
      .toBe(true);
    return atual!;
  }

  test.beforeAll(async () => {
    admin = await Api.admin();
  });

  test.afterAll(async () => {
    await ctxA?.close();
    await ctxT?.close();
    await ctxAdmin?.close();
    await admin?.fechar();
  });

  test('1. admin gera a OS da proposta aprovada ("conclui a proposta" marcado) e atribui o técnico T', async ({ browser }) => {
    test.setTimeout(120_000);
    // pela API: empresa (a existente fica como está), usuários, item, template, cliente e as duas propostas aprovadas
    logoId = await admin.garantirEmpresa();
    comercialA = await admin.criarUsuario(`Comercial M2 A ${ts}`, `m2.a.${ts}@regera.local`, 'COMERCIAL');
    comercialB = await admin.criarUsuario(`Comercial M2 B ${ts}`, `m2.b.${ts}@regera.local`, 'COMERCIAL');
    tecnico = await admin.criarUsuario(`Tecnico M2 T ${ts}`, `m2.t.${ts}@regera.local`, 'TECNICO');
    tecnico2 = await admin.criarUsuario(`Tecnico M2 T2 ${ts}`, `m2.t2.${ts}@regera.local`, 'TECNICO');
    item = await admin.criarItem(`M2-${ts}`, nomeItem, 300, 480.25);
    const templateId = await admin.criarTemplate(`Template M2 ${ts}`, 'VENDA');
    clienteId = await admin.criarClientePf(nomeCliente, cpf, { telefone, endereco });
    const apiA = await Api.entrar(comercialA.email, comercialA.senha);
    try {
      p1 = await apiA.criarPropostaAprovada(comercialA.id, clienteId, templateId, item);
      p2 = await apiA.criarPropostaAprovada(comercialA.id, clienteId, templateId, item);
    } finally {
      await apiA.fechar();
    }

    ctxAdmin = await novoContexto(browser);
    cspAdmin = await semViolacaoCsp(ctxAdmin);
    pageAdmin = await ctxAdmin.newPage();
    await abrirApp(pageAdmin, ADMIN_EMAIL, ADMIN_SENHA);

    // "Gerar OS" no detalhe da proposta aprovada: Q17, "Esta OS conclui a proposta?" vem marcado e fica assim
    await pageAdmin.goto(`/propostas/${p1}`);
    const secao = pageAdmin.getByTestId('os-da-proposta');
    await expect(secao).toContainText('Nenhuma OS para esta proposta.');
    await secao.getByRole('button', { name: 'Gerar OS' }).click();
    const dialogo = pageAdmin.getByRole('dialog', { name: 'Gerar OS' });
    await expect(dialogo.getByLabel('Esta OS conclui a proposta?')).toBeChecked();
    await dialogo.getByRole('button', { name: 'Gerar OS' }).click();
    await expect(pageAdmin).toHaveURL(/\/os\/[0-9a-f-]+$/, { timeout: 30_000 });
    osId = /\/os\/([0-9a-f-]+)$/.exec(pageAdmin.url())![1];

    // atribuir o técnico T na tela da OS
    await pageAdmin.getByRole('button', { name: 'Atribuir técnico' }).click();
    await pageAdmin.locator('#tecnico-atribuir-os').selectOption({ label: tecnico.nome });
    await pageAdmin.getByRole('button', { name: 'Salvar técnico' }).click();
    await expect(pageAdmin.getByTestId('tecnico')).toContainText(tecnico.nome);

    const noServidor = await aguardarOs(osId, (o) => typeof o.numero === 'number' && o.tecnicoId === tecnico.id);
    expect(noServidor.status).toBe('ABERTA');
    expect(noServidor.propostaId).toBe(p1);
    expect(noServidor.clienteId).toBe(clienteId);
    expect(noServidor.responsavelId).toBe(comercialA.id);
    expect(noServidor.concluiProposta).toBe(true);
    codigo = codigoOs(noServidor.numero!);
    await expect(pageAdmin.getByRole('heading', { level: 1 })).toHaveText(codigo, { timeout: 30_000 });
    expect((await admin.proposta(p1))?.status).toBe('APROVADA');
    await cspAdmin.verificar();
  });

  test('2. T em modo avião: inicia, anota, 2 fotos, assina e conclui; o PDF vai para o compartilhamento', async ({ browser }) => {
    test.setTimeout(120_000);
    ctxT = await novoContexto(browser);
    cspT = await semViolacaoCsp(ctxT);
    compartilhados = await interceptarCompartilhamento(ctxT);
    pageT = await ctxT.newPage();
    await abrirApp(pageT, tecnico.email, tecnico.senha, /\/os$/);
    await expect(pageT.getByRole('heading', { name: 'Minhas OS' })).toBeVisible();
    // M2P1-R25: a logo da empresa fica no aparelho do técnico (o PDF offline a usa)
    if (logoId) {
      const logo = logoId;
      await expect.poll(async () => !!(await registroNoAparelho(pageT, 'arquivos', logo)), { timeout: 30_000 }).toBe(true);
    }
    const card = pageT.getByRole('link').filter({ hasText: codigo });
    await expect(card).toContainText(nomeCliente);
    await semValorNemDocumento(pageT);
    const fotoAntes = await jpegDeTeste(pageT, '#1d4ed8');
    const fotoDepois = await jpegDeTeste(pageT, '#047857');

    await ctxT.setOffline(true);
    await expect(pageT.getByTestId('status-conexao')).toHaveText(/Offline/);

    await card.click();
    await expect(pageT).toHaveURL(new RegExp(`/os/${osId}$`));
    await expect(pageT.getByRole('heading', { level: 1 })).toHaveText(codigo);
    // Q14: telefone e endereço, sem o CPF/CNPJ; os itens sem preço
    await expect(pageT.getByText(endereco.logradouro)).toBeVisible();
    await expect(pageT.locator('a[href^="tel:"]')).toBeVisible();
    await expect(pageT.getByTestId('itens')).toContainText(nomeItem);
    await semValorNemDocumento(pageT);

    await pageT.getByRole('button', { name: 'Iniciar OS' }).click();
    await expect(pageT.locator('[data-status]').first()).toHaveText('Em andamento');

    await pageT.locator('#nota-nova').fill(notaCampo);
    await pageT.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(pageT.getByTestId('notas')).toContainText(notaCampo);

    await pageT.getByRole('button', { name: 'Antes', exact: true }).click();
    await tirarFoto(pageT, fotoAntes, 'antes.jpg', 1);
    await pageT.getByRole('button', { name: 'Depois', exact: true }).click();
    await pageT.locator('#foto-legenda').fill(`Depois ${ts}`);
    await tirarFoto(pageT, fotoDepois, 'depois.jpg', 2);
    await expect(pageT.locator('[data-nao-sincronizada]')).toHaveCount(2);

    await assinarNaTela(pageT, assinante);
    await expect(pageT.getByTestId('assinatura')).toContainText(`Assinada por ${assinante} (Cliente)`);

    // Q17: concluir sem "Precisa voltar" (a OS conclui a proposta)
    await expect(pageT.getByLabel('Precisa voltar')).not.toBeChecked();
    await pageT.locator('#resumo').fill(resumo);
    await pageT.getByRole('button', { name: 'Concluir e gerar PDF' }).click();
    await expect.poll(() => compartilhados.length, { timeout: 30_000 }).toBe(1);
    const [pdf] = compartilhados;
    expect(pdf.nome).toBe(`${codigo}.pdf`);
    expect(pdf.tipo).toBe('application/pdf');
    expect(pdf.inicio).toBe('%PDF-');
    expect(pdf.tamanho).toBeGreaterThan(1000);

    await expect(pageT.locator('[data-status]').first()).toHaveText('Concluída');
    await expect(pageT.getByTestId('documentos')).toContainText('Aguardando envio');
    await semValorNemDocumento(pageT);
    expect((await registroNoAparelho<{ status: string }>(pageT, 'os', osId))?.status).toBe('CONCLUIDA');
    expect(await pageT.evaluate(() => navigator.onLine)).toBe(false);
    // nada saiu do aparelho ainda
    expect((await admin.os(osId))?.status).toBe('ABERTA');
    await cspT.verificar();
  });

  test('3. de volta online: FINALIZADA no kanban do admin em até 60 s, com "OS concluída"; fotos, assinatura e PDF no servidor', async () => {
    test.setTimeout(150_000);
    // o kanban do admin (outro aparelho) já filtrado pelo cliente: só o timer de 60 s o atualiza
    await pageAdmin.goto('/kanban');
    await expect(pageAdmin.getByRole('heading', { name: 'Kanban' })).toBeVisible();
    await pageAdmin.getByRole('tab', { name: /^Finalizada/ }).click();
    await pageAdmin.locator('#busca-kanban').fill(nomeCliente);
    const cardAdmin = pageAdmin.locator(`[data-coluna="FINALIZADA"] [data-proposta="${p1}"]`);
    await expect(cardAdmin).toHaveCount(0);

    await ctxT.setOffline(false);
    // P4c-R17: a janela conta da confirmação do servidor (a proposta FINALIZADA lá), não do setOffline
    await expect.poll(async () => (await admin.proposta(p1))?.status, { timeout: 30_000, intervals: [250] }).toBe('FINALIZADA');
    const confirmadaEm = Date.now();

    const PRAZO_DO_TIMER = 60_000;
    const MARGEM_DO_PULL = 15_000;
    await expect(cardAdmin).toBeVisible({ timeout: Math.max(1_000, PRAZO_DO_TIMER + MARGEM_DO_PULL - (Date.now() - confirmadaEm)) });
    await expect(cardAdmin.locator('[data-selo="os-concluida"]')).toHaveText('OS concluída');

    // servidor: a OS concluída por T, com a nota, a assinatura e o resumo; 2 fotos, 1 assinatura e 1 PDF
    const os = await aguardarOs(osId, (o) => {
      const n = (tipo: string) => o.anexos.filter((a) => a.tipo === tipo).length;
      return n('FOTO') === 2 && n('ASSINATURA') === 1 && n('DOCUMENTO') === 1;
    }, 60_000);
    expect(os.status).toBe('CONCLUIDA');
    expect(os.concluiProposta).toBe(true);
    expect(os.resumoExecucao).toBe(resumo);
    expect(os.assinanteNome).toBe(assinante);
    expect(os.notas.map((n) => [n.texto, n.autorId])).toEqual([[notaCampo, tecnico.id]]);
    expect(os.historico.map((h) => h.statusPara)).toEqual(['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA']);
    const inicioEsperado = { FOTO: '\xff\xd8\xff', ASSINATURA: '\x89PNG', DOCUMENTO: '%PDF-' } as const;
    for (const anexo of os.anexos) {
      const baixado = await admin.baixarArquivo(anexo.arquivoId);
      expect(baixado.status).toBe(200);
      expect(baixado.inicio.startsWith(inicioEsperado[anexo.tipo]), `início do ${anexo.tipo}`).toBe(true);
    }
    expect(os.anexos.find((a) => a.tipo === 'DOCUMENTO')?.codigoExibido).toBe(codigo);
    const proposta = await admin.proposta(p1);
    expect(proposta!.historico.map((h) => h.statusPara)).toEqual(['RASCUNHO', 'ENVIADA', 'APROVADA', 'EM_EXECUCAO', 'FINALIZADA']);

    // T: tudo enviado
    await expect(pageT.locator('[data-nao-sincronizada]')).toHaveCount(0, { timeout: 30_000 });
    await expect(pageT.getByTestId('documentos')).toContainText('Enviado', { timeout: 30_000 });
    await cspT.verificar();
    await cspAdmin.verificar();
  });

  test('4. o comercial dono vê a OS; o outro comercial não a vê (API, aparelho e tela)', async ({ browser }) => {
    test.setTimeout(120_000);
    ctxA = await novoContexto(browser);
    cspA = await semViolacaoCsp(ctxA);
    pageA = await ctxA.newPage();
    await abrirApp(pageA, comercialA.email, comercialA.senha);
    await pageA.goto('/os');
    await expect(pageA.getByRole('heading', { name: 'Ordens de serviço' })).toBeVisible();
    await pageA.locator('#busca-os').fill(codigo);
    const card = pageA.getByRole('link').filter({ hasText: codigo });
    await expect(card).toContainText('Concluída');
    await card.click();
    await expect(pageA).toHaveURL(new RegExp(`/os/${osId}$`));
    await expect(pageA.getByTestId('conclusao')).toContainText(resumo);
    await pageA.goto(`/propostas/${p1}`);
    await expect(pageA.getByTestId('os-da-proposta')).toContainText(codigo);
    const apiA = await Api.entrar(comercialA.email, comercialA.senha);
    try {
      expect((await apiA.os(osId))?.status).toBe('CONCLUIDA');
    } finally {
      await apiA.fechar();
    }
    await cspA.verificar();

    const ctxB = await novoContexto(browser);
    const cspB = await semViolacaoCsp(ctxB);
    try {
      const pageB = await ctxB.newPage();
      await abrirApp(pageB, comercialB.email, comercialB.senha);
      expect(await registroNoAparelho(pageB, 'os', osId)).toBeUndefined();
      const apiB = await Api.entrar(comercialB.email, comercialB.senha);
      try {
        expect(await apiB.os(osId)).toBeUndefined();
        const pdf = (await admin.os(osId))!.anexos.find((a) => a.tipo === 'DOCUMENTO')!;
        expect([403, 404]).toContain((await apiB.baixarArquivo(pdf.arquivoId)).status);
      } finally {
        await apiB.fechar();
      }
      // B é novo e não tem OS nenhuma: o vazio da lista; e o link direto não abre
      await pageB.goto('/os');
      await expect(pageB.getByText('Nenhuma OS ainda.', { exact: true })).toBeVisible();
      await pageB.goto(`/os/${osId}`);
      await expect(pageB.getByText('OS não encontrada neste aparelho.')).toBeVisible();
      await cspB.verificar();
    } finally {
      await ctxB.close();
    }
  });

  test('5. T não vê R$ nem o CPF do cliente em nenhuma tela da OS; o cliente chega ao aparelho dele sem documento', async () => {
    test.setTimeout(90_000);
    await pageT.goto('/os');
    await expect(pageT.getByRole('heading', { name: 'Minhas OS' })).toBeVisible();
    await pageT.getByRole('button', { name: 'Mostrar encerradas' }).click();
    await expect(pageT.getByRole('link').filter({ hasText: codigo })).toBeVisible();
    await semValorNemDocumento(pageT);
    await abrirOsPelaLista(pageT, osId, codigo, true);
    await expect(pageT.getByTestId('conclusao')).toContainText(resumo);
    await semValorNemDocumento(pageT);
    // a navegação dele: "Minhas OS" e "Mais", e o "Mais" também sem valores
    const nav = pageT.getByRole('navigation', { name: 'Navegação inferior' });
    await expect(nav.getByRole('link')).toHaveText(['Minhas OS', 'Mais']);
    await nav.getByRole('link', { name: 'Mais' }).click();
    await semValorNemDocumento(pageT);

    // Q14/Q18: o cliente da OS está no aparelho dele, com telefone e endereço e sem o documento; no servidor, igual
    const local = await registroNoAparelho<Record<string, unknown>>(pageT, 'clientes', clienteId);
    expect(local?.['nome']).toBe(nomeCliente);
    expect(local?.['documento'] ?? null).toBeNull();
    const apiT = await Api.entrar(tecnico.email, tecnico.senha);
    try {
      const cliente = await apiT.agregado('cliente', clienteId);
      expect(cliente?.dados['nome']).toBe(nomeCliente);
      expect(cliente?.dados).not.toHaveProperty('documento');
      expect(cliente?.dados['telefone']).toBe(telefone);
    } finally {
      await apiT.fechar();
    }
    await cspT.verificar();
  });

  test('6. OS avulsa (Q6): o comercial cria; T conclui sem assinatura (recusa com motivo); nenhuma proposta muda', async () => {
    test.setTimeout(120_000);
    const versaoAntes = async () => [(await admin.agregado('proposta', p1))!.version, (await admin.agregado('proposta', p2))!.version];
    const antes = await versaoAntes();

    await pageA.goto('/os');
    await pageA.getByRole('link', { name: 'Nova OS avulsa' }).click();
    await expect(pageA.getByRole('heading', { name: 'Nova OS avulsa' })).toBeVisible();
    await pageA.locator('#busca-cliente-os').fill(nomeCliente);
    await pageA.getByTestId('escolher-cliente').filter({ hasText: nomeCliente }).click();
    await expect(pageA.getByTestId('cliente-escolhido')).toContainText(nomeCliente);
    await pageA.locator('#endereco-os-0').check();
    await pageA.locator('#tipo-os').selectOption('CORRETIVA');
    await pageA.locator('#descricao-os').fill(`Chamado avulso ${ts}`);
    await pageA.locator('#tecnico-os').selectOption({ label: tecnico.nome });
    await pageA.getByRole('button', { name: 'Criar OS' }).click();
    await expect(pageA).toHaveURL(/\/os\/[0-9a-f-]+$/, { timeout: 30_000 });
    const avulsaId = /\/os\/([0-9a-f-]+)$/.exec(pageA.url())![1];
    const criada = await aguardarOs(avulsaId, (o) => typeof o.numero === 'number');
    expect(criada.propostaId ?? null).toBeNull();
    expect(criada.tecnicoId).toBe(tecnico.id);
    expect(criada.responsavelId).toBe(comercialA.id);
    const codigoAvulsa = codigoOs(criada.numero!);

    await recarregarESincronizar(pageT);
    await abrirOsPelaLista(pageT, avulsaId, codigoAvulsa);
    await expect(pageT.getByText(endereco.logradouro)).toBeVisible();
    await pageT.getByRole('button', { name: 'Iniciar OS' }).click();
    await expect(pageT.locator('[data-status]').first()).toHaveText('Em andamento');
    // a avulsa não tem proposta: nada de "Precisa voltar"
    await expect(pageT.getByLabel('Precisa voltar')).toHaveCount(0);
    await concluirComRecusa(pageT, `Responsável ausente ${ts}`);
    await expect.poll(() => compartilhados.length, { timeout: 30_000 }).toBe(2);
    expect(compartilhados[1].nome).toBe(`${codigoAvulsa}.pdf`);
    expect(compartilhados[1].inicio).toBe('%PDF-');
    await semValorNemDocumento(pageT);

    const concluida = await aguardarOs(avulsaId, (o) => o.status === 'CONCLUIDA' && o.anexos.some((a) => a.tipo === 'DOCUMENTO'), 60_000);
    expect(concluida.assinaturaRecusada).toBe(true);
    expect(concluida.motivoRecusa).toBe(`Responsável ausente ${ts}`);
    expect(concluida.anexos.filter((a) => a.tipo === 'ASSINATURA')).toEqual([]);
    expect(await versaoAntes()).toEqual(antes);
    expect((await admin.proposta(p1))?.status).toBe('FINALIZADA');
    expect((await admin.proposta(p2))?.status).toBe('APROVADA');
    await cspA.verificar();
    await cspT.verificar();
  });

  test('7. Q21: o comercial gera a OS; T conclui com "Precisa voltar"; a proposta fica EM_EXECUCAO com "Retorno pendente"', async () => {
    test.setTimeout(120_000);
    await pageA.goto(`/propostas/${p2}`);
    const secao = pageA.getByTestId('os-da-proposta');
    await secao.getByRole('button', { name: 'Gerar OS' }).click();
    const dialogo = pageA.getByRole('dialog', { name: 'Gerar OS' });
    await expect(dialogo.getByLabel('Esta OS conclui a proposta?')).toBeChecked();
    await dialogo.getByLabel('Técnico').selectOption({ label: tecnico.nome });
    await dialogo.getByRole('button', { name: 'Gerar OS' }).click();
    await expect(pageA).toHaveURL(/\/os\/[0-9a-f-]+$/, { timeout: 30_000 });
    const retornoId = /\/os\/([0-9a-f-]+)$/.exec(pageA.url())![1];
    const criada = await aguardarOs(retornoId, (o) => typeof o.numero === 'number');
    expect(criada.tecnicoId).toBe(tecnico.id);
    expect(criada.concluiProposta).toBe(true);
    const codigoRetorno = codigoOs(criada.numero!);

    await recarregarESincronizar(pageT);
    await abrirOsPelaLista(pageT, retornoId, codigoRetorno);
    await pageT.getByRole('button', { name: 'Iniciar OS' }).click();
    await expect(pageT.locator('[data-status]').first()).toHaveText('Em andamento');
    await concluirComRecusa(pageT, `Falta peça ${ts}`, { precisaVoltar: true });
    await expect.poll(() => compartilhados.length, { timeout: 30_000 }).toBe(3);
    expect(compartilhados[2].nome).toBe(`${codigoRetorno}.pdf`);

    const concluida = await aguardarOs(retornoId, (o) => o.status === 'CONCLUIDA');
    expect(concluida.concluiProposta).toBe(false);
    const proposta = await admin.proposta(p2);
    expect(proposta?.status).toBe('EM_EXECUCAO');
    expect(proposta!.historico.map((h) => h.statusPara)).toEqual(['RASCUNHO', 'ENVIADA', 'APROVADA', 'EM_EXECUCAO']);

    // o comercial: o card em execução com "Retorno pendente", e a proposta aceita outra OS
    await pageA.goto('/kanban');
    await recarregarESincronizar(pageA);
    await pageA.getByRole('tab', { name: /^Em execução/ }).click();
    await pageA.locator('#busca-kanban').fill(nomeCliente);
    const card = pageA.locator(`[data-coluna="EM_EXECUCAO"] [data-proposta="${p2}"]`);
    await expect(card.locator('[data-selo="retorno-pendente"]')).toHaveText('Retorno pendente', { timeout: 30_000 });
    await expect(card.locator('[data-selo="os-concluida"]')).toHaveText('OS concluída');
    await pageA.goto(`/propostas/${p2}`);
    await expect(pageA.getByTestId('os-da-proposta').getByRole('button', { name: 'Gerar OS' })).toBeEnabled();
    await cspA.verificar();
    await cspT.verificar();
  });

  test('8. reatribuição (M2-R3): as notas offline de T chegam depois de o admin passar a OS a T2, e a OS sai do aparelho de T', async () => {
    test.setTimeout(150_000);
    const reatribuidaId = await admin.criarOsAvulsa(clienteId, tecnico.id, `Reatribuição ${ts}`);
    const criada = await aguardarOs(reatribuidaId, (o) => typeof o.numero === 'number');
    const codigoReatribuida = codigoOs(criada.numero!);

    // T inicia online e, sem internet, acrescenta duas notas
    await recarregarESincronizar(pageT);
    await abrirOsPelaLista(pageT, reatribuidaId, codigoReatribuida);
    await pageT.getByRole('button', { name: 'Iniciar OS' }).click();
    await aguardarOs(reatribuidaId, (o) => o.status === 'EM_ANDAMENTO');
    await ctxT.setOffline(true);
    await expect(pageT.getByTestId('status-conexao')).toHaveText(/Offline/);
    const notas = [`Offline 1 ${ts}`, `Offline 2 ${ts}`];
    for (const nota of notas) {
      await pageT.locator('#nota-nova').fill(nota);
      await pageT.getByRole('button', { name: 'Adicionar', exact: true }).click();
      await expect(pageT.getByTestId('notas')).toContainText(nota);
    }
    await expect(pageT.getByTestId('notas').getByText('Não sincronizada')).toHaveCount(2);

    // o admin passa a OS para T2
    await pageAdmin.goto(`/os/${reatribuidaId}`);
    await recarregarESincronizar(pageAdmin);
    await expect(pageAdmin.locator('[data-status]').first()).toHaveText('Em andamento', { timeout: 30_000 });
    await pageAdmin.getByRole('button', { name: 'Trocar técnico' }).click();
    await pageAdmin.locator('#tecnico-atribuir-os').selectOption({ label: tecnico2.nome });
    await pageAdmin.getByRole('button', { name: 'Salvar técnico' }).click();
    await expect(pageAdmin.getByTestId('tecnico')).toContainText(tecnico2.nome);
    await aguardarOs(reatribuidaId, (o) => o.tecnicoId === tecnico2.id);

    // T volta: as notas dele chegam ao servidor (M2-R3), e a OS sai do aparelho dele
    await ctxT.setOffline(false);
    const comNotas = await aguardarOs(reatribuidaId, (o) => notas.every((n) => o.notas.some((x) => x.texto === n)));
    for (const n of notas) expect(comNotas.notas.find((x) => x.texto === n)?.autorId).toBe(tecnico.id);
    expect(comNotas.tecnicoId).toBe(tecnico2.id);
    expect(comNotas.status).toBe('EM_ANDAMENTO');
    await expect.poll(async () => await registroNoAparelho(pageT, 'os', reatribuidaId), { timeout: 30_000 }).toBeUndefined();
    await expect(pageT.getByText('OS não encontrada neste aparelho.')).toBeVisible();
    await pageT.goto('/os');
    await expect(pageT.getByRole('heading', { name: 'Minhas OS' })).toBeVisible();
    await pageT.getByRole('button', { name: 'Mostrar encerradas' }).click();
    await expect(pageT.getByRole('link').filter({ hasText: codigoOs(criada.numero!) })).toHaveCount(0);
    // as outras OS dele continuam
    await expect(pageT.getByRole('link').filter({ hasText: codigo })).toBeVisible();

    // o admin vê as notas de T
    await recarregarESincronizar(pageAdmin);
    for (const n of notas) await expect(pageAdmin.getByTestId('notas')).toContainText(n, { timeout: 30_000 });
    await cspT.verificar();
    await cspAdmin.verificar();
  });
});
