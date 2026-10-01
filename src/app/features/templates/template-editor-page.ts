import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { RegeraDb } from '../../core/db/regera-db';
import { avisarAoSairDaPagina, ComAlteracoes, instantaneo } from '../../core/navegacao/alteracoes-guard';
import { entradaFicticia } from '../../core/pdf/dados-ficticios';
import { PdfService } from '../../core/pdf/pdf-service';
import { ErroCampo } from '../../core/util/erro-campo';
import { Toasts } from '../../shared/ui/toasts';
import { ID_EMPRESA } from '../empresa/empresa-models';
import { BlocoConfig, resumoBloco, rotuloBloco } from './bloco-config';
import {
  Bloco,
  blocosIniciais,
  novoBloco,
  TemplateDados,
  TIPOS_BLOCO,
  TIPOS_PROPOSTA,
  TipoBloco,
  TipoProposta,
  validarBlocos,
} from './template-models';
import { TemplatesRepo } from './templates-repo';

const MAX_NOME = 120;
/** Mesmo ponto do `lg:` do Tailwind: daqui para cima, em aparelho de mouse, a prévia fica num iframe ao lado do editor. */
const LARGURA_DESKTOP = 1024;
const CORRIJA = 'Corrija os campos destacados.';
const CAMINHO_BLOCO = /^blocos\[(\d+)\]/;
/** Uma prévia aberta em outra aba ainda pode estar lendo o blob: a revogação espera. */
const ESPERA_REVOGAR_MS = 60_000;
/** Validação dos blocos e "sujo" (JSON do template inteiro) só depois de uma pausa na edição: templates grandes. */
const ESPERA_EDICAO_MS = 300;

type AcaoMover = 'subir' | 'descer';

/**
 * Iframe só em tela larga com mouse: tablet (ponteiro grosso) e iOS — inclusive o iPad, que se apresenta como Mac —
 * costumam não mostrar PDF dentro de iframe, então vão para a aba, mesmo com 1024 px ou mais.
 */
function previaNoIframe(): boolean {
  if (window.innerWidth < LARGURA_DESKTOP) return false;
  const toque = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return !toque && !ios;
}

@Component({
  selector: 'app-template-editor-page',
  imports: [RouterLink, CdkDropList, CdkDrag, CdkDragHandle, BlocoConfig],
  host: { '(document:pointerdown)': 'pointerFora($event)' },
  styles: `
    .cdk-drag-preview { box-shadow: 0 8px 24px rgb(15 23 42 / 0.2); border-radius: 0.75rem; background: white; }
    .cdk-drag-placeholder { opacity: 0.3; }
    .cdk-drag-animating, .cdk-drop-list-dragging .cdk-drag:not(.cdk-drag-placeholder) { transition: transform 200ms ease; }
  `,
  template: `
    <a routerLink="/templates" class="text-sm text-blue-700">← Templates</a>
    <h1 class="mb-4 mt-2 text-xl font-semibold">{{ id() ? 'Editar template' : 'Novo template' }}</h1>

    @if (temPendencia()) {
      <p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        Este template tem uma pendência de sincronização. <a routerLink="/pendencias" class="font-semibold underline">Ver pendências</a>
      </p>
    }

    <p role="status" class="sr-only">{{ anuncio() }}</p>

    <div class="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      <form (submit)="$event.preventDefault(); salvar()" class="space-y-4" novalidate>
        @if (erroGeral(); as erro) {
          <p data-testid="erro-geral" role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{{ erro }}</p>
        }

        @if (!indisponivel()) {
        <section class="space-y-4 rounded-xl bg-white p-4">
          <div class="space-y-1">
            <label for="nome" class="text-sm font-medium">Nome</label>
            <input id="nome" [value]="nome()" (input)="nome.set($any($event.target).value)" maxlength="120" autocomplete="off"
                   [attr.aria-invalid]="erroNome() ? 'true' : 'false'" [attr.aria-describedby]="erroNome() ? 'nome-erro' : null"
                   class="h-12 w-full rounded-lg border px-3" [class.border-slate-300]="!erroNome()" [class.border-red-600]="erroNome()" />
            @if (erroNome(); as erro) { <p id="nome-erro" class="text-sm text-red-600">{{ erro }}</p> }
          </div>

          <div class="space-y-1">
            <label for="tipo" class="text-sm font-medium">Tipo de proposta</label>
            <select id="tipo" (change)="tipo.set($any($event.target).value)"
                    class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3">
              @for (t of tiposProposta; track t.valor) {
                <option [value]="t.valor" [selected]="t.valor === tipo()">{{ t.rotulo }}</option>
              }
            </select>
          </div>

          <label class="flex min-h-12 items-center gap-3">
            <input id="ativo" type="checkbox" class="size-5" [checked]="ativo()" (change)="alternarAtivo($any($event.target).checked)" />
            Ativo (pode ser escolhido nas propostas)
          </label>
          <div>
            <label class="flex min-h-12 items-center gap-3" [class.text-slate-400]="!ativo()">
              <input id="padrao" type="checkbox" class="size-5" [checked]="padrao()" [disabled]="!ativo()"
                     (change)="padrao.set($any($event.target).checked); erroPadrao.set(null)"
                     [attr.aria-describedby]="erroPadrao() ? 'padrao-ajuda padrao-erro' : 'padrao-ajuda'" />
              Padrão do tipo
            </label>
            <p id="padrao-ajuda" class="text-sm text-slate-500">
              {{ ativo() ? 'Usado nas novas propostas deste tipo; marcar aqui tira a marca do padrão anterior.' : 'Só um template ativo pode ser o padrão.' }}
            </p>
            @if (erroPadrao(); as erro) { <p id="padrao-erro" role="alert" class="text-sm text-red-600">{{ erro }}</p> }
          </div>
        </section>

        <section class="space-y-3 rounded-xl bg-white p-4" aria-labelledby="titulo-blocos">
          <div class="flex items-center justify-between gap-3">
            <h2 id="titulo-blocos" class="font-semibold">Blocos</h2>
            <div #areaMenu class="relative">
              <button #botaoMais type="button" aria-haspopup="menu" [attr.aria-expanded]="menuAberto() ? 'true' : 'false'"
                      aria-controls="menu-blocos" (click)="alternarMenu()" [disabled]="carregando()"
                      class="h-12 rounded-lg border border-blue-600 px-4 text-sm font-semibold text-blue-700 disabled:opacity-60">+ Bloco</button>
              @if (menuAberto()) {
                <div id="menu-blocos" role="menu" aria-label="Tipo do bloco" tabindex="-1" (keydown)="teclaNoMenu($event)"
                     class="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  @for (t of tiposBloco; track t.valor) {
                    <button type="button" role="menuitem" (click)="adicionar(t.valor)"
                            class="flex min-h-12 w-full items-center px-3 text-left text-sm hover:bg-slate-100">{{ t.rotulo }}</button>
                  }
                </div>
              }
            </div>
          </div>

          @if (carregando()) {
            <p class="text-sm text-slate-500">Carregando…</p>
          } @else {
            @if (blocos().length === 0) {
              <p class="text-sm text-slate-500">Nenhum bloco. Use "+ Bloco" para montar o documento.</p>
            }
            <ul cdkDropList cdkDropListLockAxis="y" (cdkDropListDropped)="soltar($event)" class="space-y-2" aria-label="Blocos do template">
              @for (b of blocos(); track b.id; let i = $index, primeiro = $first, ultimo = $last) {
                <li cdkDrag [attr.data-bloco-id]="b.id" class="rounded-xl border bg-white"
                    [class.border-slate-200]="!errosPorBloco().has(b.id)" [class.border-red-400]="errosPorBloco().has(b.id)">
                  <div class="flex items-stretch gap-1 p-1">
                    <!-- fora da ordem de Tab: pelo teclado, ↑ e ↓ -->
                    <button type="button" cdkDragHandle tabindex="-1" aria-label="Arrastar para reordenar o bloco" title="Arrastar"
                            class="flex w-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                      <span aria-hidden="true">⋮⋮</span>
                    </button>
                    <button type="button" data-testid="abrir-bloco" (click)="alternarAberto(b.id)"
                            [attr.aria-expanded]="aberto() === b.id ? 'true' : 'false'" [attr.aria-controls]="'config-' + b.id"
                            class="min-h-12 min-w-0 flex-1 rounded-lg px-2 py-1 text-left hover:bg-slate-50">
                      <span class="block text-sm font-medium" data-testid="bloco-tipo">{{ rotulo(b) }}</span>
                      @if (resumo(b); as r) { <span class="block truncate text-sm text-slate-500">{{ r }}</span> }
                    </button>
                    <button type="button" data-acao="subir" aria-label="Mover bloco para cima" title="Mover para cima" [disabled]="primeiro"
                            (click)="mover(i, -1, 'subir')"
                            class="flex h-12 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-30">↑</button>
                    <button type="button" data-acao="descer" aria-label="Mover bloco para baixo" title="Mover para baixo" [disabled]="ultimo"
                            (click)="mover(i, 1, 'descer')"
                            class="flex h-12 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-30">↓</button>
                    <button type="button" aria-label="Remover bloco" title="Remover" (click)="remover(b, i)"
                            class="flex h-12 w-10 shrink-0 items-center justify-center rounded-lg text-red-600 hover:bg-red-50">✕</button>
                  </div>
                  @if (aberto() === b.id) {
                    <!-- aberto: o erro aparece uma vez só, dentro do formulário do bloco -->
                    <div [id]="'config-' + b.id" class="border-t border-slate-200 p-3">
                      <app-bloco-config [bloco]="b" [erro]="errosPorBloco().get(b.id) ?? null" (configChange)="atualizarConfig(b.id, $event)" />
                    </div>
                  } @else if (errosPorBloco().get(b.id); as erro) {
                    <p data-testid="erro-bloco" class="px-3 pb-2 text-sm text-red-600">{{ erro }}</p>
                  }
                </li>
              }
            </ul>
          }
        </section>
        }

        @if (naoEncontrado()) {
          <p class="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900" role="alert">Template não encontrado neste aparelho.</p>
        } @else if (falhaCarga()) {
          <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">Não foi possível carregar o template.</p>
        } @else {
          <button type="submit" [disabled]="carregando() || salvando()"
                  class="h-12 w-full rounded-lg bg-blue-600 font-semibold text-white disabled:opacity-60">Salvar</button>
          @if (id()) {
            <button type="button" data-testid="excluir" (click)="excluir()" [disabled]="carregando() || excluindo()"
                    class="h-12 w-full rounded-lg border border-red-300 font-semibold text-red-600 disabled:opacity-60">Excluir template</button>
          }
        }
      </form>

      @if (!indisponivel()) {
      <!-- 4.5rem: abaixo do cabeçalho fixo do app -->
      <section class="mt-4 space-y-3 rounded-xl bg-white p-4 lg:sticky lg:top-[4.5rem] lg:mt-0" aria-labelledby="titulo-previa">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 id="titulo-previa" class="font-semibold">Prévia</h2>
          <button type="button" (click)="gerarPrevia()" [disabled]="gerando() || carregando()" aria-describedby="previa-ajuda"
                  class="h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold disabled:opacity-60">
            {{ gerando() ? 'Gerando prévia…' : 'Gerar prévia' }}
          </button>
        </div>
        <p id="previa-ajuda" class="text-sm text-slate-500">PDF com dados de exemplo e a marca "PRÉVIA". Não precisa de internet.</p>
        @if (iframeUrl(); as url) {
          <iframe title="Prévia do PDF" [src]="url" class="h-[80vh] w-full rounded-lg border border-slate-200"></iframe>
        } @else if (linkPrevia(); as url) {
          <p class="text-sm" role="status">
            O navegador bloqueou a nova aba.
            <a [href]="url" target="_blank" rel="noopener" class="font-semibold text-blue-700 underline">Abrir prévia</a>
          </p>
        } @else if (abertaEmAba()) {
          <p class="text-sm text-slate-600">A prévia foi aberta em uma nova aba.</p>
        }
        @if (urlBaixar(); as url) {
          <!-- o celular pode não mostrar o PDF na aba: baixar sempre funciona -->
          <a [href]="url" [attr.download]="nomeArquivoPrevia()"
             class="inline-flex min-h-12 items-center text-sm font-semibold text-blue-700 underline">Baixar PDF</a>
        }
      </section>
      }
    </div>
  `,
})
export class TemplateEditorPage implements ComAlteracoes {
  readonly id = input<string>();

  private readonly repo = inject(TemplatesRepo);
  private readonly pdf = inject(PdfService);
  private readonly db = inject(RegeraDb);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly areaMenu = viewChild<ElementRef<HTMLElement>>('areaMenu');

  protected readonly tiposProposta = TIPOS_PROPOSTA;
  protected readonly tiposBloco = TIPOS_BLOCO;
  protected readonly rotulo = rotuloBloco;
  protected readonly resumo = resumoBloco;

  protected readonly nome = signal('');
  protected readonly tipo = signal<TipoProposta>('VENDA');
  protected readonly ativo = signal(true);
  protected readonly padrao = signal(false);
  protected readonly blocos = signal<Bloco[]>(blocosIniciais());
  /** Id do bloco com a configuração aberta (um por vez). */
  protected readonly aberto = signal<string | null>(null);
  protected readonly menuAberto = signal(false);
  protected readonly anuncio = signal('');

  protected readonly salvando = signal(false);
  protected readonly excluindo = signal(false);
  protected readonly temPendencia = signal(false);
  protected readonly naoEncontrado = signal(false);
  protected readonly falhaCarga = signal(false);
  protected readonly erroPadrao = signal<string | null>(null);
  /** Erro que o repo devolveu ao salvar (ex.: `ErroCampo('blocos')` por tamanho); some na próxima tentativa. */
  private readonly erroRepo = signal<string | null>(null);
  /** Depois da primeira tentativa de salvar, os erros acompanham a edição (somem quando corrigidos). */
  private readonly tentouSalvar = signal(false);
  private readonly carregadoId = signal<string | null>(null);
  protected readonly carregando = computed(() => {
    const id = this.id();
    return !!id && this.carregadoId() !== id;
  });
  private versaoCarregada: number | null | undefined;
  protected readonly indisponivel = computed(() => this.naoEncontrado() || this.falhaCarga());

  // ---- edição com debounce ----
  /** O que está na tela (barato: só referências). */
  private readonly editado = computed(() => ({
    nome: this.nome(), tipo: this.tipo(), ativo: this.ativo(), padrao: this.padrao(), blocos: this.blocos(),
  }));
  /** `editado` depois de ESPERA_EDICAO_MS sem mudança; o que é caro (validar, serializar) parte daqui. */
  private readonly editadoEstavel = signal(this.editado());
  private timerEdicao: ReturnType<typeof setTimeout> | undefined;

  // ---- alterações não salvas (P4a-R12) ----
  private readonly estadoAtual = computed(() => instantaneo(this.editadoEstavel()));
  /** Estado ao abrir, depois de carregar ou depois de salvar. */
  private readonly estadoSalvo = signal('');
  /** Depois de excluir, sair não pergunta nada. */
  private readonly liberado = signal(false);
  private readonly alterado = computed(
    () => !this.liberado() && !this.carregando() && !this.indisponivel() && this.estadoAtual() !== this.estadoSalvo(),
  );

  protected readonly erroNome = computed(() => {
    if (!this.tentouSalvar()) return null;
    const n = this.nome().trim();
    if (n === '') return 'Informe o nome.';
    return n.length > MAX_NOME ? `Máximo de ${MAX_NOME} caracteres.` : null;
  });
  private readonly errosBlocos = computed(() => (this.tentouSalvar() ? validarBlocos(this.editadoEstavel().blocos) : {}));
  /** Id do bloco → primeira mensagem dele (as chaves de `validarBlocos` são `blocos[i]...`, com o índice da tela). */
  protected readonly errosPorBloco = computed(() => {
    const blocos = this.editadoEstavel().blocos;
    const mapa = new Map<string, string>();
    for (const [caminho, mensagem] of Object.entries(this.errosBlocos())) {
      const m = CAMINHO_BLOCO.exec(caminho);
      const b = m ? blocos[Number(m[1])] : undefined;
      if (b && !mapa.has(b.id)) mapa.set(b.id, mensagem);
    }
    return mapa;
  });
  protected readonly erroGeral = computed(() => {
    const erros = this.errosBlocos();
    // erro da lista inteira (ex.: blocos demais), sem índice
    const daLista = Object.entries(erros).find(([caminho]) => !CAMINHO_BLOCO.test(caminho));
    if (daLista) return daLista[1];
    if (this.erroNome() || Object.keys(erros).length > 0) return CORRIJA;
    return this.erroRepo();
  });

  // ---- prévia ----
  protected readonly gerando = signal(false);
  private readonly urlPrevia = signal<string | null>(null);
  private readonly modoPrevia = signal<'iframe' | 'aba' | 'bloqueada' | null>(null);
  protected readonly iframeUrl = computed((): SafeResourceUrl | null => {
    const url = this.urlPrevia();
    // blob: criado aqui mesmo, a partir do PDF gerado no aparelho
    return url && this.modoPrevia() === 'iframe' ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });
  protected readonly linkPrevia = computed(() => (this.modoPrevia() === 'bloqueada' ? this.urlPrevia() : null));
  protected readonly abertaEmAba = computed(() => this.modoPrevia() === 'aba');
  protected readonly urlBaixar = computed(() => {
    const modo = this.modoPrevia();
    return modo === 'aba' || modo === 'bloqueada' ? this.urlPrevia() : null;
  });
  protected readonly nomeArquivoPrevia = computed(
    () => `previa-${this.nome().trim().replace(/[\\/:*?"<>|]+/g, '-') || 'template'}.pdf`,
  );

  private destruido = false;

  constructor() {
    this.estadoSalvo.set(this.estadoAtual());
    effect(() => {
      const editado = this.editado();
      untracked(() => {
        clearTimeout(this.timerEdicao);
        if (editado !== this.editadoEstavel()) {
          this.timerEdicao = setTimeout(() => this.editadoEstavel.set(editado), ESPERA_EDICAO_MS);
        }
      });
    });
    effect(() => {
      const id = this.id();
      if (id) void this.carregar(id);
    });
    // o aviso do navegador (fechar a aba) segue o estado com debounce
    avisarAoSairDaPagina(this.alterado);
    inject(DestroyRef).onDestroy(() => {
      this.destruido = true;
      clearTimeout(this.timerEdicao);
      this.descartarPrevia();
    });
  }

  /** Guard de rota: compara o estado de agora, sem esperar o debounce (é uma chamada só, na navegação). */
  temAlteracoes(): boolean {
    if (this.liberado() || this.carregando() || this.indisponivel()) return false;
    return instantaneo(this.editado()) !== this.estadoSalvo();
  }

  /** Aplica já o que está pendente no debounce (Salvar, depois de carregar). */
  private estabilizar(): void {
    clearTimeout(this.timerEdicao);
    this.timerEdicao = undefined;
    this.editadoEstavel.set(this.editado());
  }

  /** Toque fora do "+ Bloco" e do menu fecha o menu. */
  protected pointerFora(e: Event): void {
    if (!this.menuAberto()) return;
    const area = this.areaMenu()?.nativeElement;
    if (area && !area.contains(e.target as Node)) this.menuAberto.set(false);
  }

  protected alternarAtivo(ativo: boolean): void {
    this.ativo.set(ativo);
    if (!ativo) this.padrao.set(false);
    this.erroPadrao.set(null);
  }

  protected alternarAberto(id: string): void {
    this.aberto.set(this.aberto() === id ? null : id);
  }

  protected alternarMenu(): void {
    const abrir = !this.menuAberto();
    this.menuAberto.set(abrir);
    if (abrir) this.focar('#menu-blocos [role=menuitem]');
  }

  /** Setas, Home e End movem o foco entre os tipos; Esc fecha e devolve o foco ao "+ Bloco"; Tab fecha. */
  protected teclaNoMenu(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.menuAberto.set(false);
      this.focar('button[aria-controls="menu-blocos"]');
      return;
    }
    if (e.key === 'Tab') {
      this.menuAberto.set(false);
      return;
    }
    const itens = [...this.host.nativeElement.querySelectorAll<HTMLElement>('#menu-blocos [role=menuitem]')];
    const atual = itens.indexOf(document.activeElement as HTMLElement);
    const n = itens.length;
    const destinos: Record<string, number> = { ArrowDown: (atual + 1) % n, ArrowUp: (atual - 1 + n) % n, Home: 0, End: n - 1 };
    const proximo = destinos[e.key];
    if (proximo === undefined) return;
    e.preventDefault();
    itens[proximo]?.focus();
  }

  protected adicionar(tipo: TipoBloco): void {
    const b = novoBloco(tipo);
    this.blocos.update((l) => [...l, b]);
    this.menuAberto.set(false);
    this.aberto.set(b.id);
    this.anuncio.set(`Bloco ${rotuloBloco(b)} adicionado no fim.`);
    this.focar(`li[data-bloco-id="${b.id}"] [data-testid=abrir-bloco]`);
  }

  protected atualizarConfig(id: string, config: Bloco['config']): void {
    // síncrono: o editor de texto trata o eco do que acabou de emitir (P4a-R10)
    this.blocos.update((l) => l.map((b) => (b.id === id ? ({ ...b, config } as Bloco) : b)));
  }

  protected mover(i: number, delta: -1 | 1, acao: AcaoMover): void {
    const destino = i + delta;
    const lista = [...this.blocos()];
    if (destino < 0 || destino >= lista.length) return;
    moveItemInArray(lista, i, destino);
    this.blocos.set(lista);
    const b = lista[destino];
    this.anunciarPosicao(b, destino, lista.length);
    // o foco fica no mesmo botão do bloco movido; se ele ficou desabilitado (chegou na ponta), no botão oposto
    const chegouNaPonta = acao === 'subir' ? destino === 0 : destino === lista.length - 1;
    const alvo = chegouNaPonta ? (acao === 'subir' ? 'descer' : 'subir') : acao;
    this.focar(`li[data-bloco-id="${b.id}"] button[data-acao=${alvo}]`);
  }

  protected soltar(e: CdkDragDrop<unknown>): void {
    if (e.previousIndex === e.currentIndex) return;
    const lista = [...this.blocos()];
    moveItemInArray(lista, e.previousIndex, e.currentIndex);
    this.blocos.set(lista);
    this.anunciarPosicao(lista[e.currentIndex], e.currentIndex, lista.length);
  }

  protected remover(b: Bloco, i: number): void {
    if (!window.confirm(`Remover o bloco "${rotuloBloco(b)}"?`)) return;
    const lista = this.blocos().filter((x) => x.id !== b.id);
    this.blocos.set(lista);
    if (this.aberto() === b.id) this.aberto.set(null);
    this.anuncio.set(`Bloco ${rotuloBloco(b)} removido.`);
    const proximo = lista[Math.min(i, lista.length - 1)];
    this.focar(proximo ? `li[data-bloco-id="${proximo.id}"] [data-testid=abrir-bloco]` : 'button[aria-controls="menu-blocos"]');
  }

  protected async salvar(): Promise<void> {
    if (this.salvando() || this.carregando() || this.naoEncontrado() || this.falhaCarga()) return;
    // validação final síncrona, sobre o que está na tela
    this.estabilizar();
    this.tentouSalvar.set(true);
    this.erroRepo.set(null);
    this.erroPadrao.set(null);
    if (this.erroGeral()) {
      this.focarPrimeiroErro();
      return;
    }
    const dados: TemplateDados = {
      nome: this.nome().trim(),
      tipoProposta: this.tipo(),
      padrao: this.ativo() && this.padrao(),
      ativo: this.ativo(),
      blocos: this.blocos(),
    };
    this.salvando.set(true);
    try {
      await this.repo.salvar(dados, this.id(), this.versaoCarregada);
      this.estadoSalvo.set(this.estadoAtual());
      this.toasts.mostrar('Template salvo.');
      await this.router.navigateByUrl('/templates');
    } catch (e) {
      if (e instanceof ErroCampo && e.campo === 'padrao') this.erroPadrao.set(e.message);
      else if (e instanceof ErroCampo) this.erroRepo.set(e.message);
      else this.toasts.erro('Não foi possível salvar o template.');
    } finally {
      this.salvando.set(false);
    }
  }

  protected async excluir(): Promise<void> {
    const id = this.id();
    if (!id || this.excluindo() || !window.confirm('Excluir este template?')) return;
    this.excluindo.set(true);
    try {
      await this.repo.excluir(id, this.versaoCarregada);
      this.liberado.set(true);
      this.toasts.mostrar('Template excluído.');
      await this.router.navigateByUrl('/templates');
    } catch {
      this.toasts.erro('Não foi possível excluir o template.');
    } finally {
      this.excluindo.set(false);
    }
  }

  /**
   * PDF com dados fictícios e a empresa local; tudo no aparelho (funciona offline). No celular (P4a-R1), a aba é aberta
   * aqui, de forma síncrona, ainda dentro do gesto do usuário — o iOS/Safari bloqueia `window.open` depois de um
   * `await` — e só recebe o blob quando ele fica pronto.
   */
  protected async gerarPrevia(): Promise<void> {
    if (this.gerando()) return;
    this.gerando.set(true);
    const desktop = previaNoIframe();
    const janela = desktop ? null : this.abrirJanelaDePrevia();
    try {
      const empresa = (await this.db.empresa.get(ID_EMPRESA)) ?? null;
      const logo = await this.pdf.logoDataUrl(empresa);
      const blob = await this.pdf.gerarBlob(entradaFicticia(this.blocos(), empresa, logo, this.tipo()));
      if (this.destruido) {
        // saiu do editor durante a geração: só a aba já aberta ainda quer o PDF; nada de URL sem dono
        if (janela) {
          const url = URL.createObjectURL(blob);
          janela.location.href = url;
          this.revogar(url, true);
        }
        return;
      }
      this.descartarPrevia();
      const url = URL.createObjectURL(blob);
      this.urlPrevia.set(url);
      if (desktop) {
        this.modoPrevia.set('iframe');
      } else if (janela) {
        janela.location.href = url;
        this.modoPrevia.set('aba');
      } else {
        // popup bloqueado: fica o link
        this.modoPrevia.set('bloqueada');
      }
    } catch {
      janela?.close();
      this.toasts.erro('Não foi possível gerar a prévia.');
    } finally {
      this.gerando.set(false);
    }
  }

  /** Aba em branco com "Gerando prévia…"; null se o navegador bloquear o popup. */
  private abrirJanelaDePrevia(): Window | null {
    const janela = window.open('', '_blank');
    if (!janela) return null;
    try {
      janela.opener = null;
      janela.document.title = 'Prévia do PDF';
      janela.document.body.textContent = 'Gerando prévia…';
    } catch {
      // só cosmético: sem acesso ao documento da aba, ela fica em branco até o PDF chegar
    }
    return janela;
  }

  /** Tira a prévia atual. No iframe, revoga já; em outra aba (ou no link), só depois de um tempo. */
  private descartarPrevia(): void {
    const url = this.urlPrevia();
    const modo = this.modoPrevia();
    this.urlPrevia.set(null);
    this.modoPrevia.set(null);
    if (url) this.revogar(url, modo !== 'iframe');
  }

  private revogar(url: string, adiar: boolean): void {
    if (adiar) window.setTimeout(() => URL.revokeObjectURL(url), ESPERA_REVOGAR_MS);
    else URL.revokeObjectURL(url);
  }

  /** Nome inválido: foco no #nome. Senão abre o primeiro bloco com erro e foca o card dele. */
  private focarPrimeiroErro(): void {
    if (this.erroNome()) {
      this.focar('#nome');
      return;
    }
    const erros = this.errosPorBloco();
    const primeiro = this.blocos().find((b) => erros.has(b.id));
    if (primeiro) {
      this.aberto.set(primeiro.id);
      this.focar(`li[data-bloco-id="${primeiro.id}"] [data-testid=abrir-bloco]`);
    }
  }

  private anunciarPosicao(b: Bloco, indice: number, total: number): void {
    this.anuncio.set(`Bloco ${rotuloBloco(b)} movido para a posição ${indice + 1} de ${total}.`);
  }

  /** Foca o elemento depois da próxima renderização (a lista acabou de mudar). */
  private focar(seletor: string): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(seletor)?.focus(),
      { injector: this.injector },
    );
  }

  private async carregar(id: string): Promise<void> {
    this.falhaCarga.set(false);
    try {
      const t = await this.repo.buscar(id);
      const pendencia = await this.repo.temPendencia(id);
      // marcado no registro mas não é o padrão efetivo (outro do tipo foi marcado depois, ainda não sincronizado):
      // o checkbox mostra o que vale
      const padraoEfetivo = t?.padrao ? await this.repo.padraoPorTipo(t.tipoProposta) : undefined;
      // o id mudou durante a leitura: a carga do id novo é que preenche a tela
      if (this.id() !== id) return;
      this.temPendencia.set(pendencia);
      this.naoEncontrado.set(!t);
      if (!t) return;
      this.versaoCarregada = t.version;
      this.nome.set(t.nome);
      this.tipo.set(t.tipoProposta);
      this.ativo.set(t.ativo);
      this.padrao.set(t.padrao && padraoEfetivo?.id === t.id);
      // blocos de tipo desconhecido (vindos do pull) ficam como estão
      this.blocos.set(t.blocos);
      this.aberto.set(null);
      this.estabilizar();
      this.estadoSalvo.set(this.estadoAtual());
    } catch {
      // editor vazio salvaria por cima do template existente: bloqueia
      if (this.id() === id) this.falhaCarga.set(true);
    } finally {
      if (this.id() === id) this.carregadoId.set(id);
    }
  }
}
