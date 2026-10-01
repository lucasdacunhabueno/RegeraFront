import { afterNextRender, Component, ElementRef, inject, Injector, input, output, signal, viewChild, viewChildren } from '@angular/core';
import { LucideChevronDown, LucideDynamicIcon } from '@lucide/angular';
import { STATUS_PROPOSTA, StatusProposta } from '../propostas/proposta-models';

let sequencia = 0;

export interface MovimentoEscolhido {
  para: StatusProposta;
  /** O botão "Mover para…": quem abre um diálogo devolve o foco a ele. */
  gatilho: HTMLElement;
}

/**
 * "Mover para…" de um card do kanban: um botão de menu (padrão menu button da APG) que lista só os destinos recebidos.
 * Teclado: Enter/Espaço ou seta para baixo abrem no primeiro item, seta para cima abre no último; setas, Home e End
 * circulam; Esc fecha e devolve o foco ao botão; Tab, o clique fora ou o foco saindo fecham. O menu abre no fluxo
 * (sem posição absoluta), então nada o corta dentro das colunas. `bloqueado` (CONFLITO): desabilitado, com a dica.
 */
@Component({
  selector: 'app-menu-mover',
  imports: [LucideDynamicIcon],
  host: { '(focusout)': 'aoSairFoco($event)', '(document:click)': 'aoClicarDocumento($event)' },
  template: `
    <button #gatilho type="button" [id]="id + '-gatilho'" aria-haspopup="menu" [attr.aria-expanded]="aberto()"
            [attr.aria-controls]="aberto() ? id + '-menu' : null" [disabled]="bloqueado()"
            [attr.aria-describedby]="bloqueado() ? id + '-dica' : null" (click)="alternar()" (keydown)="tecladoGatilho($event)"
            class="inline-flex min-h-12 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60">
      Mover para…<span class="sr-only"> (proposta {{ codigo() }})</span>
      <svg [lucideIcon]="iconeAbrir" [size]="16" aria-hidden="true"></svg>
    </button>
    @if (bloqueado()) {
      <p [id]="id + '-dica'" class="mt-1 text-xs text-amber-800">Resolva a pendência primeiro.</p>
    }
    @if (aberto()) {
      <ul role="menu" [id]="id + '-menu'" [attr.aria-labelledby]="id + '-gatilho'"
          class="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        @for (d of destinos(); track d) {
          <li role="none">
            <button #item type="button" role="menuitem" tabindex="-1" (click)="escolher(d)" (keydown)="tecladoMenu($event)"
                    class="flex min-h-12 w-full items-center px-3 text-left text-sm hover:bg-slate-100 focus:bg-blue-50 focus:outline-none">{{ rotulo(d) }}</button>
          </li>
        }
      </ul>
    }
  `,
})
export class MenuMover {
  /** Os destinos permitidos (`destinos` das regras do kanban). */
  readonly destinos = input.required<StatusProposta[]>();
  /** O código exibido da proposta, no nome acessível do botão. */
  readonly codigo = input.required<string>();
  readonly bloqueado = input(false);
  readonly escolhido = output<MovimentoEscolhido>();

  protected readonly id = `menu-mover-${++sequencia}`;
  protected readonly aberto = signal(false);
  protected readonly iconeAbrir = LucideChevronDown;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly gatilho = viewChild.required<ElementRef<HTMLButtonElement>>('gatilho');
  private readonly itens = viewChildren<ElementRef<HTMLButtonElement>>('item');

  protected rotulo(s: StatusProposta): string {
    return STATUS_PROPOSTA[s].rotulo;
  }

  protected alternar(): void {
    if (this.aberto()) this.fechar(true);
    else this.abrir('primeiro');
  }

  protected tecladoGatilho(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.abrir(e.key === 'ArrowDown' ? 'primeiro' : 'ultimo');
    } else if (e.key === 'Escape' && this.aberto()) {
      e.preventDefault();
      this.fechar(true);
    }
  }

  protected tecladoMenu(e: KeyboardEvent): void {
    const itens = this.itens().map((i) => i.nativeElement);
    const atual = itens.indexOf(e.target as HTMLButtonElement);
    const focar = (i: number) => {
      e.preventDefault();
      itens[(i + itens.length) % itens.length]?.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        return focar(atual + 1);
      case 'ArrowUp':
        return focar(atual - 1);
      case 'Home':
        return focar(0);
      case 'End':
        return focar(itens.length - 1);
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        return this.fechar(true);
      case 'Tab':
        // o foco segue para o próximo da página; o menu só fecha
        return this.fechar(false);
    }
  }

  protected escolher(para: StatusProposta): void {
    this.fechar(true);
    this.escolhido.emit({ para, gatilho: this.gatilho().nativeElement });
  }

  protected aoSairFoco(e: FocusEvent): void {
    const destino = e.relatedTarget as Node | null;
    if (this.aberto() && destino && !this.host.nativeElement.contains(destino)) this.fechar(false);
  }

  protected aoClicarDocumento(e: MouseEvent): void {
    if (this.aberto() && !this.host.nativeElement.contains(e.target as Node)) this.fechar(false);
  }

  private abrir(onde: 'primeiro' | 'ultimo'): void {
    if (this.bloqueado() || this.destinos().length === 0) return;
    this.aberto.set(true);
    afterNextRender(
      () => {
        const itens = this.itens();
        itens[onde === 'primeiro' ? 0 : itens.length - 1]?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  private fechar(devolverFoco: boolean): void {
    this.aberto.set(false);
    if (devolverFoco) this.gatilho().nativeElement.focus();
  }
}
