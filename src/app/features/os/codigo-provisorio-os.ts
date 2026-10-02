import { gerarCodigoComPrefixo } from '../propostas/codigo-provisorio';

/** O `@Pattern` do `codigoProvisorio` no `OsDados` do servidor. */
const PADRAO = /^OSP-[0-9A-HJKMNP-TV-Z]{6}$/;

/**
 * `OSP-` + 6 símbolos Crockford, gerado no aparelho enquanto a OS não tem número (o mesmo gerador do `PROV-` da
 * proposta). Colisão no servidor volta como `CODIGO_PROVISORIO_DUPLICADO`, e o sync gera outro e reenvia, até 3 vezes
 * por sincronização (`SyncService.trocarCodigoProvisorio`); depois disso vira pendência.
 */
export function gerarCodigoProvisorioOs(rand?: Parameters<typeof gerarCodigoComPrefixo>[1]): string {
  return gerarCodigoComPrefixo('OSP', rand);
}

export function codigoProvisorioOsValido(codigo: string): boolean {
  return PADRAO.test(codigo);
}
