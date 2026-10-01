import { Component, computed, inject, output, signal } from '@angular/core';
import { formatarDocumento, formatarTelefone } from '../../core/util/formatos';
import { filtrarClientes } from '../clientes/cliente-models';
import { TIPOS_PROPOSTA, TipoProposta } from '../templates/template-models';
import { EstadoWizard } from './wizard-estado';

/** Quantos clientes a lista mostra de uma vez (a busca refina). */
const MAX_RESULTADOS = 20;

/** Passo 1 (§13): tipo e cliente — busca local por nome, documento ou telefone, ou "Cadastrar cliente". */
@Component({
  selector: 'app-passo-cliente',
  template: `
    <section class="space-y-4 rounded-xl bg-white p-4" aria-labelledby="titulo-passo">
      <h2 id="titulo-passo" tabindex="-1" class="font-semibold outline-none">Tipo e cliente</h2>

      <div class="space-y-1">
        <label for="tipo-proposta" class="text-sm font-medium">Tipo de proposta</label>
        <select id="tipo-proposta" (change)="trocarTipo($any($event.target).value)"
                [attr.aria-invalid]="erros().tipo ? 'true' : 'false'" [attr.aria-describedby]="erros().tipo ? 'tipo-erro' : null"
                class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3">
          @for (t of tipos; track t.valor) {
            <option [value]="t.valor" [selected]="t.valor === e.tipo()">{{ t.rotulo }}</option>
          }
        </select>
        @if (erros().tipo; as erro) { <p id="tipo-erro" class="text-sm text-red-600">{{ erro }}</p> }
      </div>

      <div class="space-y-2">
        <span id="rotulo-cliente" class="block text-sm font-medium">Cliente</span>
        @if (e.clienteId()) {
          <div data-testid="cliente-selecionado" class="flex items-center gap-3 rounded-lg border border-blue-600 bg-blue-50 px-3 py-2">
            <div class="min-w-0 flex-1">
              @if (e.cliente(); as c) {
                <p class="truncate font-medium">{{ c.nome }}</p>
                <p class="truncate text-sm text-slate-600">{{ documento(c.documento) }}</p>
              } @else if (e.clientes() === undefined) {
                <p class="text-sm text-slate-500">Carregando…</p>
              } @else {
                <p class="text-sm text-amber-800">Cliente não encontrado neste aparelho.</p>
              }
            </div>
            <button type="button" (click)="trocarCliente()" class="h-12 shrink-0 rounded-lg px-3 text-sm font-semibold text-blue-700">Trocar</button>
          </div>
        } @else {
          <label for="busca-cliente" class="sr-only">Buscar cliente</label>
          <input id="busca-cliente" type="search" [value]="busca()" (input)="busca.set($any($event.target).value)"
                 placeholder="Nome, CPF/CNPJ ou telefone" autocomplete="off"
                 [attr.aria-invalid]="erros().clienteId ? 'true' : 'false'"
                 [attr.aria-describedby]="erros().clienteId ? 'cliente-erro' : null"
                 class="h-12 w-full rounded-lg border px-3" [class.border-slate-300]="!erros().clienteId"
                 [class.border-red-600]="erros().clienteId" />
          @if (e.clientes() === undefined) {
            <p class="text-sm text-slate-500">Carregando…</p>
          } @else {
            <ul class="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200" aria-labelledby="rotulo-cliente">
              @for (c of resultados(); track c.id) {
                <li>
                  <button type="button" data-testid="escolher-cliente" (click)="escolher(c.id)"
                          class="flex min-h-12 w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50">
                    <span class="font-medium">{{ c.nome }}</span>
                    <span class="text-sm text-slate-500">{{ documento(c.documento) }}@if (c.telefone) { · {{ telefone(c.telefone) }} }</span>
                  </button>
                </li>
              } @empty {
                <li class="px-3 py-3 text-sm text-slate-500">
                  {{ busca().trim() ? 'Nenhum cliente encontrado.' : 'Nenhum cliente neste aparelho ainda.' }}
                </li>
              }
            </ul>
          }
        }
        @if (erros().clienteId; as erro) { <p id="cliente-erro" role="alert" class="text-sm text-red-600">{{ erro }}</p> }
        <button type="button" data-testid="cadastrar-cliente" (click)="cadastrar.emit()"
                class="inline-flex h-12 items-center rounded-lg border border-blue-600 px-4 text-sm font-semibold text-blue-700">
          Cadastrar cliente
        </button>
      </div>
    </section>
  `,
})
export class PassoCliente {
  /** "Cadastrar cliente": a página leva ao formulário de cliente e volta com o cliente novo selecionado. */
  readonly cadastrar = output<void>();

  protected readonly e = inject(EstadoWizard);
  protected readonly tipos = TIPOS_PROPOSTA;
  protected readonly busca = signal('');
  protected readonly erros = this.e.errosCliente;
  protected readonly documento = formatarDocumento;
  protected readonly telefone = formatarTelefone;

  protected readonly resultados = computed(() => filtrarClientes(this.e.clientes() ?? [], this.busca()).slice(0, MAX_RESULTADOS));

  protected trocarTipo(tipo: TipoProposta): void {
    this.e.tipo.set(tipo);
    this.e.limparErroServidor((c) => c === 'tipo');
  }

  protected escolher(id: string): void {
    this.e.clienteId.set(id);
    this.e.limparErroServidor((c) => c === 'clienteId');
  }

  protected trocarCliente(): void {
    this.e.clienteId.set(null);
    this.busca.set('');
  }
}
