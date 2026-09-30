import { TestBed } from '@angular/core/testing';
import { TiptapDoc, TiptapNo, validarBlocos } from '../../features/templates/template-models';
import { EditorTexto, normalizarHtmlColado } from './editor-texto';

const doc = (...content: TiptapNo[]): TiptapDoc => ({ type: 'doc', content });
const paragrafo = (texto: string): TiptapNo => ({ type: 'paragraph', content: [{ type: 'text', text: texto }] });
const valida = (conteudo: unknown) => validarBlocos([{ id: 'a', tipo: 'TEXTO', config: { conteudo } }]);

/** Todos os nós (menos o doc) e todas as marcas do JSON. */
function percorrer(no: TiptapNo | TiptapDoc, nos: TiptapNo[] = []): TiptapNo[] {
  for (const filho of no.content ?? []) {
    nos.push(filho);
    percorrer(filho, nos);
  }
  return nos;
}
const textoDe = (d: TiptapDoc) => percorrer(d).map((n) => n.text ?? '').join('');

async function montar(conteudo: TiptapDoc = doc(paragrafo('Olá mundo'))) {
  const fixture = TestBed.createComponent(EditorTexto);
  fixture.componentRef.setInput('conteudo', conteudo);
  const emitidos: TiptapDoc[] = [];
  fixture.componentInstance.conteudoChange.subscribe((d) => emitidos.push(d));
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const editor = fixture.componentInstance.editor!;
  const botao = (rotulo: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${rotulo}"]`)!;
  const ultimo = () => emitidos[emitidos.length - 1];
  return { fixture, el, editor, emitidos, botao, ultimo };
}

describe('EditorTexto', () => {
  // O jsdom não implementa Range.getClientRects/getBoundingClientRect, que o ProseMirror usa para rolar até a seleção
  // (scrollIntoView depois de focus/insertContent). Retângulos vazios bastam: não há layout no jsdom.
  beforeAll(() => {
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  });

  it('monta o Tiptap com o conteúdo recebido', async () => {
    const { el, editor } = await montar();

    expect(editor).toBeDefined();
    expect(el.querySelector('.ProseMirror')?.textContent).toBe('Olá mundo');
  });

  it('botão Negrito aplica a marca bold e o JSON emitido tem a marca', async () => {
    const { fixture, editor, botao, ultimo } = await montar();
    editor.commands.selectAll();

    botao('Negrito').click();
    await fixture.whenStable();

    expect(ultimo()).toEqual(doc({ type: 'paragraph', content: [{ type: 'text', text: 'Olá mundo', marks: [{ type: 'bold' }] }] }));
    expect(botao('Negrito').getAttribute('aria-pressed')).toBe('true');
    expect(botao('Itálico').getAttribute('aria-pressed')).toBe('false');
  });

  it('toda a barra tem aria-label e aria-pressed', async () => {
    const { el } = await montar();
    const rotulos = Array.from(el.querySelectorAll('[role=toolbar] button')).map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-pressed')]);

    expect(rotulos.map(([r]) => r)).toEqual([
      'Parágrafo', 'Título 2', 'Título 3', 'Negrito', 'Itálico', 'Sublinhado', 'Lista com marcador', 'Lista numerada',
      'Alinhar à esquerda', 'Centralizar', 'Alinhar à direita', 'Justificar',
    ]);
    expect(rotulos.every(([, p]) => p === 'true' || p === 'false')).toBe(true);
    expect(el.querySelector('select[aria-label="Inserir variável"]')).not.toBeNull();
  });

  it('Título 2, centralizar e lista numerada geram JSON válido (sem orderedList.type)', async () => {
    const { fixture, editor, botao, ultimo } = await montar(doc(paragrafo('Título'), paragrafo('item')));
    editor.commands.setTextSelection(2);
    botao('Título 2').click();
    botao('Centralizar').click();
    editor.commands.setTextSelection(10);
    botao('Lista numerada').click();
    await fixture.whenStable();

    expect(ultimo()).toEqual(
      doc(
        { type: 'heading', attrs: { textAlign: 'center', level: 2 }, content: [{ type: 'text', text: 'Título' }] },
        { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [paragrafo('item')] }] },
        { type: 'paragraph' }, // TrailingNode do StarterKit: sempre dá para escrever depois da lista
      ),
    );
    expect(valida(ultimo())).toEqual({});
    expect(botao('Lista numerada').getAttribute('aria-pressed')).toBe('true');
  });

  it('insere a variável pelo menu: nó variavel com attrs.nome, chip com o rótulo e texto {{nome}}', async () => {
    const { fixture, el, editor, ultimo } = await montar(doc(paragrafo('Cliente: ')));
    editor.commands.focus('end');
    const menu = el.querySelector<HTMLSelectElement>('select[aria-label="Inserir variável"]')!;

    menu.value = 'cliente.nome';
    menu.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(ultimo()).toEqual(
      doc({ type: 'paragraph', content: [{ type: 'text', text: 'Cliente: ' }, { type: 'variavel', attrs: { nome: 'cliente.nome' } }] }),
    );
    const chip = el.querySelector('.ProseMirror span[data-variavel="cliente.nome"]');
    expect(chip?.textContent).toBe('Nome do cliente');
    expect(editor.getText()).toBe('Cliente: {{cliente.nome}}');
    expect(menu.value).toBe('');
  });

  it('HTML colado (Review Focus 1): só o permitido fica, o texto sobrevive e o JSON passa na validação', async () => {
    const { fixture, editor, ultimo } = await montar(doc({ type: 'paragraph' }));

    editor.commands.insertContent(
      '<table><tr><td>x</td></tr></table><a href="https://x">link</a><img src="x.png"><span style="color:red">vermelho</span><h1>T</h1><p><strong>forte</strong></p>',
    );
    await fixture.whenStable();

    const json = ultimo();
    const nos = percorrer(json);
    const tipos = new Set(nos.map((n) => n.type));
    const marcas = new Set(nos.flatMap((n) => (n.marks ?? []).map((m) => m.type)));
    for (const t of tipos) expect(['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'text', 'hardBreak', 'variavel']).toContain(t);
    for (const m of marcas) expect(['bold', 'italic', 'underline']).toContain(m);
    for (const t of ['x', 'link', 'vermelho', 'T', 'forte']) expect(textoDe(json)).toContain(t);
    expect(nos.filter((n) => n.type === 'heading').every((n) => n.attrs?.['level'] === 2)).toBe(true);
    expect(nos.find((n) => n.text === 'forte')?.marks).toEqual([{ type: 'bold' }]);
    expect(JSON.stringify(json)).not.toMatch(/href|src|color|style/);
    expect(valida(json)).toEqual({});
  });

  it('colar de verdade (Word/web): h1 vira Título 2, lista com type some e o JSON passa na validação', async () => {
    const { fixture, editor, ultimo } = await montar(doc({ type: 'paragraph' }));

    editor.view.pasteHTML(
      '<h1 class="MsoTitle">Proposta</h1>' +
        '<p class="MsoNormal" style="text-align:justify;font-family:Calibri;color:#333"><b>Olá</b> <i>mundo</i><o:p></o:p></p>' +
        '<ol type="a" start="3"><li>um</li></ol><h5>menor</h5>',
      new Event('paste') as ClipboardEvent, // o jsdom não tem ClipboardEvent (o padrão do pasteHTML)
    );
    await fixture.whenStable();

    const json = ultimo();
    expect(json.content?.[0]).toEqual({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Proposta' }] });
    const nos = percorrer(json);
    expect(nos.find((n) => n.type === 'orderedList')?.attrs).toEqual({ start: 3 });
    expect(nos.find((n) => n.text === 'menor')).toBeDefined();
    expect(nos.filter((n) => n.type === 'heading').map((n) => n.attrs?.['level'])).toEqual([2, 3]);
    expect(nos.find((n) => n.text === 'Olá')?.marks).toEqual([{ type: 'bold' }]);
    expect(valida(json)).toEqual({});
  });

  it('conteudo novo de fora é aplicado sem emitir; o mesmo conteúdo não mexe no editor', async () => {
    const { fixture, editor, emitidos } = await montar();
    let transacoes = 0;
    editor.on('transaction', () => transacoes++);

    fixture.componentRef.setInput('conteudo', doc(paragrafo('Outro texto')));
    await fixture.whenStable();
    expect(editor.getText()).toBe('Outro texto');
    expect(emitidos).toEqual([]);

    const antes = transacoes;
    fixture.componentRef.setInput('conteudo', doc(paragrafo('Outro texto')));
    await fixture.whenStable();
    expect(transacoes).toBe(antes);
  });

  it('conteudo de fora com formatação estranha é limpo antes de entrar no editor', async () => {
    const { editor } = await montar({
      type: 'doc',
      content: [{ type: 'blockquote', content: [paragrafo('guardado')] }, { type: 'paragraph', content: [{ type: 'variavel', attrs: { nome: 'x.y' } }] }],
    } as TiptapDoc);

    // sem a limpeza, o Tiptap recusaria o doc (tipo desconhecido) e o editor abriria vazio
    expect(editor.getJSON()).toEqual(doc({ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: 'guardado' }] }, { type: 'paragraph', attrs: { textAlign: null } }));
  });

  it('somenteLeitura desliga a edição e esconde a barra', async () => {
    const { fixture, el, editor } = await montar();

    fixture.componentRef.setInput('somenteLeitura', true);
    await fixture.whenStable();

    expect(editor.isEditable).toBe(false);
    expect(el.querySelector('[role=toolbar]')).toBeNull();
  });

  it('destrói o editor no ngOnDestroy', async () => {
    const { fixture, editor } = await montar();

    fixture.destroy();

    expect(editor.isDestroyed).toBe(true);
  });
});

describe('normalizarHtmlColado', () => {
  it('h1 vira h2 e h4–h6 viram h3, mantendo os atributos', () => {
    expect(normalizarHtmlColado('<H1 class="a">x</H1><h4>y</h4><h6 style="c">z</h6><h2>w</h2><hr>')).toBe(
      '<h2 class="a">x</h2><h3>y</h3><h3 style="c">z</h3><h2>w</h2><hr>',
    );
  });
});
