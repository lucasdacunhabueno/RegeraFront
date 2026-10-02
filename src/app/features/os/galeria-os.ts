import { Component, computed, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FOTOS_MAX_OS, MomentoFoto } from './os-models';
import type { AnexoOsVisivel } from './os-repo';

export const ROTULO_MOMENTO: Readonly<Record<MomentoFoto, string>> = { ANTES: 'Antes', DURANTE: 'Durante', DEPOIS: 'Depois' };
export const MOMENTOS: readonly MomentoFoto[] = ['ANTES', 'DURANTE', 'DEPOIS'];

interface ItemGaleria {
  anexo: AnexoOsVisivel;
  numero: number;
  url: string | null;
  alt: string;
  momento: string | null;
  /** Os bytes estão aqui ou no servidor: dá para ver a foto inteira. */
  podeAbrir: boolean;
}

/**
 * As fotos da OS (`OsRepo.observarAnexos`, só as FOTO): miniaturas na ordem da captura, com o momento, a legenda, o
 * contador `n/20` e "Não sincronizada" na foto que ainda não foi enviada. A miniatura é o JPEG de 320 px do aparelho;
 * a foto que só o servidor tem aparece como um quadro. "Ver foto" emite `abrir` (quem usa abre os bytes do aparelho ou
 * o download sem cache). Os URLs de blob das miniaturas ficam por id (o repositório reemite Blobs novos a cada escrita)
 * e são revogados quando a foto sai e no destroy.
 */
@Component({
  selector: 'app-galeria-os',
  host: { class: 'block space-y-2' },
  template: `
    <p class="text-sm text-slate-600">
      Fotos: <span data-testid="contador-fotos" class="font-semibold" aria-hidden="true">{{ itens().length }}/{{ limite }}</span>
      <span data-testid="contador-fotos-leitor" class="sr-only">{{ itens().length }} de {{ limite }} fotos</span>
    </p>
    <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Fotos da OS">
      @for (f of itens(); track f.anexo.id) {
        <li class="space-y-1 text-sm">
          @if (f.url) {
            <img [src]="f.url" [alt]="f.alt" class="aspect-square w-full rounded-lg bg-slate-100 object-cover" />
          } @else {
            <div role="img" [attr.aria-label]="f.alt"
                 class="flex aspect-square w-full items-center justify-center rounded-lg bg-slate-100 p-2 text-center text-xs text-slate-500">
              Foto no servidor
            </div>
          }
          <p class="flex flex-wrap items-center gap-1">
            @if (f.momento; as m) { <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{{ m }}</span> }
            @if (!f.anexo.enviado) {
              <span data-nao-sincronizada class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Não sincronizada</span>
            }
          </p>
          @if (f.anexo.legenda; as l) { <p class="break-words text-slate-700">{{ l }}</p> }
          @if (f.podeAbrir) {
            <button type="button" (click)="abrir.emit(f.anexo)" [attr.aria-label]="'Ver foto ' + f.numero"
                    class="min-h-12 text-sm font-semibold text-blue-700 underline">Ver foto</button>
          }
        </li>
      } @empty {
        <li class="col-span-full text-sm text-slate-500">Nenhuma foto ainda.</li>
      }
    </ul>
  `,
})
export class GaleriaOs {
  /** As FOTO da OS, na ordem da captura. */
  readonly fotos = input.required<readonly AnexoOsVisivel[]>();
  readonly abrir = output<AnexoOsVisivel>();

  protected readonly limite = FOTOS_MAX_OS;
  /** id → URL de blob da miniatura. */
  private readonly urls = signal<ReadonlyMap<string, string>>(new Map());

  protected readonly itens = computed<ItemGaleria[]>(() => {
    const urls = this.urls();
    return this.fotos().map((a, i) => {
      const momento = a.momento ? ROTULO_MOMENTO[a.momento] : null;
      const base = momento ? `Foto ${i + 1}, ${momento}` : `Foto ${i + 1}`;
      return {
        anexo: a,
        numero: i + 1,
        url: urls.get(a.id) ?? null,
        alt: a.legenda ? `${base}: ${a.legenda}` : base,
        momento,
        podeAbrir: a.temBytes || a.arquivoId !== null,
      };
    });
  });

  constructor() {
    effect(() => {
      const fotos = this.fotos();
      untracked(() => {
        const atuais = this.urls();
        const novas = new Map<string, string>();
        for (const a of fotos) {
          const url = atuais.get(a.id) ?? (a.miniatura ? URL.createObjectURL(a.miniatura) : null);
          if (url) novas.set(a.id, url);
        }
        for (const [id, url] of atuais) if (!novas.has(id)) URL.revokeObjectURL(url);
        this.urls.set(novas);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      for (const url of this.urls().values()) URL.revokeObjectURL(url);
    });
  }
}
