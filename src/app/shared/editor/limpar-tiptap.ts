import { TiptapDoc, TiptapMarca, TiptapNo, VARIAVEIS } from '../../features/templates/template-models';

/**
 * Deixa um JSON do Tiptap dentro do schema restrito (§9.1) que o `validarBlocos` (e o servidor) aceita.
 * Função pura, sem Tiptap: serve para o que o editor emite e para o que chega de fora antes de entrar no editor.
 * - Nós de bloco/inline e marcas fora da whitelist somem, mas o texto deles fica (tabela, citação, link, cor...).
 * - Atributos fora da whitelist somem (ex.: `orderedList.type` do Tiptap 3, P4a-R3); `textAlign` nulo ou inválido é
 *   omitido; `heading.level` 1 vira 2 e 4+ vira 3; `orderedList.start` só fica se for inteiro ≥ 1.
 * - Texto solto em nível de bloco vai para um parágrafo; filho de lista que não é `listItem` vira item; item sempre
 *   começa por parágrafo (exigência do schema do Tiptap). Listas vazias somem; o doc nunca fica vazio.
 * - Listas aninhadas além da profundidade máxima (12, com o doc em 1) são achatadas em parágrafos.
 */
export function limparTiptap(json: unknown): TiptapDoc {
  const content = ehObjeto(json) ? blocos(filhos(json), 2) : [];
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

const MAX_PROFUNDIDADE = 12;
const INT_MAX = 2147483647;
const MARCAS = new Set(['bold', 'italic', 'underline']);
const ALINHAMENTOS = new Set(['left', 'center', 'right', 'justify']);
const NOMES_VARIAVEIS = new Set(VARIAVEIS.map((v) => v.nome));
const INLINE = new Set(['text', 'hardBreak', 'variavel']);

type Objeto = Record<string, unknown>;

const ehObjeto = (v: unknown): v is Objeto => typeof v === 'object' && v !== null && !Array.isArray(v);
const filhos = (no: Objeto): unknown[] => (Array.isArray(no['content']) ? no['content'] : []);
const atributos = (no: Objeto): Objeto => (ehObjeto(no['attrs']) ? no['attrs'] : {});

/** Nós de bloco que ficam na profundidade `p`. */
function blocos(nos: unknown[], p: number): TiptapNo[] {
  const saida: TiptapNo[] = [];
  let soltos: TiptapNo[] = [];
  const fecharSoltos = () => {
    if (soltos.length > 0) {
      saida.push({ type: 'paragraph', content: soltos });
      soltos = [];
    }
  };
  for (const no of nos) {
    if (!ehObjeto(no)) continue;
    const tipo = no['type'];
    if ((typeof tipo === 'string' && INLINE.has(tipo)) || typeof no['text'] === 'string') {
      soltos.push(...inline([no]));
      continue;
    }
    fecharSoltos();
    switch (tipo) {
      case 'paragraph':
        saida.push(textual('paragraph', alinhamento(no), no));
        break;
      case 'heading':
        saida.push(textual('heading', { ...alinhamento(no), level: nivel(no) }, no));
        break;
      case 'bulletList':
      case 'orderedList':
        saida.push(...lista(tipo, no, p));
        break;
      default:
        // listItem fora de lista, citação, tabela, bloco de código, imagem...: fica só o conteúdo
        saida.push(...blocos(filhos(no), p));
    }
  }
  fecharSoltos();
  return saida;
}

function textual(tipo: 'paragraph' | 'heading', attrs: Objeto, no: Objeto): TiptapNo {
  const saida: TiptapNo = { type: tipo };
  if (Object.keys(attrs).length > 0) saida.attrs = attrs;
  const content = inline(filhos(no));
  if (content.length > 0) saida.content = content;
  return saida;
}

function alinhamento(no: Objeto): Objeto {
  const a = atributos(no)['textAlign'];
  return typeof a === 'string' && ALINHAMENTOS.has(a) ? { textAlign: a } : {};
}

function nivel(no: Objeto): 2 | 3 {
  const level = atributos(no)['level'];
  return typeof level === 'number' && Number.isInteger(level) && level >= 3 ? 3 : 2;
}

/** A lista fica em `p`, o item em `p + 1`, o parágrafo do item em `p + 2` e o texto em `p + 3`. */
function lista(tipo: 'bulletList' | 'orderedList', no: Objeto, p: number): TiptapNo[] {
  const conteudoDoItem = (filho: unknown, pItem: number): TiptapNo[] =>
    ehObjeto(filho) && filho['type'] === 'listItem' ? blocos(filhos(filho), pItem) : blocos([filho], pItem);

  if (p + 3 > MAX_PROFUNDIDADE) {
    return filhos(no).flatMap((filho) => conteudoDoItem(filho, p));
  }
  const itens: TiptapNo[] = filhos(no)
    .filter(ehObjeto)
    .map((filho) => {
      const content = conteudoDoItem(filho, p + 2);
      if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph' });
      return { type: 'listItem', content };
    });
  if (itens.length === 0) return [];
  const saida: TiptapNo = { type: tipo };
  const start = atributos(no)['start'];
  if (tipo === 'orderedList' && typeof start === 'number' && Number.isInteger(start) && start >= 1 && start <= INT_MAX) {
    saida.attrs = { start };
  }
  saida.content = itens;
  return [saida];
}

/** Nós inline; bloco ou nó desconhecido dentro de texto vira só o texto que ele tem. */
function inline(nos: unknown[]): TiptapNo[] {
  const saida: TiptapNo[] = [];
  for (const no of nos) {
    if (!ehObjeto(no)) continue;
    const marks = marcas(no['marks']);
    const comMarcas = (n: TiptapNo): TiptapNo => (marks.length > 0 ? { ...n, marks } : n);
    const tipo = no['type'];
    if (tipo === 'hardBreak') {
      saida.push(comMarcas({ type: 'hardBreak' }));
    } else if (tipo === 'variavel') {
      const nome = atributos(no)['nome'];
      if (typeof nome === 'string' && NOMES_VARIAVEIS.has(nome)) {
        saida.push(comMarcas({ type: 'variavel', attrs: { nome } }));
      }
    } else if (typeof no['text'] === 'string') {
      if (no['text'] !== '') saida.push(comMarcas({ type: 'text', text: no['text'] }));
    } else {
      saida.push(...inline(filhos(no)));
    }
  }
  return saida;
}

function marcas(v: unknown): TiptapMarca[] {
  if (!Array.isArray(v)) return [];
  const tipos = new Set<string>();
  for (const m of v) {
    const tipo = ehObjeto(m) ? m['type'] : undefined;
    if (typeof tipo === 'string' && MARCAS.has(tipo)) tipos.add(tipo);
  }
  return [...tipos].map((type) => ({ type }));
}
