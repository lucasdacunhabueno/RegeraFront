import { paraBytes } from '../../core/arquivos/arquivos-service';
import { gerarImagens } from '../../core/arquivos/imagem-service';
import { sha256Hex } from '../../core/util/sha256';
import { ErroOs } from './erro-os';

/** Lado maior da foto guardada e enviada, e qualidade do JPEG. */
export const FOTO_LADO_MAXIMO = 1600;
export const FOTO_QUALIDADE = 0.75;
/** Miniatura gerada na captura: é o que fica no aparelho depois do upload aceito (P4b-R26). */
export const MINIATURA_LADO_MAXIMO = 320;
export const MINIATURA_QUALIDADE = 0.7;
/** O limite do servidor para FOTO (`AnexoOsService.MAX_FOTO_BYTES`): acima disso o upload voltaria 400. */
export const FOTO_MAX_BYTES = 3 * 1024 * 1024;
/** Abaixo disto livre no armazenamento do site, o aparelho recusa mais fotos. */
export const ESPACO_MINIMO_BYTES = 100 * 1024 * 1024;

export interface FotoPreparada {
  /** JPEG de até 1.600 px, sem EXIF. */
  bytes: ArrayBuffer;
  /** JPEG de até 320 px. */
  miniatura: ArrayBuffer;
  /** SHA-256 de `bytes`, em hexadecimal. */
  sha256: string;
  largura: number;
  altura: number;
}

/**
 * Prepara no aparelho, offline, a foto tirada ou escolhida pelo técnico: JPEG de até 1.600 px com qualidade 0,75 e a
 * miniatura de 320 px (0,7), decodificando uma vez só e com a orientação EXIF aplicada (`gerarImagens`). O canvas não
 * leva o EXIF (nem o GPS) para a saída.
 *
 * Recusa com `ErroOs` (campo `foto`), nesta ordem: arquivo que não é imagem (`FOTO_TIPO`); menos de 100 MB livres
 * (`SEM_ESPACO`, conferido antes de gastar tempo e memória comprimindo); imagem que o aparelho não consegue abrir
 * (`FOTO_ILEGIVEL`); foto acima de 3 MB depois de comprimida (`FOTO_GRANDE`).
 */
export async function prepararFoto(arquivo: Blob): Promise<FotoPreparada> {
  // sem tipo (alguns seletores de arquivo do Android não informam): quem decide é o decodificador
  if (arquivo.type !== '' && !arquivo.type.startsWith('image/')) {
    throw new ErroOs('FOTO_TIPO', 'foto', 'Escolha uma imagem.');
  }
  if (await faltaEspaco()) {
    throw new ErroOs('SEM_ESPACO', 'foto', 'Pouco espaço no aparelho para mais fotos.');
  }
  let geradas;
  try {
    geradas = await gerarImagens(arquivo, [
      { max: FOTO_LADO_MAXIMO, tipo: 'image/jpeg', qualidade: FOTO_QUALIDADE },
      { max: MINIATURA_LADO_MAXIMO, tipo: 'image/jpeg', qualidade: MINIATURA_QUALIDADE },
    ]);
  } catch {
    throw new ErroOs('FOTO_ILEGIVEL', 'foto', 'Não foi possível abrir a foto. Escolha outra imagem.');
  }
  const [foto, miniatura] = geradas;
  if (foto.blob.size > FOTO_MAX_BYTES) {
    throw new ErroOs('FOTO_GRANDE', 'foto', 'A foto ficou grande demais.');
  }
  const bytes = await paraBytes(foto.blob);
  return {
    bytes,
    miniatura: await paraBytes(miniatura.blob),
    sha256: await sha256Hex(bytes),
    largura: foto.largura,
    altura: foto.altura,
  };
}

/** Menos de 100 MB livres pela estimativa do navegador. Sem a API, ou sem resposta completa, não bloqueia. */
async function faltaEspaco(): Promise<boolean> {
  try {
    const estimativa = await navigator.storage?.estimate?.();
    if (typeof estimativa?.quota !== 'number' || typeof estimativa.usage !== 'number') return false;
    return estimativa.quota - estimativa.usage < ESPACO_MINIMO_BYTES;
  } catch {
    return false;
  }
}
