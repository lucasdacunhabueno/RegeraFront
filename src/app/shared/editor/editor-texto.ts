import {
  afterNextRender,
  Component,
  effect,
  ElementRef,
  input,
  OnDestroy,
  output,
  signal,
  untracked,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import {
  LucideAlignCenter,
  LucideAlignJustify,
  LucideAlignLeft,
  LucideAlignRight,
  LucideBold,
  LucideDynamicIcon,
  LucideHeading2,
  LucideHeading3,
  LucideIcon,
  LucideItalic,
  LucideList,
  LucideListOrdered,
  LucidePilcrow,
  LucideUnderline,
} from '@lucide/angular';
import { ChainedCommands, Editor } from '@tiptap/core';
import { TextAlign } from '@tiptap/extension-text-align';
import { StarterKit } from '@tiptap/starter-kit';
import { TiptapDoc, VARIAVEIS } from '../../features/templates/template-models';
import { limparTiptap } from './limpar-tiptap';
import { VariavelNode } from './variavel-node';

interface Botao {
  rotulo: string;
  icone: LucideIcon;
  ativo: (e: Editor) => boolean;
  acao: (c: ChainedCommands) => ChainedCommands;
}

const alinhado = (e: Editor, a: string) => e.isActive({ textAlign: a });

const BOTOES: readonly Botao[] = [
  { rotulo: 'Parágrafo', icone: LucidePilcrow, ativo: (e) => e.isActive('paragraph'), acao: (c) => c.setParagraph() },
  { rotulo: 'Título 2', icone: LucideHeading2, ativo: (e) => e.isActive('heading', { level: 2 }), acao: (c) => c.toggleHeading({ level: 2 }) },
  { rotulo: 'Título 3', icone: LucideHeading3, ativo: (e) => e.isActive('heading', { level: 3 }), acao: (c) => c.toggleHeading({ level: 3 }) },
  { rotulo: 'Negrito', icone: LucideBold, ativo: (e) => e.isActive('bold'), acao: (c) => c.toggleBold() },
  { rotulo: 'Itálico', icone: LucideItalic, ativo: (e) => e.isActive('italic'), acao: (c) => c.toggleItalic() },
  { rotulo: 'Sublinhado', icone: LucideUnderline, ativo: (e) => e.isActive('underline'), acao: (c) => c.toggleUnderline() },
  { rotulo: 'Lista com marcador', icone: LucideList, ativo: (e) => e.isActive('bulletList'), acao: (c) => c.toggleBulletList() },
  { rotulo: 'Lista numerada', icone: LucideListOrdered, ativo: (e) => e.isActive('orderedList'), acao: (c) => c.toggleOrderedList() },
  {
    rotulo: 'Alinhar à esquerda',
    icone: LucideAlignLeft,
    // sem alinhamento (null) o texto sai à esquerda
    ativo: (e) => !['center', 'right', 'justify'].some((a) => alinhado(e, a)),
    acao: (c) => c.setTextAlign('left'),
  },
  { rotulo: 'Centralizar', icone: LucideAlignCenter, ativo: (e) => alinhado(e, 'center'), acao: (c) => c.setTextAlign('center') },
  { rotulo: 'Alinhar à direita', icone: LucideAlignRight, ativo: (e) => alinhado(e, 'right'), acao: (c) => c.setTextAlign('right') },
  { rotulo: 'Justificar', icone: LucideAlignJustify, ativo: (e) => alinhado(e, 'justify'), acao: (c) => c.setTextAlign('justify') },
];

/**
 * HTML colado (Word, página web): títulos fora dos níveis permitidos viram o mais próximo (h1 → h2, h4–h6 → h3), em
 * vez de virar parágrafo. O resto do filtro é o schema do editor mais o `limparTiptap` na saída.
 */
export function normalizarHtmlColado(html: string): string {
  return html.replace(/<(\/?)h([1-6])(?=[\s>/])/gi, (_, barra: string, n: string) => {
    const nivel = Number(n);
    return `<${barra}h${nivel === 1 ? 2 : Math.min(nivel, 3)}`;
  });
}

const iguais = (a: readonly boolean[], b: readonly boolean[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Editor de texto rico restrito (§9.1) sobre o Tiptap 3 (sem binding Angular: `Editor` do `@tiptap/core` num elemento
 * do template). Só é importado por páginas de rota lazy (templates), para o Tiptap não entrar no bundle inicial.
 * - Emite `conteudoChange` a cada `update` com `limparTiptap(editor.getJSON())`: nunca HTML, só o JSON permitido.
 * - `conteudo` vindo de fora, diferente do doc atual, entra com `setContent(..., { emitUpdate: false })`.
 * - Zoneless: os eventos do Tiptap só atualizam signals.
 */
@Component({
  selector: 'app-editor-texto',
  imports: [LucideDynamicIcon],
  encapsulation: ViewEncapsulation.None,
  styles: `
    .editor-texto .ProseMirror { min-height: 8rem; outline: none; }
    .editor-texto .ProseMirror p { margin: 0.25rem 0; }
    .editor-texto .ProseMirror h2 { margin: 0.75rem 0 0.25rem; font-size: 1.25rem; font-weight: 600; }
    .editor-texto .ProseMirror h3 { margin: 0.5rem 0 0.25rem; font-size: 1.125rem; font-weight: 600; }
    .editor-texto .ProseMirror ul { list-style: disc; padding-left: 1.5rem; }
    .editor-texto .ProseMirror ol { list-style: decimal; padding-left: 1.5rem; }
  `,
  template: `
    <div class="rounded-lg border border-slate-300 bg-white focus-within:border-blue-600">
      @if (!somenteLeitura()) {
        <div role="toolbar" aria-label="Formatação do texto" class="flex flex-wrap items-center gap-1 border-b border-slate-200 p-1">
          @for (b of botoes; track b.rotulo; let i = $index) {
            <button
              type="button"
              [attr.aria-label]="b.rotulo"
              [attr.aria-pressed]="ativos()[i] ? 'true' : 'false'"
              [title]="b.rotulo"
              (mousedown)="$event.preventDefault()"
              (click)="acionar(b)"
              class="flex h-12 w-12 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 lg:h-9 lg:w-9"
              [class.bg-blue-100]="ativos()[i]"
              [class.text-blue-800]="ativos()[i]"
            >
              <svg [lucideIcon]="b.icone" [size]="18" aria-hidden="true"></svg>
            </button>
          }
          <select
            aria-label="Inserir variável"
            (change)="inserirVariavel($event)"
            class="h-12 max-w-full rounded-lg border border-slate-300 bg-white px-2 text-sm lg:h-9"
          >
            <option value="">Inserir variável</option>
            @for (v of variaveis; track v.nome) {
              <option [value]="v.nome">{{ v.rotulo }}</option>
            }
          </select>
        </div>
      }
      <div #host class="editor-texto px-3 py-2"></div>
    </div>
  `,
})
export class EditorTexto implements OnDestroy {
  readonly conteudo = input<TiptapDoc | null>(null);
  readonly somenteLeitura = input(false);
  /** Nome acessível da área de texto. */
  readonly rotulo = input('Texto');
  readonly conteudoChange = output<TiptapDoc>();

  protected readonly botoes = BOTOES;
  protected readonly variaveis = VARIAVEIS;
  /** Estado de cada botão da barra (mesma ordem de `botoes`), atualizado a cada transação do Tiptap. */
  protected readonly ativos = signal<readonly boolean[]>([], { equal: iguais });

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private instancia?: Editor;

  /** O `Editor` do Tiptap, depois da primeira renderização. */
  get editor(): Editor | undefined {
    return this.instancia;
  }

  constructor() {
    afterNextRender(() => this.criar());
    effect(() => {
      const conteudo = this.conteudo();
      untracked(() => this.aplicar(conteudo));
    });
    effect(() => {
      const somenteLeitura = this.somenteLeitura();
      untracked(() => this.instancia?.setEditable(!somenteLeitura, false));
    });
  }

  ngOnDestroy(): void {
    this.instancia?.destroy();
    this.instancia = undefined;
  }

  protected acionar(b: Botao): void {
    if (this.instancia) {
      b.acao(this.instancia.chain().focus()).run();
    }
  }

  protected inserirVariavel(evento: Event): void {
    const menu = evento.target as HTMLSelectElement;
    const nome = menu.value;
    menu.value = '';
    if (nome !== '' && this.instancia) {
      this.instancia.chain().focus().insertContent({ type: 'variavel', attrs: { nome } }).run();
    }
  }

  private criar(): void {
    this.instancia = new Editor({
      element: this.host().nativeElement,
      extensions: [
        StarterKit.configure({
          blockquote: false,
          code: false,
          codeBlock: false,
          horizontalRule: false,
          strike: false,
          link: false,
          heading: { levels: [2, 3] },
          // P4a-R8: sem parágrafo vazio automático no fim (sairia como espaço em branco no PDF)
          trailingNode: false,
        }),
        TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
        VariavelNode,
      ],
      content: limparTiptap(this.conteudo()),
      editable: !this.somenteLeitura(),
      editorProps: {
        attributes: { 'aria-label': this.rotulo(), 'aria-multiline': 'true', role: 'textbox' },
        transformPastedHTML: normalizarHtmlColado,
      },
      onUpdate: ({ editor }) => this.conteudoChange.emit(limparTiptap(editor.getJSON())),
      onTransaction: ({ editor }) => this.atualizarBarra(editor),
    });
    this.atualizarBarra(this.instancia);
  }

  private aplicar(conteudo: TiptapDoc | null): void {
    const editor = this.instancia;
    if (!editor) return;
    const novo = limparTiptap(conteudo);
    if (JSON.stringify(novo) !== JSON.stringify(limparTiptap(editor.getJSON()))) {
      editor.commands.setContent(novo, { emitUpdate: false });
    }
  }

  private atualizarBarra(editor: Editor): void {
    this.ativos.set(BOTOES.map((b) => b.ativo(editor)));
  }
}
