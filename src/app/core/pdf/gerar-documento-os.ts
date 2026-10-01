import type { Content, CustomTableLayout, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { AssinaturaPdfOs, EntradaPdfOs, FotoPdfOs, ItemPdfOs, NotaPdfOs } from '../../features/os/os-repo';
import type { MomentoFoto } from '../../features/os/os-models';
import { dataBr, dataHoraBr, quantidadeBr } from './formatos-pdf';
import { colunasEmpresa, corPrimaria, estilosPdf, imagemSegura, telefone, txt } from './partes-pdf';

/**
 * O PDF da OS (spec M2 §8): layout fixo em A4, sem template. Função pura: `EntradaPdfOs` → `docDefinition` do pdfmake;
 * não lê relógio nem serviços (o "Gerado em" é o `emitidaEm` da entrada).
 *
 * - Sem preço, custo, desconto nem total: a OS não os tem, e o técnico não os vê.
 * - O CPF/CNPJ do cliente NUNCA sai (M2P2-R8, Q14): o `cliente.documento` não é lido aqui, mesmo que a entrada o traga.
 *   O CNPJ que aparece é o da empresa, no cabeçalho.
 * - Só data URL PNG/JPEG vira imagem (`imagemSegura`): nada é buscado fora da entrada; o resto vira o texto no lugar.
 *
 * Cada seção de topo leva um `id` (o pdfmake o ignora fora de nós de texto) para os testes a acharem.
 */

const TRACO = '—';
const ROTULO_MOMENTO: Readonly<Record<MomentoFoto, string>> = { ANTES: 'Antes', DURANTE: 'Durante', DEPOIS: 'Depois' };
/** Duas fotos por linha na largura útil do A4 (515 pt), com o espaço entre elas. */
const FOTO_AJUSTE: [number, number] = [240, 180];
const ASSINATURA_AJUSTE: [number, number] = [220, 90];
const COR_SECUNDARIA = '#4b5563';
/**
 * Larguras fixas em todas as colunas de texto: o pdfmake só parte uma palavra longa numa coluna de largura fixa; numa
 * `auto` ou `*` a coluna cresce até a palavra e a tabela passa da margem. A conta usa a largura útil do A4 (595 − 2 × 40)
 * menos o enchimento do layout de cada tabela (`noBorders`: 4 entre colunas; `LAYOUT_ITENS`: 8 de cada lado entre colunas).
 */
const LARGURA_UTIL = 515;
const ROTULO_CAMPO = 95;
const LARGURAS_CAMPOS: [number, number] = [ROTULO_CAMPO, LARGURA_UTIL - ROTULO_CAMPO - 2 * 4];
const LARGURAS_ITENS: [number, number, number, number] = [70, LARGURA_UTIL - 70 - 50 - 70 - 6 * 8, 50, 70];

/**
 * O `lightHorizontalLines` do pdfmake para a tabela de itens com o título da seção como 1ª linha de cabeçalho: sem
 * linha entre o título e os rótulos, a grossa abaixo dos rótulos e as finas entre os itens.
 */
const LAYOUT_ITENS: CustomTableLayout = {
  hLineWidth: (i, node) => (i <= 1 || i === node.table.body.length ? 0 : i === node.table.headerRows ? 2 : 1),
  vLineWidth: () => 0,
  paddingLeft: (i) => (i === 0 ? 0 : 8),
  paddingRight: (i, node) => (i === (node.table.widths?.length ?? 0) - 1 ? 0 : 8),
};

const ouTraco = (v: string): string => (v.trim() !== '' ? v : TRACO);

export function gerarDocumentoOs(e: EntradaPdfOs): TDocumentDefinitions {
  const cor = corPrimaria(e.empresa);
  const codigo = txt(e.os.codigoExibido);

  const content: Content[] = [];
  const cabecalho = colunasEmpresa(e.empresa, imagemSegura(e.logoDataUrl), true);
  if (cabecalho.length > 0) content.push(secao('cabecalho', { columns: cabecalho, margin: [0, 0, 0, 12] }));
  content.push(secao('titulo', titulo(e, codigo)));
  content.push(secao('cliente', cliente(e)));
  content.push(secao('dados', dados(e)));
  content.push(secao('itens', itens(e.itens)));
  if (e.notas.length > 0) content.push(secao('notas', notas(e.notas)));
  if (e.fotos.length > 0) content.push(secao('fotos', fotos(e.fotos)));
  content.push(secao('assinatura', assinatura(e.assinatura, e.recusaAssinatura)));

  const gerado = dataHoraBr(e.os.emitidaEm);
  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 56],
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    styles: estilosPdf(cor),
    content,
    footer: (atual: number, total: number): Content => ({
      columns: [
        gerado ? 'Gerado em ' + gerado : '',
        { text: codigo, alignment: 'center' },
        { text: 'Página ' + atual + ' de ' + total, alignment: 'right' },
      ],
      margin: [40, 16, 40, 0],
      fontSize: 8,
    }),
  };
}

function secao(id: string, c: Content): Content {
  return { ...(c as object), id } as Content;
}

function tituloSecao(texto: string): Content {
  return { text: texto, style: 'h2', margin: [0, 12, 0, 4] };
}

/** Pares rótulo/valor em duas colunas, sem bordas. */
function campos(pares: [string, string][]): Content {
  return {
    table: { widths: LARGURAS_CAMPOS, body: pares.map(([rotulo, valor]): TableCell[] => [{ text: rotulo, bold: true }, { text: valor }]) },
    layout: 'noBorders',
  };
}

function titulo(e: EntradaPdfOs, codigo: string): Content {
  const stack: Content[] = [{ text: 'Ordem de serviço ' + codigo, style: 'titulo' }];
  const { propostaCodigoExibido, propostaNumero } = e.os;
  const proposta = txt(propostaCodigoExibido) ||
    (typeof propostaNumero === 'number' && Number.isFinite(propostaNumero) ? String(propostaNumero).padStart(6, '0') : '');
  if (proposta) stack.push({ text: 'Proposta ' + proposta, style: 'h3', margin: [0, 2, 0, 0] });
  return { stack, margin: [0, 0, 0, 4] };
}

/** Nome, telefone e o endereço do serviço (sem ele, o do cliente). Nunca o CPF/CNPJ. */
function cliente(e: EntradaPdfOs): Content {
  const c = e.cliente;
  const endereco = txt(e.os.endereco) || txt(c?.endereco);
  return {
    stack: [
      tituloSecao('Cliente'),
      campos([
        ['Nome', ouTraco(txt(c?.nome))],
        ['Telefone', ouTraco(telefone(c?.telefone))],
        ['Endereço', ouTraco(endereco)],
      ]),
    ],
  };
}

function dados(e: EntradaPdfOs): Content {
  const os = e.os;
  const tipo = txt(os.rotuloTipo) + (os.urgente === true ? ' · Urgente' : '');
  const pares: [string, string][] = [
    ['Tipo', ouTraco(tipo)],
    ['Técnico', ouTraco(txt(e.tecnicoNome))],
    ['Data prevista', ouTraco(dataBr(os.dataPrevista))],
    ['Início', ouTraco(dataHoraBr(os.iniciadaEm))],
    ['Conclusão', ouTraco(dataHoraBr(os.concluidaEm))],
    ['Descrição', ouTraco(txt(os.descricao))],
  ];
  if (txt(os.resumoExecucao).trim() !== '') pares.push(['Resumo da execução', txt(os.resumoExecucao)]);
  return { stack: [tituloSecao('Dados da OS'), campos(pares)] };
}

/**
 * O título "Itens" é a 1ª linha de cabeçalho da tabela, e `keepWithHeaderRows: 1` o prende aos rótulos e ao 1º item:
 * o título nunca fica sozinho no pé da página, e título e rótulos se repetem nas páginas seguintes. Cada item fica
 * inteiro numa página (`dontBreakRows`).
 */
function itens(lista: readonly ItemPdfOs[]): Content {
  const body: TableCell[][] = [
    [{ ...(tituloSecao('Itens') as object), colSpan: 4 } as TableCell, {}, {}, {}],
    [
      { text: 'Código', style: 'cabecalhoTabela' },
      { text: 'Item', style: 'cabecalhoTabela' },
      { text: 'Unidade', style: 'cabecalhoTabela' },
      { text: 'Qtd. prevista', style: 'cabecalhoTabela', alignment: 'right' },
    ],
  ];
  if (lista.length === 0) {
    body.push([{ text: 'Nenhum item.', colSpan: 4 }, {}, {}, {}]);
  } else {
    for (const i of lista) {
      body.push([{ text: txt(i.codigo) }, { text: txt(i.nome) }, { text: txt(i.unidade) }, { text: quantidadeBr(i.quantidade), alignment: 'right' }]);
    }
  }
  return { table: { headerRows: 2, keepWithHeaderRows: 1, dontBreakRows: true, widths: LARGURAS_ITENS, body }, layout: LAYOUT_ITENS };
}

/**
 * Cada nota com "autor · hora" acima do texto (o que faltar some da linha). Só o começo da nota (o título da seção, na
 * 1ª, o "autor · hora" e o 1º parágrafo) é indivisível: o resto quebra entre páginas, porque o pdfmake descarta um
 * bloco indivisível mais alto que a página (uma nota de checklist com muitas linhas sumia). O 1º parágrafo tem no
 * máximo 2000 caracteres (o limite da nota), umas 20 linhas.
 */
function notas(lista: readonly NotaPdfOs[]): Content {
  const stack: Content[] = [];
  lista.forEach((n, i) => {
    const meta = [txt(n.autorNome), dataHoraBr(n.criadaEm)].filter((s) => s.trim() !== '').join(' · ');
    const [primeiro, ...resto] = txt(n.texto).split('\n');
    const inicio: Content[] = [];
    if (i === 0) inicio.push(tituloSecao('Notas'));
    if (meta) inicio.push({ text: meta, style: 'pequeno', color: COR_SECUNDARIA });
    inicio.push({ text: primeiro });
    const nota: Content[] = [{ stack: inicio, unbreakable: true }];
    if (resto.length > 0) nota.push({ text: resto.join('\n') });
    stack.push({ stack: nota, margin: [0, 0, 0, 6] });
  });
  return { stack };
}

/**
 * Duas fotos por linha; cada linha inteira na mesma página (`dontBreakRows`). O título vai num bloco indivisível com a
 * 1ª linha (não fica sozinho no pé da página); as outras linhas seguem numa tabela de mesmas larguras.
 */
function fotos(lista: readonly FotoPdfOs[]): Content {
  const body: TableCell[][] = [];
  for (let i = 0; i < lista.length; i += 2) {
    body.push([celulaFoto(lista[i]), i + 1 < lista.length ? celulaFoto(lista[i + 1]) : { text: '' }]);
  }
  const tabela = (linhas: TableCell[][]): Content => ({ table: { widths: ['*', '*'], dontBreakRows: true, body: linhas }, layout: 'noBorders' });
  const stack: Content[] = [{ stack: [tituloSecao('Fotos'), tabela(body.slice(0, 1))], unbreakable: true }];
  if (body.length > 1) stack.push(tabela(body.slice(1)));
  return { stack };
}

function celulaFoto(f: FotoPdfOs): TableCell {
  const imagem = imagemSegura(f.imagem);
  const stack: Content[] = [
    imagem
      ? { image: imagem, fit: FOTO_AJUSTE, alignment: 'center' }
      : caixaFotoIndisponivel(),
  ];
  const momento = f.momento ? ROTULO_MOMENTO[f.momento] ?? '' : '';
  const meta = [momento, dataHoraBr(f.tiradaEm)].filter((s) => s !== '').join(' · ');
  if (meta) stack.push({ text: meta, style: 'pequeno', bold: true, margin: [0, 4, 0, 0] });
  if (txt(f.legenda).trim() !== '') stack.push({ text: txt(f.legenda), style: 'pequeno' });
  return { stack, margin: [0, 0, 0, 10] };
}

/**
 * Caixa do tamanho da área da foto (240 × 180), centrada, para a grade não pular. Os descontos são o enchimento e as
 * bordas do layout padrão da tabela: 4 + 4 e 1 + 1 na largura, 2 + 2 na altura.
 */
function caixaFotoIndisponivel(): Content {
  return {
    columns: [
      { width: '*', text: '' },
      {
        width: 'auto',
        table: {
          widths: [FOTO_AJUSTE[0] - 10],
          heights: [FOTO_AJUSTE[1] - 4],
          body: [[{ text: 'Foto indisponível', alignment: 'center', color: COR_SECUNDARIA, margin: [0, FOTO_AJUSTE[1] / 2 - 10, 0, 0] }]],
        },
      },
      { width: '*', text: '' },
    ],
  };
}

/** A assinatura (imagem, nome, papel, data/hora), a recusa ou, sem nenhuma, "Sem assinatura."; num bloco só. */
function assinatura(a: AssinaturaPdfOs | null, recusa: string | null): Content {
  const stack: Content[] = [tituloSecao('Assinatura')];
  if (a) {
    const imagem = imagemSegura(a.imagem);
    stack.push(imagem
      ? { image: imagem, fit: ASSINATURA_AJUSTE }
      : { text: 'Imagem da assinatura indisponível', color: COR_SECUNDARIA, italics: true });
    if (txt(a.nome).trim() !== '') stack.push({ text: txt(a.nome), bold: true, margin: [0, 4, 0, 0] });
    if (txt(a.papel).trim() !== '') stack.push({ text: txt(a.papel) });
    const quando = dataHoraBr(a.assinadaEm);
    if (quando) stack.push({ text: 'Assinado em ' + quando, style: 'pequeno' });
  } else if (recusa !== null) {
    const motivo = txt(recusa).trim();
    stack.push({ text: motivo ? 'Cliente não assinou: ' + motivo : 'Cliente não assinou.' });
  } else {
    stack.push({ text: 'Sem assinatura.' });
  }
  return { stack, unbreakable: true };
}
