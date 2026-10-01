import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth-service';
import { formatarMoeda } from '../../core/util/moeda';
import { CatalogoRepo } from './catalogo-repo';
import { FotoItem } from './foto-item';
import { FiltroCatalogo, filtrarItens } from './item-models';

@Component({
  selector: 'app-catalogo-page',
  imports: [RouterLink, NgTemplateOutlet, FotoItem],
  template: `
    <div class="mb-4 flex items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">Catálogo</h1>
      @if (admin()) {
        <a routerLink="/catalogo/novo" class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Novo item</a>
      }
    </div>

    <input type="search" [value]="busca()" (input)="busca.set($any($event.target).value)"
           placeholder="Buscar por código ou nome" aria-label="Buscar no catálogo"
           class="mb-3 h-12 w-full rounded-lg border border-slate-300 px-3" />

    <div class="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar catálogo">
      @for (f of filtros; track f.valor) {
        <button type="button" (click)="filtro.set(f.valor)" [attr.aria-pressed]="filtro() === f.valor"
                class="min-h-12 rounded-full border px-4 py-1.5 text-sm"
                [class.border-blue-600]="filtro() === f.valor" [class.bg-blue-50]="filtro() === f.valor"
                [class.border-slate-300]="filtro() !== f.valor">{{ f.rotulo }}</button>
      }
      @if (admin()) {
        <label class="ml-auto flex items-center gap-2 text-sm text-slate-600">
          <input id="mostrar-inativos" type="checkbox" [checked]="inativos()" (change)="inativos.set(!inativos())" class="size-4" />
          Mostrar inativos
        </label>
      }
    </div>

    @if (todos() === undefined) {
      <p class="py-8 text-center text-slate-500">Carregando…</p>
    } @else if (filtrados().length === 0) {
      <p class="py-8 text-center text-slate-500">
        {{ busca().trim() || filtro() !== 'TODOS' ? 'Nenhum item encontrado.' : 'Nenhum item no catálogo ainda.' }}
      </p>
    } @else {
      <ul class="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white">
        @for (i of filtrados(); track i.id) {
          <li>
            @if (admin()) {
              <a [routerLink]="['/catalogo', i.id]" class="flex items-center gap-3 px-4 py-3">
                <ng-container *ngTemplateOutlet="linha; context: { $implicit: i }" />
              </a>
            } @else {
              <div class="flex items-center gap-3 px-4 py-3">
                <ng-container *ngTemplateOutlet="linha; context: { $implicit: i }" />
              </div>
            }
          </li>
        }
      </ul>
    }

    <ng-template #linha let-i>
      <app-foto-item [arquivoId]="i.fotoArquivoId" />
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium">{{ i.nome }}</p>
        <p class="truncate text-sm text-slate-500">{{ i.codigo }} · {{ i.unidade }} · {{ i.natureza === 'PRODUTO' ? 'Produto' : 'Serviço' }}</p>
        @if (i.precoVenda !== null) {
          <p class="text-sm font-semibold">{{ moeda(i.precoVenda) }}</p>
        }
        @if (i.locavel && i.precoLocacaoMensal !== null) {
          <p class="text-sm text-slate-600">Locação: {{ moeda(i.precoLocacaoMensal) }}/mês</p>
        }
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1">
        @if (!i.ativo) {
          <span class="rounded-full bg-slate-200 px-2 py-0.5 text-xs">Inativo</span>
        }
        @if (naoSincronizados().has(i.id)) {
          <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Não sincronizado</span>
        }
      </div>
    </ng-template>
  `,
})
export class CatalogoPage {
  private readonly repo = inject(CatalogoRepo);
  private readonly auth = inject(AuthService);
  protected readonly admin = computed(() => this.auth.usuario()?.perfil === 'ADMIN');
  protected readonly busca = signal('');
  protected readonly filtro = signal<FiltroCatalogo>('TODOS');
  protected readonly inativos = signal(false);
  protected readonly filtros: { valor: FiltroCatalogo; rotulo: string }[] = [
    { valor: 'TODOS', rotulo: 'Todos' },
    { valor: 'PRODUTO', rotulo: 'Produtos' },
    { valor: 'SERVICO', rotulo: 'Serviços' },
    { valor: 'LOCAVEL', rotulo: 'Locáveis' },
  ];
  /** undefined até a primeira leitura do banco: sem isso a tela piscaria o vazio. */
  protected readonly todos = toSignal(this.repo.observarTodos());
  protected readonly naoSincronizados = toSignal(this.repo.observarNaoSincronizados(), { initialValue: new Set<string>() });
  protected readonly filtrados = computed(() =>
    filtrarItens(this.todos() ?? [], this.filtro(), this.busca(), this.admin() && this.inativos()),
  );
  protected readonly moeda = formatarMoeda;
}
