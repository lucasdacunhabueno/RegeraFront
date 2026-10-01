import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TemplateLocal, TIPOS_PROPOSTA, TipoProposta } from './template-models';
import { TemplatesRepo } from './templates-repo';

type FiltroTipo = 'TODOS' | TipoProposta;

const ROTULO_TIPO = new Map<string, string>(TIPOS_PROPOSTA.map((t) => [t.valor, t.rotulo]));

@Component({
  selector: 'app-templates-page',
  imports: [RouterLink],
  template: `
    <div class="mb-4 flex items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">Templates</h1>
      <a routerLink="/templates/novo" class="inline-flex min-h-12 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white">Novo template</a>
    </div>

    <div class="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por tipo de proposta">
      @for (f of filtros; track f.valor) {
        <button type="button" (click)="filtro.set(f.valor)" [attr.aria-pressed]="filtro() === f.valor"
                class="min-h-12 rounded-full border px-4 py-1.5 text-sm"
                [class.border-blue-600]="filtro() === f.valor" [class.bg-blue-50]="filtro() === f.valor"
                [class.border-slate-300]="filtro() !== f.valor">{{ f.rotulo }}</button>
      }
    </div>

    @if (todos() === undefined) {
      <p class="py-8 text-center text-slate-500">Carregando…</p>
    } @else if (filtrados().length === 0) {
      <p class="py-8 text-center text-slate-500">
        {{ todos()!.length === 0 ? 'Nenhum template ainda.' : 'Nenhum template deste tipo.' }}
      </p>
    } @else {
      <ul class="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white">
        @for (t of filtrados(); track t.id) {
          <li>
            <a [routerLink]="['/templates', t.id]" class="flex items-center gap-3 px-4 py-3">
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{{ t.nome }}</p>
                <p class="truncate text-sm text-slate-500">
                  {{ rotuloTipo(t) }} · {{ t.blocos.length }} {{ t.blocos.length === 1 ? 'bloco' : 'blocos' }}
                </p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                @if (padroes().get(t.tipoProposta) === t.id) {
                  <span class="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">Padrão</span>
                }
                @if (!t.ativo) {
                  <span class="rounded-full bg-slate-200 px-2 py-0.5 text-xs">Inativo</span>
                }
                @if (naoSincronizados().has(t.id)) {
                  <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Não sincronizado</span>
                }
              </div>
            </a>
          </li>
        }
      </ul>
    }
  `,
})
export class TemplatesPage {
  private readonly repo = inject(TemplatesRepo);
  protected readonly filtro = signal<FiltroTipo>('TODOS');
  protected readonly filtros: readonly { valor: FiltroTipo; rotulo: string }[] = [
    { valor: 'TODOS', rotulo: 'Todos' },
    ...TIPOS_PROPOSTA,
  ];
  /** undefined até a primeira leitura do banco: sem isso a tela piscaria "Nenhum template ainda.". */
  protected readonly todos = toSignal(this.repo.observarTodos());
  protected readonly naoSincronizados = toSignal(this.repo.observarNaoSincronizados(), { initialValue: new Set<string>() });
  /** P4a-R5: só o padrão efetivo de cada tipo leva o selo (dois marcados no mesmo tipo podem coexistir até o sync). */
  protected readonly padroes = toSignal(this.repo.observarPadroesEfetivos(), {
    initialValue: new Map<TipoProposta, string>(),
  });
  protected readonly filtrados = computed(() => {
    const f = this.filtro();
    const todos = this.todos() ?? [];
    return f === 'TODOS' ? todos : todos.filter((t) => t.tipoProposta === f);
  });

  protected rotuloTipo(t: TemplateLocal): string {
    return ROTULO_TIPO.get(t.tipoProposta) ?? t.tipoProposta;
  }
}
