import type { Content, DynamicContent, TDocumentDefinitions } from 'pdfmake/interfaces';
import { Bloco } from '../../features/templates/template-models';
import { gerarDocumento, valorVariavel } from './gerar-documento';
import { EntradaPdf, ItemPdf } from './pdf-models';

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

function item(p: Partial<ItemPdf> & Pick<ItemPdf, 'codigo' | 'nome' | 'natureza'>): ItemPdf {
  return {
    descricao: null, unidade: 'UN', quantidade: 1, precoUnitarioCentavos: 10000, descontoPercentual: 0, meses: null,
    subtotalCentavos: 10000, ...p,
  };
}

const BLOCOS: Bloco[] = [
  { id: 'b1', tipo: 'CABECALHO', config: { mostrarLogo: true, mostrarDadosEmpresa: true, titulo: 'Proposta {{proposta.numero}} para {{cliente.nome}}' } },
  { id: 'b2', tipo: 'TEXTO', config: { conteudo: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prezados,' }] }] } } },
  { id: 'b3', tipo: 'ITENS', config: { colunas: ['codigo', 'descricao', 'quantidade', 'unidade', 'precoUnitario', 'desconto', 'meses', 'subtotal'], agruparPorNatureza: false } },
  { id: 'b4', tipo: 'TOTAIS', config: { mostrarDescontos: true } },
  { id: 'b5', tipo: 'QUEBRA_PAGINA', config: {} },
  { id: 'b6', tipo: 'ASSINATURA', config: { assinantes: ['EMPRESA', 'CLIENTE'] } },
];

function entrada(over: Partial<EntradaPdf> = {}): EntradaPdf {
  return {
    empresa: {
      razaoSocial: 'Regera Energia S.A.', nomeFantasia: 'Regera', cnpj: '11222333000181', endereco: 'Rua A, 10 - São Paulo/SP',
      telefone: '1133334444', email: 'contato@regera.test', site: 'regera.test', corPrimaria: '#0f766e',
    },
    cliente: {
      nome: 'ACME Ltda', documento: '11444777000161', endereco: 'Av. B, 20', contato: 'Maria', telefone: '11988887777',
      email: 'maria@acme.test',
    },
    proposta: {
      codigoExibido: '000123', referenciaProvisoria: 'PROV-ABC123', revisao: 2, tipo: 'MANUTENCAO', dataEmissao: '2026-10-01',
      validadeAte: '2026-10-16', condicoesPagamento: '30 dias', prazoExecucao: '10 dias úteis', observacoes: 'Obs.',
      // §7.3: Σ subtotal 290000; desconto geral 10% → total 261000; descontos = 15000 (item) + 29000 (geral)
      totalItensCentavos: 290000, totalDescontosCentavos: 44000, totalCentavos: 261000, responsavelNome: 'João',
      responsavelEmail: 'joao@regera.test',
    },
    itens: [
      item({ codigo: 'P1', nome: 'Painel', descricao: 'Painel 550 W', natureza: 'PRODUTO', quantidade: 1.5, precoUnitarioCentavos: 100000, descontoPercentual: 10, subtotalCentavos: 135000 }),
      item({ codigo: 'S1', nome: 'Instalação', natureza: 'SERVICO', unidade: 'SV', precoUnitarioCentavos: 155000, subtotalCentavos: 155000 }),
    ],
    blocos: BLOCOS,
    logoDataUrl: LOGO,
    previa: false,
    ...over,
  };
}

const conteudo = (dd: TDocumentDefinitions): Content[] => dd.content as Content[];
const rodape = (dd: TDocumentDefinitions, atual: number, total: number) =>
  (dd.footer as DynamicContent)(atual, total, { width: 595, height: 842, orientation: 'portrait' });
interface Totais { columns: [unknown, { table: { body: { text: string }[][] } }] }
const linhasTotais = (e: EntradaPdf) => (conteudo(gerarDocumento(e))[0] as unknown as Totais).columns[1].table.body;
const soTotais = (mostrarDescontos: boolean) => entrada({ blocos: [{ id: 't', tipo: 'TOTAIS', config: { mostrarDescontos } }] });
/** '-R$ 1.234,56' → -123456 */
const centavos = (s: string): number => Number(s.replace(/[^\d-]/g, ''));
interface Tabela { table: { body: unknown[][]; widths: unknown[]; headerRows: number }; layout: string }

describe('gerarDocumento', () => {
  it('configuração da página, fonte e estilos com a cor primária', () => {
    const dd = gerarDocumento(entrada());
    expect(dd.pageSize).toBe('A4');
    expect(dd.pageMargins).toEqual([40, 40, 40, 56]);
    expect(dd.defaultStyle).toEqual({ font: 'Roboto', fontSize: 10 });
    expect(dd.styles).toMatchObject({
      titulo: { fontSize: 16, bold: true, color: '#0f766e' },
      h2: { fontSize: 13, bold: true },
      h3: { fontSize: 11, bold: true },
      cabecalhoTabela: { bold: true, color: 'white', fillColor: '#0f766e' },
      pequeno: { fontSize: 8 },
    });
  });

  it('um elemento por bloco de conteúdo, na ordem dos blocos; a quebra vai no bloco seguinte', () => {
    const c = conteudo(gerarDocumento(entrada()));
    expect(c).toHaveLength(5);
    expect(c[0]).toHaveProperty('stack');
    expect(c[1]).toHaveProperty('stack');
    expect(c[2]).toHaveProperty('table');
    expect(c[3]).toHaveProperty('columns');
    expect(c[3]).not.toHaveProperty('pageBreak');
    expect(c[4]).toMatchObject({ margin: [0, 40, 0, 0], pageBreak: 'before' });
  });

  describe('QUEBRA_PAGINA', () => {
    const quebra = (id: string): Bloco => ({ id, tipo: 'QUEBRA_PAGINA', config: {} });
    const total = (id: string): Bloco => ({ id, tipo: 'TOTAIS', config: { mostrarDescontos: false } });
    const quebras = (blocos: Bloco[]) =>
      conteudo(gerarDocumento(entrada({ blocos }))).map((c) => (c as { pageBreak?: string }).pageBreak ?? null);

    it('entre dois blocos vira pageBreak before no seguinte, sem elemento vazio', () => {
      expect(quebras([total('a'), quebra('q'), total('b')])).toEqual([null, 'before']);
    });

    it('quebras seguidas viram uma só', () => {
      expect(quebras([total('a'), quebra('q1'), quebra('q2'), quebra('q3'), total('b')])).toEqual([null, 'before']);
    });

    it('quebra no início é descartada', () => {
      expect(quebras([quebra('q'), total('a'), total('b')])).toEqual([null, null]);
    });

    it('quebra no fim é descartada (nada de página em branco)', () => {
      expect(quebras([total('a'), quebra('q1'), quebra('q2')])).toEqual([null]);
    });

    it('quebra antes de um bloco que não gera conteúdo vai para o próximo que gera', () => {
      const vazio = { id: 'i', tipo: 'ITENS', config: { colunas: [], agruparPorNatureza: false } } as Bloco;
      expect(quebras([total('a'), quebra('q'), vazio, total('b')])).toEqual([null, 'before']);
    });
  });

  it('impressão: assinatura e totais não se partem entre páginas; linha de item não se parte', () => {
    const c = conteudo(gerarDocumento(entrada()));
    expect((c[2] as unknown as { table: { dontBreakRows?: boolean; headerRows: number } }).table).toMatchObject({ dontBreakRows: true, headerRows: 1 });
    expect(c[3]).toMatchObject({ unbreakable: true });
    expect(c[4]).toMatchObject({ unbreakable: true });
  });

  it('CABECALHO: logo, dados da empresa, título resolvido e referência provisória', () => {
    const [cab] = conteudo(gerarDocumento(entrada()));
    expect(cab).toMatchObject({
      stack: [
        {
          columns: [
            { image: LOGO, fit: [140, 60] },
            {
              stack: [
                { text: 'Regera Energia S.A.', bold: true },
                'CNPJ 11.222.333/0001-81',
                'Rua A, 10 - São Paulo/SP',
                '(11) 3333-4444 · contato@regera.test',
                'regera.test',
              ],
            },
          ],
        },
        { text: 'Proposta 000123 para ACME Ltda', style: 'titulo' },
        { text: '(ref. PROV-ABC123)', style: 'pequeno' },
      ],
    });
  });

  it('CABECALHO: sem logo, sem dados opcionais e sem referência omite as linhas', () => {
    const e = entrada({ logoDataUrl: null });
    e.empresa = { ...e.empresa, cnpj: null, endereco: null, telefone: null, site: null };
    e.proposta = { ...e.proposta, referenciaProvisoria: null };
    const [cab] = conteudo(gerarDocumento(e));
    expect(cab).toEqual({
      stack: [
        { columns: [{ stack: [{ text: 'Regera Energia S.A.', bold: true }, 'contato@regera.test'], width: '*' }] },
        { text: 'Proposta 000123 para ACME Ltda', style: 'titulo', margin: [0, 12, 0, 2] },
      ],
      margin: [0, 0, 0, 12],
    });
  });

  it('CABECALHO: mostrarLogo e mostrarDadosEmpresa desligados deixam só o título', () => {
    const e = entrada({ blocos: [{ id: 'c', tipo: 'CABECALHO', config: { mostrarLogo: false, mostrarDadosEmpresa: false, titulo: 'Oferta' } }] });
    e.proposta = { ...e.proposta, referenciaProvisoria: null };
    const [cab] = conteudo(gerarDocumento(e));
    expect((cab as { stack: unknown[] }).stack).toEqual([{ text: 'Oferta', style: 'titulo', margin: [0, 12, 0, 2] }]);
  });

  it('TEXTO usa tiptapParaPdf com as variáveis resolvidas', () => {
    const e = entrada({
      blocos: [{ id: 't', tipo: 'TEXTO', config: { conteudo: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'variavel', attrs: { nome: 'proposta.total' } }] }] } } }],
    });
    expect(conteudo(gerarDocumento(e))[0]).toMatchObject({ stack: [{ text: [{ text: 'R$ 2.610,00' }] }] });
  });

  it('ITENS: cabeçalho com rótulos, larguras e células formatadas', () => {
    const tabela = conteudo(gerarDocumento(entrada()))[2] as unknown as Tabela;
    expect(tabela.layout).toBe('lightHorizontalLines');
    expect(tabela.table.headerRows).toBe(1);
    expect(tabela.table.widths).toEqual(['auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto']);
    const [cab, l1, l2] = tabela.table.body;
    expect(cab.map((c) => (c as { text: string }).text)).toEqual(['Código', 'Descrição', 'Qtd.', 'Un.', 'Preço unit.', 'Desc.', 'Meses', 'Subtotal']);
    expect(cab[0]).toMatchObject({ style: 'cabecalhoTabela' });
    expect(cab[2]).toMatchObject({ alignment: 'right' });
    expect(l1).toEqual([
      { text: 'P1' },
      { stack: [{ text: 'Painel', bold: true }, { text: 'Painel 550 W', style: 'pequeno' }] },
      { text: '1,5', alignment: 'right' },
      { text: 'UN' },
      { text: 'R$ 1.000,00', alignment: 'right' },
      { text: '10%', alignment: 'right' },
      { text: '—', alignment: 'right' },
      { text: 'R$ 1.350,00', alignment: 'right' },
    ]);
    expect(l2[1]).toEqual({ stack: [{ text: 'Instalação', bold: true }] });
    expect(l2[6]).toEqual({ text: '—', alignment: 'right' });
  });

  it('ITENS: meses com valor aparece como número', () => {
    const e = entrada({ blocos: [{ id: 'i', tipo: 'ITENS', config: { colunas: ['meses'], agruparPorNatureza: false } }] });
    e.itens = [item({ codigo: 'L1', nome: 'Locação', natureza: 'SERVICO', meses: 12, subtotalCentavos: 120000 })];
    expect((conteudo(gerarDocumento(e))[0] as unknown as Tabela).table.body[1][0]).toEqual({ text: '12', alignment: 'right' });
  });

  it('ITENS: colunas na ordem do config; descrição com largura *', () => {
    const e = entrada({ blocos: [{ id: 'i', tipo: 'ITENS', config: { colunas: ['subtotal', 'descricao', 'codigo'], agruparPorNatureza: false } }] });
    const tabela = conteudo(gerarDocumento(e))[0] as unknown as Tabela;
    expect(tabela.table.widths).toEqual(['auto', '*', 'auto']);
    expect(tabela.table.body[0].map((c) => (c as { text: string }).text)).toEqual(['Subtotal', 'Descrição', 'Código']);
    expect(tabela.table.body[1][0]).toEqual({ text: 'R$ 1.350,00', alignment: 'right' });
  });

  it('ITENS agrupado por natureza: seções só com itens, colSpan do total de colunas', () => {
    const blocos: Bloco[] = [{ id: 'i', tipo: 'ITENS', config: { colunas: ['codigo', 'descricao', 'subtotal'], agruparPorNatureza: true } }];
    const tabela = conteudo(gerarDocumento(entrada({ blocos })))[0] as unknown as Tabela;
    const corpo = tabela.table.body;
    expect(corpo).toHaveLength(5);
    expect(corpo[1]).toEqual([{ text: 'Produtos', colSpan: 3, bold: true }, {}, {}]);
    expect(corpo[2][0]).toEqual({ text: 'P1' });
    expect(corpo[3]).toEqual([{ text: 'Serviços', colSpan: 3, bold: true }, {}, {}]);
    expect(corpo[4][0]).toEqual({ text: 'S1' });

    const soServicos = entrada({ blocos });
    soServicos.itens = soServicos.itens.filter((i) => i.natureza === 'SERVICO');
    const c2 = (conteudo(gerarDocumento(soServicos))[0] as unknown as Tabela).table.body;
    expect(c2).toHaveLength(3);
    expect(c2[1][0]).toMatchObject({ text: 'Serviços' });
  });

  it('ITENS agrupado: natureza desconhecida vai para "Outros", nunca some', () => {
    const blocos: Bloco[] = [{ id: 'i', tipo: 'ITENS', config: { colunas: ['codigo'], agruparPorNatureza: true } }];
    const e = entrada({ blocos });
    e.itens = [...e.itens, item({ codigo: 'X1', nome: 'Kit', natureza: 'KIT' as unknown as ItemPdf['natureza'] })];
    const corpo = (conteudo(gerarDocumento(e))[0] as unknown as Tabela).table.body;
    expect(corpo.map((l) => (l[0] as { text: string }).text)).toEqual(['Código', 'Produtos', 'P1', 'Serviços', 'S1', 'Outros', 'X1']);
  });

  it('ITENS sem itens mostra "Nenhum item."', () => {
    const tabela = conteudo(gerarDocumento(entrada({ itens: [] })))[2] as unknown as Tabela;
    expect(tabela.table.body).toHaveLength(2);
    expect(tabela.table.body[1][0]).toMatchObject({ text: 'Nenhum item.', colSpan: 8 });
    expect(tabela.table.body[1]).toHaveLength(8);
  });

  it('TOTAIS com descontos: Subtotal, Descontos e Total em negrito, alinhado à direita, e os valores fecham', () => {
    const tot = conteudo(gerarDocumento(entrada()))[3] as unknown as Totais;
    expect(tot.columns[1]).toMatchObject({ width: 'auto' });
    const corpo = tot.columns[1].table.body;
    expect(corpo).toEqual([
      [{ text: 'Subtotal' }, { text: 'R$ 3.050,00', alignment: 'right' }],
      [{ text: 'Descontos' }, { text: '-R$ 440,00', alignment: 'right' }],
      [{ text: 'Total', bold: true }, { text: 'R$ 2.610,00', alignment: 'right', bold: true }],
    ]);
    expect(centavos(corpo[0][1].text) + centavos(corpo[1][1].text)).toBe(centavos(corpo[2][1].text));
  });

  it('TOTAIS com mostrarDescontos e desconto zero: Subtotal e Total', () => {
    const e = soTotais(true);
    e.proposta = { ...e.proposta, totalDescontosCentavos: 0, totalCentavos: 290000 };
    expect(linhasTotais(e)).toEqual([
      [{ text: 'Subtotal' }, { text: 'R$ 2.900,00', alignment: 'right' }],
      [{ text: 'Total', bold: true }, { text: 'R$ 2.900,00', alignment: 'right', bold: true }],
    ]);
  });

  it('TOTAIS sem mostrarDescontos: só o Total', () => {
    expect(linhasTotais(soTotais(false))).toEqual([[{ text: 'Total', bold: true }, { text: 'R$ 2.610,00', alignment: 'right', bold: true }]]);
  });

  it('ASSINATURA: uma coluna por assinante com linha, nome e rótulo', () => {
    const ass = conteudo(gerarDocumento(entrada()))[4];
    expect(ass).toMatchObject({
      columns: [
        { stack: ['______________________________', 'Regera Energia S.A.', { text: 'Contratada', style: 'pequeno' }] },
        { stack: ['______________________________', 'ACME Ltda', { text: 'Contratante', style: 'pequeno' }] },
      ],
      margin: [0, 40, 0, 0],
    });
  });

  it('rodapé: fantasia, proposta com revisão e página x de y', () => {
    const dd = gerarDocumento(entrada());
    expect(rodape(dd, 2, 3)).toEqual({
      columns: ['Regera', { text: 'Proposta 000123-R2', alignment: 'center' }, { text: 'Página 2 de 3', alignment: 'right' }],
      margin: [40, 16, 40, 0],
      fontSize: 8,
    });
  });

  it('rodapé: sem fantasia usa a razão social; revisão 1 não mostra -R', () => {
    const e = entrada();
    e.empresa = { ...e.empresa, nomeFantasia: null };
    e.proposta = { ...e.proposta, revisao: 1 };
    const r = rodape(gerarDocumento(e), 1, 1) as { columns: unknown[] };
    expect(r.columns[0]).toBe('Regera Energia S.A.');
    expect(r.columns[1]).toEqual({ text: 'Proposta 000123', alignment: 'center' });
  });

  it('marca d’água "PRÉVIA" só na prévia', () => {
    expect(gerarDocumento(entrada({ previa: true })).watermark).toEqual({ text: 'PRÉVIA', opacity: 0.08, bold: true });
    expect(gerarDocumento(entrada()).watermark).toBeUndefined();
    expect(Object.keys(gerarDocumento(entrada()))).not.toContain('watermark');
  });

  it('cliente null e empresa sem opcionais: nada de "undefined" nem "null" no documento (Review Focus 2)', () => {
    const variaveis = [
      'empresa.nome', 'empresa.cnpj', 'empresa.telefone', 'empresa.email', 'empresa.endereco', 'cliente.nome', 'cliente.documento',
      'cliente.endereco', 'cliente.contato', 'cliente.telefone', 'cliente.email', 'proposta.numero', 'proposta.revisao',
      'proposta.tipo', 'proposta.data', 'proposta.validade', 'proposta.total', 'proposta.condicoes_pagamento',
      'proposta.prazo_execucao', 'proposta.observacoes', 'responsavel.nome', 'responsavel.email',
    ];
    const e = entrada({
      cliente: null,
      logoDataUrl: null,
      blocos: [
        { id: 'c', tipo: 'CABECALHO', config: { mostrarLogo: true, mostrarDadosEmpresa: true, titulo: variaveis.map((v) => `{{${v}}}`).join('|') } },
        {
          id: 't', tipo: 'TEXTO',
          config: { conteudo: { type: 'doc', content: [{ type: 'paragraph', content: variaveis.map((nome) => ({ type: 'variavel', attrs: { nome } })) }] } },
        },
        ...BLOCOS.slice(2),
      ],
    });
    e.empresa = { razaoSocial: 'Só Razão', nomeFantasia: null, cnpj: null, endereco: null, telefone: null, email: null, site: null, corPrimaria: '#1d4ed8' };
    e.proposta = {
      ...e.proposta, referenciaProvisoria: null, validadeAte: null, condicoesPagamento: null, prazoExecucao: null, observacoes: null,
      responsavelNome: null, responsavelEmail: null,
    };
    e.itens = [item({ codigo: 'X', nome: 'Sem descrição', natureza: 'PRODUTO' })];
    const dd = gerarDocumento(e);
    const json = JSON.stringify(dd) + JSON.stringify(rodape(dd, 1, 1));
    expect(json).not.toMatch(/undefined|null/i);
    const vazios = ['cliente.nome', 'cliente.email', 'proposta.validade', 'proposta.prazo_execucao', 'responsavel.nome', 'empresa.cnpj'];
    vazios.forEach((v) => expect(valorVariavel(e, v)).toBe(''));
  });

  it('valorVariavel resolve cada variável com a formatação pt-BR', () => {
    const e = entrada();
    expect(valorVariavel(e, 'empresa.nome')).toBe('Regera');
    expect(valorVariavel(e, 'empresa.cnpj')).toBe('11.222.333/0001-81');
    expect(valorVariavel(e, 'empresa.telefone')).toBe('(11) 3333-4444');
    expect(valorVariavel(e, 'empresa.email')).toBe('contato@regera.test');
    expect(valorVariavel(e, 'empresa.endereco')).toBe('Rua A, 10 - São Paulo/SP');
    expect(valorVariavel(e, 'cliente.nome')).toBe('ACME Ltda');
    expect(valorVariavel(e, 'cliente.documento')).toBe('11.444.777/0001-61');
    expect(valorVariavel({ ...e, cliente: { ...e.cliente!, documento: '52998224725' } }, 'cliente.documento')).toBe('529.982.247-25');
    // o cliente do TECNICO chega sem documento (Q14): sai em branco, sem quebrar
    expect(valorVariavel({ ...e, cliente: { ...e.cliente!, documento: null } }, 'cliente.documento')).toBe('');
    expect(valorVariavel(e, 'cliente.endereco')).toBe('Av. B, 20');
    expect(valorVariavel(e, 'cliente.contato')).toBe('Maria');
    expect(valorVariavel(e, 'cliente.telefone')).toBe('(11) 98888-7777');
    expect(valorVariavel(e, 'cliente.email')).toBe('maria@acme.test');
    expect(valorVariavel(e, 'proposta.numero')).toBe('000123');
    expect(valorVariavel(e, 'proposta.revisao')).toBe('2');
    expect(valorVariavel(e, 'proposta.tipo')).toBe('Manutenção');
    expect(valorVariavel(e, 'proposta.data')).toBe('01/10/2026');
    expect(valorVariavel(e, 'proposta.validade')).toBe('16/10/2026');
    expect(valorVariavel(e, 'proposta.total')).toBe('R$ 2.610,00');
    expect(valorVariavel(e, 'proposta.condicoes_pagamento')).toBe('30 dias');
    expect(valorVariavel(e, 'proposta.prazo_execucao')).toBe('10 dias úteis');
    expect(valorVariavel(e, 'proposta.observacoes')).toBe('Obs.');
    expect(valorVariavel(e, 'responsavel.nome')).toBe('João');
    expect(valorVariavel(e, 'responsavel.email')).toBe('joao@regera.test');
    expect(valorVariavel(e, 'nao.existe')).toBe('');
    expect(valorVariavel({ ...e, empresa: { ...e.empresa, nomeFantasia: null } }, 'empresa.nome')).toBe('Regera Energia S.A.');
  });

  it('pureza: a mesma entrada gera o mesmo documento, e não altera a entrada', () => {
    const e = entrada({ previa: true });
    const antes = JSON.stringify(e);
    const a = gerarDocumento(e);
    const b = gerarDocumento(entrada({ previa: true }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(rodape(a, 1, 2))).toBe(JSON.stringify(rodape(b, 1, 2)));
    expect(JSON.stringify(e)).toBe(antes);
  });

  it('bloco de tipo desconhecido é ignorado (Review Focus 3)', () => {
    const blocos = [
      { id: 'x', tipo: 'IMAGEM', config: { url: 'x' } },
      { id: 't', tipo: 'TOTAIS', config: { mostrarDescontos: false } },
    ] as unknown as Bloco[];
    const c = conteudo(gerarDocumento(entrada({ blocos })));
    expect(c).toHaveLength(1);
    expect(c[0]).toHaveProperty('columns');
  });

  it('coluna ou assinante desconhecidos são ignorados; cor inválida usa a padrão', () => {
    const blocos = [
      { id: 'i', tipo: 'ITENS', config: { colunas: ['codigo', 'foto'], agruparPorNatureza: false } },
      { id: 'a', tipo: 'ASSINATURA', config: { assinantes: ['TESTEMUNHA', 'CLIENTE'] } },
    ] as unknown as Bloco[];
    const e = entrada({ blocos });
    e.empresa = { ...e.empresa, corPrimaria: 'vermelho' };
    const dd = gerarDocumento(e);
    const [tab, ass] = conteudo(dd);
    expect((tab as unknown as Tabela).table.widths).toEqual(['auto']);
    expect((ass as { columns: unknown[] }).columns).toHaveLength(1);
    expect(dd.styles).toMatchObject({ titulo: { color: '#1d4ed8' } });
  });
});
