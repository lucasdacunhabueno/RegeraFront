import { Component, inject } from '@angular/core';
import { Toast, Toasts } from './toasts';

@Component({
  selector: 'app-toast-host',
  template: `
    <div class="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-4">
      @for (t of toasts.itens(); track t.id) {
        <div
          [attr.role]="t.tipo === 'erro' ? 'alert' : 'status'"
          class="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg px-4 py-3 text-sm text-white shadow-lg"
          [class.bg-slate-800]="t.tipo === 'info'"
          [class.bg-red-600]="t.tipo === 'erro'"
        >
          <span class="flex-1">{{ t.mensagem }}</span>
          @if (t.acao) {
            <button type="button" class="font-semibold underline" (click)="agir(t)">{{ t.acao }}</button>
          }
          <button type="button" aria-label="Fechar" (click)="toasts.fechar(t.id)">✕</button>
        </div>
      }
    </div>
  `,
})
export class ToastHost {
  protected readonly toasts = inject(Toasts);

  protected agir(t: Toast): void {
    t.aoAgir?.();
    this.toasts.fechar(t.id);
  }
}
