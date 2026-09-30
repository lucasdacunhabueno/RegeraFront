import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { calcularDimensoes, ImagemService } from './imagem-service';

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
