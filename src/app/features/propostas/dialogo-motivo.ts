import { afterNextRender, Component, computed, DestroyRef, DOCUMENT, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { motivoValido, stripJava } from './proposta-models';

let sequencia = 0;

const FOCAVEIS = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal das ações que pedem motivo (§8: RECUSADA e CANCELADA, 3 a 500 caracteres sem os espaços das pontas,
 * contados como o `String.strip()` do Java, igual ao `PropostasRepo`) ou só confirmação (`pedirMotivo` false: ex.
 * "Excluir rascunho", como `alertdialog`). Acessível: `aria-modal`, título e texto ligados, o foco entra no campo (ou
 * em Cancelar, na confirmação), fica preso no diálogo (Tab/Shift+Tab) e volta para quem o abriu ao fechar; Esc, o
 * Cancelar e o toque fora cancelam sem mudar nada. Quem usa mostra com `@if` e fecha nos dois eventos.
 */
@Component({
  selector: 'app-dialogo-motivo',
  host: {
    class: 'fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center',
    '(click)': 'aoClicarFora($event)',
  },
  template: `
    <div #painel tabindex="-1" [attr.role]="pedirMotivo() ? 'dialog' : 'alertdialog'" aria-modal="true" [attr.aria-labelledby]="id + '-titulo'"
         [attr.aria-describedby]="texto() ? id + '-texto' : null" (keydown)="teclado($event)"
         class="w-full max-w-md space-y-4 rounded-xl bg-white p-4 shadow-xl outline-none pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
      <h2 [id]="id + '-titulo'" class="text-lg font-semibold">{{ titulo() }}</h2>
      @if (texto(); as t) { <p [id]="id + '-texto'" class="text-sm text-slate-600">{{ t }}</p> }

      @if (pedirMotivo()) {
        <div class="space-y-1">
          <label [for]="id + '-motivo'" class="text-sm font-medium">Motivo</label>
          <textarea #campo [id]="id + '-motivo'" rows="4" [value]="motivo()" (input)="digitar($any($event.target).value)"
                    [attr.aria-invalid]="erro() ? 'true' : 'false'"
                    [attr.aria-describedby]="id + '-ajuda' + (erro() ? ' ' + id + '-erro' : '')"
                    class="w-full rounded-lg border px-3 py-2" [class.border-slate-300]="!erro()" [class.border-red-600]="erro()"></textarea>
          <p [id]="id + '-ajuda'" class="text-xs text-slate-500">
            De 3 a 500 caracteres. <span [class.text-red-600]="tamanho() > 500">{{ tamanho() }}/500</span>
          </p>
          @if (erro(); as e) { <p [id]="id + '-erro'" role="alert" class="text-sm text-red-600">{{ e }}</p> }
        </div>
      }

      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button #cancelar type="button" (click)="cancelado.emit()" [disabled]="ocupado()"
                class="h-12 rounded-lg border border-slate-300 px-4 font-semibold text-slate-700 disabled:opacity-60">{{ rotuloCancelar() }}</button>
        <button type="button" (click)="confirmar()" [disabled]="ocupado()"
                class="h-12 rounded-lg px-4 font-semibold text-white disabled:opacity-60" [class.bg-red-600]="perigo()"
                [class.bg-blue-600]="!perigo()">{{ ocupado() ? 'Aguarde…' : rotuloConfirmar() }}</button>
      </div>
    </div>
  `,
})
export class DialogoMotivo {
  readonly titulo = input.required<string>();
  readonly texto = input<string | null>(null);
  readonly rotuloConfirmar = input.required<string>();
  /** O botão que fecha sem fazer nada (ex.: "Voltar" quando a ação é "Cancelar proposta"). */
  readonly rotuloCancelar = input('Cancelar');
  /** false: só confirmação, sem campo (confirma com null). */
  readonly pedirMotivo = input(true);
  /** Ação destrutiva: o botão de confirmar em vermelho. */
  readonly perigo = input(false);
  /** A ação está gravando: os botões ficam desabilitados. */
  readonly ocupado = input(false);
  /** O motivo sem os espaços das pontas (`stripJava`), ou null sem `pedirMotivo`. */
  readonly confirmado = output<string | null>();
  readonly cancelado = output<void>();

  protected readonly id = `dialogo-motivo-${++sequencia}`;
  protected readonly motivo = signal('');
  protected readonly erro = signal<string | null>(null);
  protected readonly tamanho = computed(() => stripJava(this.motivo()).length);

  private readonly painel = viewChild.required<ElementRef<HTMLElement>>('painel');
  private readonly campo = viewChild<ElementRef<HTMLTextAreaElement>>('campo');
  private readonly botaoCancelar = viewChild.required<ElementRef<HTMLButtonElement>>('cancelar');

  constructor() {
    const documento = inject(DOCUMENT);
    // quem abriu (o botão da ação): recebe o foco de volta ao fechar
    const anterior = documento.activeElement instanceof HTMLElement ? documento.activeElement : null;
    afterNextRender(() => (this.campo() ?? this.botaoCancelar()).nativeElement.focus());
    inject(DestroyRef).onDestroy(() => {
      if (anterior?.isConnected) anterior.focus();
    });
  }

  protected digitar(valor: string): void {
    this.motivo.set(valor);
    if (this.erro() && motivoValido(valor)) this.erro.set(null);
  }

  protected confirmar(): void {
    if (this.ocupado()) return;
    if (!this.pedirMotivo()) {
      this.confirmado.emit(null);
      return;
    }
    if (!motivoValido(this.motivo())) {
      this.erro.set('Informe o motivo (de 3 a 500 caracteres).');
      this.campo()?.nativeElement.focus();
      return;
    }
    this.confirmado.emit(stripJava(this.motivo()));
  }

  protected teclado(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!this.ocupado()) this.cancelado.emit();
      return;
    }
    if (e.key !== 'Tab') return;
    const focaveis = [...this.painel().nativeElement.querySelectorAll<HTMLElement>(FOCAVEIS)];
    if (focaveis.length === 0) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const ativo = this.painel().nativeElement.ownerDocument.activeElement;
    if (e.shiftKey && (ativo === primeiro || !focaveis.includes(ativo as HTMLElement))) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && (ativo === ultimo || !focaveis.includes(ativo as HTMLElement))) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  /** O toque no fundo (fora do painel) cancela. */
  protected aoClicarFora(e: MouseEvent): void {
    if (!this.ocupado() && !this.painel().nativeElement.contains(e.target as Node)) this.cancelado.emit();
  }
}
