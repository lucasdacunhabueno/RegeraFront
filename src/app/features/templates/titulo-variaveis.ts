import { Component, ElementRef, input, model, viewChild } from '@angular/core';
import { VARIAVEIS } from './template-models';

/**
 * Título do bloco CABECALHO: texto simples (até 200) em que "Inserir variável" põe `{{nome}}` na posição do cursor
 * (ou no lugar do texto selecionado). O input guarda a seleção mesmo sem foco, então escolher no menu não a perde.
 */
@Component({
  selector: 'app-titulo-variaveis',
  template: `
    <div class="flex flex-col gap-2 sm:flex-row">
      <input
        #campo
        [id]="idCampo()"
        [value]="valor()"
        (input)="valor.set(campo.value)"
        maxlength="200"
        autocomplete="off"
        class="h-12 min-w-0 flex-1 rounded-lg border border-slate-300 px-3"
      />
      <select
        aria-label="Inserir variável"
        (change)="inserir($event)"
        class="h-12 rounded-lg border border-slate-300 bg-white px-2 text-sm"
      >
        <option value="">Inserir variável</option>
        @for (v of variaveis; track v.nome) {
          <option [value]="v.nome">{{ v.rotulo }}</option>
        }
      </select>
    </div>
  `,
})
export class TituloVariaveis {
  readonly valor = model('');
  /** `id` do input, para um `<label for>` de fora. */
  readonly idCampo = input('titulo');

  protected readonly variaveis = VARIAVEIS;
  private readonly campo = viewChild.required<ElementRef<HTMLInputElement>>('campo');

  protected inserir(evento: Event): void {
    const menu = evento.target as HTMLSelectElement;
    const nome = menu.value;
    menu.value = '';
    if (nome === '') return;

    const el = this.campo().nativeElement;
    const atual = el.value;
    const inicio = el.selectionStart ?? atual.length;
    const fim = el.selectionEnd ?? inicio;
    const token = `{{${nome}}}`;
    const novo = atual.slice(0, inicio) + token + atual.slice(fim);
    el.value = novo;
    this.valor.set(novo);
    el.focus();
    el.setSelectionRange(inicio + token.length, inicio + token.length);
  }
}
