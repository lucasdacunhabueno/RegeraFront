import { baixarArquivo } from '../../core/pdf/abrir-pdf';

export type ResultadoCompartilhar = 'compartilhado' | 'baixado' | 'cancelado';

type NavegadorComShare = Navigator & {
  canShare?: (dados: ShareData) => boolean;
  share?: (dados: ShareData) => Promise<void>;
};

/**
 * Compartilha o PDF (§13): a folha nativa (Web Share com arquivo, ex.: WhatsApp) quando `navigator.canShare({ files })`
 * aceita; senão, download por `<a download>` com `nome`. Fechar a folha (`AbortError`) é `cancelado`, sem erro. Se o
 * share falhar de outro jeito — tipicamente `NotAllowedError`, quando o gesto do toque expirou durante a geração do
 * PDF —, baixa: o PDF nunca fica sem chegar ao usuário.
 */
export async function compartilharPdf(blob: Blob, nome: string): Promise<ResultadoCompartilhar> {
  const nav = navigator as NavegadorComShare;
  const arquivo = new File([blob], nome, { type: 'application/pdf' });
  if (podeCompartilhar(nav, arquivo)) {
    try {
      await nav.share!({ files: [arquivo], title: nome.replace(/\.pdf$/i, '') });
      return 'compartilhado';
    } catch (e) {
      // DOMException nem sempre é `instanceof Error` (jsdom, navegadores antigos): vale o nome
      if ((e as { name?: unknown } | null)?.name === 'AbortError') return 'cancelado';
    }
  }
  baixarArquivo(blob, nome);
  return 'baixado';
}

function podeCompartilhar(nav: NavegadorComShare, arquivo: File): boolean {
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [arquivo] });
  } catch {
    return false;
  }
}
