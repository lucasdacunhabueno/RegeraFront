import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { formatarDocumento, formatarTelefone } from '../../core/util/formatos';
import { filtrarClientes } from './cliente-models';
import { ClientesRepo } from './clientes-repo';

@Component({
  selector: 'app-clientes-page',
  imports: [RouterLink],
  template: `
    <div class="mb-4 flex items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">Clientes</h1>
      <a routerLink="/clientes/novo" class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Novo cliente</a>
    </div>

    <input
      type="search"
      [value]="busca()"
      (input)="busca.set($any($event.target).value)"
      placeholder="Buscar por nome, CPF/CNPJ ou telefone"
      aria-label="Buscar clientes"
      class="mb-3 h-12 w-full rounded-lg border border-slate-300 px-3"
    />

    @if (filtrados().length === 0) {
      <p class="py-8 text-center text-slate-500">
        {{ busca().trim() ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.' }}
      </p>
    } @else {
      <ul class="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white">
        @for (c of filtrados(); track c.id) {
          <li>
            <a [routerLink]="['/clientes', c.id]" class="flex items-center gap-3 px-4 py-3">
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{{ c.nome }}</p>
                <p class="truncate text-sm text-slate-500">
                  {{ formatarDocumento(c.documento) }}
                  @if (c.telefone) {
                    · {{ formatarTelefone(c.telefone) }}
                  }
                </p>
              </div>
              @if (naoSincronizados().has(c.id)) {
                <span class="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Não sincronizado</span>
              }
            </a>
          </li>
        }
      </ul>
    }
  `,
})
export class ClientesPage {
  private readonly repo = inject(ClientesRepo);
  protected readonly busca = signal('');
  protected readonly todos = toSignal(this.repo.observarTodos(), { initialValue: [] });
  protected readonly naoSincronizados = toSignal(this.repo.observarNaoSincronizados(), {
    initialValue: new Set<string>(),
  });
  protected readonly filtrados = computed(() => filtrarClientes(this.todos(), this.busca()));
  protected readonly formatarDocumento = formatarDocumento;
  protected readonly formatarTelefone = formatarTelefone;
}
