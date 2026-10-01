import { vi } from 'vitest';
import { ErroOs } from './erro-os';
import { FOTO_MAX_BYTES, prepararFoto } from './foto-os';

interface CanvasFalso {
  width: number;
  height: number;
  toBlob: ReturnType<typeof vi.fn>;
}

const MB = 1024 * 1024;

/**
 * Canvas falsos (o jsdom não desenha): cada toBlob devolve um JPEG falso com bytes distintos por canvas; o tamanho do
 * primeiro (a foto) é configurável para testar o limite.
 */
function canvasesFalsos(tamanhoDaFoto = 1000): CanvasFalso[] {
  const canvases: CanvasFalso[] = [];
  const criarOriginal = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return criarOriginal(tag);
    const indice = canvases.length;
    const ctx = { fillStyle: '', imageSmoothingQuality: '', fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toBlob: vi.fn((cb: (b: Blob | null) => void, tipo: string) => {
        const bytes = new Uint8Array(indice === 0 ? tamanhoDaFoto : 100).fill(indice + 1);
        cb(new Blob([bytes], { type: tipo }));
      }),
    };
    canvases.push(canvas);
    return canvas as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
  return canvases;
}

function decodificador(largura: number, altura: number) {
  const original = { width: largura, height: altura, close: vi.fn() };
  const fn = vi.fn(async (_fonte: unknown, o?: ImageBitmapOptions) =>
    o?.resizeWidth ? { width: o.resizeWidth, height: o.resizeHeight ?? 0, close: vi.fn() } : original,
  );
  vi.stubGlobal('createImageBitmap', fn);
  return { fn, original };
}

function espaco(estimativa: (() => Promise<StorageEstimate>) | undefined) {
  Object.defineProperty(navigator, 'storage', {
    value: estimativa === undefined ? undefined : { estimate: estimativa },
    configurable: true,
  });
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

function foto(tipo = 'image/jpeg'): File {
  return new File([new Uint8Array(10)], 'IMG_0001.jpg', { type: tipo });
}

async function erroDe(p: Promise<unknown>): Promise<ErroOs> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErroOs);
    return e as ErroOs;
  }
  throw new Error('deveria ter falhado');
}

describe('prepararFoto', () => {
  beforeEach(() => espaco(async () => ({ quota: 2000 * MB, usage: 100 * MB })));

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (navigator as { storage?: unknown }).storage;
  });

  it('foto de 12 MP vira JPEG de 1.600 px (qualidade 0,75) e miniatura de 320 px (0,7), sem canvas do tamanho original', async () => {
    const { fn } = decodificador(4000, 3000);
    const canvases = canvasesFalsos();
    const arquivo = foto();

    const r = await prepararFoto(arquivo);

    expect(fn.mock.calls[0]).toEqual([arquivo, { imageOrientation: 'from-image' }]);
    expect(canvases.map((c) => [c.width, c.height])).toEqual([
      [1600, 1200],
      [320, 240],
    ]);
    expect(canvases[0].toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.75);
    expect(canvases[1].toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.7);
    expect(r.largura).toBe(1600);
    expect(r.altura).toBe(1200);
  });

  it('foto em retrato (orientação já aplicada pelo decodificador): o lado maior é a altura', async () => {
    decodificador(3000, 4000);
    const canvases = canvasesFalsos();
    const r = await prepararFoto(foto());
    expect([r.largura, r.altura]).toEqual([1200, 1600]);
    expect([canvases[1].width, canvases[1].height]).toEqual([240, 320]);
  });

  it('devolve os bytes da foto, os da miniatura e o SHA-256 dos bytes da foto', async () => {
    decodificador(4000, 3000);
    canvasesFalsos(1234);
    const r = await prepararFoto(foto());
    expect(r.bytes.byteLength).toBe(1234);
    expect(new Uint8Array(r.bytes)[0]).toBe(1);
    expect(r.miniatura.byteLength).toBe(100);
    expect(new Uint8Array(r.miniatura)[0]).toBe(2);
    expect(r.sha256).toBe(await sha256(r.bytes));
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('PNG e WebP também viram JPEG', async () => {
    decodificador(800, 600);
    const canvases = canvasesFalsos();
    await prepararFoto(foto('image/png'));
    await prepararFoto(foto('image/webp'));
    expect(canvases.every((c) => c.toBlob.mock.calls[0][1] === 'image/jpeg')).toBe(true);
  });

  it('arquivo que não é imagem: "Escolha uma imagem." sem decodificar', async () => {
    const { fn } = decodificador(4000, 3000);
    canvasesFalsos();
    const e = await erroDe(prepararFoto(new File(['%PDF'], 'contrato.pdf', { type: 'application/pdf' })));
    expect(e.codigo).toBe('FOTO_TIPO');
    expect(e.campo).toBe('foto');
    expect(e.message).toBe('Escolha uma imagem.');
    expect(fn).not.toHaveBeenCalled();
  });

  it('arquivo sem tipo (alguns seletores do Android): tenta decodificar', async () => {
    decodificador(800, 600);
    canvasesFalsos();
    const r = await prepararFoto(new File([new Uint8Array(10)], 'foto', { type: '' }));
    expect(r.largura).toBe(800);
  });

  it('imagem que o aparelho não consegue abrir (corrompida, HEIC no Chrome...): erro em pt-BR', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new DOMException('The source image could not be decoded.')));
    canvasesFalsos();
    const e = await erroDe(prepararFoto(foto('image/heic')));
    expect(e.codigo).toBe('FOTO_ILEGIVEL');
    expect(e.message).toBe('Não foi possível abrir a foto. Escolha outra imagem.');
  });

  it(`resultado acima de 3 MB: "A foto ficou grande demais." (exatamente 3 MB passa)`, async () => {
    expect(FOTO_MAX_BYTES).toBe(3 * MB);
    decodificador(4000, 3000);
    canvasesFalsos(3 * MB + 1);
    const e = await erroDe(prepararFoto(foto()));
    expect(e.codigo).toBe('FOTO_GRANDE');
    expect(e.campo).toBe('foto');
    expect(e.message).toBe('A foto ficou grande demais.');

    vi.restoreAllMocks();
    decodificador(4000, 3000);
    canvasesFalsos(3 * MB);
    expect((await prepararFoto(foto())).bytes.byteLength).toBe(3 * MB);
  });

  it('menos de 100 MB livres: "Pouco espaço no aparelho para mais fotos." sem decodificar', async () => {
    const { fn } = decodificador(4000, 3000);
    canvasesFalsos();
    espaco(async () => ({ quota: 1000 * MB, usage: 900 * MB + 1 }));
    const e = await erroDe(prepararFoto(foto()));
    expect(e.codigo).toBe('SEM_ESPACO');
    expect(e.campo).toBe('foto');
    expect(e.message).toBe('Pouco espaço no aparelho para mais fotos.');
    expect(fn).not.toHaveBeenCalled();
  });

  it('exatamente 100 MB livres passa', async () => {
    decodificador(800, 600);
    canvasesFalsos();
    espaco(async () => ({ quota: 1000 * MB, usage: 900 * MB }));
    await expect(prepararFoto(foto())).resolves.toBeTruthy();
  });

  it('sem navigator.storage, estimativa incompleta ou que falha: não bloqueia', async () => {
    decodificador(800, 600);
    canvasesFalsos();

    espaco(undefined);
    await expect(prepararFoto(foto())).resolves.toBeTruthy();

    Object.defineProperty(navigator, 'storage', { value: {}, configurable: true });
    await expect(prepararFoto(foto())).resolves.toBeTruthy();

    espaco(async () => ({ usage: 900 * MB }));
    await expect(prepararFoto(foto())).resolves.toBeTruthy();

    espaco(async () => {
      throw new DOMException('negado', 'SecurityError');
    });
    await expect(prepararFoto(foto())).resolves.toBeTruthy();
  });
});
