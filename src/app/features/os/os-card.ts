import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideClock, LucideDynamicIcon, LucideIcon, LucideRefreshCw, LucideTriangleAlert, LucideZap } from '@lucide/angular';
import { dataBr } from '../../core/pdf/formatos-pdf';
import { localDaOs, SeloOs } from './formatos-os';
import { codigoOsExibido, OsLocal, rotuloTipoOs, STATUS_OS } from './os-models';

/** Cor e ícone de cada selo da OS. */
export const ESTILO_SELO_OS: Readonly<Record<SeloOs['tipo'], { cor: string; icone: LucideIcon }>> = {
  'proposta-cancelada': { cor: 'bg-red-100 text-red-800', icone: LucideTriangleAlert },
  urgente: { cor: 'bg-red-100 text-red-800', icone: LucideZap },
  atrasada: { cor: 'bg-orange-100 text-orange-800', icone: LucideClock },
  'nao-sincronizada': { cor: 'bg-amber-100 text-amber-800', icone: LucideRefreshCw },
};

/**
 * Card de uma OS na lista. Só exibe: quem usa resolve os nomes e os selos (`selosDaOs`). O card inteiro é o link para
 * a OS. A OS não tem valor nenhum, e o card não recebe o cliente, só o nome: nem o CPF/CNPJ nem o endereço completo
 * passam por aqui (o local é o bairro e a cidade do snapshot). O técnico aparece só com `mostrarTecnico` (escritório).
 * As cores vão por `[attr.class]`, como no card da proposta.
 */
@Component({
  selector: 'app-os-card',
  imports: [RouterLink, LucideDynamicIcon],
  template: `
    <a [routerLink]="['/os', os().id]"
       class="block min-h-12 rounded-xl bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
      <div class="flex items-start justify-between gap-3">
        <p class="min-w-0 truncate font-mono text-sm font-semibold">{{ codigo() }}</p>
        <span data-status [attr.class]="'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ' + status().cor">{{ status().rotulo }}</span>
      </div>
      <p class="mt-1 truncate font-medium">{{ clienteNome() }}</p>
      @if (local(); as l) {
        <p data-local class="truncate text-sm text-slate-600">{{ l }}</p>
      }
      <div class="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm text-slate-600">
        <span data-tipo>{{ tipo() }}</span>
        <span data-prevista>{{ prevista() }}</span>
      </div>
      @if (mostrarTecnico()) {
        <p data-tecnico class="mt-1 truncate text-sm text-slate-500">{{ tecnicoNome() ? 'Técnico: ' + tecnicoNome() : 'Sem técnico' }}</p>
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
export class OsCard {
  readonly os = input.required<OsLocal>();
  readonly clienteNome = input.required<string>();
  /** null = sem técnico atribuído. */
  readonly tecnicoNome = input<string | null>(null);
  /** true no escritório; o técnico não vê a linha do técnico. */
  readonly mostrarTecnico = input(false);
  readonly selos = input<SeloOs[]>([]);

  protected readonly codigo = computed(() => codigoOsExibido(this.os()));
  protected readonly status = computed(() => STATUS_OS[this.os().status]);
  protected readonly tipo = computed(() => rotuloTipoOs(this.os().tipo));
  protected readonly local = computed(() => localDaOs(this.os()));
  protected readonly prevista = computed(() => {
    const data = dataBr(this.os().dataPrevista);
    return data ? `Prevista: ${data}` : 'Sem data prevista';
  });

  protected estilo(s: SeloOs) {
    return ESTILO_SELO_OS[s.tipo];
  }
}
