import { HttpErrorResponse } from '@angular/common/http';

interface Problema {
  detail?: string;
  codigo?: string;
  campos?: Record<string, string>;
}

/**
 * O pedido não chegou ao servidor: o status 0 do navegador ou, com o service worker no controle da página, o 504 que o
 * Angular devolve quando o fetch dele falha (`safeFetch` do `ngsw-worker.js`), sem internet de verdade.
 */
export function falhaDeRede(erro: unknown): boolean {
  return erro instanceof HttpErrorResponse && (erro.status === 0 || erro.status === 504);
}

export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof HttpErrorResponse) {
    if (erro.status === 0) return 'Sem conexão com o servidor.';
    const corpo = erro.error as Problema | null;
    if (corpo?.detail) return corpo.detail;
    if (erro.status === 403) return 'Você não tem permissão para esta ação.';
  }
  return 'Erro inesperado. Tente de novo.';
}

export function camposComErro(erro: unknown): Record<string, string> {
  if (erro instanceof HttpErrorResponse) {
    return (erro.error as Problema | null)?.campos ?? {};
  }
  return {};
}
