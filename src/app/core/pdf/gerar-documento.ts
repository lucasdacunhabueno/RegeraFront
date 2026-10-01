import type { Column, Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  Assinante,
  Bloco,
  COLUNAS_ITENS,
  ColunaItens,
  ConfigAssinatura,
  ConfigCabecalho,
  ConfigItens,
  ConfigTotais,
  TIPOS_PROPOSTA,
  tokenTitulo,
} from '../../features/templates/template-models';
import { formatarDocumento, formatarTelefone } from '../util/formatos';
import { dataBr, linhasDeTotais, moedaCentavos, percentualBr, quantidadeBr } from './formatos-pdf';
import { EntradaPdf, ItemPdf } from './pdf-models';
import { tiptapParaPdf } from './tiptap-para-pdf';

const COR_PADRAO = '#1d4ed8';
const LINHA_ASSINATURA = '______________________________';
const ROTULOS_COLUNA = new Map<string, string>(COLUNAS_ITENS.map((c) => [c.valor, c.rotulo]));
const COLUNAS_NUMERICAS = new Set<ColunaItens>(['quantidade', 'precoUnitario', 'desconto', 'meses', 'subtotal']);
const ROTULOS_TIPO = new Map<string, string>(TIPOS_PROPOSTA.map((t) => [t.valor, t.rotulo]));

/** Texto ou ''; nunca `undefined`/`null` no PDF (Review Focus 2). */
const txt = (v: string | null | undefined): string => (typeof v === 'string' ? v : '');
const telefone = (v: string | null | undefined): string => (v ? formatarTelefone(v) : '');
const documento = (v: string | null | undefined): string => (v ? formatarDocumento(v) : '');

function nomeEmpresa(e: EntradaPdf): string {
  return txt(e.empresa.nomeFantasia) || txt(e.empresa.razaoSocial);
}

function corPrimaria(e: EntradaPdf): string {
  const cor = e.empresa.corPrimaria;
  return typeof cor === 'string' && /^#[0-9a-fA-F]{6}$/.test(cor) ? cor : COR_PADRAO;
}

/** Valor de uma variável da lista fechada (§9.2), já formatado; ausente ou desconhecida → ''. */
export function valorVariavel(e: EntradaPdf, nome: string): string {
  const { empresa, cliente, proposta } = e;
  switch (nome) {
    case 'empresa.nome':
      return nomeEmpresa(e);
    case 'empresa.cnpj':
      return documento(empresa.cnpj);
    case 'empresa.telefone':
      return telefone(empresa.telefone);
    case 'empresa.email':
      return txt(empresa.email);
    case 'empresa.endereco':
      return txt(empresa.endereco);
    case 'cliente.nome':
      return txt(cliente?.nome);
    case 'cliente.documento':
      return documento(cliente?.documento);
    case 'cliente.endereco':
      return txt(cliente?.endereco);
    case 'cliente.contato':
      return txt(cliente?.contato);
    case 'cliente.telefone':
      return telefone(cliente?.telefone);
    case 'cliente.email':
      return txt(cliente?.email);
    case 'proposta.numero':
      return txt(proposta.codigoExibido);
    case 'proposta.revisao':
      return Number.isFinite(proposta.revisao) ? String(proposta.revisao) : '';
    case 'proposta.tipo':
      return ROTULOS_TIPO.get(proposta.tipo) ?? '';
    case 'proposta.data':
      return dataBr(proposta.dataEmissao);
    case 'proposta.validade':
      return dataBr(proposta.validadeAte);
    case 'proposta.total':
      return moedaCentavos(proposta.totalCentavos);
    case 'proposta.condicoes_pagamento':
      return txt(proposta.condicoesPagamento);
    case 'proposta.prazo_execucao':
      return txt(proposta.prazoExecucao);
    case 'proposta.observacoes':
      return txt(proposta.observacoes);
    case 'responsavel.nome':
      return txt(proposta.responsavelNome);
    case 'responsavel.email':
      return txt(proposta.responsavelEmail);
    default:
      return '';
  }
}

/**
 * Função pura (§9.3): blocos do template + dados → `docDefinition` do pdfmake. Não lê relógio, aleatório nem serviços;
 * a mesma entrada gera o mesmo documento. Blocos de tipo desconhecido são ignorados (Review Focus 3).
 */
export function gerarDocumento(e: EntradaPdf): TDocumentDefinitions {
  const cor = corPrimaria(e);
  const nome = nomeEmpresa(e);
  const revisao = e.proposta.revisao > 1 ? '-R' + e.proposta.revisao : '';
  const rotuloProposta = 'Proposta ' + txt(e.proposta.codigoExibido) + revisao;

  const content: Content[] = [];
  // QUEBRA_PAGINA vira pageBreak 'before' no próximo bloco que gera conteúdo: seguidas valem uma, e no início ou no
  // fim são descartadas (um elemento vazio com 'after' deixava página em branco)
  let quebrar = false;
  for (const b of Array.isArray(e.blocos) ? e.blocos : []) {
    if (ehQuebra(b)) {
      quebrar = content.length > 0;
      continue;
    }
    const c = bloco(e, b);
    if (!c) continue;
    content.push(quebrar ? ({ ...(c as object), pageBreak: 'before' } as Content) : c);
    quebrar = false;
  }

  const dd: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 56],
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    styles: {
      titulo: { fontSize: 16, bold: true, color: cor },
      h2: { fontSize: 13, bold: true },
      h3: { fontSize: 11, bold: true },
      cabecalhoTabela: { bold: true, color: 'white', fillColor: cor },
      pequeno: { fontSize: 8 },
    },
    content,
    footer: (atual: number, total: number): Content => ({
      columns: [
        nome,
        { text: rotuloProposta, alignment: 'center' },
        { text: 'Página ' + atual + ' de ' + total, alignment: 'right' },
      ],
      margin: [40, 16, 40, 0],
      fontSize: 8,
    }),
  };
  if (e.previa) dd.watermark = { text: 'PRÉVIA', opacity: 0.08, bold: true };
  return dd;
}

function ehQuebra(b: Bloco): boolean {
  const config: unknown = (b as { config?: unknown } | null)?.config;
  return b?.tipo === 'QUEBRA_PAGINA' && typeof config === 'object' && config !== null;
}

/** Conteúdo de um bloco; null para os que não geram nada (QUEBRA_PAGINA é tratada em `gerarDocumento`). */
function bloco(e: EntradaPdf, b: Bloco): Content | null {
  const config: unknown = (b as { config?: unknown } | null)?.config;
  if (typeof config !== 'object' || config === null) return null;
  switch (b.tipo) {
    case 'CABECALHO':
      return cabecalho(e, b.config);
    case 'TEXTO':
      return { stack: tiptapParaPdf(b.config.conteudo, (nome) => valorVariavel(e, nome)) };
    case 'ITENS':
      return itens(e, b.config);
    case 'TOTAIS':
      return totais(e, b.config);
    case 'ASSINATURA':
      return assinatura(e, b.config);
    default:
      return null;
  }
}

function cabecalho(e: EntradaPdf, config: ConfigCabecalho): Content {
  const stack: Content[] = [];
  const colunas: Column[] = [];
  const logo = config.mostrarLogo === true && e.logoDataUrl ? e.logoDataUrl : null;
  if (logo) colunas.push({ image: logo, fit: [140, 60], width: 140 });
  if (config.mostrarDadosEmpresa === true) {
    const emp = e.empresa;
    const linhas: Content[] = [];
    if (txt(emp.razaoSocial)) linhas.push({ text: emp.razaoSocial, bold: true });
    const cnpj = documento(emp.cnpj);
    if (cnpj) linhas.push('CNPJ ' + cnpj);
    if (txt(emp.endereco)) linhas.push(emp.endereco!);
    const contato = [telefone(emp.telefone), txt(emp.email)].filter((s) => s !== '').join(' · ');
    if (contato) linhas.push(contato);
    if (txt(emp.site)) linhas.push(emp.site!);
    if (linhas.length > 0) colunas.push(logo ? { stack: linhas, width: '*', alignment: 'right' } : { stack: linhas, width: '*' });
  }
  if (colunas.length > 0) stack.push({ columns: colunas });

  const titulo = txt(config.titulo).replace(tokenTitulo(), (_token, nome: string) => valorVariavel(e, nome));
  if (titulo.trim() !== '') stack.push({ text: titulo, style: 'titulo', margin: [0, 12, 0, 2] });
  const ref = txt(e.proposta.referenciaProvisoria);
  if (ref) stack.push({ text: '(ref. ' + ref + ')', style: 'pequeno' });
  return { stack, margin: [0, 0, 0, 12] };
}

function celulaItem(coluna: ColunaItens, i: ItemPdf): TableCell {
  switch (coluna) {
    case 'codigo':
      return { text: txt(i.codigo) };
    case 'descricao': {
      const stack: Content[] = [{ text: txt(i.nome), bold: true }];
      if (txt(i.descricao)) stack.push({ text: i.descricao!, style: 'pequeno' });
      return { stack };
    }
    case 'quantidade':
      return { text: quantidadeBr(i.quantidade), alignment: 'right' };
    case 'unidade':
      return { text: txt(i.unidade) };
    case 'precoUnitario':
      return { text: moedaCentavos(i.precoUnitarioCentavos), alignment: 'right' };
    case 'desconto':
      return { text: percentualBr(i.descontoPercentual), alignment: 'right' };
    case 'meses':
      return { text: typeof i.meses === 'number' && Number.isFinite(i.meses) ? String(i.meses) : '—', alignment: 'right' };
    case 'subtotal':
      return { text: moedaCentavos(i.subtotalCentavos), alignment: 'right' };
  }
}

/** Linha que ocupa a tabela inteira (seção ou "Nenhum item."). */
function linhaCheia(celula: Record<string, unknown>, n: number): TableCell[] {
  return [{ ...celula, colSpan: n } as TableCell, ...Array.from({ length: n - 1 }, () => ({}) as TableCell)];
}

function itens(e: EntradaPdf, config: ConfigItens): Content | null {
  const colunas = (Array.isArray(config.colunas) ? config.colunas : []).filter((c) => ROTULOS_COLUNA.has(c));
  if (colunas.length === 0) return null;
  const n = colunas.length;
  const cabecalhoLinha: TableCell[] = colunas.map((c) =>
    COLUNAS_NUMERICAS.has(c)
      ? { text: ROTULOS_COLUNA.get(c)!, style: 'cabecalhoTabela', alignment: 'right' }
      : { text: ROTULOS_COLUNA.get(c)!, style: 'cabecalhoTabela' },
  );
  const linha = (i: ItemPdf): TableCell[] => colunas.map((c) => celulaItem(c, i));
  const lista = Array.isArray(e.itens) ? e.itens : [];

  const body: TableCell[][] = [cabecalhoLinha];
  if (lista.length === 0) {
    body.push(linhaCheia({ text: 'Nenhum item.' }, n));
  } else if (config.agruparPorNatureza === true) {
    // natureza fora de PRODUTO/SERVICO (dado de um front mais novo) vai para "Outros": item nunca some do PDF
    const secoes: [string, (i: ItemPdf) => boolean][] = [
      ['Produtos', (i) => i.natureza === 'PRODUTO'],
      ['Serviços', (i) => i.natureza === 'SERVICO'],
      ['Outros', (i) => i.natureza !== 'PRODUTO' && i.natureza !== 'SERVICO'],
    ];
    for (const [rotulo, doGrupo] of secoes) {
      const doGrupoItens = lista.filter(doGrupo);
      if (doGrupoItens.length === 0) continue;
      body.push(linhaCheia({ text: rotulo, bold: true }, n));
      doGrupoItens.forEach((i) => body.push(linha(i)));
    }
  } else {
    lista.forEach((i) => body.push(linha(i)));
  }

  return {
    // cabeçalho repetido em cada página e linha de item inteira na mesma página
    table: { headerRows: 1, dontBreakRows: true, widths: colunas.map((c) => (c === 'descricao' ? '*' : 'auto')), body },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 12],
  };
}

function totais(e: EntradaPdf, config: ConfigTotais): Content {
  const p = e.proposta;
  // P4a-R6: as mesmas linhas que o wizard mostra (Subtotal = bruto, Descontos, Total)
  const body: TableCell[][] = linhasDeTotais(p.totalCentavos, p.totalDescontosCentavos, config.mostrarDescontos === true).map((l) =>
    l.total
      ? [{ text: l.rotulo, bold: true }, { text: moedaCentavos(l.centavos), alignment: 'right', bold: true }]
      : [{ text: l.rotulo }, { text: moedaCentavos(l.centavos), alignment: 'right' }],
  );
  return {
    columns: [{ width: '*', text: '' }, { width: 'auto', table: { body }, layout: 'noBorders' }],
    unbreakable: true,
    margin: [0, 0, 0, 12],
  };
}

function assinatura(e: EntradaPdf, config: ConfigAssinatura): Content | null {
  const rotulos: Record<Assinante, [string, string]> = {
    EMPRESA: [txt(e.empresa.razaoSocial), 'Contratada'],
    CLIENTE: [txt(e.cliente?.nome), 'Contratante'],
  };
  const colunas: Content[] = (Array.isArray(config.assinantes) ? config.assinantes : [])
    .filter((a): a is Assinante => a === 'EMPRESA' || a === 'CLIENTE')
    .map((a) => ({ stack: [LINHA_ASSINATURA, rotulos[a][0], { text: rotulos[a][1], style: 'pequeno' }], alignment: 'center' }));
  if (colunas.length === 0) return null;
  return { columns: colunas, columnGap: 24, unbreakable: true, margin: [0, 40, 0, 0] };
}
