import { Node } from '@tiptap/core';
import { VARIAVEIS } from '../../features/templates/template-models';

const ROTULOS = new Map(VARIAVEIS.map((v) => [v.nome, v.rotulo]));

/** Rótulo pt-BR da variável; nome desconhecido aparece como está (o `limparTiptap` o descarta ao emitir). */
export const rotuloVariavel = (nome: unknown): string => (typeof nome === 'string' ? (ROTULOS.get(nome) ?? nome) : '');

/**
 * Variável da lista fechada (§9.2) dentro do texto: nó inline atômico, aparece como um chip com o rótulo e vira
 * `{{nome}}` no texto puro (`getText`, copiar como texto). No JSON: `{ type: 'variavel', attrs: { nome } }`.
 */
export const VariavelNode = Node.create({
  name: 'variavel',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      nome: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-variavel'),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-variavel]', getAttrs: (el: HTMLElement) => ({ nome: el.getAttribute('data-variavel') }) }];
  },

  renderHTML({ node }) {
    return [
      'span',
      { 'data-variavel': node.attrs['nome'], class: 'rounded bg-blue-100 px-1 text-blue-800' },
      rotuloVariavel(node.attrs['nome']),
    ];
  },

  renderText({ node }) {
    return `{{${node.attrs['nome']}}}`;
  },
});
