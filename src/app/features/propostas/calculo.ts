/**
 * Cálculo dos totais da proposta (spec §7.3), espelho de `PropostaCalculo` do servidor e conferido pelos mesmos casos
 * (`casos-calculo.json`). Tudo em inteiros `bigint`, sem ponto flutuante:
 * - quantidade em milésimos (escala 3), preço em centavos (escala 2), percentuais em centésimos (escala 2);
 * - `bruto = quantidade × preço × (meses se locação e meses != null, senão 1)`, exato (escala 5);
 * - `subtotal = round2(bruto × (1 − desconto/100))`; `totalItens = Σ subtotal`;
 * - `total = round2(totalItens × (1 − descontoGeral/100))`;
 * - `totalDescontos = Σ(round2(bruto) − subtotal) + (totalItens − total)`.
 * `round2` é HALF_UP (o meio vai para longe do zero), como o `RoundingMode.HALF_UP` do Java.
 */

export interface LinhaCalculo {
  quantidadeMilesimos: bigint;
  precoUnitarioCentavos: bigint;
  /** Desconto em centésimos de ponto percentual (33,33% → 3333n). */
  descontoCentesimos: bigint;
  meses: number | null;
}

export interface TotaisCalculo {
  subtotaisCentavos: bigint[];
  totalItensCentavos: bigint;
  totalDescontosCentavos: bigint;
  totalCentavos: bigint;
}

/** 100% em centésimos: `1 − d/100` vira `(CEM_POR_CENTO − d) / CEM_POR_CENTO`. */
const CEM_POR_CENTO = 10000n;

export function calcular(linhas: readonly LinhaCalculo[], descontoGeralCentesimos: bigint, locacao: boolean): TotaisCalculo {
  const subtotaisCentavos: bigint[] = [];
  let somaBrutosArredondados = 0n;
  let totalItensCentavos = 0n;
  for (const l of linhas) {
    const fator = locacao && l.meses !== null ? BigInt(l.meses) : 1n;
    const bruto = l.quantidadeMilesimos * l.precoUnitarioCentavos * fator; // escala 3 + 2 = 5
    // escala 5 + 4 = 9 → 2: divide por 10^7
    const subtotal = dividirHalfUp(bruto * (CEM_POR_CENTO - l.descontoCentesimos), 10_000_000n);
    subtotaisCentavos.push(subtotal);
    somaBrutosArredondados += dividirHalfUp(bruto, 1000n); // escala 5 → 2
    totalItensCentavos += subtotal;
  }
  // escala 2 + 4 = 6 → 2: divide por 10^4
  const totalCentavos = dividirHalfUp(totalItensCentavos * (CEM_POR_CENTO - descontoGeralCentesimos), CEM_POR_CENTO);
  const totalDescontosCentavos = somaBrutosArredondados - totalItensCentavos + (totalItensCentavos - totalCentavos);
  return { subtotaisCentavos, totalItensCentavos, totalDescontosCentavos, totalCentavos };
}

/** Divisão inteira com arredondamento HALF_UP (empate vai para longe do zero). `divisor` > 0. */
export function dividirHalfUp(dividendo: bigint, divisor: bigint): bigint {
  if (dividendo < 0n) return -dividirHalfUp(-dividendo, divisor);
  const quociente = dividendo / divisor;
  return (dividendo % divisor) * 2n >= divisor ? quociente + 1n : quociente;
}

const EXPOENTE_MAXIMO = 30;

const DECIMAL = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Para dados do servidor (e do próprio front). O que o usuário digita passa por {@link lerDecimalEstrito}.
 * Decimal (texto, ou `number` pelo seu texto mais curto) para inteiro escalado por 10^casas, sem passar por float.
 * Casas além da escala são arredondadas com HALF_UP. Aceita notação científica (`String(1e-7)` = `'1e-7'`).
 */
export function paraEscalado(valor: string | number, casas: number): bigint {
  if (typeof valor === 'number' && !Number.isFinite(valor)) throw new Error(`Número inválido: ${valor}`);
  const texto = String(valor);
  const m = DECIMAL.exec(texto);
  const inteiro = m?.[2] ?? '';
  const fracao = m?.[3] ?? '';
  if (!m || inteiro.length + fracao.length === 0) throw new Error(`Decimal inválido: "${texto}"`);
  const expoente = Number(m[4] ?? '0');
  // dado do servidor nunca chega perto disso; o limite impede que um "1e999999999" monte um bigint gigante
  if (Math.abs(expoente) > EXPOENTE_MAXIMO) throw new Error(`Expoente fora do limite: "${texto}"`);
  const deslocamento = casas + expoente - fracao.length;
  const digitos = BigInt(inteiro + fracao);
  const absoluto = deslocamento >= 0 ? digitos * 10n ** BigInt(deslocamento) : dividirHalfUp(digitos, 10n ** BigInt(-deslocamento));
  return m[1] === '-' ? -absoluto : absoluto;
}

/** Inteiro escalado para texto decimal. `fixo`: sempre `casas` decimais; senão, sem zeros à direita. */
export function deEscalado(valor: bigint, casas: number, fixo: boolean): string {
  const negativo = valor < 0n;
  const texto = (negativo ? -valor : valor).toString().padStart(casas + 1, '0');
  const inteiro = texto.slice(0, texto.length - casas);
  let fracao = texto.slice(texto.length - casas);
  if (!fixo) fracao = fracao.replace(/0+$/, '');
  return `${negativo ? '-' : ''}${inteiro}${fracao ? `.${fracao}` : ''}`;
}

export const paraCentavos = (v: string | number): bigint => paraEscalado(v, 2);
/** Sempre com 2 casas (`'1234.50'`), como o dinheiro no servidor. */
export const deCentavos = (v: bigint): string => deEscalado(v, 2, true);
export const paraMilesimos = (v: string | number): bigint => paraEscalado(v, 3);
export const deMilesimos = (v: bigint): string => deEscalado(v, 3, false);
export const paraCentesimos = (v: string | number): bigint => paraEscalado(v, 2);
export const deCentesimos = (v: bigint): string => deEscalado(v, 2, false);

/** Por que o texto digitado não é um decimal aceitável (a UI escolhe a mensagem). */
export type ErroDecimal = 'VAZIO' | 'NEGATIVO' | 'CASAS' | 'INVALIDO';

const SO_DIGITOS = /^\d+$/;
const UM_SEPARADOR = /^(\d+)[.,](\d+)$/;
const MILHAR_PT_BR = /^(\d{1,3}(?:\.\d{3})+),(\d+)$/;

/**
 * Valor digitado num formulário para inteiro escalado por 10^casas, sem arredondar. Tira os espaços das pontas e
 * aceita: só dígitos (`1234`); vírgula ou ponto decimal (`1234,56`, `1234.56`); e ponto de milhar só na forma pt-BR
 * com vírgula decimal (`1.234,56`). Sem vírgula, o ponto é decimal (`1.234` = 1,234). Recusa sinal, expoente,
 * separador sem dígitos dos dois lados, mais casas que `casas` (mesmo zeros) e qualquer outro caractere.
 */
export function lerDecimalEstrito(texto: string, casas: number): bigint | ErroDecimal {
  const t = texto.trim();
  if (t === '') return 'VAZIO';
  if (t.startsWith('-')) return 'NEGATIVO';
  let inteiro: string;
  let fracao = '';
  const separado = MILHAR_PT_BR.exec(t) ?? UM_SEPARADOR.exec(t);
  if (separado) {
    inteiro = separado[1].replace(/\./g, '');
    fracao = separado[2];
  } else if (SO_DIGITOS.test(t)) {
    inteiro = t;
  } else {
    return 'INVALIDO';
  }
  if (fracao.length > casas) return 'CASAS';
  return BigInt(inteiro + fracao.padEnd(casas, '0'));
}
