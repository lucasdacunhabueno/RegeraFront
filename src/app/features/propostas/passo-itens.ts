import { afterNextRender, Component, computed, ElementRef, inject, Injector, input, output, signal } from '@angular/core';
import { filtrarItens, ItemLocal, margemPercentual } from '../catalogo/item-models';
import { CampoLinha, LinhaEditavel, totaisDe } from './edicao-wizard';
import { moedaCentavos } from './formatos-proposta';
import { EstadoWizard } from './wizard-estado';

const MAX_RESULTADOS = 20;

interface CampoDaTela {
  campo: CampoLinha;
  rotulo: string;
  modo: 'decimal' | 'numeric';
}

const CAMPOS: readonly CampoDaTela[] = [
  { campo: 'quantidade', rotulo: 'Quantidade', modo: 'decimal' },
  { campo: 'preco', rotulo: 'Preço unitário (R$)', modo: 'decimal' },
  { campo: 'desconto', rotulo: 'Desconto (%)', modo: 'decimal' },
  { campo: 'meses', rotulo: 'Meses', modo: 'numeric' },
];

/**
 * Passo 2 (§13): itens. Busca no catálogo ativo (código ou nome) e "Adicionar"; cada linha edita quantidade, preço,
 * desconto e meses (só LOCACAO com item locável), com o subtotal ao vivo (`calcular`) e o total no rodapé. O custo e a
 * margem da linha aparecem só para o ADMIN (o COMERCIAL nunca vê custo).
 */
@Component({
  selector: 'app-passo-itens',
  template: `
    <section class="space-y-4 rounded-xl bg-white p-4" aria-labelledby="titulo-passo">
      <h2 id="titulo-passo" tabindex="-1" class="font-semibold outline-none">Itens</h2>

      <div class="space-y-2">
        <label for="busca-catalogo" class="text-sm font-medium">Adicionar do catálogo</label>
        <input id="busca-catalogo" type="search" [value]="busca()" (input)="busca.set($any($event.target).value)"
               placeholder="Código ou nome" autocomplete="off" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
        @if (busca().trim()) {
          <ul class="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200" aria-label="Itens do catálogo">
            @for (i of resultados(); track i.id) {
              <li class="flex items-center gap-3 px-3 py-2">
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium">{{ i.nome }}</p>
                  <p class="truncate text-sm text-slate-500">{{ i.codigo }} · {{ i.unidade }}</p>
                </div>
                <button type="button" data-testid="adicionar-item" (click)="adicionar.emit(i)" [disabled]="adicionando()"
                        [attr.aria-label]="'Adicionar ' + i.nome"
                        class="h-12 shrink-0 rounded-lg border border-blue-600 px-4 text-sm font-semibold text-blue-700 disabled:opacity-60">
                  Adicionar
                </button>
              </li>
            } @empty {
              <li class="px-3 py-3 text-sm text-slate-500">Nenhum item ativo encontrado.</li>
            }
          </ul>
        }
      </div>

      @if (erros().itens; as erro) { <p id="itens-erro" role="alert" class="text-sm text-red-600">{{ erro }}</p> }

      <ul class="space-y-3" aria-label="Itens da proposta">
        @for (l of e.linhas(); track l.id; let i = $index, primeiro = $first, ultimo = $last) {
          <li [attr.data-linha-id]="l.id" class="space-y-3 rounded-xl border border-slate-200 p-3">
            <div class="flex items-start gap-1">
              <div class="min-w-0 flex-1">
                <p class="font-medium">{{ l.nome }}</p>
                <p class="text-sm text-slate-500">{{ l.codigo }} · {{ l.unidade }}</p>
              </div>
              <button type="button" data-acao="subir" [attr.aria-label]="'Mover ' + l.nome + ' para cima'" title="Mover para cima"
                      [disabled]="primeiro" (click)="mover(i, -1)"
                      class="flex h-12 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-30">↑</button>
              <button type="button" data-acao="descer" [attr.aria-label]="'Mover ' + l.nome + ' para baixo'" title="Mover para baixo"
                      [disabled]="ultimo" (click)="mover(i, 1)"
                      class="flex h-12 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-30">↓</button>
              <button type="button" data-acao="remover" [attr.aria-label]="'Remover ' + l.nome" title="Remover" (click)="remover(l, i)"
                      class="flex h-12 w-10 shrink-0 items-center justify-center rounded-lg text-red-600 hover:bg-red-50">✕</button>
            </div>

            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              @for (c of campos; track c.campo) {
                @if (c.campo !== 'meses' || e.comMeses(l)) {
                  @let erro = erros().linhas[i]?.[c.campo];
                  <div class="space-y-1">
                    <label [for]="c.campo + '-' + l.id" class="text-sm font-medium">{{ c.rotulo }}</label>
                    <input [id]="c.campo + '-' + l.id" [attr.data-campo]="c.campo" [attr.inputmode]="c.modo" autocomplete="off"
                           [value]="l[c.campo]" (input)="e.alterarLinha(l.id, c.campo, $any($event.target).value)"
                           [attr.aria-invalid]="erro ? 'true' : 'false'"
                           [attr.aria-describedby]="erro ? c.campo + '-' + l.id + '-erro' : null"
                           class="h-12 w-full rounded-lg border px-3 text-right" [class.border-slate-300]="!erro" [class.border-red-600]="erro" />
                    @if (erro) { <p [id]="c.campo + '-' + l.id + '-erro'" class="text-sm text-red-600">{{ erro }}</p> }
                  </div>
                }
              }
            </div>
            @if (erros().linhas[i]?.geral; as erro) { <p class="text-sm text-red-600">{{ erro }}</p> }

            <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              @if (e.admin() && l.precoCustoCentavos !== null) {
                <p data-testid="custo" class="text-slate-600">
                  Custo: {{ moeda(l.precoCustoCentavos) }}
                  @if (margem(i, l); as m) { · Margem: {{ m }}% }
                </p>
              }
              <p class="ml-auto">Subtotal: <strong data-testid="subtotal">{{ subtotal(i) }}</strong></p>
            </div>
          </li>
        } @empty {
          <li class="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">
            Nenhum item ainda. Busque no catálogo acima.
          </li>
        }
      </ul>

      <p class="flex items-baseline justify-between border-t border-slate-200 pt-3 font-semibold" aria-live="polite">
        <span>Total dos itens</span>
        <span data-testid="total-itens">{{ totalItens() }}</span>
      </p>
    </section>
  `,
})
export class PassoItens {
  /** Item escolhido no catálogo: a página grava a linha (`adicionarItem`) e a acrescenta. */
  readonly adicionar = output<ItemLocal>();
  readonly adicionando = input(false);
  /** Anúncio para leitor de tela (a página tem a região `aria-live`). */
  readonly anunciar = output<string>();

  protected readonly e = inject(EstadoWizard);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly campos = CAMPOS;
  protected readonly busca = signal('');
  protected readonly erros = this.e.errosItens;
  protected readonly moeda = moedaCentavos;

  protected readonly resultados = computed(() => filtrarItens(this.e.catalogo(), 'TODOS', this.busca(), false).slice(0, MAX_RESULTADOS));

  protected readonly totalItens = computed(() => {
    const t = this.e.totaisItens();
    return t ? moedaCentavos(Number(t.totalItensCentavos)) : '—';
  });

  protected subtotal(i: number): string {
    const linha = this.e.leituras()[i]?.linha;
    return linha ? moedaCentavos(Number(totaisDe([linha], 0n, this.e.tipo()).subtotaisCentavos[0])) : '—';
  }

  /** Margem da linha (só ADMIN): custo × quantidade contra o subtotal, como a margem do item no catálogo. */
  protected margem(i: number, l: LinhaEditavel): string | null {
    const linha = this.e.leituras()[i]?.linha;
    if (!linha || l.precoCustoCentavos === null) return null;
    const subtotal = Number(totaisDe([linha], 0n, this.e.tipo()).subtotaisCentavos[0]);
    return margemPercentual((l.precoCustoCentavos * linha.quantidadeMilesimos) / 1000, subtotal);
  }

  /** Depois de "Adicionar": o foco vai para a quantidade da linha nova. */
  focarLinha(id: string): void {
    this.focar(`li[data-linha-id="${id}"] input[data-campo=quantidade]`);
  }

  protected mover(i: number, delta: -1 | 1): void {
    const l = this.e.linhas()[i];
    if (!l || !this.e.moverLinha(i, delta)) return;
    const destino = i + delta;
    const total = this.e.linhas().length;
    this.anunciar.emit(`${l.nome ?? 'Item'} movido para a posição ${destino + 1} de ${total}.`);
    // o foco fica no mesmo botão; se ele ficou desabilitado (chegou na ponta), no oposto
    const naPonta = delta < 0 ? destino === 0 : destino === total - 1;
    const acao = naPonta ? (delta < 0 ? 'descer' : 'subir') : delta < 0 ? 'subir' : 'descer';
    this.focar(`li[data-linha-id="${l.id}"] button[data-acao=${acao}]`);
  }

  protected remover(l: LinhaEditavel, i: number): void {
    this.e.removerLinha(l.id);
    this.anunciar.emit(`${l.nome ?? 'Item'} removido.`);
    const proxima = this.e.linhas()[Math.min(i, this.e.linhas().length - 1)];
    this.focar(proxima ? `li[data-linha-id="${proxima.id}"] input[data-campo=quantidade]` : '#busca-catalogo');
  }

  private focar(seletor: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(seletor)?.focus(), { injector: this.injector });
  }
}
