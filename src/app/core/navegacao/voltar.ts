/** Origem fictícia só para o `URL` resolver o caminho: o que sair dela é externo e é recusado. */
const BASE = 'https://regera.invalid';
const PREFIXO = '/propostas/';
const MAX = 2000;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/;

/**
 * O `?voltar=` de um formulário aberto por outra tela (ex.: "Cadastrar cliente" do wizard da proposta): só um caminho
 * interno de `/propostas/`, já normalizado (sem `..`, barra invertida, esquema, `//host` ou caractere de controle),
 * com `parametros` acrescentados (ou trocados) na query. null = não volta para lá (evita o redirecionamento aberto).
 */
export function destinoDeVolta(voltar: string | null | undefined, parametros: Record<string, string> = {}): string | null {
  if (typeof voltar !== 'string' || voltar.length > MAX || !voltar.startsWith(PREFIXO)) return null;
  if (voltar.includes('\\') || CONTROLE.test(voltar)) return null;
  let url: URL;
  try {
    url = new URL(voltar, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || !url.pathname.startsWith(PREFIXO)) return null;
  for (const [nome, valor] of Object.entries(parametros)) url.searchParams.set(nome, valor);
  return url.pathname + url.search;
}
