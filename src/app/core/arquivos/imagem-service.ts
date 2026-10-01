import { Injectable } from '@angular/core';

/** Maior lado ≤ max, mantendo proporção; nunca amplia. */
export function calcularDimensoes(largura: number, altura: number, max: number): { largura: number; altura: number } {
  const escala = Math.min(1, max / Math.max(largura, altura));
  return { largura: Math.round(largura * escala), altura: Math.round(altura * escala) };
}

@Injectable({ providedIn: 'root' })
export class ImagemService {
  /** Redimensiona no aparelho antes do upload (foto: 800 px JPEG; logo: 400 px PNG). */
  async redimensionar(arquivo: Blob, max: number, tipo: 'image/jpeg' | 'image/png'): Promise<Blob> {
    const bitmap = await createImageBitmap(arquivo);
    const canvas = document.createElement('canvas');
    try {
      const { largura, altura } = calcularDimensoes(bitmap.width, bitmap.height, max);
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Não foi possível processar a imagem.');
      if (tipo === 'image/jpeg') {
        // JPEG não tem transparência: sem fundo, o transparente de um PNG vira preto
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, largura, altura);
      }
      ctx.drawImage(bitmap, 0, 0, largura, altura);
    } finally {
      bitmap.close();
    }
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível processar a imagem.'))), tipo, 0.85),
    );
  }
}
