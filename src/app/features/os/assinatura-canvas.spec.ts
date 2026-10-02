import { vi } from 'vitest';
import {
  ASSINATURA_MAX_BYTES,
  AssinaturaCanvas,
  caixaDosTracos,
  Comando,
  comandosDoTraco,
  dimensoesDaSaida,
  Ponto,
  trechoAoChegar,
  trechoFinal,
} from './assinatura-canvas';
import { ErroOs } from './erro-os';

type Op = [string, ...unknown[]];

/** Contexto 2D falso que registra, em ordem, cada chamada de desenho e o estilo vigente em cada stroke/fill. */
function ctxFalso() {
  const ops: Op[] = [];
  const ctx: Record<string, unknown> = { lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', strokeStyle: '#000', fillStyle: '#000' };
  for (const nome of ['setTransform', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'arc']) {
    ctx[nome] = vi.fn((...args: unknown[]) => ops.push([nome, ...args]));
  }
  ctx['stroke'] = vi.fn(() => ops.push(['stroke', { lineWidth: ctx['lineWidth'], strokeStyle: ctx['strokeStyle'], lineCap: ctx['lineCap'] }]));
  ctx['fill'] = vi.fn(() => ops.push(['fill', { fillStyle: ctx['fillStyle'] }]));
  return { ctx, ops };
}

/** Padding de cada canvas falso, para o getComputedStyle falso (o jsdom não calcula estilo de um EventTarget). */
const paddings = new WeakMap<object, number>();

function estiloFalso() {
  vi.stubGlobal('getComputedStyle', (el: object) => {
    const p = `${paddings.get(el) ?? 0}px`;
    return { paddingLeft: p, paddingRight: p, paddingTop: p, paddingBottom: p } as CSSStyleDeclaration;
  });
}

/**
 * Canvas da tela, falso: um EventTarget de verdade (os listeners funcionam). `rect` é a caixa de conteúdo (left/top na
 * página, largura/altura CSS); `padding` e `borda` ficam em volta dela, como no navegador: o getBoundingClientRect
 * inclui os dois, o clientWidth só o padding, e o clientLeft é a borda.
 */
function canvasDaTela(rect = { left: 10, top: 20, width: 300, height: 150 }, { padding = 0, borda = 0 } = {}) {
  const { ctx, ops } = ctxFalso();
  const alvo = new EventTarget();
  const canvas = Object.assign(alvo, {
    width: 300,
    height: 150,
    style: {} as Record<string, string>,
    clientLeft: borda,
    clientTop: borda,
    getBoundingClientRect: vi.fn(() => {
      const width = rect.width + 2 * (padding + borda);
      const height = rect.height + 2 * (padding + borda);
      return { left: rect.left, top: rect.top, width, height, right: rect.left + width, bottom: rect.top + height, x: rect.left, y: rect.top };
    }),
    getContext: vi.fn(() => ctx),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
  Object.defineProperty(canvas, 'clientWidth', { get: () => rect.width + 2 * padding, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { get: () => rect.height + 2 * padding, configurable: true });
  paddings.set(canvas, padding);
  return { canvas, el: canvas as unknown as HTMLCanvasElement, ctx, ops, rect };
}

interface Ponteiro {
  pointerId?: number;
  isPrimary?: boolean;
  pointerType?: string;
  button?: number;
  clientX: number;
  clientY: number;
  coalescidos?: { clientX: number; clientY: number }[];
}

function ponteiro(alvo: EventTarget, tipo: string, p: Ponteiro): Event {
  const e = Object.assign(new Event(tipo, { cancelable: true }), {
    pointerId: p.pointerId ?? 1,
    isPrimary: p.isPrimary ?? true,
    pointerType: p.pointerType ?? 'touch',
    button: p.button ?? 0,
    clientX: p.clientX,
    clientY: p.clientY,
    ...(p.coalescidos ? { getCoalescedEvents: () => p.coalescidos } : {}),
  });
  alvo.dispatchEvent(e);
  return e;
}

/** Traço na tela em coordenadas do canvas (o falso fica em left 10, top 20). */
function tracar(alvo: EventTarget, pontos: Ponto[], pointerId = 1) {
  const [primeiro, ...resto] = pontos;
  ponteiro(alvo, 'pointerdown', { pointerId, clientX: primeiro.x + 10, clientY: primeiro.y + 20 });
  for (const p of resto) ponteiro(alvo, 'pointermove', { pointerId, clientX: p.x + 10, clientY: p.y + 20 });
  const ultimo = pontos[pontos.length - 1];
  ponteiro(alvo, 'pointerup', { pointerId, clientX: ultimo.x + 10, clientY: ultimo.y + 20 });
}

/** Canvas de saída do paraPng (document.createElement('canvas')), falso; `noToBlob` guarda o tamanho antes de zerar. */
function canvasDeSaida(tamanhoDoPng: number | null = 2000, { semContexto = false } = {}) {
  const { ctx, ops } = ctxFalso();
  const saida = {
    width: 0,
    height: 0,
    noToBlob: [] as number[],
    getContext: vi.fn(() => (semContexto ? null : ctx)),
    toBlob: vi.fn((cb: (b: Blob | null) => void, tipo: string) => {
      saida.noToBlob = [saida.width, saida.height];
      cb(tamanhoDoPng === null ? null : new Blob([new Uint8Array(tamanhoDoPng).fill(7)], { type: tipo }));
    }),
  };
  const criarOriginal = document.createElement.bind(document);
  const criar = vi
    .spyOn(document, 'createElement')
    .mockImplementation(((tag: string) =>
      tag === 'canvas' ? (saida as unknown as HTMLCanvasElement) : criarOriginal(tag)) as typeof document.createElement);
  return { saida, ops, criar };
}

const meio = (a: Ponto, b: Ponto): Ponto => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

describe('traço suavizado (funções puras)', () => {
  const p = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 10 },
    { x: 30, y: 10 },
  ];

  it('sem pontos: nada; um ponto: um pingo', () => {
    expect(comandosDoTraco([])).toEqual([]);
    expect(comandosDoTraco([{ x: 5, y: 6 }])).toEqual([{ op: 'ponto', x: 5, y: 6 }]);
  });

  it('dois pontos: reta até o meio e do meio até o fim', () => {
    expect(comandosDoTraco(p.slice(0, 2))).toEqual([
      { op: 'mover', x: 0, y: 0 },
      { op: 'linha', x: 5, y: 0 },
      { op: 'linha', x: 10, y: 0 },
    ]);
  });

  it('vários pontos: curvas quadráticas com o ponto como controle, entre os pontos médios', () => {
    expect(comandosDoTraco(p)).toEqual([
      { op: 'mover', x: 0, y: 0 },
      { op: 'linha', ...meio(p[0], p[1]) },
      { op: 'curva', cx: 10, cy: 0, ...meio(p[1], p[2]) },
      { op: 'curva', cx: 20, cy: 10, ...meio(p[2], p[3]) },
      { op: 'linha', x: 30, y: 10 },
    ]);
  });

  it('os trechos desenhados ao vivo, juntos, são o mesmo traço do redesenho', () => {
    const trechos: Comando[][] = [];
    for (let i = 1; i < p.length; i++) trechos.push(trechoAoChegar(p, i));
    trechos.push(trechoFinal(p));
    // cada trecho começa onde o anterior terminou
    let fim: Ponto = p[0];
    for (const t of trechos) {
      expect(t[0]).toEqual({ op: 'mover', ...fim });
      const ultimo = t[t.length - 1] as { x: number; y: number };
      fim = { x: ultimo.x, y: ultimo.y };
    }
    const semMover = (cs: Comando[]) => cs.filter((c) => c.op !== 'mover');
    expect(trechos.flatMap(semMover)).toEqual(semMover(comandosDoTraco(p)));
  });

  it('trecho final de um toque só é o pingo', () => {
    expect(trechoFinal([{ x: 1, y: 2 }])).toEqual([{ op: 'ponto', x: 1, y: 2 }]);
  });
});

describe('recorte (funções puras)', () => {
  it('caixa do traço com margem, arredondada para fora', () => {
    const tracos = [
      [
        { x: 10.4, y: 20.6 },
        { x: 60, y: 70 },
      ],
      [{ x: 110.2, y: 40 }],
    ];
    expect(caixaDosTracos(tracos, 5, { largura: 300, altura: 150 })).toEqual({ x: 5, y: 15, largura: 111, altura: 60 });
  });

  it('a margem não passa da borda do canvas (o que foi visto é o que sai)', () => {
    const tracos = [
      [
        { x: 2, y: 3 },
        { x: 298, y: 149 },
        { x: 400, y: -50 },
      ],
    ];
    expect(caixaDosTracos(tracos, 10, { largura: 300, altura: 150 })).toEqual({ x: 0, y: 0, largura: 300, altura: 150 });
  });

  it('sem pontos: null', () => {
    expect(caixaDosTracos([], 10, { largura: 300, altura: 150 })).toBeNull();
    expect(caixaDosTracos([[]], 10, { largura: 300, altura: 150 })).toBeNull();
  });

  it('saída cabe em 640×320 mantendo a proporção; amplia no máximo 2× (o traço é vetorial)', () => {
    expect(dimensoesDaSaida({ x: 0, y: 0, largura: 500, altura: 200 })).toEqual({ largura: 640, altura: 256, escala: 1.28 });
    expect(dimensoesDaSaida({ x: 0, y: 0, largura: 1280, altura: 200 })).toEqual({ largura: 640, altura: 100, escala: 0.5 });
    expect(dimensoesDaSaida({ x: 0, y: 0, largura: 300, altura: 300 })).toEqual({ largura: 320, altura: 320, escala: 320 / 300 });
    expect(dimensoesDaSaida({ x: 0, y: 0, largura: 100, altura: 40 })).toEqual({ largura: 200, altura: 80, escala: 2 });
  });
});

describe('AssinaturaCanvas', () => {
  beforeEach(() => estiloFalso());

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('ligar(): canvas nítido na densidade da tela (devicePixelRatio) e sem rolagem pelo toque', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const { el, canvas, ops, ctx } = canvasDaTela();
    new AssinaturaCanvas().ligar(el);
    expect([canvas.width, canvas.height]).toEqual([600, 300]);
    expect(ops).toContainEqual(['setTransform', 2, 0, 0, 2, 0, 0]);
    expect(canvas.style['touchAction']).toBe('none');
    expect(ctx['lineCap']).toBe('round');
    expect(ctx['lineJoin']).toBe('round');
  });

  it('começa vazia', () => {
    const a = new AssinaturaCanvas();
    expect(a.vazio()).toBe(true);
    a.ligar(canvasDaTela().el);
    expect(a.vazio()).toBe(true);
  });

  it('dedo: pointerdown/move/up vira um traço em coordenadas do canvas, desenhado com curvas', () => {
    const { el, canvas, ops } = canvasDaTela();
    const aoMudar = vi.fn();
    const a = new AssinaturaCanvas({ aoMudar });
    a.ligar(el);
    ops.length = 0;

    const down = ponteiro(canvas, 'pointerdown', { clientX: 20, clientY: 30 });
    expect(down.defaultPrevented).toBe(true);
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
    expect(a.vazio()).toBe(false);
    expect(aoMudar).toHaveBeenCalledTimes(1);

    ponteiro(canvas, 'pointermove', { clientX: 30, clientY: 30 });
    ponteiro(canvas, 'pointermove', { clientX: 40, clientY: 40 });
    ponteiro(canvas, 'pointerup', { clientX: 40, clientY: 40 });

    expect(a.tracos).toEqual([
      [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 30, y: 20 },
      ],
    ]);
    const desenho = ops.filter(([n]) => ['moveTo', 'lineTo', 'quadraticCurveTo'].includes(n));
    expect(desenho).toEqual([
      ['moveTo', 10, 10],
      ['lineTo', 15, 10],
      ['moveTo', 15, 10],
      ['quadraticCurveTo', 20, 10, 25, 15],
      ['moveTo', 25, 15],
      ['lineTo', 30, 20],
    ]);
    expect(ops.filter(([n]) => n === 'stroke')).toHaveLength(3);
  });

  it('caneta e mouse também desenham; botão direito do mouse não', () => {
    const { el, canvas } = canvasDaTela();
    const a = new AssinaturaCanvas();
    a.ligar(el);
    ponteiro(canvas, 'pointerdown', { pointerType: 'mouse', button: 2, clientX: 20, clientY: 30 });
    expect(a.vazio()).toBe(true);
    ponteiro(canvas, 'pointerdown', { pointerType: 'mouse', clientX: 20, clientY: 30 });
    ponteiro(canvas, 'pointerup', { pointerType: 'mouse', clientX: 20, clientY: 30 });
    ponteiro(canvas, 'pointerdown', { pointerType: 'pen', pointerId: 7, clientX: 50, clientY: 50 });
    ponteiro(canvas, 'pointerup', { pointerType: 'pen', pointerId: 7, clientX: 50, clientY: 50 });
    expect(a.tracos).toHaveLength(2);
  });

  it('segundo dedo é ignorado enquanto o primeiro desenha', () => {
    const { el, canvas } = canvasDaTela();
    const a = new AssinaturaCanvas();
    a.ligar(el);
    ponteiro(canvas, 'pointerdown', { pointerId: 1, clientX: 20, clientY: 30 });
    ponteiro(canvas, 'pointerdown', { pointerId: 2, isPrimary: false, clientX: 200, clientY: 100 });
    ponteiro(canvas, 'pointermove', { pointerId: 2, isPrimary: false, clientX: 210, clientY: 110 });
    ponteiro(canvas, 'pointermove', { pointerId: 1, clientX: 30, clientY: 30 });
    ponteiro(canvas, 'pointerup', { pointerId: 2, isPrimary: false, clientX: 210, clientY: 110 });
    ponteiro(canvas, 'pointermove', { pointerId: 1, clientX: 40, clientY: 30 });
    ponteiro(canvas, 'pointerup', { pointerId: 1, clientX: 40, clientY: 30 });
    expect(a.tracos).toEqual([
      [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 30, y: 10 },
      ],
    ]);
  });

  it('usa os eventos coalescidos (traço fiel em aparelho lento) e descarta ponto repetido', () => {
    const { el, canvas } = canvasDaTela();
    const a = new AssinaturaCanvas();
    a.ligar(el);
    ponteiro(canvas, 'pointerdown', { clientX: 20, clientY: 30 });
    ponteiro(canvas, 'pointermove', {
      clientX: 40,
      clientY: 30,
      coalescidos: [
        { clientX: 30, clientY: 30 },
        { clientX: 30, clientY: 30 },
        { clientX: 40, clientY: 30 },
      ],
    });
    ponteiro(canvas, 'pointerup', { clientX: 40, clientY: 30 });
    expect(a.tracos[0]).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 30, y: 10 },
    ]);
  });

  it('pointercancel encerra o traço sem perdê-lo; o próximo toque começa outro', () => {
    const { el, canvas } = canvasDaTela();
    const a = new AssinaturaCanvas();
    a.ligar(el);
    ponteiro(canvas, 'pointerdown', { clientX: 20, clientY: 30 });
    ponteiro(canvas, 'pointermove', { clientX: 30, clientY: 30 });
    ponteiro(canvas, 'pointercancel', { clientX: 30, clientY: 30 });
    ponteiro(canvas, 'pointermove', { clientX: 90, clientY: 90 });
    ponteiro(canvas, 'pointerdown', { pointerId: 3, clientX: 100, clientY: 100 });
    ponteiro(canvas, 'pointerup', { pointerId: 3, clientX: 100, clientY: 100 });
    expect(a.tracos).toEqual([
      [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
      ],
      [{ x: 90, y: 80 }],
    ]);
  });

  it('toque sem arrastar desenha um pingo', () => {
    const { el, canvas, ops } = canvasDaTela();
    const a = new AssinaturaCanvas({ espessura: 3 });
    a.ligar(el);
    ponteiro(canvas, 'pointerdown', { clientX: 60, clientY: 70 });
    ponteiro(canvas, 'pointerup', { clientX: 60, clientY: 70 });
    expect(ops).toContainEqual(['arc', 50, 50, 1.5, 0, Math.PI * 2]);
    expect(ops.some(([n]) => n === 'fill')).toBe(true);
  });

  it('limpar(): esvazia, apaga o canvas e avisa', () => {
    const { el, canvas, ops } = canvasDaTela();
    const aoMudar = vi.fn();
    const a = new AssinaturaCanvas({ aoMudar });
    a.ligar(el);
    tracar(canvas, [
      { x: 10, y: 10 },
      { x: 50, y: 50 },
    ]);
    aoMudar.mockClear();
    ops.length = 0;
    a.limpar();
    expect(a.vazio()).toBe(true);
    expect(a.tracos).toEqual([]);
    expect(ops).toContainEqual(['clearRect', 0, 0, 300, 150]);
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it('ajustarTamanho(): novo tamanho da tela redesenha os traços (mudar o tamanho do canvas apaga o desenho)', () => {
    const { el, canvas, ops, rect } = canvasDaTela();
    const a = new AssinaturaCanvas();
    a.ligar(el);
    tracar(canvas, [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 30, y: 20 },
    ]);
    ops.length = 0;
    rect.width = 400;
    rect.height = 200;
    a.ajustarTamanho();
    expect([canvas.width, canvas.height]).toEqual([400, 200]);
    expect(ops.filter(([n]) => ['moveTo', 'lineTo', 'quadraticCurveTo'].includes(n))).toEqual([
      ['moveTo', 10, 10],
      ['lineTo', 15, 10],
      ['quadraticCurveTo', 20, 10, 25, 15],
      ['lineTo', 30, 20],
    ]);
  });

  it('tamanho pela caixa de conteúdo e tinta sob o dedo com padding e borda (p-2 border)', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const { el, canvas, ops } = canvasDaTela({ left: 10, top: 20, width: 300, height: 150 }, { padding: 8, borda: 2 });
    const a = new AssinaturaCanvas();
    a.ligar(el);
    // o bitmap cobre só o conteúdo (300×150 CSS), não padding nem borda
    expect([canvas.width, canvas.height]).toEqual([600, 300]);
    ops.length = 0;
    // o conteúdo começa em left 10 + borda 2 + padding 8 = 20; top 20 + 2 + 8 = 30
    ponteiro(canvas, 'pointerdown', { clientX: 20, clientY: 30 });
    ponteiro(canvas, 'pointermove', { clientX: 70, clientY: 80 });
    ponteiro(canvas, 'pointerup', { clientX: 70, clientY: 80 });
    expect(a.tracos).toEqual([
      [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
      ],
    ]);
    expect(ops).toContainEqual(['moveTo', 0, 0]);
  });

  it('canvas sem tamanho no CSS e densidade > 1: o ResizeObserver não entra em laço (o canvas não cresce sem parar)', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const observadores: { cb: () => void }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        constructor(public cb: () => void) {
          observadores.push(this);
        }
      },
    );
    const { el, canvas } = canvasDaTela();
    // sem CSS, o tamanho do elemento é o intrínseco: segue o width/height do canvas
    Object.defineProperty(canvas, 'clientWidth', { get: () => canvas.width });
    Object.defineProperty(canvas, 'clientHeight', { get: () => canvas.height });
    const a = new AssinaturaCanvas();
    a.ligar(el);
    expect([canvas.width, canvas.height]).toEqual([600, 300]);
    // o elemento cresceu para 600×300 CSS e o observador avisa; depois avisaria de novo, e de novo
    for (let i = 0; i < 5; i++) observadores[0].cb();
    expect([canvas.width, canvas.height]).toEqual([600, 300]);
  });

  it('aviso sem mudança de tamanho não refaz o canvas', () => {
    const { el, canvas } = canvasDaTela();
    const a = new AssinaturaCanvas();
    a.ligar(el);
    canvas.getContext.mockClear();
    a.ajustarTamanho();
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  it('lostpointercapture (o sistema tomou o toque, sem pointerup) encerra o traço', () => {
    const { el, canvas, ops } = canvasDaTela();
    const a = new AssinaturaCanvas();
    a.ligar(el);
    ponteiro(canvas, 'pointerdown', { clientX: 20, clientY: 30 });
    ponteiro(canvas, 'pointermove', { clientX: 40, clientY: 30 });
    ops.length = 0;
    ponteiro(canvas, 'lostpointercapture', { clientX: 90, clientY: 90 });
    // o trecho final vai até o último ponto recebido, não até onde o ponteiro foi perdido
    expect(ops.filter(([n]) => ['moveTo', 'lineTo'].includes(n))).toEqual([
      ['moveTo', 20, 10],
      ['lineTo', 30, 10],
    ]);
    ponteiro(canvas, 'pointermove', { clientX: 60, clientY: 60 });
    expect(a.tracos).toEqual([
      [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
      ],
    ]);
    // o próximo toque começa outro traço
    ponteiro(canvas, 'pointerdown', { clientX: 100, clientY: 100 });
    expect(a.tracos).toHaveLength(2);
  });

  it('elemento escondido (0×0, ex.: a tela fechou antes do paraPng): mantém o tamanho e os traços', async () => {
    const { el, canvas, rect } = canvasDaTela();
    const a = new AssinaturaCanvas();
    a.ligar(el);
    tracar(canvas, [
      { x: 10, y: 10 },
      { x: 50, y: 50 },
    ]);
    rect.width = 0;
    rect.height = 0;
    a.ajustarTamanho();
    expect([canvas.width, canvas.height]).toEqual([300, 150]);
    canvasDeSaida();
    expect(await a.paraPng()).not.toBeNull();
  });

  it('acompanha o tamanho do elemento pelo ResizeObserver, quando existe; desligar() solta tudo', () => {
    const observadores: { cb: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        constructor(public cb: () => void) {
          observadores.push(this);
        }
      },
    );
    const { el, canvas, rect } = canvasDaTela();
    const a = new AssinaturaCanvas();
    a.ligar(el);
    expect(observadores[0].observe).toHaveBeenCalledWith(el);
    rect.width = 500;
    observadores[0].cb();
    expect(canvas.width).toBe(500);

    a.desligar();
    expect(observadores[0].disconnect).toHaveBeenCalled();
    ponteiro(canvas, 'pointerdown', { clientX: 20, clientY: 30 });
    expect(a.vazio()).toBe(true);
  });

  it('ligar() em outro canvas solta o anterior', () => {
    const primeiro = canvasDaTela();
    const segundo = canvasDaTela();
    const a = new AssinaturaCanvas();
    a.ligar(primeiro.el);
    a.ligar(segundo.el);
    ponteiro(primeiro.canvas, 'pointerdown', { clientX: 20, clientY: 30 });
    expect(a.vazio()).toBe(true);
    ponteiro(segundo.canvas, 'pointerdown', { clientX: 20, clientY: 30 });
    expect(a.vazio()).toBe(false);
  });

  describe('paraPng()', () => {
    it('vazia: null, sem criar canvas', async () => {
      const { criar } = canvasDeSaida();
      const a = new AssinaturaCanvas();
      a.ligar(canvasDaTela().el);
      expect(await a.paraPng()).toBeNull();
      expect(criar).not.toHaveBeenCalledWith('canvas');
    });

    it('recorta ao traço com margem, fundo branco, traço em escala e PNG; devolve bytes e SHA-256', async () => {
      const tela = canvasDaTela({ left: 10, top: 20, width: 800, height: 400 });
      const a = new AssinaturaCanvas({ espessura: 2 });
      a.ligar(tela.el);
      tracar(tela.canvas, [
        { x: 100, y: 100 },
        { x: 300, y: 150 },
        { x: 500, y: 200 },
      ]);
      const { saida, ops } = canvasDeSaida();

      const png = await a.paraPng();

      // margem 12 + metade da espessura: caixa (87, 87) a (513, 213) → 426×126 → escala 640/426
      const escala = 640 / 426;
      expect(saida.noToBlob).toEqual([640, Math.round(126 * escala)]);
      // zerado depois do toBlob: o iOS segura a memória do canvas até o GC
      expect([saida.width, saida.height]).toEqual([0, 0]);
      const fundo = ops.findIndex(([n]) => n === 'fillRect');
      expect(ops[fundo]).toEqual(['fillRect', 0, 0, 640, Math.round(126 * escala)]);
      const transformacao = ops.findIndex(([n]) => n === 'setTransform');
      expect(ops[transformacao]).toEqual(['setTransform', escala, 0, 0, escala, -87 * escala, -87 * escala]);
      const primeiroTraco = ops.findIndex(([n]) => n === 'stroke');
      expect(fundo).toBeLessThan(primeiroTraco);
      expect(transformacao).toBeLessThan(primeiroTraco);
      expect(ops[primeiroTraco][1]).toMatchObject({ lineWidth: 2, lineCap: 'round' });
      expect(ops.filter(([n]) => ['moveTo', 'lineTo', 'quadraticCurveTo'].includes(n))).toEqual([
        ['moveTo', 100, 100],
        ['lineTo', 200, 125],
        ['quadraticCurveTo', 300, 150, 400, 175],
        ['lineTo', 500, 200],
      ]);
      expect(saida.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
      expect(png).not.toBeNull();
      expect(png!.bytes.byteLength).toBe(2000);
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', png!.bytes));
      expect(png!.sha256).toBe(Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join(''));
    });

    it('o fundo branco é pintado com branco', async () => {
      const tela = canvasDaTela();
      const a = new AssinaturaCanvas();
      a.ligar(tela.el);
      tracar(tela.canvas, [
        { x: 10, y: 10 },
        { x: 50, y: 50 },
      ]);
      const { saida } = canvasDeSaida();
      const estilos: string[] = [];
      const ctx = saida.getContext() as unknown as Record<string, unknown>;
      const fillRect = ctx['fillRect'] as ReturnType<typeof vi.fn>;
      fillRect.mockImplementation(() => estilos.push(ctx['fillStyle'] as string));
      await a.paraPng();
      expect(estilos).toEqual(['#fff']);
    });

    it('nunca passa de 640×320', async () => {
      const tela = canvasDaTela({ left: 10, top: 20, width: 2000, height: 2000 });
      const a = new AssinaturaCanvas();
      a.ligar(tela.el);
      tracar(tela.canvas, [
        { x: 100, y: 100 },
        { x: 1900, y: 1900 },
      ]);
      const { saida } = canvasDeSaida();
      await a.paraPng();
      const [largura, altura] = saida.noToBlob;
      expect(largura).toBeLessThanOrEqual(640);
      expect(altura).toBe(320);
    });

    it('acima de 512 KB: ErroOs (o servidor recusaria)', async () => {
      const tela = canvasDaTela();
      const a = new AssinaturaCanvas();
      a.ligar(tela.el);
      tracar(tela.canvas, [
        { x: 10, y: 10 },
        { x: 50, y: 50 },
      ]);
      canvasDeSaida(ASSINATURA_MAX_BYTES + 1);
      const erro = await a.paraPng().catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroOs);
      expect(erro).toMatchObject({ codigo: 'ASSINATURA_GRANDE', campo: 'assinatura', message: 'A assinatura ficou grande demais.' });
    });

    it('sem contexto 2D: ErroOs ASSINATURA_FALHOU, e o canvas de saída zerado', async () => {
      const tela = canvasDaTela();
      const a = new AssinaturaCanvas();
      a.ligar(tela.el);
      tracar(tela.canvas, [
        { x: 10, y: 10 },
        { x: 50, y: 50 },
      ]);
      const { saida } = canvasDeSaida(2000, { semContexto: true });
      const erro = await a.paraPng().catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroOs);
      expect(erro).toMatchObject({ codigo: 'ASSINATURA_FALHOU', campo: 'assinatura', message: 'Não foi possível gerar a assinatura.' });
      expect([saida.width, saida.height]).toEqual([0, 0]);
    });

    it('toBlob sem blob: ErroOs ASSINATURA_FALHOU, e o canvas de saída zerado', async () => {
      const tela = canvasDaTela();
      const a = new AssinaturaCanvas();
      a.ligar(tela.el);
      tracar(tela.canvas, [
        { x: 10, y: 10 },
        { x: 50, y: 50 },
      ]);
      const { saida } = canvasDeSaida(null);
      const erro = await a.paraPng().catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroOs);
      expect(erro).toMatchObject({ codigo: 'ASSINATURA_FALHOU', campo: 'assinatura' });
      expect(saida.noToBlob).toHaveLength(2);
      expect([saida.width, saida.height]).toEqual([0, 0]);
    });

    it('depois de desligar() ainda gera o PNG (a tela confirma e depois fecha)', async () => {
      const tela = canvasDaTela();
      const a = new AssinaturaCanvas();
      a.ligar(tela.el);
      tracar(tela.canvas, [
        { x: 10, y: 10 },
        { x: 50, y: 50 },
      ]);
      a.desligar();
      canvasDeSaida();
      expect(await a.paraPng()).not.toBeNull();
    });
  });
});
