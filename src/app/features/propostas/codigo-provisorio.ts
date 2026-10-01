/** Base32 Crockford sem I, L, O e U: 32 símbolos sem confusão visual (spec: `codigoProvisorio`). */
export const ALFABETO_PROVISORIO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const PADRAO = /^PROV-[0-9A-HJKMNP-TV-Z]{6}$/;

/**
 * `PROV-` + 6 símbolos, gerado no aparelho enquanto a proposta não tem número. Um byte aleatório por símbolo, módulo
 * 32 (256 é múltiplo de 32, então não há viés). Colisão no servidor volta como `CODIGO_PROVISORIO_DUPLICADO` e o
 * front gera outro.
 */
export function gerarCodigoProvisorio(
  rand: (a: Uint8Array<ArrayBuffer>) => Uint8Array = (a) => crypto.getRandomValues(a),
): string {
  const bytes = new Uint8Array(6);
  rand(bytes);
  return `PROV-${Array.from(bytes, (b) => ALFABETO_PROVISORIO[b % 32]).join('')}`;
}

export function codigoProvisorioValido(codigo: string): boolean {
  return PADRAO.test(codigo);
}
