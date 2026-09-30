import { TiptapNo, validarBlocos } from '../../features/templates/template-models';
import { limparTiptap } from './limpar-tiptap';

const valida = (conteudo: unknown) => validarBlocos([{ id: 'a', tipo: 'TEXTO', config: { conteudo } }]);

describe('limparTiptap', () => {
  it('mantém um doc já permitido como está', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { textAlign: 'center', level: 3 }, content: [{ type: 'text', text: 'T' }] },
        {
          type: 'paragraph',
          attrs: { textAlign: 'justify' },
          content: [
            { type: 'text', text: 'Olá ', marks: [{ type: 'bold' }, { type: 'underline' }] },
            { type: 'variavel', attrs: { nome: 'cliente.nome' } },
            { type: 'hardBreak' },
          ],
        },
        { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      ],
    };
    expect(limparTiptap(doc)).toEqual(doc);
  });

  it('remove atributos fora da whitelist e normaliza os defaults', () => {
    const limpo = limparTiptap({
      type: 'doc',
      extra: 1,
      content: [
        { type: 'paragraph', attrs: { textAlign: null, class: 'MsoNormal', style: 'color:red' }, content: [{ type: 'text', text: 'a', id: 'x' }] },
        { type: 'paragraph', attrs: { textAlign: 'start' }, content: [{ type: 'text', text: 'b' }] },
        { type: 'heading', attrs: { level: 1, id: 't1', textAlign: 'right' }, content: [{ type: 'text', text: 'h1' }] },
        { type: 'heading', attrs: { level: 5 }, content: [{ type: 'text', text: 'h5' }] },
        { type: 'heading', content: [{ type: 'text', text: 'sem nível' }] },
        { type: 'orderedList', attrs: { start: 1, type: null }, content: [{ type: 'listItem', attrs: { x: 1 }, content: [{ type: 'paragraph' }] }] },
        { type: 'orderedList', attrs: { start: 0, type: 'a' }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'bulletList', attrs: { tight: true }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        {
          type: 'paragraph',
          content: [
            { type: 'variavel', attrs: { nome: 'proposta.numero', rotulo: 'x' } },
            { type: 'text', text: 'c', marks: [{ type: 'bold', attrs: { x: 1 } }, { type: 'link', attrs: { href: 'https://x' } }, { type: 'bold' }] },
            { type: 'hardBreak', attrs: { x: 1 } },
          ],
        },
      ],
    });

    expect(limpo).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
        { type: 'heading', attrs: { textAlign: 'right', level: 2 }, content: [{ type: 'text', text: 'h1' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'h5' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'sem nível' }] },
        { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        {
          type: 'paragraph',
          content: [
            { type: 'variavel', attrs: { nome: 'proposta.numero' } },
            { type: 'text', text: 'c', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
          ],
        },
      ],
    });
    expect(valida(limpo)).toEqual({});
  });

  it('nós e marcas desconhecidos somem, o texto fica', () => {
    const limpo = limparTiptap({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'célula' }] }] }] }],
        },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'citação' }] }] },
        { type: 'image', attrs: { src: 'x.png' } },
        { type: 'horizontalRule' },
        { type: 'codeBlock', content: [{ type: 'text', text: 'código' }] },
        { type: 'text', text: 'solto', marks: [{ type: 'textStyle', attrs: { color: 'red' } }, { type: 'italic' }] },
        { type: 'paragraph', content: [{ type: 'emoji', content: [{ type: 'text', text: 'dentro' }] }, { type: 'variavel', attrs: { nome: 'nao.existe' } }] },
        { type: 'paragraph', content: [{ type: 'text', text: '' }, { type: 'text', text: 3 }] },
      ],
    });

    expect(limpo).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'célula' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'citação' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'código' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'solto', marks: [{ type: 'italic' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'dentro' }] },
        { type: 'paragraph' },
      ],
    });
    expect(valida(limpo)).toEqual({});
  });

  it('listas: filhos que não são listItem viram itens e o item começa por parágrafo', () => {
    const limpo = limparTiptap({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'text', text: 'solto' },
            { type: 'listItem', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'h' }] }] },
            { type: 'listItem' },
          ],
        },
        { type: 'orderedList', content: [] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item órfão' }] }] },
      ],
    });

    expect(limpo).toEqual({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'solto' }] }] },
            {
              type: 'listItem',
              content: [{ type: 'paragraph' }, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'h' }] }],
            },
            { type: 'listItem', content: [{ type: 'paragraph' }] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'item órfão' }] },
      ],
    });
    expect(valida(limpo)).toEqual({});
  });

  it('listas aninhadas além da profundidade máxima são achatadas sem perder texto', () => {
    let no: TiptapNo = { type: 'paragraph', content: [{ type: 'text', text: 'fundo' }] };
    for (let i = 0; i < 10; i++) {
      no = { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: `n${i}` }] }, no] }] };
    }
    const limpo = limparTiptap({ type: 'doc', content: [no] });

    expect(valida(limpo)).toEqual({});
    const textos = JSON.stringify(limpo).match(/"text":"[^"]*"/g) ?? [];
    expect(textos).toHaveLength(11);
    expect(JSON.stringify(limpo)).toContain('"fundo"');
  });

  it('entrada inválida vira um doc com um parágrafo vazio', () => {
    for (const entrada of [null, undefined, 'x', 3, [], { type: 'doc' }, { type: 'doc', content: 'x' }]) {
      expect(limparTiptap(entrada)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    }
  });
});
