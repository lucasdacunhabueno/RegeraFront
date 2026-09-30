import { Component, effect, inject, input, signal } from '@angular/core';
import { LucideDynamicIcon, LucidePackage } from '@lucide/angular';
import { ArquivosService } from '../../core/arquivos/arquivos-service';

@Component({
  selector: 'app-foto-item',
  imports: [LucideDynamicIcon],
  template: `
    @if (url()) {
      <img [src]="url()" alt="" class="size-12 shrink-0 rounded-lg object-cover" />
    } @else {
      <div class="flex size-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
        <svg [lucideIcon]="icone" [size]="20"></svg>
      </div>
    }
  `,
})
export class FotoItem {
  readonly arquivoId = input<string | null>(null);
  private readonly arquivos = inject(ArquivosService);
  protected readonly url = signal<string | null>(null);
  protected readonly icone = LucidePackage;

  constructor() {
    effect(() => {
      const id = this.arquivoId();
      this.url.set(null);
      if (!id) return;
      void this.arquivos.obterUrl(id).then((u) => {
        if (this.arquivoId() === id) this.url.set(u);
      });
    });
  }
}
