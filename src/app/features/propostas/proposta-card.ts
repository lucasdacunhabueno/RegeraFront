import { Component, computed, input } from '@angular/core';
import { LucideClock, LucideDynamicIcon, LucideIcon, LucideRefreshCw, LucideTriangleAlert } from '@lucide/angular';
import { RouterLink } from '@angular/router';
import { moedaCentavos, rotuloCodigo, rotuloTipo, Selo } from './formatos-proposta';
import { PropostaLocal, STATUS_PROPOSTA } from './proposta-models';

const SELO: Readonly<Record<Selo['tipo'], { cor: string; icone: LucideIcon }>> = {
  expirada: { cor: 'bg-orange-100 text-orange-800', icone: LucideClock },
  'nao-sincronizada': { cor: 'bg-amber-100 text-amber-800', icone: LucideRefreshCw },
  pendencia: { cor: 'bg-red-100 text-red-800', icone: LucideTriangleAlert },
};

/**
 * Card de uma proposta (lista, kanban e detalhe do cliente). Só exibe: quem usa resolve os nomes e os selos
 * (`selosDaProposta`). O card inteiro é o link para o detalhe. Com `mostrarValores` false (TECNICO) não sai nenhum
 * valor em dinheiro. As cores vão por `[attr.class]` e não por `[class]`: o `[class]` traz o runtime de classMap
 * do Angular para o bundle inicial (~1,5 kB).
 */
@Component({
  selector: 'app-proposta-card',
  imports: [RouterLink, LucideDynamicIcon],
  template: `
    <a [routerLink]="['/propostas', proposta().id]"
       class="block min-h-12 rounded-xl bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
      <div class="flex items-start justify-between gap-3">
        <p class="min-w-0 truncate font-mono text-sm font-semibold">{{ codigo() }}</p>
        <span data-status [attr.class]="'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ' + status().cor">{{ status().rotulo }}</span>
      </div>
      <p class="mt-1 truncate font-medium">{{ clienteNome() }}</p>
      <div class="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm text-slate-600">
        <span>{{ tipo() }}</span>
        @if (total(); as t) {
          <span class="font-semibold text-slate-900">{{ t }}</span>
        }
      </div>
      @if (responsavelNome(); as nome) {
        <p class="mt-1 truncate text-sm text-slate-500">Responsável: {{ nome }}</p>
      }
      @if (selos().length > 0) {
        <ul class="mt-2 flex flex-wrap gap-1.5" aria-label="Avisos">
          @for (s of selos(); track s.tipo) {
            <li [attr.data-selo]="s.tipo" [attr.class]="'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ' + estilo(s).cor">
              <svg [lucideIcon]="estilo(s).icone" [size]="12" aria-hidden="true"></svg>
              {{ s.rotulo }}
            </li>
          }
        </ul>
      }
    </a>
  `,
})
export class PropostaCard {
  readonly proposta = input.required<PropostaLocal>();
  readonly clienteNome = input.required<string>();
  readonly responsavelNome = input<string | null>(null);
  /** false para o TECNICO: o card não mostra o total. */
  readonly mostrarValores = input.required<boolean>();
  readonly selos = input<Selo[]>([]);

  protected readonly codigo = computed(() => rotuloCodigo(this.proposta()));
  protected readonly status = computed(() => STATUS_PROPOSTA[this.proposta().status]);
  protected readonly tipo = computed(() => rotuloTipo(this.proposta().tipo));
  protected readonly total = computed(() => {
    const centavos = this.proposta().totalCentavos;
    return this.mostrarValores() && centavos !== null ? moedaCentavos(centavos) : null;
  });

  protected estilo(s: Selo) {
    return SELO[s.tipo];
  }
}
