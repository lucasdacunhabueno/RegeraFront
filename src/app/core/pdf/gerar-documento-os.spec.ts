import type { Content, DynamicContent, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { EntradaPdfOs, FotoPdfOs } from '../../features/os/os-repo';
import { gerarDocumentoOs } from './gerar-documento-os';

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQ';
const PNG_ASSINATURA = 'data:image/png;base64,iVBORassinatura';
/** CPF/CNPJ do cliente: nunca no PDF da OS (M2P2-R8), nem cru nem formatado. */
const DOC_CLIENTE = '11444777000161';
const DOC_CLIENTE_FORMATADO = '11.444.777/0001-61';

function foto(i: number, over: Partial<FotoPdfOs> = {}): FotoPdfOs {
  return { id: 'f' + i, legenda: 'Foto ' + i, momento: 'ANTES', tiradaEm: '2026-10-01T13:00:00Z', imagem: JPEG, ...over };
}

function entrada(over: Partial<EntradaPdfOs> = {}, os: Partial<EntradaPdfOs['os']> = {}): EntradaPdfOs {
  return {
    empresa: {
      razaoSocial: 'Regera Energia S.A.', nomeFantasia: 'Regera', cnpj: '11222333000181', endereco: 'Rua A, 10 - São Paulo/SP',
      telefone: '1133334444', email: 'contato@regera.test', site: 'regera.test', corPrimaria: '#0f766e',
    },
    logoDataUrl: LOGO,
    os: {
      codigoExibido: 'OS-000123', revisao: 1, tipo: 'MANUTENCAO', rotuloTipo: 'Manutenção', urgente: false,
      dataPrevista: '2026-10-05', iniciadaEm: '2026-10-05T12:00:00Z', concluidaEm: '2026-10-05T18:30:00Z',
      emitidaEm: '2026-10-05T18:31:00Z', descricao: 'Troca do inversor', endereco: 'Av. B, 20 - Centro - Campinas/SP',
      resumoExecucao: 'Inversor trocado e testado', propostaNumero: 277, propostaCodigoExibido: '000277', ...os,
    },
    cliente: {
      nome: 'ACME Ltda', documento: null, endereco: 'Rua do Cliente, 1', contato: 'Maria', telefone: '11988887777',
      email: 'maria@acme.test',
    },
    tecnicoNome: 'Tiago Técnico',
    responsavelNome: 'João',
    itens: [
      { codigo: 'P1', nome: 'Inversor 5 kW', unidade: 'UN', natureza: 'PRODUTO', quantidade: 1 },
      { codigo: 'S1', nome: 'Mão de obra', unidade: 'H', natureza: 'SERVICO', quantidade: 2.5 },
    ],
    notas: [
      { texto: 'Cliente pediu para ligar antes', autorNome: 'Tiago Técnico', criadaEm: '2026-10-05T12:10:00Z' },
      { texto: 'Nota sem autor', autorNome: null, criadaEm: null },
    ],
    fotos: [foto(1), foto(2, { momento: 'DEPOIS', legenda: null })],
    assinatura: { anexoId: 'a1', imagem: PNG_ASSINATURA, nome: 'Maria Cliente', papel: 'Gerente', assinadaEm: '2026-10-05T18:20:00Z' },
    recusaAssinatura: null,
    ...over,
  };
}

const conteudo = (dd: TDocumentDefinitions): Content[] => dd.content as Content[];
const rodape = (dd: TDocumentDefinitions, atual: number, total: number) =>
  (dd.footer as DynamicContent)(atual, total, { width: 595, height: 842, orientation: 'portrait' });
/** Todo o texto do documento (conteúdo e rodapé), para buscas de "nunca aparece". */
const tudo = (dd: TDocumentDefinitions): string => JSON.stringify([dd, rodape(dd, 1, 1)]);

/** O texto impresso de um nó, em profundidade: strings soltas e `text`, dentro de `stack`, `columns` e tabelas. */
function textos(no: unknown): string[] {
  if (typeof no === 'string') return [no];
  if (Array.isArray(no)) return no.flatMap(textos);
  if (no && typeof no === 'object') {
    const o = no as { text?: unknown; stack?: unknown; columns?: unknown; table?: { body?: unknown } };
    return [o.text, o.stack, o.columns, o.table?.body].filter((x) => x !== undefined).flatMap(textos);
  }
  return [];
}

/** A seção pelo id (`id` do pdfmake no elemento de topo). */
function secao(dd: TDocumentDefinitions, id: string): Record<string, unknown> | undefined {
  return conteudo(dd).find((c) => (c as { id?: string }).id === id) as Record<string, unknown> | undefined;
}

interface TabelaFotos { table: { widths: unknown[]; dontBreakRows: boolean; body: unknown[][] } }
const tabelaFotos = (dd: TDocumentDefinitions): TabelaFotos =>
  (secao(dd, 'fotos')!['stack'] as unknown[]).find((x) => (x as { table?: unknown }).table) as TabelaFotos;

describe('gerarDocumentoOs', () => {
  it('página A4, Roboto e estilos com a cor primária da empresa', () => {
    const dd = gerarDocumentoOs(entrada());
    expect(dd.pageSize).toBe('A4');
    expect(dd.pageMargins).toEqual([40, 40, 40, 56]);
    expect(dd.defaultStyle).toEqual({ font: 'Roboto', fontSize: 10 });
    expect(dd.styles).toMatchObject({
      titulo: { fontSize: 16, bold: true, color: '#0f766e' },
      cabecalhoTabela: { bold: true, color: 'white', fillColor: '#0f766e' },
    });
    expect(tudo(dd)).not.toMatch(/"font":"(?!Roboto")/);
  });

  it('cabeçalho: logo e dados da empresa, com o CNPJ dela, como no PDF da proposta', () => {
    const cab = secao(gerarDocumentoOs(entrada()), 'cabecalho')!;
    expect(cab['columns']).toEqual([
      { image: LOGO, fit: [140, 60], width: 140 },
      {
        stack: [
          { text: 'Regera Energia S.A.', bold: true },
          'CNPJ 11.222.333/0001-81',
          'Rua A, 10 - São Paulo/SP',
          '(11) 3333-4444 · contato@regera.test',
          'regera.test',
        ],
        width: '*',
        alignment: 'right',
      },
    ]);
  });

  it('cabeçalho sem logo: só os dados; logo que não é data URL PNG/JPEG não entra (nada externo)', () => {
    for (const logo of [null, 'https://exemplo.test/logo.png', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      const dd = gerarDocumentoOs(entrada({ logoDataUrl: logo }));
      const colunas = secao(dd, 'cabecalho')!['columns'] as unknown[];
      expect(colunas).toHaveLength(1);
      expect(colunas[0]).toMatchObject({ width: '*' });
      expect(tudo(dd)).not.toContain('"image":"' + logo);
    }
  });

  it('título: "Ordem de serviço" com o código, e a proposta de origem pelo código exibido', () => {
    const tit = secao(gerarDocumentoOs(entrada()), 'titulo')!;
    expect(textos(tit)).toEqual(['Ordem de serviço OS-000123', 'Proposta 000277']);
    expect((tit['stack'] as unknown[])[0]).toMatchObject({ style: 'titulo' });
  });

  it('título: o código como veio, com a revisão (-R2) e o OSP provisório', () => {
    const r2 = gerarDocumentoOs(entrada({}, { codigoExibido: 'OS-000123-R2', revisao: 2, propostaCodigoExibido: '000277-R3' }));
    expect(textos(secao(r2, 'titulo'))).toEqual(['Ordem de serviço OS-000123-R2', 'Proposta 000277-R3']);
    const osp = gerarDocumentoOs(entrada({}, { codigoExibido: 'OSP-AB12CD-R2', revisao: 2, propostaCodigoExibido: 'PROV-XYZ123' }));
    expect(textos(secao(osp, 'titulo'))).toEqual(['Ordem de serviço OSP-AB12CD-R2', 'Proposta PROV-XYZ123']);
  });

  it('título: sem o código exibido, a proposta sai pelo número com seis dígitos', () => {
    const dd = gerarDocumentoOs(entrada({}, { propostaCodigoExibido: null, propostaNumero: 277 }));
    expect(textos(secao(dd, 'titulo'))).toEqual(['Ordem de serviço OS-000123', 'Proposta 000277']);
  });

  it('OS avulsa: sem a linha da proposta', () => {
    const dd = gerarDocumentoOs(entrada({}, { propostaNumero: null, propostaCodigoExibido: null }));
    expect(textos(secao(dd, 'titulo'))).toEqual(['Ordem de serviço OS-000123']);
    expect(tudo(dd)).not.toContain('Proposta');
  });

  it('cliente: nome e telefone, e o endereço do serviço', () => {
    const t = textos(secao(gerarDocumentoOs(entrada()), 'cliente'));
    expect(t).toContain('ACME Ltda');
    expect(t).toContain('(11) 98888-7777');
    expect(t).toContain('Av. B, 20 - Centro - Campinas/SP');
    // o resto do cadastro do cliente não vai: só nome, telefone e o endereço
    expect(t.join('|')).not.toContain('maria@acme.test');
    expect(t.join('|')).not.toContain('Rua do Cliente');
  });

  it('cliente: sem o endereço do serviço, o do cliente; sem cliente no aparelho, um traço', () => {
    const semEndereco = textos(secao(gerarDocumentoOs(entrada({}, { endereco: null })), 'cliente'));
    expect(semEndereco).toContain('Rua do Cliente, 1');
    const semCliente = gerarDocumentoOs(entrada({ cliente: null }, { endereco: null }));
    expect(textos(secao(semCliente, 'cliente'))).toContain('—');
    expect(tudo(semCliente)).not.toMatch(/undefined|null/);
  });

  it('NUNCA imprime o CPF/CNPJ do cliente, mesmo que a entrada o traga (M2P2-R8)', () => {
    const cliente = { ...entrada().cliente!, documento: DOC_CLIENTE };
    const dd = gerarDocumentoOs(entrada({ cliente }));
    const s = tudo(dd);
    expect(s).not.toContain(DOC_CLIENTE);
    expect(s).not.toContain(DOC_CLIENTE_FORMATADO);
    expect(s).not.toMatch(/CPF|documento/i);
    // o CNPJ da própria empresa continua no cabeçalho
    expect(s).toContain('CNPJ 11.222.333/0001-81');
  });

  it('dados: tipo, urgência, técnico, as três datas, descrição e resumo da execução', () => {
    const t = textos(secao(gerarDocumentoOs(entrada({}, { urgente: true })), 'dados'));
    for (const esperado of [
      'Tipo', 'Manutenção · Urgente', 'Técnico', 'Tiago Técnico', 'Data prevista', '05/10/2026', 'Início', '05/10/2026 09:00',
      'Conclusão', '05/10/2026 15:30', 'Descrição', 'Troca do inversor', 'Resumo da execução', 'Inversor trocado e testado',
    ]) {
      expect(t).toContain(esperado);
    }
  });

  it('dados: o que falta vira traço, nunca "null"', () => {
    const dd = gerarDocumentoOs(entrada({ tecnicoNome: null }, {
      dataPrevista: null, iniciadaEm: null, concluidaEm: null, descricao: null, resumoExecucao: null,
    }));
    const t = textos(secao(dd, 'dados'));
    expect(t).toContain('Manutenção');
    expect(t.filter((x) => x === '—')).toHaveLength(5);
    expect(t).not.toContain('Resumo da execução');
    expect(tudo(dd)).not.toMatch(/undefined|null/);
  });

  it('itens: código, item, unidade e quantidade prevista; linha inteira na mesma página', () => {
    const it = secao(gerarDocumentoOs(entrada()), 'itens')!;
    const tabela = (it['stack'] as unknown[]).find((x) => (x as { table?: unknown }).table) as {
      table: { headerRows: number; dontBreakRows: boolean; widths: unknown[]; body: unknown[][] };
    };
    expect(tabela.table.headerRows).toBe(1);
    expect(tabela.table.dontBreakRows).toBe(true);
    expect(tabela.table.widths).toEqual(['auto', '*', 'auto', 'auto']);
    expect(textos(tabela.table.body[0])).toEqual(['Código', 'Item', 'Unidade', 'Qtd. prevista']);
    expect(textos(tabela.table.body[1])).toEqual(['P1', 'Inversor 5 kW', 'UN', '1']);
    expect(textos(tabela.table.body[2])).toEqual(['S1', 'Mão de obra', 'H', '2,5']);
  });

  it('itens: lista vazia mostra "Nenhum item."', () => {
    expect(textos(secao(gerarDocumentoOs(entrada({ itens: [] })), 'itens'))).toContain('Nenhum item.');
  });

  it('nenhum valor, preço, desconto nem total no documento', () => {
    const itensComPreco = entrada().itens.map((i) => ({ ...i, precoUnitarioCentavos: 99999, subtotalCentavos: 99999 }));
    const s = tudo(gerarDocumentoOs(entrada({ itens: itensComPreco })));
    expect(s).not.toMatch(/R\$|preço|valor|desconto|total|subtotal/i);
    expect(s).not.toContain('99999');
    expect(s).not.toContain('999,99');
  });

  it('notas: o texto com o autor e a hora; sem autor nem hora, só o texto', () => {
    const notas = secao(gerarDocumentoOs(entrada()), 'notas')!;
    const t = textos(notas);
    expect(t).toContain('Tiago Técnico · 05/10/2026 09:10');
    expect(t).toContain('Cliente pediu para ligar antes');
    expect(t).toContain('Nota sem autor');
    expect(t.join('|')).not.toMatch(/undefined|null/);
  });

  it('notas e fotos vazias não geram seção', () => {
    const dd = gerarDocumentoOs(entrada({ notas: [], fotos: [] }));
    expect(secao(dd, 'notas')).toBeUndefined();
    expect(secao(dd, 'fotos')).toBeUndefined();
  });

  it('fotos: duas por linha, com momento, hora e legenda; o bloco não se parte entre páginas', () => {
    const t = tabelaFotos(gerarDocumentoOs(entrada()));
    expect(t.table.widths).toEqual(['*', '*']);
    expect(t.table.dontBreakRows).toBe(true);
    expect(t.table.body).toHaveLength(1);
    const [a, b] = t.table.body[0] as { stack: unknown[] }[];
    expect(a.stack[0]).toEqual({ image: JPEG, fit: [240, 180], alignment: 'center' });
    expect(textos(a)).toEqual(expect.arrayContaining(['Antes · 01/10/2026 10:00', 'Foto 1']));
    expect(textos(b)).toContain('Depois · 01/10/2026 10:00');
    expect(textos(b).join('|')).not.toMatch(/undefined|null/);
  });

  it('20 fotos geram 10 linhas; número ímpar completa a última com célula vazia', () => {
    const vinte = gerarDocumentoOs(entrada({ fotos: Array.from({ length: 20 }, (_, i) => foto(i)) }));
    expect(tabelaFotos(vinte).table.body).toHaveLength(10);
    for (const linha of tabelaFotos(vinte).table.body) expect(linha).toHaveLength(2);
    const tres = gerarDocumentoOs(entrada({ fotos: [foto(1), foto(2), foto(3)] }));
    const corpo = tabelaFotos(tres).table.body;
    expect(corpo).toHaveLength(2);
    expect(corpo[1][1]).toEqual({ text: '' });
  });

  it('foto sem imagem (ou com imagem que não é data URL PNG/JPEG) vira a caixa "Foto indisponível"', () => {
    const dd = gerarDocumentoOs(entrada({
      fotos: [foto(1, { imagem: null }), foto(2, { imagem: 'https://exemplo.test/x.jpg' }), foto(3)],
    }));
    const corpo = tabelaFotos(dd).table.body;
    for (const celula of [corpo[0][0], corpo[0][1]] as { stack: unknown[] }[]) {
      const caixa = celula.stack[0] as { table: { widths: unknown[]; heights: unknown[]; body: unknown[][] } };
      expect(caixa.table.widths).toEqual(['*']);
      expect(caixa.table.heights).toEqual([180]);
      expect(textos(caixa)).toEqual(['Foto indisponível']);
    }
    expect(tudo(dd)).not.toContain('https://');
    expect((corpo[1][0] as { stack: unknown[] }).stack[0]).toMatchObject({ image: JPEG });
  });

  it('assinatura: imagem, nome, papel e data/hora, num bloco que não se parte', () => {
    const ass = secao(gerarDocumentoOs(entrada()), 'assinatura')!;
    expect(ass['unbreakable']).toBe(true);
    expect((ass['stack'] as unknown[])[1]).toEqual({ image: PNG_ASSINATURA, fit: [220, 90] });
    const t = textos(ass);
    expect(t).toEqual(expect.arrayContaining(['Maria Cliente', 'Gerente', 'Assinado em 05/10/2026 15:20']));
    expect(t.join('|')).not.toContain('não assinou');
  });

  it('assinatura sem imagem no aparelho: o texto no lugar, com nome e data', () => {
    const ass = secao(gerarDocumentoOs(entrada({ assinatura: { ...entrada().assinatura!, imagem: null, papel: null } })), 'assinatura')!;
    const t = textos(ass);
    expect(t).toEqual(expect.arrayContaining(['Imagem da assinatura indisponível', 'Maria Cliente']));
    expect(t.join('|')).not.toMatch(/undefined|null/);
    expect(JSON.stringify(ass)).not.toContain('"image"');
  });

  it('recusa: "Cliente não assinou: motivo", sem imagem', () => {
    const ass = secao(gerarDocumentoOs(entrada({ assinatura: null, recusaAssinatura: 'Responsável ausente' })), 'assinatura')!;
    expect(textos(ass)).toContain('Cliente não assinou: Responsável ausente');
    expect(JSON.stringify(ass)).not.toContain('"image"');
  });

  it('sem assinatura nem recusa: "Sem assinatura."', () => {
    const ass = secao(gerarDocumentoOs(entrada({ assinatura: null, recusaAssinatura: null })), 'assinatura')!;
    expect(textos(ass)).toContain('Sem assinatura.');
  });

  it('rodapé: "Gerado em" na hora de São Paulo, o código da OS e página x de y', () => {
    const dd = gerarDocumentoOs(entrada({}, { codigoExibido: 'OS-000123-R2' }));
    expect(rodape(dd, 2, 3)).toEqual({
      columns: [
        'Gerado em 05/10/2026 15:31',
        { text: 'OS-000123-R2', alignment: 'center' },
        { text: 'Página 2 de 3', alignment: 'right' },
      ],
      margin: [40, 16, 40, 0],
      fontSize: 8,
    });
  });

  it('ordem das seções: cabeçalho, título, cliente, dados, itens, notas, fotos, assinatura', () => {
    const ids = conteudo(gerarDocumentoOs(entrada())).map((c) => (c as { id?: string }).id);
    expect(ids).toEqual(['cabecalho', 'titulo', 'cliente', 'dados', 'itens', 'notas', 'fotos', 'assinatura']);
  });

  it('empresa sem opcionais e cor inválida: sem "undefined"/"null", cor padrão', () => {
    const dd = gerarDocumentoOs(entrada({
      empresa: { razaoSocial: '', nomeFantasia: null, cnpj: null, endereco: null, telefone: null, email: null, site: null, corPrimaria: 'x' },
      logoDataUrl: null,
    }));
    expect(secao(dd, 'cabecalho')).toBeUndefined();
    expect(dd.styles).toMatchObject({ titulo: { color: '#1d4ed8' } });
    expect(tudo(dd)).not.toMatch(/undefined|null/);
  });

  it('pureza: a mesma entrada gera o mesmo documento, e a entrada não muda', () => {
    const e = entrada();
    const antes = JSON.stringify(e);
    expect(tudo(gerarDocumentoOs(e))).toBe(tudo(gerarDocumentoOs(e)));
    expect(JSON.stringify(e)).toBe(antes);
  });
});
