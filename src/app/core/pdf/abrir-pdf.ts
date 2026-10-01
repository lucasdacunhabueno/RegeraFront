/**
 * Como mostrar um PDF gerado no aparelho (P4a-R1, P4c-R3): funções puras, sem Angular, usadas pelo `VisorPdf` (prévia
 * do template, prévia e documentos da proposta) e pelo download do compartilhamento.
 */

/** Mesmo ponto do `lg:` do Tailwind: daqui para cima, em aparelho de mouse, o PDF fica num iframe na página. */
export const LARGURA_DESKTOP = 1024;
/** Um PDF aberto em outra aba (ou baixado) ainda pode estar lendo o blob: a revogação espera. */
export const ESPERA_REVOGAR_MS = 60_000;

/**
 * Iframe só em tela larga com mouse: tablet (ponteiro grosso) e iOS — inclusive o iPad, que se apresenta como Mac —
 * costumam não mostrar PDF dentro de iframe, então vão para a aba, mesmo com 1024 px ou mais.
 */
export function previaNoIframe(): boolean {
  if (window.innerWidth < LARGURA_DESKTOP) return false;
  const toque = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return !toque && !ios;
}

/**
 * Aba em branco com `aviso` (ex.: "Gerando prévia…"); null se o navegador bloquear o popup. Chame de forma síncrona,
 * dentro do gesto do usuário: o iOS/Safari bloqueia `window.open` depois de um `await`.
 */
export function abrirJanelaEmBranco(titulo: string, aviso: string): Window | null {
  const janela = window.open('', '_blank');
  if (!janela) return null;
  try {
    janela.opener = null;
    janela.document.title = titulo;
    janela.document.body.textContent = aviso;
  } catch {
    // só cosmético: sem acesso ao documento da aba, ela fica em branco até o PDF chegar
  }
  return janela;
}

/** Revoga o URL de blob já (iframe na página) ou depois de um tempo (outra aba ou download ainda lendo). */
export function revogarUrl(url: string, adiar: boolean): void {
  if (adiar) window.setTimeout(() => URL.revokeObjectURL(url), ESPERA_REVOGAR_MS);
  else URL.revokeObjectURL(url);
}

/** Baixa o blob com `nome` por um `<a download>` temporário; o URL é revogado depois. */
export function baixarArquivo(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    revogarUrl(url, true);
  }
}
