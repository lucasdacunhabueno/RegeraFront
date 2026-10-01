import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender, Component, computed, DestroyRef, DOCUMENT, effect, ElementRef, inject, Injector, signal, Signal, viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { LucideDynamicIcon, LucideListFilter } from '@lucide/angular';
import { AuthService } from '../../core/auth/auth-service';
import { Toasts } from '../../shared/ui/toasts';
import { ClientesRepo } from '../clientes/clientes-repo';
import { DialogoMotivo } from '../propostas/dialogo-motivo';
import { correspondeABusca, mensagemErroProposta, moedaCentavos, rotuloCodigo, Selo, selosDaProposta } from '../propostas/formatos-proposta';
import { hojeReativo } from '../propostas/hoje-reativo';
import { PropostaCard } from '../propostas/proposta-card';
import { PropostaLocal, STATUS_PROPOSTA, StatusProposta } from '../propostas/proposta-models';
import { EstadoSync, PropostasRepo } from '../propostas/propostas-repo';
import { TIPOS_PROPOSTA, TipoProposta } from '../templates/template-models';
import { MenuMover, MovimentoEscolhido } from './menu-mover';
import { acaoDoMovimento, agrupar, colunas, destinos, noPeriodo, podeSoltar, somarTotais } from './regras-kanban';

/** Desktop do §13: largura do menu lateral e mouse (um tablet grande com toque fica nas abas, que têm "Mover para…"). */
const CONSULTA_DESKTOP = '(min-width: 1024px) and (pointer: fine)';

interface Cartao {
  proposta: PropostaLocal;
  codigo: string;
  clienteNome: string;
  responsavelNome: string | null;
  selos: Selo[];
  /** Os destinos de "Mover para…" (vazio: nem o botão aparece, nem arrasta). */
  destinos: StatusProposta[];
  /** Pendência de CONFLITO: nada se move até resolver (como no detalhe). */
  conflito: boolean;
}

interface Coluna {
  status: StatusProposta;
  rotulo: string;
  cartoes: Cartao[];
  /** A soma dos totais; null na visão restrita (sem valores). */
  total: string | null;
}

type Encerramento = 'RECUSADA' | 'CANCELADA';

/** A largura e o ponteiro do desktop como sinal (sem `matchMedia`, como no jsdom: celular). */
function midiaDesktop(): Signal<boolean> {
  const janela = inject(DOCUMENT).defaultView;
  if (typeof janela?.matchMedia !== 'function') return signal(false);
  const consulta = janela.matchMedia(CONSULTA_DESKTOP);
  const desktop = signal(consulta.matches);
  const aoMudar = (e: MediaQueryListEvent) => desktop.set(e.matches);
  consulta.addEventListener('change', aoMudar);
  inject(DestroyRef).onDestroy(() => consulta.removeEventListener('change', aoMudar));
  return desktop.asReadonly();
}

/**
 * Kanban das propostas (`/kanban`, ADMIN e COMERCIAL, §13). Colunas do fluxo (§8), com as encerradas por toggle; em
 * cada uma, a contagem e a soma dos totais, e os cards por `atualizadoEm` desc. Quem move o quê vem das
 * `regras-kanban` (que delegam a `transicoesPermitidas`): sem destino permitido o card não arrasta e "Mover para…" não
 * aparece; com CONFLITO, fica travado com a dica. Mover usa `repo.transicionar` (otimista: o card muda de coluna na
 * hora e ganha "Não sincronizada"); RECUSADA e CANCELADA pedem o motivo; RASCUNHO→ENVIADA abre o envio no wizard.
 * - Desktop (≥ 1024 px e ponteiro fino): colunas lado a lado com o drag-drop do CDK; as proibidas esmaecem no arrasto.
 *   O "Mover para…" fica também, porque o arrasto do CDK não tem teclado.
 * - Celular: uma coluna por vez, em abas (tablist da APG, com a contagem), e "Mover para…" em cada card.
 * Os filtros (tipo, emissão de/até, busca e, para o admin, responsável) valem enquanto a página está aberta.
 */
@Component({
  selector: 'app-kanban-page',
  imports: [RouterLink, NgTemplateOutlet, CdkDropListGroup, CdkDropList, CdkDrag, CdkScrollable, LucideDynamicIcon, PropostaCard, MenuMover, DialogoMotivo],
  styles: `
    .cdk-drag-preview { box-shadow: 0 8px 24px rgb(15 23 42 / 0.2); border-radius: 0.75rem; }
    .cdk-drag-placeholder { opacity: 0.3; }
    .cdk-drag-animating { transition: transform 200ms ease; }
  `,
  template: `
    <div class="mb-4 flex items-center justify-between gap-3">
      <h1 #titulo tabindex="-1" class="text-xl font-semibold outline-none">Kanban</h1>
      <a routerLink="/propostas/nova" class="inline-flex min-h-12 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white">Nova proposta</a>
    </div>

    <!-- celular: a busca e "Filtros", que abre o resto; desktop (lg): tudo numa linha, sempre à vista -->
    <div data-filtros class="mb-3 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
      <div class="flex gap-2 lg:min-w-64 lg:flex-1">
        <div class="min-w-0 flex-1">
          <label for="busca-kanban" class="sr-only">Buscar propostas</label>
          <input id="busca-kanban" type="search" [value]="busca()" (input)="busca.set($any($event.target).value)"
                 placeholder="Número, PROV, cliente ou CPF/CNPJ" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
        </div>
        <button type="button" (click)="filtrosAbertos.update((v) => !v)" [attr.aria-expanded]="filtrosAbertos()" aria-controls="filtros-kanban"
                class="inline-flex h-12 shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 lg:hidden">
          <svg [lucideIcon]="iconeFiltros" [size]="18" aria-hidden="true"></svg>
          {{ rotuloFiltros() }}
        </button>
      </div>
      <div id="filtros-kanban" class="grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end"
           [class.grid]="filtrosAbertos()" [class.hidden]="!filtrosAbertos()">
      <div class="flex flex-col gap-1">
        <label for="tipo-kanban" class="text-sm text-slate-600">Tipo</label>
        <select id="tipo-kanban" [value]="tipo()" (change)="tipo.set($any($event.target).value)"
                class="h-12 rounded-lg border border-slate-300 bg-white px-3 lg:w-52">
          <option value="TODOS">Todos os tipos</option>
          @for (t of tipos; track t.valor) {
            <option [value]="t.valor">{{ t.rotulo }}</option>
          }
        </select>
      </div>
      @if (ehAdmin()) {
        <div class="flex flex-col gap-1">
          <label for="responsavel-kanban" class="text-sm text-slate-600">Responsável</label>
          <select id="responsavel-kanban" [value]="responsavel()" (change)="responsavel.set($any($event.target).value)"
                  class="h-12 rounded-lg border border-slate-300 bg-white px-3 lg:w-56">
            <option value="">Todos os responsáveis</option>
            @for (u of responsaveis(); track u.id) {
              <option [value]="u.id">{{ u.nome }}</option>
            }
          </select>
        </div>
      }
      <fieldset class="flex gap-3 sm:col-span-2 lg:col-span-1">
        <legend class="sr-only">Período de emissão</legend>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <label for="emissao-de" class="text-sm text-slate-600">Emissão de</label>
          <input id="emissao-de" type="date" [value]="emissaoDe()" [attr.max]="emissaoAte() || null"
                 (input)="emissaoDe.set($any($event.target).value)" class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <label for="emissao-ate" class="text-sm text-slate-600">até</label>
          <input id="emissao-ate" type="date" [value]="emissaoAte()" [attr.min]="emissaoDe() || null"
                 (input)="emissaoAte.set($any($event.target).value)" class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3" />
        </div>
      </fieldset>
      <button type="button" (click)="alternarEncerradas()" [attr.aria-pressed]="mostrarEncerradas()"
              class="inline-flex min-h-12 items-center gap-2 self-start rounded-lg px-2 text-sm text-slate-700 lg:self-auto">
        <span class="inline-block size-4 rounded border" [class.bg-blue-600]="mostrarEncerradas()"
              [class.border-blue-600]="mostrarEncerradas()" [class.border-slate-400]="!mostrarEncerradas()" aria-hidden="true"></span>
        Mostrar encerradas
      </button>
      </div>
    </div>

    <p data-anuncio role="status" aria-live="polite" class="mb-2 min-h-5 text-sm text-slate-600">{{ anuncio() }}</p>

    @if (carregando()) {
      <p class="py-8 text-center text-slate-500">Carregando…</p>
    } @else if (desktop()) {
      <div cdkDropListGroup cdkScrollable class="flex gap-3 overflow-x-auto pb-2">
        @for (c of quadro(); track c.status) {
          <section [attr.data-coluna]="c.status" [attr.data-proibida]="proibida(c.status) ? '' : null" [attr.aria-labelledby]="'coluna-' + c.status"
                   class="flex min-w-64 flex-1 flex-col rounded-xl bg-slate-100 transition-opacity" [class.opacity-40]="proibida(c.status)">
            <ng-container *ngTemplateOutlet="cabecalho; context: { $implicit: c }" />
            <ul cdkDropList [cdkDropListData]="c.status" [cdkDropListEnterPredicate]="podeEntrar" cdkDropListSortingDisabled
                (cdkDropListDropped)="soltar($event)" class="flex min-h-24 flex-1 flex-col gap-2 p-2">
              @for (k of c.cartoes; track k.proposta.id) {
                <li cdkDrag [cdkDragData]="k.proposta" [cdkDragDisabled]="k.conflito || k.destinos.length === 0" [cdkDragStartDelay]="atrasoArrasto"
                    (cdkDragStarted)="arrastando.set(k.proposta)" (cdkDragEnded)="arrastando.set(null)">
                  <ng-container *ngTemplateOutlet="cartao; context: { $implicit: k }" />
                </li>
              }
            </ul>
          </section>
        }
      </div>
    } @else {
      <div role="tablist" aria-label="Colunas do kanban"
           class="-mx-4 mb-3 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1">
        @for (c of quadro(); track c.status) {
          <button type="button" role="tab" [id]="'aba-' + c.status" [attr.aria-controls]="ativa()?.status === c.status ? 'painel-' + c.status : null"
                  [attr.aria-selected]="ativa()?.status === c.status" [tabindex]="ativa()?.status === c.status ? 0 : -1"
                  (click)="aba.set(c.status)" (keydown)="tecladoAbas($event)"
                  class="inline-flex min-h-12 shrink-0 snap-start items-center gap-2 rounded-full border px-4 text-sm"
                  [class.border-blue-600]="ativa()?.status === c.status" [class.bg-blue-50]="ativa()?.status === c.status"
                  [class.border-slate-300]="ativa()?.status !== c.status">
            {{ c.rotulo }}
            <span data-quantidade class="rounded-full bg-white px-1.5 text-xs font-semibold text-slate-700">{{ c.cartoes.length }}</span>
          </button>
        }
      </div>
      @if (ativa(); as c) {
        <section #painel role="tabpanel" tabindex="-1" [id]="'painel-' + c.status" [attr.aria-labelledby]="'aba-' + c.status"
                 [attr.data-coluna]="c.status" class="rounded-xl bg-slate-100 outline-none">
          <ng-container *ngTemplateOutlet="cabecalho; context: { $implicit: c }" />
          <ul class="flex flex-col gap-2 p-2">
            @for (k of c.cartoes; track k.proposta.id) {
              <li><ng-container *ngTemplateOutlet="cartao; context: { $implicit: k }" /></li>
            }
          </ul>
        </section>
      }
    }

    <ng-template #cabecalho let-c>
      <header class="flex items-baseline justify-between gap-2 px-3 pt-3">
        <h2 [id]="'coluna-' + c.status" class="font-semibold">{{ c.rotulo }}</h2>
        <p class="text-sm text-slate-600">
          <span class="sr-only">Propostas: </span><span data-quantidade>{{ c.cartoes.length }}</span>
          @if (c.total) {
            · <span class="sr-only">Total: </span><span data-total>{{ c.total }}</span>
          }
        </p>
      </header>
      @if (c.cartoes.length === 0) {
        <p class="px-3 pt-2 text-sm text-slate-500">Nenhuma proposta.</p>
      }
    </ng-template>

    <ng-template #cartao let-k>
      <div [attr.data-proposta]="k.proposta.id" class="rounded-xl bg-white shadow-sm">
        <app-proposta-card [proposta]="k.proposta" [clienteNome]="k.clienteNome" [responsavelNome]="k.responsavelNome"
                           [mostrarValores]="!restrito()" [selos]="k.selos" [mostrarStatus]="false" />
        @if (k.destinos.length > 0) {
          <app-menu-mover class="block px-4 pb-3" [destinos]="k.destinos" [codigo]="k.codigo" [bloqueado]="k.conflito"
                          (escolhido)="aoEscolher(k.proposta, $event)" />
        }
      </div>
    </ng-template>

    @if (dialogo(); as d) {
      @if (d.para === 'RECUSADA') {
        <app-dialogo-motivo [gatilho]="gatilho()" titulo="Recusar proposta" texto="O motivo fica no histórico da proposta." rotuloConfirmar="Recusar"
                            [perigo]="true" [ocupado]="ocupado()" (confirmado)="transicionar(d.proposta, 'RECUSADA', $event)"
                            (cancelado)="dialogo.set(null)" />
      } @else {
        <app-dialogo-motivo [gatilho]="gatilho()" titulo="Cancelar proposta"
                            texto="Uma proposta cancelada não volta atrás. Para refazê-la, use Duplicar."
                            rotuloConfirmar="Cancelar proposta" rotuloCancelar="Voltar" [perigo]="true" [ocupado]="ocupado()"
                            (confirmado)="transicionar(d.proposta, 'CANCELADA', $event)" (cancelado)="dialogo.set(null)" />
      }
    }
  `,
})
export class KanbanPage {
  private readonly repo = inject(PropostasRepo);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly injector = inject(Injector);
  private readonly documento = inject(DOCUMENT);
  private readonly usuario = inject(AuthService).usuario;
  private readonly titulo = viewChild.required<ElementRef<HTMLElement>>('titulo');
  private readonly painel = viewChild<ElementRef<HTMLElement>>('painel');

  /** Sem valores fora de ADMIN e COMERCIAL (o guard já barra o técnico; aqui é a segunda trava). */
  protected readonly restrito = computed(() => {
    const perfil = this.usuario()?.perfil;
    return perfil !== 'ADMIN' && perfil !== 'COMERCIAL';
  });
  protected readonly ehAdmin = computed(() => this.usuario()?.perfil === 'ADMIN');
  protected readonly desktop = midiaDesktop();

  protected readonly busca = signal('');
  protected readonly tipo = signal<'TODOS' | TipoProposta>('TODOS');
  protected readonly responsavel = signal('');
  protected readonly emissaoDe = signal('');
  protected readonly emissaoAte = signal('');
  protected readonly mostrarEncerradas = signal(false);
  protected readonly tipos = TIPOS_PROPOSTA;
  /** Celular: os filtros além da busca ficam atrás de "Filtros" (no desktop, sempre à vista). */
  protected readonly filtrosAbertos = signal(false);
  protected readonly iconeFiltros = LucideListFilter;
  /** Notebook com toque: segurar antes de arrastar, para o toque ainda rolar o quadro; no mouse, na hora. */
  protected readonly atrasoArrasto = { touch: 300, mouse: 0 };

  /** Os filtros ativos atrás de "Filtros" (a busca fica sempre à vista e não conta). */
  private readonly filtrosAtivos = computed(
    () =>
      [this.tipo() !== 'TODOS', this.ehAdmin() && !!this.responsavel(), !!this.emissaoDe(), !!this.emissaoAte(), this.mostrarEncerradas()]
        .filter(Boolean).length,
  );
  protected readonly rotuloFiltros = computed(() => (this.filtrosAtivos() > 0 ? `Filtros (${this.filtrosAtivos()})` : 'Filtros'));

  /** A aba aberta no celular (cai na primeira se a coluna dela some). */
  protected readonly aba = signal<StatusProposta>('RASCUNHO');
  /** O card sendo arrastado (desktop): esmaece as colunas que não o aceitam. */
  protected readonly arrastando = signal<PropostaLocal | null>(null);
  protected readonly dialogo = signal<{ proposta: PropostaLocal; para: Encerramento } | null>(null);
  protected readonly gatilho = signal<HTMLElement | null>(null);
  protected readonly ocupado = signal(false);
  protected readonly anuncio = signal('');
  /** Depois de um "Mover para…": o foco segue o card quando ele chegar à nova coluna. */
  private readonly focoPendente = signal<{ id: string; para: StatusProposta } | null>(null);

  /** undefined até a primeira leitura do banco (sem isso o quadro piscaria vazio). */
  private readonly propostas = toSignal(this.repo.observarTodas());
  private readonly clientes = toSignal(inject(ClientesRepo).observarTodos());
  private readonly usuarios = toSignal(this.repo.observarUsuarios(), { initialValue: [] });
  private readonly estado = toSignal(this.repo.observarEstadoSync(), {
    initialValue: { naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() } as EstadoSync,
  });
  /** Data civil de São Paulo (selo Expirada), refeita à meia-noite e quando a aba volta a ficar visível. */
  private readonly hoje = hojeReativo();

  protected readonly carregando = computed(() => this.propostas() === undefined || this.clientes() === undefined);

  private readonly clientePorId = computed(() => new Map((this.clientes() ?? []).map((c) => [c.id, c])));
  private readonly nomeUsuario = computed(() => new Map(this.usuarios().map((u) => [u.id, u.nome])));

  /** Quem pode ser responsável (ADMIN e COMERCIAL), por nome. */
  protected readonly responsaveis = computed(() =>
    this.usuarios()
      .filter((u) => u.perfil === 'ADMIN' || u.perfil === 'COMERCIAL')
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  );

  private readonly filtradas = computed(() => {
    const busca = this.busca();
    const tipo = this.tipo();
    // o filtro de responsável é só do admin (o comercial já recebe só as dele)
    const responsavel = this.ehAdmin() ? this.responsavel() : '';
    const de = this.emissaoDe();
    const ate = this.emissaoAte();
    const clientes = this.clientePorId();
    return (this.propostas() ?? []).filter(
      (p) =>
        (tipo === 'TODOS' || p.tipo === tipo) &&
        (!responsavel || p.responsavelId === responsavel) &&
        noPeriodo(p.dataEmissao, de, ate) &&
        correspondeABusca(p, p.clienteId ? clientes.get(p.clienteId) : undefined, busca),
    );
  });

  protected readonly quadro = computed<Coluna[]>(() => {
    const grupos = agrupar(this.filtradas(), colunas(this.mostrarEncerradas()));
    const clientes = this.clientePorId();
    const nomes = this.nomeUsuario();
    const { naOutbox, comPendencia, comConflito } = this.estado();
    const hoje = this.hoje();
    const perfil = this.usuario()?.perfil;
    const eu = this.usuario()?.id;
    const valores = !this.restrito();
    return [...grupos].map(([status, lista]) => ({
      status,
      rotulo: STATUS_PROPOSTA[status].rotulo,
      total: valores ? moedaCentavos(somarTotais(lista)) : null,
      cartoes: lista.map((p) => ({
        proposta: p,
        codigo: rotuloCodigo(p),
        clienteNome: p.clienteId ? (clientes.get(p.clienteId)?.nome ?? 'Cliente não encontrado') : 'Sem cliente',
        responsavelNome: nomes.get(p.responsavelId) ?? null,
        selos: selosDaProposta(p, { pendente: comPendencia.has(p.id), naoSincronizada: naOutbox.has(p.id), hoje }),
        destinos: destinos(p, perfil, eu),
        conflito: comConflito.has(p.id),
      })),
    }));
  });

  protected readonly ativa = computed(() => {
    const q = this.quadro();
    return q.find((c) => c.status === this.aba()) ?? q[0];
  });

  /** `cdkDropListEnterPredicate`: a própria coluna aceita a volta; as outras, só o que `podeSoltar` permite. */
  protected readonly podeEntrar = (drag: CdkDrag<PropostaLocal>, drop: CdkDropList<StatusProposta>): boolean =>
    drop.data === drag.data.status || this.soltavel(drag.data, drop.data);

  constructor() {
    effect(() => {
      const alvo = this.focoPendente();
      if (!alvo) return;
      // espera o repositório devolver a proposta já no status novo (o card renderizado na coluna certa)
      if (this.propostas()?.find((p) => p.id === alvo.id)?.status !== alvo.para) return;
      this.focoPendente.set(null);
      afterNextRender(() => this.focarCard(alvo.id), { injector: this.injector });
    });
  }

  protected proibida(status: StatusProposta): boolean {
    const p = this.arrastando();
    return !!p && status !== p.status && !this.soltavel(p, status);
  }

  protected alternarEncerradas(): void {
    const mostrar = !this.mostrarEncerradas();
    this.mostrarEncerradas.set(mostrar);
    // a aba de uma encerrada some: volta para a primeira (e não reaparece sozinha ao religar)
    if (!mostrar && !colunas(false).includes(this.aba())) this.aba.set('RASCUNHO');
  }

  protected tecladoAbas(e: KeyboardEvent): void {
    const q = this.quadro();
    const atual = q.findIndex((c) => c.status === this.ativa()?.status);
    const destino = { ArrowRight: atual + 1, ArrowLeft: atual - 1, Home: 0, End: q.length - 1 }[e.key];
    if (destino === undefined || q.length === 0) return;
    e.preventDefault();
    const status = q[(destino + q.length) % q.length].status;
    this.aba.set(status);
    afterNextRender(() => this.documento.getElementById(`aba-${status}`)?.focus(), { injector: this.injector });
  }

  protected soltar(e: CdkDragDrop<StatusProposta, StatusProposta, PropostaLocal>): void {
    this.arrastando.set(null);
    // o CDK emite no último container que aceitou o card, mesmo solto fora dele (sobre uma proibida ou fora do quadro)
    if (e.previousContainer === e.container || !e.isPointerOverContainer) return;
    this.mover(e.item.data, e.container.data, null);
  }

  protected aoEscolher(p: PropostaLocal, m: MovimentoEscolhido): void {
    this.mover(p, m.para, m.gatilho);
  }

  /** O movimento pedido pelo arrasto (gatilho null) ou pelo "Mover para…". O que não é permitido não faz nada. */
  private mover(p: PropostaLocal, para: StatusProposta, gatilho: HTMLElement | null): void {
    if (this.ocupado() || !this.soltavel(p, para)) return;
    this.gatilho.set(gatilho);
    switch (acaoDoMovimento(p.status, para)) {
      case 'enviar':
        // P4c-R5: o envio gera o PDF oficial, então vai ao passo de revisão do wizard; o card não se move
        void this.router.navigate(['/propostas', p.id, 'editar'], { queryParams: { passo: 4 } });
        return;
      case 'motivo':
        this.dialogo.set({ proposta: p, para: para as Encerramento });
        return;
      case 'transicionar':
        void this.transicionar(p, para);
    }
  }

  protected async transicionar(p: PropostaLocal, para: StatusProposta, motivo?: string | null): Promise<void> {
    if (this.ocupado()) return;
    // o diálogo pode ter ficado aberto enquanto o sync mudava a proposta: confere de novo com o estado de agora
    const atual = this.propostas()?.find((x) => x.id === p.id) ?? p;
    if (!this.soltavel(atual, para)) {
      this.dialogo.set(null);
      this.toasts.erro(
        this.estado().comConflito.has(p.id)
          ? 'Resolva a pendência primeiro.'
          : `A proposta mudou e não pode mais ir para ${STATUS_PROPOSTA[para].rotulo}.`,
      );
      return;
    }
    this.ocupado.set(true);
    try {
      if (motivo === undefined) await this.repo.transicionar(p.id, para);
      else await this.repo.transicionar(p.id, para, motivo);
      this.dialogo.set(null);
      this.anuncio.set(`Proposta ${rotuloCodigo(p)} movida para ${STATUS_PROPOSTA[para].rotulo}.`);
      if (this.gatilho()) this.focoPendente.set({ id: p.id, para });
    } catch (e) {
      // o diálogo (se houver) fica aberto, com o motivo digitado
      this.toasts.erro(mensagemErroProposta(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  private soltavel(p: PropostaLocal, para: StatusProposta): boolean {
    const u = this.usuario();
    return !this.estado().comConflito.has(p.id) && podeSoltar(p, para, u?.perfil, u?.id);
  }

  /**
   * O card movido pelo "Mover para…" foi recriado na nova coluna: o foco vai ao "Mover para…" dele; se a coluna não
   * está à vista (outra aba, encerrada oculta), ao painel da aba ou ao título. Só quando o foco se perdeu.
   */
  private focarCard(id: string): void {
    const ativo = this.documento.activeElement as HTMLElement | null;
    if (ativo && ativo !== this.documento.body && ativo.isConnected) return;
    const alvo =
      this.documento.querySelector<HTMLElement>(`[data-proposta="${id}"] button[aria-haspopup="menu"]`) ??
      this.painel()?.nativeElement ??
      this.titulo().nativeElement;
    alvo.focus();
  }
}
