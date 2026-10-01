import { paraBytes } from '../../core/arquivos/arquivos-service';
import { sha256Hex } from '../../core/util/sha256';
import { ErroOs } from './erro-os';

/** Ponto em pixels CSS, relativo ao canto superior esquerdo do canvas. */
export interface Ponto {
  x: number;
  y: number;
}

export type Traco = readonly Ponto[];

/** Retângulo em pixels CSS do canvas da tela. */
export interface Caixa {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/** Comando de desenho de um traço, aplicado num contexto 2D (`aplicar`). */
export type Comando =
  | { op: 'mover'; x: number; y: number }
  | { op: 'linha'; x: number; y: number }
  | { op: 'curva'; cx: number; cy: number; x: number; y: number }
  | { op: 'ponto'; x: number; y: number };

/** Limites do PNG da assinatura (o servidor aceita PNG de até 512 KB). */
export const ASSINATURA_LARGURA_MAX = 640;
export const ASSINATURA_ALTURA_MAX = 320;
export const ASSINATURA_MAX_BYTES = 512 * 1024;
/** Espessura do traço em pixels CSS, a cor e a folga em volta do traço no recorte. */
const ESPESSURA_PADRAO = 2.5;
const COR_PADRAO = '#111';
const MARGEM = 12;
/** O traço é vetorial: uma assinatura pequena na tela pode sair ampliada, até este fator. */
const ESCALA_MAXIMA = 2;
/** Pontos mais próximos que isto (em px CSS) do anterior não acrescentam nada ao traço. */
const DISTANCIA_MINIMA = 0.5;

const meio = (a: Ponto, b: Ponto): Ponto => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * O traço inteiro, suavizado: do primeiro ponto ao meio do primeiro segmento em reta; depois uma curva quadrática por
 * ponto intermediário, com o ponto como controle, de um ponto médio ao seguinte; do último meio ao último ponto em
 * reta. Um ponto só vira um pingo.
 */
export function comandosDoTraco(pontos: Traco): Comando[] {
  if (pontos.length === 0) return [];
  if (pontos.length === 1) return [{ op: 'ponto', ...pontos[0] }];
  const comandos: Comando[] = [{ op: 'mover', ...pontos[0] }];
  for (let i = 1; i < pontos.length; i++) comandos.push(...trechoAoChegar(pontos, i).slice(1));
  comandos.push(...trechoFinal(pontos).slice(1));
  return comandos;
}

/**
 * O pedaço do traço que fica definido quando chega o ponto `i` (≥ 1), para desenhar ao vivo sem redesenhar tudo a
 * cada movimento. Juntos, e com o `trechoFinal`, formam o mesmo traço de `comandosDoTraco`.
 */
export function trechoAoChegar(pontos: Traco, i: number): Comando[] {
  if (i === 1) return [{ op: 'mover', ...pontos[0] }, { op: 'linha', ...meio(pontos[0], pontos[1]) }];
  const controle = pontos[i - 1];
  return [
    { op: 'mover', ...meio(pontos[i - 2], controle) },
    { op: 'curva', cx: controle.x, cy: controle.y, ...meio(controle, pontos[i]) },
  ];
}

/** O fim do traço, desenhado ao soltar: do último ponto médio ao último ponto (ou o pingo, num toque só). */
export function trechoFinal(pontos: Traco): Comando[] {
  const n = pontos.length;
  if (n === 0) return [];
  if (n === 1) return [{ op: 'ponto', ...pontos[0] }];
  return [
    { op: 'mover', ...meio(pontos[n - 2], pontos[n - 1]) },
    { op: 'linha', ...pontos[n - 1] },
  ];
}

/**
 * A caixa que envolve todos os traços com `margem` (px CSS) de folga, arredondada para fora e limitada ao canvas
 * (`limite`): com o ponteiro capturado o dedo pode sair do canvas, e o PNG mostra só o que se viu na tela. Null sem
 * pontos visíveis.
 */
export function caixaDosTracos(tracos: readonly Traco[], margem: number, limite: { largura: number; altura: number }): Caixa | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const traco of tracos) {
    for (const p of traco) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (minX === Infinity) return null;
  const x0 = Math.max(0, Math.floor(minX - margem));
  const y0 = Math.max(0, Math.floor(minY - margem));
  const x1 = Math.min(limite.largura, Math.ceil(maxX + margem));
  const y1 = Math.min(limite.altura, Math.ceil(maxY + margem));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, largura: x1 - x0, altura: y1 - y0 };
}

/** Tamanho do PNG: a caixa cabe em 640×320 mantendo a proporção, ampliada no máximo 2×. */
export function dimensoesDaSaida(caixa: Caixa): { largura: number; altura: number; escala: number } {
  const escala = Math.min(ASSINATURA_LARGURA_MAX / caixa.largura, ASSINATURA_ALTURA_MAX / caixa.altura, ESCALA_MAXIMA);
  return {
    largura: Math.min(ASSINATURA_LARGURA_MAX, Math.max(1, Math.round(caixa.largura * escala))),
    altura: Math.min(ASSINATURA_ALTURA_MAX, Math.max(1, Math.round(caixa.altura * escala))),
    escala,
  };
}

/** Desenha os comandos: o pingo é um círculo cheio do diâmetro do traço; o resto, um caminho com stroke. */
function aplicar(ctx: CanvasRenderingContext2D, comandos: readonly Comando[], espessura: number): void {
  if (comandos.length === 0) return;
  ctx.beginPath();
  let pingo = false;
  for (const c of comandos) {
    if (c.op === 'mover') ctx.moveTo(c.x, c.y);
    else if (c.op === 'linha') ctx.lineTo(c.x, c.y);
    else if (c.op === 'curva') ctx.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
    else {
      ctx.arc(c.x, c.y, espessura / 2, 0, Math.PI * 2);
      pingo = true;
    }
  }
  if (pingo) ctx.fill();
  else ctx.stroke();
}

export interface OpcoesAssinatura {
  /** Espessura do traço em px CSS (padrão 2,5). */
  espessura?: number;
  /** Cor do traço (padrão quase preto). */
  cor?: string;
  /** Chamado quando a assinatura deixa de estar vazia (início de um traço) ou é limpa: a tela atualiza o "Confirmar". */
  aoMudar?: () => void;
}

/**
 * A lógica da assinatura na tela, sem Angular: o componente (M2-P3) chama `ligar(canvas)` ao montar e `desligar()` ao
 * destruir, e usa `vazio()`, `limpar()` e `paraPng()`.
 *
 * - Pointer events: dedo, caneta e mouse (só o botão principal). Um ponteiro por vez: o segundo dedo é ignorado.
 *   O ponteiro é capturado no pointerdown, e o canvas recebe `touch-action: none` (o dedo não rola a página).
 * - Traço suave: curvas quadráticas pelos pontos médios (`comandosDoTraco`), com os eventos coalescidos quando o
 *   navegador os oferece (traço fiel mesmo com o aparelho lento). Ao vivo desenha só o pedaço novo.
 * - Nitidez: o canvas tem `devicePixelRatio` pixels por px CSS; os pontos ficam em px CSS. Quando o elemento muda de
 *   tamanho (giro da tela), `ajustarTamanho()` refaz o canvas e redesenha os traços (o ResizeObserver chama sozinho
 *   onde existe).
 * - `paraPng()` não depende do canvas da tela: redesenha os traços (vetoriais) recortados num canvas próprio.
 */
export class AssinaturaCanvas {
  private readonly espessura: number;
  private readonly cor: string;
  private readonly aoMudar: (() => void) | undefined;
  private readonly pontos: Ponto[][] = [];
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private eventos: AbortController | null = null;
  private observador: ResizeObserver | null = null;
  /** Tamanho CSS do canvas da tela no último ajuste (o recorte se limita a ele). */
  private largura = 0;
  private altura = 0;
  /** O traço em andamento e o ponteiro que o desenha. */
  private atual: Ponto[] | null = null;
  private ponteiro: number | null = null;
  private retangulo: DOMRect | null = null;

  constructor(opcoes: OpcoesAssinatura = {}) {
    this.espessura = opcoes.espessura ?? ESPESSURA_PADRAO;
    this.cor = opcoes.cor ?? COR_PADRAO;
    this.aoMudar = opcoes.aoMudar;
  }

  /** Os traços desenhados até agora (o em andamento incluído), em px CSS do canvas. */
  get tracos(): readonly Traco[] {
    return this.pontos;
  }

  ligar(canvas: HTMLCanvasElement): void {
    if (this.canvas) this.desligar();
    this.canvas = canvas;
    canvas.style.touchAction = 'none';
    this.eventos = new AbortController();
    const opcoes = { signal: this.eventos.signal };
    canvas.addEventListener('pointerdown', (e) => this.aoPressionar(e), opcoes);
    canvas.addEventListener('pointermove', (e) => this.aoMover(e), opcoes);
    canvas.addEventListener('pointerup', (e) => this.aoSoltar(e), opcoes);
    canvas.addEventListener('pointercancel', (e) => this.aoSoltar(e), opcoes);
    // sem pointerup (ex.: o sistema tomou o toque): encerra o traço do mesmo jeito
    canvas.addEventListener('lostpointercapture', (e) => this.aoSoltar(e), opcoes);
    this.ajustarTamanho();
    if (typeof ResizeObserver !== 'undefined') {
      this.observador = new ResizeObserver(() => this.ajustarTamanho());
      this.observador.observe(canvas);
    }
  }

  /** Solta o canvas (listeners e observador). Os traços continuam: `paraPng()` ainda funciona. */
  desligar(): void {
    this.eventos?.abort();
    this.eventos = null;
    this.observador?.disconnect();
    this.observador = null;
    this.encerrarTraco();
    this.canvas = null;
    this.ctx = null;
  }

  /** Refaz o canvas no tamanho atual do elemento, na densidade da tela, e redesenha os traços. */
  ajustarTamanho(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // escondido (display: none, a tela fechando): zerar o canvas apagaria o desenho e o recorte do paraPng
    if (rect.width === 0 || rect.height === 0) return;
    const densidade = globalThis.devicePixelRatio || 1;
    this.largura = rect.width;
    this.altura = rect.height;
    canvas.width = Math.round(rect.width * densidade);
    canvas.height = Math.round(rect.height * densidade);
    if (this.atual) this.retangulo = rect;
    // mudar o tamanho do canvas zera o contexto (transformação e estilo) e apaga o desenho
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) return;
    this.ctx.setTransform(densidade, 0, 0, densidade, 0, 0);
    this.estilizar(this.ctx);
    for (const traco of this.pontos) aplicar(this.ctx, comandosDoTraco(traco), this.espessura);
  }

  vazio(): boolean {
    return this.pontos.length === 0;
  }

  limpar(): void {
    this.encerrarTraco();
    this.pontos.length = 0;
    this.ctx?.clearRect(0, 0, this.largura, this.altura);
    this.aoMudar?.();
  }

  /**
   * PNG da assinatura: null se vazia. Recorta aos traços com margem, fundo branco, cabe em 640×320 (redesenhado na
   * escala de saída, nítido) e devolve os bytes com o SHA-256. Acima de 512 KB (o limite do servidor) é `ErroOs`.
   */
  async paraPng(): Promise<{ bytes: ArrayBuffer; sha256: string } | null> {
    if (this.vazio()) return null;
    const caixa = caixaDosTracos(this.pontos, MARGEM + this.espessura / 2, { largura: this.largura, altura: this.altura });
    if (!caixa) return null;
    const { largura, altura, escala } = dimensoesDaSaida(caixa);
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ErroOs('ASSINATURA_FALHOU', 'assinatura', 'Não foi possível gerar a assinatura.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, largura, altura);
    ctx.setTransform(escala, 0, 0, escala, -caixa.x * escala, -caixa.y * escala);
    this.estilizar(ctx);
    for (const traco of this.pontos) aplicar(ctx, comandosDoTraco(traco), this.espessura);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new ErroOs('ASSINATURA_FALHOU', 'assinatura', 'Não foi possível gerar a assinatura.');
    if (blob.size > ASSINATURA_MAX_BYTES) {
      throw new ErroOs('ASSINATURA_GRANDE', 'assinatura', 'A assinatura ficou grande demais.');
    }
    const bytes = await paraBytes(blob);
    return { bytes, sha256: await sha256Hex(bytes) };
  }

  private aoPressionar(e: PointerEvent): void {
    if (this.ponteiro !== null || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const canvas = this.canvas;
    if (!canvas) return;
    e.preventDefault();
    this.ponteiro = e.pointerId;
    this.retangulo = canvas.getBoundingClientRect();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ponteiro já solto: o traço termina no pointerup/cancel que vier
    }
    this.atual = [this.ponto(e)];
    this.pontos.push(this.atual);
    this.aoMudar?.();
  }

  private aoMover(e: PointerEvent): void {
    if (e.pointerId !== this.ponteiro || !this.atual) return;
    e.preventDefault();
    const coalescidos = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of coalescidos.length > 0 ? coalescidos : [e]) this.acrescentar(this.ponto(ev));
  }

  private aoSoltar(e: PointerEvent): void {
    if (e.pointerId !== this.ponteiro || !this.atual) return;
    if (e.type === 'pointerup') this.acrescentar(this.ponto(e));
    this.encerrarTraco();
  }

  private acrescentar(p: Ponto): void {
    const traco = this.atual;
    if (!traco) return;
    const ultimo = traco[traco.length - 1];
    if (Math.hypot(p.x - ultimo.x, p.y - ultimo.y) < DISTANCIA_MINIMA) return;
    traco.push(p);
    if (this.ctx) aplicar(this.ctx, trechoAoChegar(traco, traco.length - 1), this.espessura);
  }

  private encerrarTraco(): void {
    if (this.atual && this.ctx) aplicar(this.ctx, trechoFinal(this.atual), this.espessura);
    this.atual = null;
    this.ponteiro = null;
    this.retangulo = null;
  }

  private ponto(e: { clientX: number; clientY: number }): Ponto {
    const r = this.retangulo;
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: e.clientX, y: e.clientY };
  }

  private estilizar(ctx: CanvasRenderingContext2D): void {
    ctx.lineWidth = this.espessura;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.cor;
    ctx.fillStyle = this.cor;
  }
}
