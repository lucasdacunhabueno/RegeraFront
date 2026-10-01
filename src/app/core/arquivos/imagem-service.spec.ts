import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { calcularDimensoes, gerarImagens, ImagemService } from './imagem-service';

function canvasFalso(ctx: Partial<CanvasRenderingContext2D> | null) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((cb: (b: Blob | null) => void, tipo: string) => cb(new Blob(['x'], { type: tipo }))),
  };
  const criarOriginal = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? (canvas as unknown as HTMLCanvasElement) : criarOriginal(tag)) as typeof document.createElement);
  return canvas;
}

describe('ImagemService', () => {
  let svc: ImagemService;
  let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    bitmap = { width: 1600, height: 800, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    svc = TestBed.inject(ImagemService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('calcula dimensões sem ampliar', () => {
    expect(calcularDimensoes(1600, 800, 800)).toEqual({ largura: 800, altura: 400 });
    expect(calcularDimensoes(100, 50, 800)).toEqual({ largura: 100, altura: 50 });
  });

  it('JPEG: pinta fundo branco antes de desenhar (PNG transparente não vira preto)', async () => {
    const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = canvasFalso(ctx as unknown as CanvasRenderingContext2D);
    const blob = await svc.redimensionar(new Blob(['x']), 800, 'image/jpeg');

    expect(blob.type).toBe('image/jpeg');
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(400);
    expect(ctx.fillStyle).toBe('#fff');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 400);
    expect(ctx.fillRect.mock.invocationCallOrder[0]).toBeLessThan(ctx.drawImage.mock.invocationCallOrder[0]);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('PNG: mantém a transparência (sem fundo)', async () => {
    const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    canvasFalso(ctx as unknown as CanvasRenderingContext2D);
    await svc.redimensionar(new Blob(['x']), 400, 'image/png');
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it('fecha o bitmap mesmo quando o processamento falha', async () => {
    canvasFalso(null);
    await expect(svc.redimensionar(new Blob(['x']), 800, 'image/jpeg')).rejects.toThrow('Não foi possível processar a imagem.');
    expect(bitmap.close).toHaveBeenCalled();

    bitmap.close.mockClear();
    const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn(() => { throw new Error('falhou'); }) };
    canvasFalso(ctx as unknown as CanvasRenderingContext2D);
    await expect(svc.redimensionar(new Blob(['x']), 800, 'image/png')).rejects.toThrow('falhou');
    expect(bitmap.close).toHaveBeenCalled();
  });
});

interface BitmapFalso {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
}

function bitmapFalso(width: number, height: number): BitmapFalso {
  return { width, height, close: vi.fn() };
}

interface CanvasFalso {
  width: number;
  height: number;
  ctx: { fillStyle: string; imageSmoothingQuality: string; fillRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> };
  toBlob: ReturnType<typeof vi.fn>;
}

/** Um canvas falso novo a cada createElement('canvas'). */
function canvasesFalsos(): CanvasFalso[] {
  const canvases: CanvasFalso[] = [];
  const criarOriginal = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return criarOriginal(tag);
    const ctx = { fillStyle: '', imageSmoothingQuality: '', fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      ctx,
      getContext: vi.fn(() => ctx),
      toBlob: vi.fn((cb: (b: Blob | null) => void, tipo: string) => cb(new Blob(['x'], { type: tipo }))),
    };
    canvases.push(canvas);
    return canvas as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
  return canvases;
}

describe('gerarImagens', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** createImageBitmap falso: do arquivo devolve `original`; com resizeWidth/Height devolve um bitmap daquele tamanho. */
  function decodificador(original: BitmapFalso, reduzir = true) {
    const reduzidos: BitmapFalso[] = [];
    const fn = vi.fn(async (_fonte: unknown, opcoes?: ImageBitmapOptions) => {
      if (opcoes?.resizeWidth && reduzir) {
        const r = bitmapFalso(opcoes.resizeWidth, opcoes.resizeHeight ?? 0);
        reduzidos.push(r);
        return r;
      }
      return original;
    });
    vi.stubGlobal('createImageBitmap', fn);
    return { fn, reduzidos };
  }

  it('decodifica uma vez respeitando a orientação EXIF e reduz pelo createImageBitmap (sem canvas do tamanho original)', async () => {
    const original = bitmapFalso(4000, 3000);
    const { fn, reduzidos } = decodificador(original);
    const canvases = canvasesFalsos();
    const arquivo = new Blob(['x'], { type: 'image/jpeg' });

    const [foto, mini] = await gerarImagens(arquivo, [
      { max: 1600, tipo: 'image/jpeg', qualidade: 0.75 },
      { max: 320, tipo: 'image/jpeg', qualidade: 0.7 },
    ]);

    expect(fn.mock.calls[0]).toEqual([arquivo, { imageOrientation: 'from-image' }]);
    expect(fn.mock.calls.filter((c) => c[0] === arquivo)).toHaveLength(1);
    expect(fn.mock.calls[1]).toEqual([original, { resizeWidth: 1600, resizeHeight: 1200, resizeQuality: 'high' }]);
    // a miniatura parte da foto já reduzida, não do original de 12 MP
    expect(fn.mock.calls[2]).toEqual([reduzidos[0], { resizeWidth: 320, resizeHeight: 240, resizeQuality: 'high' }]);
    expect(canvases.map((c) => [c.width, c.height])).toEqual([
      [1600, 1200],
      [320, 240],
    ]);
    expect(canvases[0].ctx.drawImage).toHaveBeenCalledWith(reduzidos[0], 0, 0, 1600, 1200);
    expect(canvases[1].ctx.drawImage).toHaveBeenCalledWith(reduzidos[1], 0, 0, 320, 240);
    expect(foto).toMatchObject({ largura: 1600, altura: 1200 });
    expect(mini).toMatchObject({ largura: 320, altura: 240 });
    expect(original.close).toHaveBeenCalled();
    expect(reduzidos.every((r) => r.close.mock.calls.length > 0)).toBe(true);
  });

  it('o original é liberado logo depois da primeira redução (antes de gerar a miniatura)', async () => {
    const original = bitmapFalso(4000, 3000);
    const { fn } = decodificador(original);
    canvasesFalsos();
    await gerarImagens(new Blob(['x']), [
      { max: 1600, tipo: 'image/jpeg', qualidade: 0.75 },
      { max: 320, tipo: 'image/jpeg', qualidade: 0.7 },
    ]);
    expect(original.close.mock.invocationCallOrder[0]).toBeLessThan(fn.mock.invocationCallOrder[2]);
  });

  it('saídas em ordem crescente: a maior não parte da menor (não amplia uma redução)', async () => {
    const original = bitmapFalso(4000, 3000);
    const { fn } = decodificador(original);
    const canvases = canvasesFalsos();
    await gerarImagens(new Blob(['x']), [
      { max: 320, tipo: 'image/jpeg', qualidade: 0.7 },
      { max: 1600, tipo: 'image/jpeg', qualidade: 0.75 },
    ]);
    expect(fn.mock.calls[2][0]).toBe(original);
    expect(canvases[1].width).toBe(1600);
  });

  it('tipo e qualidade de cada saída vão para o toBlob; JPEG ganha fundo branco', async () => {
    decodificador(bitmapFalso(1000, 500));
    const canvases = canvasesFalsos();
    const [jpeg, png] = await gerarImagens(new Blob(['x']), [
      { max: 800, tipo: 'image/jpeg', qualidade: 0.75 },
      { max: 400, tipo: 'image/png', qualidade: 1 },
    ]);
    expect(canvases[0].toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.75);
    expect(canvases[1].toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', 1);
    expect(jpeg.blob.type).toBe('image/jpeg');
    expect(png.blob.type).toBe('image/png');
    expect(canvases[0].ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 400);
    expect(canvases[1].ctx.fillRect).not.toHaveBeenCalled();
    expect(canvases[0].ctx.imageSmoothingQuality).toBe('high');
  });

  it('navegador que ignora resizeWidth/resizeHeight (devolve o tamanho original): desenha o original reduzido no canvas final', async () => {
    const original = bitmapFalso(4000, 3000);
    decodificador(original, false);
    const canvases = canvasesFalsos();
    const [foto, mini] = await gerarImagens(new Blob(['x']), [
      { max: 1600, tipo: 'image/jpeg', qualidade: 0.75 },
      { max: 320, tipo: 'image/jpeg', qualidade: 0.7 },
    ]);
    expect(canvases.map((c) => [c.width, c.height])).toEqual([
      [1600, 1200],
      [320, 240],
    ]);
    expect(canvases[0].ctx.drawImage).toHaveBeenCalledWith(original, 0, 0, 1600, 1200);
    expect(canvases[1].ctx.drawImage).toHaveBeenCalledWith(original, 0, 0, 320, 240);
    expect(foto.largura).toBe(1600);
    expect(mini.largura).toBe(320);
    expect(original.close).toHaveBeenCalled();
  });

  it('redução pelo decodificador que falha: cai no desenho reduzido do original', async () => {
    const original = bitmapFalso(3000, 4000);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async (_f: unknown, o?: ImageBitmapOptions) => {
        if (o?.resizeWidth) throw new Error('sem suporte');
        return original;
      }),
    );
    const canvases = canvasesFalsos();
    const [foto] = await gerarImagens(new Blob(['x']), [{ max: 1600, tipo: 'image/jpeg', qualidade: 0.75 }]);
    expect(foto).toMatchObject({ largura: 1200, altura: 1600 });
    expect(canvases[0].ctx.drawImage).toHaveBeenCalledWith(original, 0, 0, 1200, 1600);
  });

  it('imagem menor que o máximo: não amplia nem pede redução ao decodificador', async () => {
    const original = bitmapFalso(640, 480);
    const { fn } = decodificador(original);
    const canvases = canvasesFalsos();
    const [foto] = await gerarImagens(new Blob(['x']), [{ max: 1600, tipo: 'image/jpeg', qualidade: 0.75 }]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(foto).toMatchObject({ largura: 640, altura: 480 });
    expect(canvases[0].ctx.drawImage).toHaveBeenCalledWith(original, 0, 0, 640, 480);
  });

  it('fecha todos os bitmaps quando o processamento falha', async () => {
    const original = bitmapFalso(4000, 3000);
    const { reduzidos } = decodificador(original);
    const criarOriginal = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? ({ getContext: () => null } as unknown as HTMLCanvasElement) : criarOriginal(tag)) as typeof document.createElement);
    await expect(gerarImagens(new Blob(['x']), [{ max: 1600, tipo: 'image/jpeg', qualidade: 0.75 }])).rejects.toThrow(
      'Não foi possível processar a imagem.',
    );
    expect(original.close).toHaveBeenCalled();
    expect(reduzidos[0].close).toHaveBeenCalled();
  });
});

describe('ImagemService.redimensionar (catálogo e logo)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('continua com qualidade 0,85 e o tipo pedido', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmapFalso(1600, 800)));
    const canvases = canvasesFalsos();
    await TestBed.inject(ImagemService).redimensionar(new Blob(['x']), 800, 'image/jpeg');
    expect(canvases[0].toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
  });
});
