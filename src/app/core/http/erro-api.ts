import { HttpErrorResponse } from '@angular/common/http';

interface Problema {
  detail?: string;
  codigo?: string;
  campos?: Record<string, string>;
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
