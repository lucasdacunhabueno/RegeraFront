import { TiptapDoc, TiptapNo } from '../../features/templates/template-models';
import { tiptapParaPdf } from './tiptap-para-pdf';

const valores: Record<string, string> = { 'cliente.nome': 'ACME Ltda' };
const valor = (nome: string): string => valores[nome] ?? '';
const doc = (...content: TiptapNo[]): TiptapDoc => ({ type: 'doc', content });
const p = (...content: TiptapNo[]): TiptapNo => ({ type: 'paragraph', content });
const t = (text: string, ...marcas: string[]): TiptapNo =>
  marcas.length ? { type: 'text', text, marks: marcas.map((type) => ({ type })) } : { type: 'text', text };

describe('tiptapParaPdf', () => {
  it('parágrafo vira text com runs e margem inferior', () => {
    expect(tiptapParaPdf(doc(p(t('Olá'))), valor)).toEqual([{ text: [{ text: 'Olá' }], margin: [0, 0, 0, 6] }]);
  });

  it('parágrafo vazio (sem content ou só texto vazio) vira um espaço', () => {
    expect(tiptapParaPdf(doc({ type: 'paragraph' }, p({ type: 'variavel', attrs: { nome: 'cliente.email' } })), valor)).toEqual([
      { text: ' ', margin: [0, 0, 0, 6] },
      { text: ' ', margin: [0, 0, 0, 6] },
    ]);
  });

  it('alinhamento do parágrafo e do título', () => {
    const r = tiptapParaPdf(
      doc(
        { type: 'paragraph', attrs: { textAlign: 'center' }, content: [t('a')] },
        { type: 'paragraph', attrs: { textAlign: 'justify' }, content: [t('b')] },
        { type: 'paragraph', attrs: { textAlign: null }, content: [t('c')] },
        { type: 'heading', attrs: { level: 2, textAlign: 'right' }, content: [t('d')] },
      ),
      valor,
    );
    expect(r[0]).toMatchObject({ alignment: 'center' });
    expect(r[1]).toMatchObject({ alignment: 'justify' });
    expect(r[2]).not.toHaveProperty('alignment');
    expect(r[3]).toMatchObject({ alignment: 'right', style: 'h2' });
  });

  it('heading nível 2 e 3 usam os estilos h2 e h3', () => {
    const r = tiptapParaPdf(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [t('Dois')] },
        { type: 'heading', attrs: { level: 3 }, content: [t('Três')] },
      ),
      valor,
    );
    expect(r[0]).toMatchObject({ text: [{ text: 'Dois' }], style: 'h2' });
    expect(r[1]).toMatchObject({ text: [{ text: 'Três' }], style: 'h3' });
  });

  it('marcas bold, italic e underline', () => {
    const [par] = tiptapParaPdf(doc(p(t('n', 'bold'), t('i', 'italic'), t('s', 'underline'), t('tudo', 'bold', 'italic', 'underline'))), valor);
    expect((par as { text: unknown }).text).toEqual([
      { text: 'n', bold: true },
      { text: 'i', italics: true },
      { text: 's', decoration: 'underline' },
      { text: 'tudo', bold: true, italics: true, decoration: 'underline' },
    ]);
  });

  it('marca desconhecida é ignorada', () => {
    const [par] = tiptapParaPdf(doc(p({ type: 'text', text: 'x', marks: [{ type: 'link' }, { type: 'bold' }] })), valor);
    expect((par as { text: unknown }).text).toEqual([{ text: 'x', bold: true }]);
  });

  it('hardBreak vira quebra de linha', () => {
    const [par] = tiptapParaPdf(doc(p(t('a'), { type: 'hardBreak' }, t('b'))), valor);
    expect((par as { text: unknown }).text).toEqual([{ text: 'a' }, '\n', { text: 'b' }]);
  });

  it('variável vira o texto resolvido, com as marcas', () => {
    const [par] = tiptapParaPdf(
      doc(p(t('Cliente: '), { type: 'variavel', attrs: { nome: 'cliente.nome' }, marks: [{ type: 'bold' }] })),
      valor,
    );
    expect((par as { text: unknown }).text).toEqual([{ text: 'Cliente: ' }, { text: 'ACME Ltda', bold: true }]);
  });

  it('variável sem valor vira texto vazio', () => {
    const [par] = tiptapParaPdf(doc(p(t('E-mail: '), { type: 'variavel', attrs: { nome: 'cliente.email' } })), valor);
    expect((par as { text: unknown }).text).toEqual([{ text: 'E-mail: ' }, { text: '' }]);
  });

  it('bulletList vira ul; listItem vira stack do conteúdo', () => {
    const r = tiptapParaPdf(
      doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('um'))] }, { type: 'listItem', content: [p(t('dois'))] }] }),
      valor,
    );
    expect(r).toEqual([
      {
        ul: [{ stack: [{ text: [{ text: 'um' }], margin: [0, 0, 0, 6] }] }, { stack: [{ text: [{ text: 'dois' }], margin: [0, 0, 0, 6] }] }],
        margin: [0, 0, 0, 6],
      },
    ]);
  });

  it('orderedList vira ol, com start quando informado', () => {
    const item = { type: 'listItem', content: [p(t('x'))] };
    const r = tiptapParaPdf(
      doc({ type: 'orderedList', attrs: { start: 3 }, content: [item] }, { type: 'orderedList', content: [item] }),
      valor,
    );
    expect(r[0]).toMatchObject({ ol: [{ stack: [{ text: [{ text: 'x' }] }] }], start: 3 });
    expect(r[1]).toMatchObject({ ol: [{ stack: [{ text: [{ text: 'x' }] }] }] });
    expect(r[1]).not.toHaveProperty('start');
  });

  it('lista aninhada dentro de listItem', () => {
    const r = tiptapParaPdf(
      doc({
        type: 'bulletList',
        content: [{ type: 'listItem', content: [p(t('pai')), { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('filho'))] }] }] }],
      }),
      valor,
    );
    expect(r[0]).toMatchObject({ ul: [{ stack: [{ text: [{ text: 'pai' }] }, { ol: [{ stack: [{ text: [{ text: 'filho' }] }] }] }] }] });
  });

  it('nó desconhecido (de bloco ou inline) é ignorado', () => {
    const r = tiptapParaPdf(
      doc(
        { type: 'table', content: [{ type: 'tableRow' }] },
        p(t('a'), { type: 'image', attrs: { src: 'x.png' } }, t('b')),
        { type: 'blockquote', content: [p(t('citação'))] },
      ),
      valor,
    );
    expect(r).toEqual([{ text: [{ text: 'a' }, { text: 'b' }], margin: [0, 0, 0, 6] }]);
  });

  it('doc sem content e content inválido não quebram', () => {
    expect(tiptapParaPdf({ type: 'doc' }, valor)).toEqual([]);
    expect(tiptapParaPdf({ type: 'doc', content: 'x' as unknown as TiptapNo[] }, valor)).toEqual([]);
    expect(tiptapParaPdf(null as unknown as TiptapDoc, valor)).toEqual([]);
  });
});
