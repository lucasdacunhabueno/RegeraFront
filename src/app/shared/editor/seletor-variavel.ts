import { afterNextRender, Component, ElementRef, Injector, inject, output, signal, viewChild } from '@angular/core';
import { VARIAVEIS } from '../../features/templates/template-models';

let sequencia = 0;

/**
 * Botão "Inserir variável" que abre uma lista (listbox) das variáveis (§9.2). Diferente de um `<select>` nativo, mover
 * com as setas não insere nada (WCAG 3.2.2): só clique, Enter ou Espaço emitem `escolher`. Esc fecha e devolve o foco ao
 * botão; sair da lista fecha. Depois de escolher, quem usa põe o foco de volta no campo (editor ou input do título).
 */
@Component({
  selector: 'app-seletor-variavel',
  host: { class: 'relative inline-block' },
  template: `
    <button
      #botao
      type="button"
      aria-haspopup="listbox"
      [attr.aria-expanded]="aberto() ? 'true' : 'false'"
      [attr.aria-controls]="aberto() ? id + '-lista' : null"
      (mousedown)="$event.preventDefault()"
      (click)="alternar()"
      (keydown)="teclaNoBotao($event)"
      class="h-12 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-100 lg:h-9"
    >
      Inserir variável <span aria-hidden="true">▾</span>
    </button>
    @if (aberto()) {
      <ul
        #lista
        [id]="id + '-lista'"
        role="listbox"
        tabindex="-1"
        aria-label="Variáveis"
        [attr.aria-activedescendant]="id + '-opcao-' + ativa()"
        (keydown)="teclaNaLista($event)"
        (focusout)="saiu($event)"
        (mousedown)="$event.preventDefault()"
        (click)="cliqueNaLista($event)"
        class="absolute right-0 z-20 mt-1 max-h-72 w-64 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg focus:outline-none"
      >
        @for (v of variaveis; track v.nome; let i = $index) {
          <li
            [id]="id + '-opcao-' + i"
            role="option"
            [attr.aria-selected]="i === ativa() ? 'true' : 'false'"
            [attr.data-indice]="i"
            class="flex min-h-12 cursor-pointer items-center px-3 text-sm hover:bg-slate-100 lg:min-h-9"
            [class.bg-blue-100]="i === ativa()"
            [class.text-blue-800]="i === ativa()"
          >
            {{ v.rotulo }}
          </li>
        }
      </ul>
    }
  `,
})
export class SeletorVariavel {
  /** Nome da variável escolhida (ex.: `cliente.nome`). */
  readonly escolher = output<string>();

  protected readonly id = `seletor-variavel-${++sequencia}`;
  protected readonly variaveis = VARIAVEIS;
  protected readonly aberto = signal(false);
  protected readonly ativa = signal(0);

  private readonly injector = inject(Injector);
  private readonly botao = viewChild.required<ElementRef<HTMLButtonElement>>('botao');
  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');

  protected alternar(): void {
    if (this.aberto()) {
      this.fechar(true);
    } else {
      this.abrir();
    }
  }

  protected teclaNoBotao(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.abrir(e.key === 'ArrowUp' ? VARIAVEIS.length - 1 : 0);
    }
  }

  protected teclaNaLista(e: KeyboardEvent): void {
    const ultima = VARIAVEIS.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        this.ativa.update((i) => Math.min(i + 1, ultima));
        break;
      case 'ArrowUp':
        this.ativa.update((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        this.ativa.set(0);
        break;
      case 'End':
        this.ativa.set(ultima);
        break;
      case 'Enter':
      case ' ':
        this.escolherIndice(this.ativa());
        break;
      case 'Escape':
        this.fechar(true);
        break;
      case 'Tab':
        this.fechar(false);
        return; // deixa o Tab seguir
      default:
        return;
    }
    e.preventDefault();
    this.rolarAteAtiva();
  }

  /** Clique tratado na lista (delegação): o teclado fica na lista, via aria-activedescendant. */
  protected cliqueNaLista(e: MouseEvent): void {
    const i = this.indiceDe(e);
    if (i !== undefined) this.escolherIndice(i);
  }

  private indiceDe(e: Event): number | undefined {
    const opcao = (e.target as HTMLElement).closest<HTMLElement>('[role=option]');
    return opcao?.dataset['indice'] === undefined ? undefined : Number(opcao.dataset['indice']);
  }

  protected saiu(e: FocusEvent): void {
    const destino = e.relatedTarget as Node | null;
    if (!destino || !(e.currentTarget as HTMLElement).contains(destino)) {
      this.aberto.set(false);
    }
  }

  protected escolherIndice(i: number): void {
    this.aberto.set(false);
    this.escolher.emit(VARIAVEIS[i].nome);
  }

  private abrir(ativa = 0): void {
    this.ativa.set(ativa);
    this.aberto.set(true);
    afterNextRender(() => this.lista()?.nativeElement.focus(), { injector: this.injector });
  }

  private fechar(devolverFoco: boolean): void {
    this.aberto.set(false);
    if (devolverFoco) this.botao().nativeElement.focus();
  }

  private rolarAteAtiva(): void {
    const lista = this.lista()?.nativeElement;
    lista?.querySelector(`#${this.id}-opcao-${this.ativa()}`)?.scrollIntoView?.({ block: 'nearest' });
  }
}
