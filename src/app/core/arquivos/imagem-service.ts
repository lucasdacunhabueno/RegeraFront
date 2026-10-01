import { Injectable } from '@angular/core';

/** Maior lado ≤ max, mantendo proporção; nunca amplia. */
export function calcularDimensoes(largura: number, altura: number, max: number): { largura: number; altura: number } {
  const escala = Math.min(1, max / Math.max(largura, altura));
  return { largura: Math.round(largura * escala), altura: Math.round(altura * escala) };
}

export type TipoImagem = 'image/jpeg' | 'image/png';

/** Uma imagem a gerar: maior lado ≤ `max` (sem ampliar), no `tipo` e com a `qualidade` (0 a 1) do `toBlob`. */
export interface SaidaImagem {
  max: number;
  tipo: TipoImagem;
  qualidade: number;
}

export interface ImagemGerada {
  blob: Blob;
  largura: number;
  altura: number;
}

const ERRO_PROCESSAR = 'Não foi possível processar a imagem.';

/**
 * Gera, no aparelho, uma imagem por saída a partir de um arquivo, decodificando-o uma vez só.
 *
 * - Orientação: o decodificador aplica o EXIF (`imageOrientation: 'from-image'`), então a foto em retrato do celular
 *   sai em pé. O canvas não leva metadados para a saída (EXIF, GPS): a imagem gerada sai limpa.
 * - Memória (foto de 12 MP num celular simples): a redução é feita pelo próprio `createImageBitmap` (`resizeWidth`/
 *   `resizeHeight`), e cada canvas tem só o tamanho final; nunca existe um canvas do tamanho original. O bitmap
 *   original é liberado assim que a primeira redução fica pronta, e as saídas seguintes, menores, partem da reduzida.
 *   Sem suporte a `resizeWidth`/`resizeHeight` (ignorados ou recusados), o original é desenhado já reduzido no canvas final.
 *
 * As saídas vêm na mesma ordem pedida; a ordem decrescente de `max` é a que economiza memória.
 */
export async function gerarImagens(arquivo: Blob, saidas: readonly SaidaImagem[]): Promise<ImagemGerada[]> {
  const original = await decodificar(arquivo);
  // as dimensões do original, guardadas: um ImageBitmap fechado passa a ter 0 × 0
  const { width, height } = original;
  const abertos = new Set<ImageBitmap>([original]);
  try {
    let fonte = original;
    const geradas: ImagemGerada[] = [];
    for (let i = 0; i < saidas.length; i++) {
      const saida = saidas[i];
      const { largura, altura } = calcularDimensoes(width, height, saida.max);
      const reduzida = await reduzir(fonte, largura, altura);
      abertos.add(reduzida);
      geradas.push({ blob: await desenhar(reduzida, largura, altura, saida), largura, altura });
      if (reduzida !== fonte && saidas.slice(i + 1).every((s) => s.max <= saida.max)) {
        // as próximas são menores: partem desta, e a fonte maior já pode ser liberada
        fonte.close();
        abertos.delete(fonte);
        fonte = reduzida;
      } else if (reduzida !== fonte) {
        reduzida.close();
        abertos.delete(reduzida);
      }
    }
    return geradas;
  } finally {
    abertos.forEach((b) => b.close());
  }
}

/**
 * Decodifica com a orientação EXIF. Navegador que não aceita o objeto de opções (TypeError) decodifica sem ele: a
 * orientação `from-image` é o padrão da especificação. Outros erros (imagem ilegível) seguem para quem chamou.
 */
async function decodificar(arquivo: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    return createImageBitmap(arquivo);
  }
}

/** A fonte reduzida a largura × altura pelo decodificador; a própria fonte se já tem o tamanho ou sem suporte a `resizeWidth`. */
async function reduzir(fonte: ImageBitmap, largura: number, altura: number): Promise<ImageBitmap> {
  if (fonte.width === largura && fonte.height === altura) return fonte;
  try {
    const r = await createImageBitmap(fonte, { resizeWidth: largura, resizeHeight: altura, resizeQuality: 'high' });
    if (r.width === largura && r.height === altura) return r;
    // navegador que ignora as opções: devolveu do tamanho original
    if (r !== fonte) r.close();
  } catch {
    // sem suporte: o drawImage reduz
  }
  return fonte;
}

async function desenhar(fonte: ImageBitmap, largura: number, altura: number, saida: SaidaImagem): Promise<Blob> {
  const canvas = document.createElement('canvas');
  try {
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(ERRO_PROCESSAR);
    ctx.imageSmoothingQuality = 'high';
    if (saida.tipo === 'image/jpeg') {
      // JPEG não tem transparência: sem fundo, o transparente de um PNG vira preto
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, largura, altura);
    }
    ctx.drawImage(fonte, 0, 0, largura, altura);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(ERRO_PROCESSAR))), saida.tipo, saida.qualidade),
    );
  } finally {
    // o Safari do iOS segura a memória do canvas até o GC (e tem teto total): zerar a libera na hora
    canvas.width = 0;
    canvas.height = 0;
  }
}

@Injectable({ providedIn: 'root' })
export class ImagemService {
  /** Redimensiona no aparelho antes do upload (foto: 800 px JPEG; logo: 400 px PNG), com qualidade 0,85. */
  async redimensionar(arquivo: Blob, max: number, tipo: TipoImagem): Promise<Blob> {
    const [gerada] = await gerarImagens(arquivo, [{ max, tipo, qualidade: 0.85 }]);
    return gerada.blob;
  }
}
