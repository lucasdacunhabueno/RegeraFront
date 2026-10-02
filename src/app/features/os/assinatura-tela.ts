import {
  afterNextRender, Component, DestroyRef, DOCUMENT, effect, ElementRef, inject, Injector, input, output, signal, viewChild,
} from '@angular/core';
import { stripJava } from '../propostas/proposta-models';
import { AssinaturaCanvas, Ponto } from './assinatura-canvas';
import { mensagemErroOs } from './formatos-os';
import { ASSINANTE_NOME_MAX_OS, ASSINANTE_NOME_MIN_OS, ASSINANTE_PAPEL_MAX_OS, tamanhoTextoOs } from './os-models';
import type { AssinaturaColhida } from './os-repo';

let sequencia = 0;

const FOCAVEIS = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Os limites do `OsRepo.assinar` (os do servidor, em `os-models`): nome de 2 a 120, papel até 60, em code points. */
const NOME_MIN = ASSINANTE_NOME_MIN_OS;
const NOME_MAX = ASSINANTE_NOME_MAX_OS;
const PAPEL_MAX = ASSINANTE_PAPEL_MAX_OS;

const dentro = (p: Ponto, largura: number, altura: number) => p.x >= 0 && p.y >= 0 && p.x <= largura && p.y <= altura;

/**
 * Assinatura em tela cheia (spec M2 §9), sobre o `AssinaturaCanvas`: quem assina desenha com o dedo e informa o nome
 * (2 a 120) e o papel (até 60, "Cliente" de saída). Confirmar fica desabilitado com o quadro vazio; o PNG sai do
 * `paraPng()` e vai, com o nome e o papel, em `confirmado` — quem usa grava (`OsRepo.assinar`), mostra o erro em
 * `erro` e fecha.
 *
 * - Diálogo modal: `aria-modal`, rótulo e dica ligados, o foco entra no painel, fica preso nele (Tab/Shift+Tab), Esc e
 *   Cancelar fecham, e o foco volta para quem abriu (`gatilho`, ou o elemento focado ao abrir).
 * - O canvas tem o tamanho no CSS (ocupa a área útil), não rola nem seleciona (`touch-none`, `select-none`, sem o menu
 *   do toque longo do iOS) e não tem borda nem padding: a moldura é da div em volta.
 * - Em paisagem, os campos e os botões vão para a lateral e o quadro fica com a altura toda. Se a tela girar com parte
 *   do traço que se via fora da área nova, a tela avisa: o PNG só leva o que se vê. Os pontos de quando o dedo passou
 *   da borda (o ponteiro fica capturado) nunca se viram e não contam.
 */
@Component({
  selector: 'app-assinatura-tela',
  host: { class: 'fixed inset-0 z-50 flex bg-white' },
  template: `
    <div #painel role="dialog" aria-modal="true" tabindex="-1" [attr.aria-labelledby]="id + '-titulo'"
         [attr.aria-describedby]="id + '-instrucao'" (keydown)="teclado($event)"
         class="flex min-h-0 w-full flex-col gap-3 overflow-y-auto overscroll-contain p-3 outline-none pb-[calc(0.75rem+env(safe-area-inset-bottom))] landscape:flex-row">
      <div class="flex min-h-0 flex-1 flex-col gap-2">
        <div class="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 [id]="id + '-titulo'" class="text-lg font-semibold">Assinatura</h2>
          <p class="text-sm text-slate-600 landscape:hidden">Gire o celular para ter mais espaço.</p>
        </div>
        <p [id]="id + '-instrucao'" class="sr-only">Assine com o dedo no quadro. Depois informe o nome e o papel de quem assina.</p>
        <div class="relative min-h-40 flex-1 rounded-lg border-2 border-dashed border-slate-300">
          <canvas #quadro role="img" aria-label="Quadro da assinatura"
                  class="absolute inset-0 block size-full touch-none select-none [-webkit-touch-callout:none]"></canvas>
          @if (vazia()) {
            <p aria-hidden="true" class="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm text-slate-400">Assine aqui</p>
          }
        </div>
        @if (foraDaArea()) {
          <p data-testid="fora-da-area" role="alert" class="text-sm font-medium text-amber-800">
            A tela mudou de tamanho e parte da assinatura ficou fora do quadro. Limpe e assine de novo.
          </p>
        }
      </div>

      <div class="flex flex-col gap-3 landscape:w-72 landscape:shrink-0 landscape:overflow-y-auto">
        <div class="space-y-1">
          <label [for]="id + '-nome'" class="text-sm font-medium">Nome de quem assina</label>
          <input #campoNome [id]="id + '-nome'" name="nome" type="text" autocomplete="name" [value]="nome()"
                 (input)="digitarNome($any($event.target).value)" [disabled]="travada()"
                 [attr.aria-invalid]="erroNome() ? 'true' : 'false'"
                 [attr.aria-describedby]="erroNome() ? id + '-erro-nome' : null"
                 class="h-12 w-full rounded-lg border px-3 disabled:opacity-60" [class.border-slate-300]="!erroNome()"
                 [class.border-red-600]="erroNome()" />
          @if (erroNome(); as e) { <p [id]="id + '-erro-nome'" role="alert" class="text-sm text-red-600">{{ e }}</p> }
        </div>
        <div class="space-y-1">
          <label [for]="id + '-papel'" class="text-sm font-medium">Papel</label>
          <input #campoPapel [id]="id + '-papel'" name="papel" type="text" [value]="papel()"
                 (input)="digitarPapel($any($event.target).value)" [disabled]="travada()"
                 [attr.aria-invalid]="erroPapel() ? 'true' : 'false'"
                 [attr.aria-describedby]="id + '-ajuda-papel' + (erroPapel() ? ' ' + id + '-erro-papel' : '')"
                 class="h-12 w-full rounded-lg border px-3 disabled:opacity-60" [class.border-slate-300]="!erroPapel()"
                 [class.border-red-600]="erroPapel()" />
          <p [id]="id + '-ajuda-papel'" class="text-xs text-slate-500">Ex.: Cliente, Síndico, Responsável no local.</p>
          @if (erroPapel(); as e) { <p [id]="id + '-erro-papel'" role="alert" class="text-sm text-red-600">{{ e }}</p> }
        </div>

        @if (mensagemErro(); as e) {
          <p data-testid="erro-assinatura" role="alert" class="text-sm text-red-600">{{ e }}</p>
        }
        @if (vazia()) {
          <p [id]="id + '-dica-vazia'" class="text-sm text-slate-600">Assine no quadro para confirmar.</p>
        }

        <div class="grid grid-cols-2 gap-2">
          <button type="button" (click)="limpar()" [disabled]="travada()"
                  class="h-12 rounded-lg border border-slate-300 px-4 font-semibold disabled:opacity-60">Limpar</button>
          <button type="button" (click)="cancelado.emit()" [disabled]="travada()"
                  class="h-12 rounded-lg border border-slate-300 px-4 font-semibold disabled:opacity-60">Cancelar</button>
          <button #botaoConfirmar type="button" (click)="confirmar()" [disabled]="travada() || vazia()"
                  [attr.aria-describedby]="vazia() ? id + '-dica-vazia' : null"
                  class="col-span-2 h-12 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-60">
            {{ travada() ? 'Gravando…' : 'Confirmar' }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class AssinaturaTela {
  /**
   * Quem abriu (o botão "Colher assinatura"): recebe o foco de volta ao fechar. Sem ele, o elemento focado ao abrir —
   * que no Safari não é o botão (ele não foca botões no clique).
   */
  readonly gatilho = input<HTMLElement | null>(null);
  /** Quem usa está gravando: tudo fica desabilitado. */
  readonly ocupado = input(false);
  /** A recusa de quem grava (ex.: sem espaço no aparelho), já em texto para o usuário. */
  readonly erro = input<string | null>(null);
  readonly confirmado = output<AssinaturaColhida>();
  readonly cancelado = output<void>();

  protected readonly id = `assinatura-${++sequencia}`;
  protected readonly vazia = signal(true);
  protected readonly foraDaArea = signal(false);
  protected readonly nome = signal('');
  protected readonly papel = signal('Cliente');
  protected readonly erroNome = signal<string | null>(null);
  protected readonly erroPapel = signal<string | null>(null);
  private readonly erroPng = signal<string | null>(null);
  private readonly gerando = signal(false);

  private readonly painel = viewChild.required<ElementRef<HTMLElement>>('painel');
  private readonly quadro = viewChild.required<ElementRef<HTMLCanvasElement>>('quadro');
  private readonly campoNome = viewChild.required<ElementRef<HTMLInputElement>>('campoNome');
  private readonly campoPapel = viewChild.required<ElementRef<HTMLInputElement>>('campoPapel');
  private readonly botaoConfirmar = viewChild.required<ElementRef<HTMLButtonElement>>('botaoConfirmar');

  private readonly assinatura = new AssinaturaCanvas({ aoMudar: () => this.vazia.set(this.assinatura.vazio()) });
  /** O tamanho do quadro na última medida: o aviso só olha uma mudança de tamanho (o giro). */
  private medida = { largura: 0, altura: 0 };
  /**
   * M1: os pontos que estavam dentro do quadro quando foram desenhados. Com o ponteiro capturado, o dedo que passa da
   * borda continua gerando pontos que nunca se viram (nem saem no PNG): eles não contam para o aviso do giro.
   */
  private vistos: Ponto[] = [];
  /** Quantos pontos (na ordem dos traços) já foram conferidos para `vistos`. */
  private conferidos = 0;

  protected travada(): boolean {
    return this.ocupado() || this.gerando();
  }

  protected mensagemErro(): string | null {
    return this.erroPng() ?? this.erro();
  }

  constructor() {
    const documento = inject(DOCUMENT);
    const anterior = documento.activeElement instanceof HTMLElement ? documento.activeElement : null;
    let observador: ResizeObserver | null = null;
    const eventos = new AbortController();
    const injector = inject(Injector);
    afterNextRender(() => {
      const canvas = this.quadro().nativeElement;
      this.assinatura.ligar(canvas);
      this.medida = { largura: canvas.clientWidth, altura: canvas.clientHeight };
      // depois dos ouvintes do AssinaturaCanvas (o último ponto do traço já entrou): confere o traço no tamanho de agora
      const aoSoltar = () => this.conferirVistos(canvas.clientWidth || this.medida.largura, canvas.clientHeight || this.medida.altura);
      for (const tipo of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        canvas.addEventListener(tipo, aoSoltar, { signal: eventos.signal });
      }
      // o giro muda o tamanho do quadro (todo navegador alvo tem o ResizeObserver; sem ele, só não há o aviso)
      if (typeof ResizeObserver !== 'undefined') {
        observador = new ResizeObserver(() => this.conferirArea());
        observador.observe(canvas);
      }
      this.painel().nativeElement.focus();
    });
    // M2: Confirmar (ou outro controle) se desabilita com o foco nele enquanto grava; no fim, o foco volta ao Confirmar
    let estavaTravada = false;
    effect(() => {
      const travada = this.travada();
      if (estavaTravada && !travada) {
        afterNextRender(() => {
          const painel = this.painel().nativeElement;
          const ativo = documento.activeElement;
          const botao = this.botaoConfirmar().nativeElement;
          if ((ativo === painel || ativo === documento.body) && !botao.disabled) botao.focus();
        }, { injector });
      }
      estavaTravada = travada;
    });
    inject(DestroyRef).onDestroy(() => {
      eventos.abort();
      observador?.disconnect();
      this.assinatura.desligar();
      const alvo = this.gatilho() ?? anterior;
      if (alvo?.isConnected) alvo.focus();
    });
  }

  protected digitarNome(valor: string): void {
    this.nome.set(valor);
    if (this.erroNome() && this.validarNome(valor) === null) this.erroNome.set(null);
  }

  protected digitarPapel(valor: string): void {
    this.papel.set(valor);
    if (this.erroPapel() && this.validarPapel(valor) === null) this.erroPapel.set(null);
  }

  protected limpar(): void {
    if (this.travada()) return;
    this.assinatura.limpar();
    this.vistos = [];
    this.conferidos = 0;
    this.foraDaArea.set(false);
    this.erroPng.set(null);
  }

  protected async confirmar(): Promise<void> {
    if (this.travada() || this.vazia()) return;
    const erroNome = this.validarNome(this.nome());
    const erroPapel = this.validarPapel(this.papel());
    this.erroNome.set(erroNome);
    this.erroPapel.set(erroPapel);
    if (erroNome || erroPapel) {
      (erroNome ? this.campoNome() : this.campoPapel()).nativeElement.focus();
      return;
    }
    // M2: o Confirmar se desabilita a seguir; o foco fica no painel, dentro do diálogo
    this.painel().nativeElement.focus();
    this.gerando.set(true);
    this.erroPng.set(null);
    try {
      const png = await this.assinatura.paraPng();
      if (!png) {
        this.erroPng.set('Assine no quadro para confirmar.');
        return;
      }
      const papel = stripJava(this.papel());
      this.confirmado.emit({ png, nome: stripJava(this.nome()), papel: papel === '' ? null : papel });
    } catch (e) {
      this.erroPng.set(mensagemErroOs(e));
    } finally {
      this.gerando.set(false);
    }
  }

  protected teclado(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!this.travada()) this.cancelado.emit();
      return;
    }
    if (e.key !== 'Tab') return;
    const painel = this.painel().nativeElement;
    const focaveis = [...painel.querySelectorAll<HTMLElement>(FOCAVEIS)];
    if (focaveis.length === 0) {
      // tudo desabilitado (gravando): o foco fica no painel, sem escapar do diálogo
      e.preventDefault();
      painel.focus();
      return;
    }
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const ativo = painel.ownerDocument.activeElement;
    if (e.shiftKey && (ativo === primeiro || !focaveis.includes(ativo as HTMLElement))) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && (ativo === ultimo || !focaveis.includes(ativo as HTMLElement))) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  /** Depois de uma mudança de tamanho (o giro): avisa se parte do traço ficou fora da área nova. */
  private conferirArea(): void {
    const canvas = this.quadro().nativeElement;
    const largura = canvas.clientWidth;
    const altura = canvas.clientHeight;
    // escondido ou fechando: não é um giro
    if (largura <= 0 || altura <= 0) return;
    if (largura === this.medida.largura && altura === this.medida.altura) return;
    // o traço em andamento foi desenhado no tamanho anterior
    this.conferirVistos(this.medida.largura, this.medida.altura);
    this.medida = { largura, altura };
    this.foraDaArea.set(this.vistos.some((p) => !dentro(p, largura, altura)));
  }

  /** Guarda em `vistos` os pontos novos (desde a última conferência) que estão dentro do quadro de `largura` × `altura`. */
  private conferirVistos(largura: number, altura: number): void {
    const pontos = this.assinatura.tracos.flat();
    for (let i = this.conferidos; i < pontos.length; i++) {
      if (dentro(pontos[i], largura, altura)) this.vistos.push(pontos[i]);
    }
    this.conferidos = pontos.length;
  }

  private validarNome(valor: string): string | null {
    const n = tamanhoTextoOs(valor);
    if (n === 0) return 'Informe o nome de quem assina.';
    if (n < NOME_MIN || n > NOME_MAX) return `O nome tem de ${NOME_MIN} a ${NOME_MAX} caracteres.`;
    return null;
  }

  private validarPapel(valor: string): string | null {
    return tamanhoTextoOs(valor) > PAPEL_MAX ? `Máximo de ${PAPEL_MAX} caracteres.` : null;
  }
}
