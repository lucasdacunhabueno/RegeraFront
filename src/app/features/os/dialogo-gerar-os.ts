import {
  afterNextRender, Component, computed, DestroyRef, DOCUMENT, ElementRef, inject, input, OnInit, output, signal, viewChild,
} from '@angular/core';
import type { PropostaLocal } from '../propostas/proposta-models';
import { stripJava } from '../propostas/proposta-models';
import { rotuloTipoOs, tamanhoTextoOs, TIPOS_OS, TipoOs } from './os-models';
import { descricaoDaProposta, OpcoesGerarOs, tipoOsDaProposta } from './os-repo';

let sequencia = 0;

const MAX_DESCRICAO = 4000;
const FOCAVEIS = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Um técnico ativo que a OS pode receber. */
export interface TecnicoOpcao {
  id: string;
  nome: string;
}

/**
 * "Gerar OS" da proposta (spec M2 §9, Q17, M2P2-R17): tipo (o derivado da proposta), técnico (os ativos; o da
 * proposta vem escolhido), data prevista, urgente, "Esta OS conclui a proposta?" (marcado) e a descrição, que vem com
 * as observações e o prazo da proposta (`descricaoDaProposta`) para o comercial revisar: o técnico a lê, e ali pode
 * haver valores. Confirma com as `OpcoesGerarOs` (a descrição sem os espaços das pontas; vazia, null).
 * Modal como o `DialogoMotivo`: `aria-modal`, título ligado, o foco no primeiro campo, preso no diálogo (Tab) e de
 * volta a quem abriu; Esc e o toque fora cancelam só sem nada mudado (M10), o Voltar sempre. Com OS em curso na
 * proposta, avisa (várias OS por proposta são do modelo, Q1/Q17, mas a comum é uma de cada vez).
 */
@Component({
  selector: 'app-dialogo-gerar-os',
  host: {
    class: 'fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center',
    '(click)': 'aoClicarFora($event)',
  },
  template: `
    <div #painel tabindex="-1" role="dialog" aria-modal="true" [attr.aria-labelledby]="id + '-titulo'" (keydown)="teclado($event)"
         class="max-h-full w-full max-w-md space-y-4 overflow-y-auto rounded-xl bg-white p-4 shadow-xl outline-none pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
      <h2 [id]="id + '-titulo'" class="text-lg font-semibold">Gerar OS</h2>
      @if (emCurso() > 0) {
        <p class="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Esta proposta já tem {{ emCurso() }} OS {{ emCurso() === 1 ? 'aberta' : 'abertas' }} ou em andamento. Gere outra só para um
          retorno ou outra equipe.
        </p>
      }

      <div class="space-y-1">
        <label [for]="id + '-tipo'" class="text-sm font-medium">Tipo</label>
        <select #primeiro [id]="id + '-tipo'" name="tipo" (change)="tipo.set($any($event.target).value)"
                class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3">
          @for (t of tipos; track t.valor) {
            <option [value]="t.valor" [selected]="t.valor === tipo()">{{ t.rotulo }}</option>
          }
        </select>
      </div>

      <div class="space-y-1">
        <label [for]="id + '-tecnico'" class="text-sm font-medium">Técnico</label>
        <select [id]="id + '-tecnico'" name="tecnico" (change)="tecnicoId.set($any($event.target).value)"
                class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3">
          <option value="" [selected]="tecnicoId() === ''">Nenhum (atribuir depois)</option>
          @for (t of tecnicos(); track t.id) {
            <option [value]="t.id" [selected]="t.id === tecnicoId()">{{ t.nome }}</option>
          }
        </select>
      </div>

      <div class="space-y-1">
        <label [for]="id + '-data'" class="text-sm font-medium">Data prevista (opcional)</label>
        <input [id]="id + '-data'" name="data" type="date" [value]="dataPrevista()" (input)="dataPrevista.set($any($event.target).value)"
               class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 sm:w-72" />
      </div>

      <!-- um alvo só (a caixa e o texto), de pelo menos 48 px -->
      <label [for]="id + '-urgente'" class="flex min-h-12 cursor-pointer items-center gap-3">
        <input [id]="id + '-urgente'" name="urgente" type="checkbox" [checked]="urgente()" (change)="urgente.set($any($event.target).checked)"
               class="size-5 shrink-0" />
        <span class="text-sm font-medium">Urgente (prazo de 7 dias em vez de 20)</span>
      </label>

      <label [for]="id + '-conclui'" class="flex min-h-12 cursor-pointer items-start gap-3 py-1">
        <input [id]="id + '-conclui'" name="conclui" type="checkbox" [checked]="concluiProposta()"
               (change)="concluiProposta.set($any($event.target).checked)" class="mt-0.5 size-5 shrink-0" />
        <span>
          <span class="block text-sm font-medium">Esta OS conclui a proposta?</span>
          <span class="block text-xs text-slate-500">Desmarque se vai ser preciso outra visita: a proposta continua em execução.</span>
        </span>
      </label>

      <div class="space-y-1">
        <label [for]="id + '-descricao'" class="text-sm font-medium">Descrição</label>
        <textarea #campoDescricao [id]="id + '-descricao'" name="descricao" rows="5" [value]="descricao()"
                  (input)="digitarDescricao($any($event.target).value)"
                  [attr.aria-invalid]="erro() ? 'true' : 'false'"
                  [attr.aria-describedby]="id + '-ajuda' + (erro() ? ' ' + id + '-erro' : '')"
                  class="w-full rounded-lg border px-3 py-2" [class.border-slate-300]="!erro()" [class.border-red-600]="erro()"></textarea>
        <p [id]="id + '-ajuda'" class="text-xs text-slate-500">
          Veio das observações e do prazo da proposta. O técnico lê a descrição: tire valores e condições de pagamento.
          <span [class.text-red-600]="tamanho() > maxDescricao">{{ tamanho() }}/{{ maxDescricao }}</span>
        </p>
        @if (erro(); as e) { <p [id]="id + '-erro'" role="alert" class="text-sm text-red-600">{{ e }}</p> }
      </div>

      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" (click)="cancelado.emit()" [disabled]="ocupado()"
                class="h-12 rounded-lg border border-slate-300 px-4 font-semibold text-slate-700 disabled:opacity-60">Voltar</button>
        <button type="button" (click)="confirmar()" [disabled]="ocupado()"
                class="h-12 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-60">{{ ocupado() ? 'Gerando…' : 'Gerar OS' }}</button>
      </div>
    </div>
  `,
})
export class DialogoGerarOs implements OnInit {
  readonly proposta = input.required<PropostaLocal>();
  /** Os técnicos ativos, na ordem da lista. */
  readonly tecnicos = input<readonly TecnicoOpcao[]>([]);
  /** Quantas OS da proposta estão abertas ou em andamento (o aviso antes de gerar outra). */
  readonly emCurso = input(0);
  /** A geração está gravando: os botões ficam desabilitados. */
  readonly ocupado = input(false);
  /** Quem abriu: recebe o foco de volta ao fechar (o Safari não foca o botão no clique). */
  readonly gatilho = input<HTMLElement | null>(null);
  readonly confirmado = output<OpcoesGerarOs>();
  readonly cancelado = output<void>();

  protected readonly id = `dialogo-gerar-os-${++sequencia}`;
  protected readonly tipos = TIPOS_OS.map((t) => ({ valor: t, rotulo: rotuloTipoOs(t) }));
  protected readonly maxDescricao = MAX_DESCRICAO;

  protected readonly tipo = signal<TipoOs>('SERVICO');
  protected readonly tecnicoId = signal('');
  protected readonly dataPrevista = signal('');
  protected readonly urgente = signal(false);
  protected readonly concluiProposta = signal(true);
  protected readonly descricao = signal('');
  protected readonly erro = signal<string | null>(null);
  protected readonly tamanho = computed(() => tamanhoTextoOs(this.descricao()));
  /** O que veio preenchido: com outra coisa, o Esc e o toque fora não descartam (M10). */
  private inicial = '';

  private readonly painel = viewChild.required<ElementRef<HTMLElement>>('painel');
  private readonly primeiro = viewChild.required<ElementRef<HTMLSelectElement>>('primeiro');
  private readonly campoDescricao = viewChild.required<ElementRef<HTMLTextAreaElement>>('campoDescricao');

  constructor() {
    const documento = inject(DOCUMENT);
    const anterior = documento.activeElement instanceof HTMLElement ? documento.activeElement : null;
    afterNextRender(() => this.primeiro().nativeElement.focus());
    inject(DestroyRef).onDestroy(() => {
      const alvo = this.gatilho() ?? anterior;
      if (alvo?.isConnected) alvo.focus();
    });
  }

  ngOnInit(): void {
    const p = this.proposta();
    this.tipo.set(tipoOsDaProposta(p.tipo));
    this.tecnicoId.set(p.tecnicoId && this.tecnicos().some((t) => t.id === p.tecnicoId) ? p.tecnicoId : '');
    this.descricao.set(descricaoDaProposta(p) ?? '');
    this.inicial = this.estado();
  }

  protected digitarDescricao(valor: string): void {
    this.descricao.set(valor);
    if (this.erro() && tamanhoTextoOs(valor) <= MAX_DESCRICAO) this.erro.set(null);
  }

  protected confirmar(): void {
    if (this.ocupado()) return;
    const descricao = stripJava(this.descricao());
    if (tamanhoTextoOs(descricao) > MAX_DESCRICAO) {
      this.erro.set(`Máximo de ${MAX_DESCRICAO} caracteres.`);
      this.campoDescricao().nativeElement.focus();
      return;
    }
    this.confirmado.emit({
      tipo: this.tipo(),
      tecnicoId: this.tecnicoId() || null,
      dataPrevista: this.dataPrevista() || null,
      urgente: this.urgente(),
      concluiProposta: this.concluiProposta(),
      descricao: descricao === '' ? null : descricao,
    });
  }

  protected teclado(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!this.ocupado() && !this.mudou()) this.cancelado.emit();
      return;
    }
    if (e.key !== 'Tab') return;
    const focaveis = [...this.painel().nativeElement.querySelectorAll<HTMLElement>(FOCAVEIS)];
    if (focaveis.length === 0) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const ativo = this.painel().nativeElement.ownerDocument.activeElement;
    if (e.shiftKey && (ativo === primeiro || !focaveis.includes(ativo as HTMLElement))) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && (ativo === ultimo || !focaveis.includes(ativo as HTMLElement))) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  /** O toque no fundo (fora do painel) cancela, salvo com algo mudado (M10). */
  protected aoClicarFora(e: MouseEvent): void {
    if (this.ocupado() || this.painel().nativeElement.contains(e.target as Node)) return;
    if (this.mudou()) {
      this.primeiro().nativeElement.focus();
      return;
    }
    this.cancelado.emit();
  }

  private mudou(): boolean {
    return this.estado() !== this.inicial;
  }

  private estado(): string {
    return JSON.stringify([this.tipo(), this.tecnicoId(), this.dataPrevista(), this.urgente(), this.concluiProposta(), this.descricao()]);
  }
}
