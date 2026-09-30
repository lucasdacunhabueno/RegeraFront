import type { Alignment, Content, ContentText, Margins } from 'pdfmake/interfaces';
import { TiptapDoc, TiptapNo } from '../../features/templates/template-models';

/** Trecho inline: texto com as marcas já traduzidas, ou `'\n'` de um hardBreak. */
type Trecho = string | { text: string; bold?: true; italics?: true; decoration?: 'underline' };

const MARGEM_PARAGRAFO: Margins = [0, 0, 0, 6];
const ALINHAMENTOS = new Set<string>(['left', 'center', 'right', 'justify']);

const filhos = (no: { content?: unknown } | null | undefined): TiptapNo[] =>
  Array.isArray(no?.content) ? (no.content as TiptapNo[]).filter((f) => typeof f === 'object' && f !== null) : [];

/**
 * Converte o Tiptap restrito (§9.1) em conteúdo do pdfmake. Nós e marcas fora da lista são ignorados (Review Focus 3):
 * o documento pode ter vindo de um front mais novo. `valor` resolve o nome de uma variável; o resultado nunca é
 * interpretado como formatação.
 */
export function tiptapParaPdf(doc: TiptapDoc, valor: (nome: string) => string): Content[] {
  return blocos(filhos(doc), valor);
}

function blocos(nos: TiptapNo[], valor: (nome: string) => string): Content[] {
  const saida: Content[] = [];
  for (const no of nos) {
    const c = bloco(no, valor);
    if (c) saida.push(c);
  }
  return saida;
}

function bloco(no: TiptapNo, valor: (nome: string) => string): Content | null {
  switch (no.type) {
    case 'paragraph':
      return comAlinhamento(no, { text: textoOuEspaco(trechos(no, valor)), margin: MARGEM_PARAGRAFO });
    case 'heading':
      return comAlinhamento(no, {
        text: textoOuEspaco(trechos(no, valor)),
        style: no.attrs?.['level'] === 3 ? 'h3' : 'h2',
        margin: [0, 6, 0, 4],
      });
    case 'bulletList':
      return { ul: itens(no, valor), margin: MARGEM_PARAGRAFO };
    case 'orderedList': {
      const start = no.attrs?.['start'];
      const lista: Content = { ol: itens(no, valor), margin: MARGEM_PARAGRAFO };
      return typeof start === 'number' && Number.isInteger(start) && start >= 1 ? { ...lista, start } : lista;
    }
    default:
      return null;
  }
}

function itens(lista: TiptapNo, valor: (nome: string) => string): Content[] {
  return filhos(lista)
    .filter((f) => f.type === 'listItem')
    .map((item) => ({ stack: blocos(filhos(item), valor) }));
}

function comAlinhamento(no: TiptapNo, c: ContentText): ContentText {
  const a = no.attrs?.['textAlign'];
  return typeof a === 'string' && ALINHAMENTOS.has(a) ? { ...c, alignment: a as Alignment } : c;
}

/** Parágrafo sem texto visível vira `' '`, para manter a altura da linha. */
function textoOuEspaco(t: Trecho[]): Trecho[] | string {
  return t.some((x) => (typeof x === 'string' ? x : x.text) !== '') ? t : ' ';
}

function trechos(no: TiptapNo, valor: (nome: string) => string): Trecho[] {
  const saida: Trecho[] = [];
  for (const f of filhos(no)) {
    switch (f.type) {
      case 'text':
        saida.push(comMarcas(f, typeof f.text === 'string' ? f.text : ''));
        break;
      case 'variavel': {
        const nome = f.attrs?.['nome'];
        const v = typeof nome === 'string' ? valor(nome) : '';
        saida.push(comMarcas(f, typeof v === 'string' ? v : ''));
        break;
      }
      case 'hardBreak':
        saida.push('\n');
        break;
      default:
        break; // inline desconhecido: ignorado
    }
  }
  return saida;
}

function comMarcas(no: TiptapNo, text: string): Trecho {
  const t: Exclude<Trecho, string> = { text };
  const marcas = Array.isArray(no.marks) ? no.marks : [];
  for (const m of marcas) {
    if (m?.type === 'bold') t.bold = true;
    else if (m?.type === 'italic') t.italics = true;
    else if (m?.type === 'underline') t.decoration = 'underline';
  }
  return t;
}
