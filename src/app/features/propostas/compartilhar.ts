import { baixarArquivo } from '../../core/pdf/abrir-pdf';

/**
 * - `compartilhado`: a folha nativa abriu e o usuário escolheu um app;
 * - `baixado`: sem Web Share com arquivo (ou falha dele), o PDF foi baixado;
 * - `cancelado`: o usuário fechou a folha (`AbortError`);
 * - `precisa-toque`: o navegador recusou por falta de gesto (`NotAllowedError`, típico depois da geração demorada do
 *   PDF num aparelho lento). Nada foi baixado: a tela pede um toque e chama `compartilharArquivo` nele (P4c-R8).
 */
export type ResultadoCompartilhar = 'compartilhado' | 'baixado' | 'cancelado' | 'precisa-toque';

type NavegadorComShare = Navigator & {
  canShare?: (dados: ShareData) => boolean;
  share?: (dados: ShareData) => Promise<void>;
};

const nomeDoErro = (e: unknown): unknown => (e as { name?: unknown } | null)?.name;

/** O PDF como `File` (o que o Web Share recebe), montado antes do toque. */
export function arquivoPdf(blob: Blob, nome: string): File {
  return new File([blob], nome, { type: 'application/pdf' });
}

/**
 * Compartilha o PDF (§13): a folha nativa (Web Share com arquivo, ex.: WhatsApp) quando `navigator.canShare({ files })`
 * aceita; senão, download por `<a download>` com `nome`. Ver `ResultadoCompartilhar`.
 */
export async function compartilharPdf(blob: Blob, nome: string): Promise<ResultadoCompartilhar> {
  return compartilharArquivo(arquivoPdf(blob, nome), blob);
}

/**
 * Como `compartilharPdf`, para chamar direto do clique: `navigator.share` é chamado de forma síncrona, antes de
 * qualquer `await`, ainda dentro do gesto do usuário. `paraBaixar`: o que baixar se não der (o próprio arquivo).
 */
export function compartilharArquivo(arquivo: File, paraBaixar: Blob = arquivo): Promise<ResultadoCompartilhar> {
  const nav = navigator as NavegadorComShare;
  const baixar = (): ResultadoCompartilhar => {
    baixarArquivo(paraBaixar, arquivo.name);
    return 'baixado';
  };
  if (!podeCompartilhar(nav, arquivo)) return Promise.resolve(baixar());
  let compartilhando: Promise<void>;
  try {
    compartilhando = nav.share!({ files: [arquivo], title: arquivo.name.replace(/\.pdf$/i, '') });
  } catch (e) {
    return Promise.resolve(depoisDaFalha(e, baixar));
  }
  return compartilhando.then(
    (): ResultadoCompartilhar => 'compartilhado',
    (e: unknown) => depoisDaFalha(e, baixar),
  );
}

/** DOMException nem sempre é `instanceof Error` (jsdom, navegadores antigos): vale o nome. */
function depoisDaFalha(e: unknown, baixar: () => ResultadoCompartilhar): ResultadoCompartilhar {
  const nome = nomeDoErro(e);
  if (nome === 'AbortError') return 'cancelado';
  if (nome === 'NotAllowedError') return 'precisa-toque';
  // outra falha do share (ex.: DataError): o PDF não pode ficar sem chegar ao usuário
  return baixar();
}

function podeCompartilhar(nav: NavegadorComShare, arquivo: File): boolean {
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [arquivo] });
  } catch {
    return false;
  }
}
