// NOTA: casos-calculo.json precisa ficar IDÊNTICO a RegeraServer/src/test/resources/casos-calculo.json
// (PropostaCalculoTest). Ao mudar um, copie para o outro e atualize SHA_CASOS_CALCULO nos dois testes.
// Limitação: o SHA só pega uma cópia alterada sozinha. Quem muda o arquivo e o SHA juntos num repo só vê esse
// repo passar; a divergência aparece apenas no teste do outro repo, que continua com o SHA antigo.
import casosTexto from './casos-calculo.json' with { loader: 'text' };
import {
  calcular,
  deCentavos,
  deCentesimos,
  deMilesimos,
  dividirHalfUp,
  LinhaCalculo,
  paraCentavos,
  paraCentesimos,
  paraEscalado,
  paraMilesimos,
} from './calculo';

/** SHA-256 do arquivo com fins de linha normalizados para LF. O teste Java tem a mesma constante. */
const SHA_CASOS_CALCULO = '6ff6da115040cb7a3172bc092f8ffa87d86635f3dbab35a3e1214e7fb58b10c1';

interface LinhaCaso {
  quantidade: string;
  precoUnitario: string;
  descontoPercentual: string;
  meses: number | null;
}

interface Caso {
  nome: string;
  locacao: boolean;
  descontoGeral: string;
  linhas: LinhaCaso[];
  esperado: { subtotais: string[]; totalItens: string; totalDescontos: string; total: string };
}

const texto = (casosTexto as unknown as string).replace(/\r\n/g, '\n');
const casos = (JSON.parse(texto) as { casos: Caso[] }).casos;

function linha(quantidade: string, preco: string, desconto: string, meses: number | null): LinhaCalculo {
  return {
    quantidadeMilesimos: paraMilesimos(quantidade),
    precoUnitarioCentavos: paraCentavos(preco),
    descontoCentesimos: paraCentesimos(desconto),
    meses,
  };
}

describe('calculo', () => {
  describe('casos compartilhados com o PropostaCalculo do servidor', () => {
    it('o arquivo é o mesmo do servidor (SHA_CASOS_CALCULO)', async () => {
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
      expect([...hash].map((b) => b.toString(16).padStart(2, '0')).join('')).toBe(SHA_CASOS_CALCULO);
    });

    it('tem os casos esperados', () => {
      expect(casos.length).toBeGreaterThanOrEqual(25);
    });

    it.each(casos.map((c) => [c.nome, c] as const))('%s', (_, c) => {
      const t = calcular(
        c.linhas.map((l) => linha(l.quantidade, l.precoUnitario, l.descontoPercentual, l.meses)),
        paraCentesimos(c.descontoGeral),
        c.locacao,
      );
      expect(t.subtotaisCentavos.map(deCentavos)).toEqual(c.esperado.subtotais);
      expect(deCentavos(t.totalItensCentavos)).toBe(c.esperado.totalItens);
      expect(deCentavos(t.totalDescontosCentavos)).toBe(c.esperado.totalDescontos);
      expect(deCentavos(t.totalCentavos)).toBe(c.esperado.total);
    });

    it('inclui valores acima de 2^53 centavos (prova de que não passa por number)', () => {
      const maior = casos.flatMap((c) => [c.esperado.totalItens, c.esperado.totalDescontos]).map(paraCentavos)
        .reduce((a, b) => (a > b ? a : b), 0n);
      expect(maior > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    });
  });

  it('o bruto não é arredondado antes do desconto', () => {
    // 0,125 × 0,10 = 0,0125; × 0,4 = 0,005 → 0,01. Arredondando o bruto antes: 0,01 × 0,4 = 0,004 → 0,00.
    const t = calcular([linha('0.125', '0.10', '60', null)], 0n, false);
    expect(t.subtotaisCentavos).toEqual([1n]);
    expect(t.totalDescontosCentavos).toBe(0n);
  });

  it('meses só multiplicam em locação e quando preenchidos', () => {
    expect(calcular([linha('2', '100.00', '0', 12)], 0n, true).totalCentavos).toBe(240000n);
    expect(calcular([linha('2', '100.00', '0', 12)], 0n, false).totalCentavos).toBe(20000n);
    expect(calcular([linha('2', '100.00', '0', null)], 0n, true).totalCentavos).toBe(20000n);
  });

  it('total + descontos = soma dos brutos arredondados', () => {
    const t = calcular([linha('1.333', '0.07', '33.33', 3), linha('2.345', '19.99', '7.5', null)], paraCentesimos('12.5'), true);
    expect(t.totalCentavos + t.totalDescontosCentavos).toBe(4716n);
  });

  describe('conversões decimais sem float', () => {
    it('paraCentavos / deCentavos', () => {
      expect(paraCentavos('1234.56')).toBe(123456n);
      expect(paraCentavos('0')).toBe(0n);
      expect(paraCentavos('7')).toBe(700n);
      expect(paraCentavos('0.5')).toBe(50n);
      expect(paraCentavos('.5')).toBe(50n);
      expect(paraCentavos('12.340')).toBe(1234n);
      expect(paraCentavos('99999999999999999.99')).toBe(9999999999999999999n);
      expect(paraCentavos(1234.56)).toBe(123456n);
      expect(paraCentavos(0.07)).toBe(7n);
      expect(deCentavos(123456n)).toBe('1234.56');
      expect(deCentavos(5n)).toBe('0.05');
      expect(deCentavos(0n)).toBe('0.00');
      expect(deCentavos(-150n)).toBe('-1.50');
      expect(deCentavos(9999999999999999999n)).toBe('99999999999999999.99');
    });

    it('quantidade em milésimos e percentual em centésimos, sem zeros à direita na volta', () => {
      expect(paraMilesimos('1.333')).toBe(1333n);
      expect(paraMilesimos('999999.999')).toBe(999999999n);
      expect(paraMilesimos('2.5')).toBe(2500n);
      expect(deMilesimos(2500n)).toBe('2.5');
      expect(deMilesimos(3000n)).toBe('3');
      expect(deMilesimos(1n)).toBe('0.001');
      expect(paraCentesimos('33.33')).toBe(3333n);
      expect(paraCentesimos('100')).toBe(10000n);
      expect(deCentesimos(1250n)).toBe('12.5');
      expect(deCentesimos(0n)).toBe('0');
    });

    it('aceita notação científica (number pequeno ou grande) e arredonda o excesso de casas com HALF_UP', () => {
      expect(paraEscalado('1e-7', 9)).toBe(100n);
      expect(paraEscalado('1.5E+3', 0)).toBe(1500n);
      expect(paraCentavos('0.005')).toBe(1n);
      expect(paraCentavos('0.004')).toBe(0n);
      expect(paraCentavos('-0.005')).toBe(-1n);
    });

    it('recusa o que não é decimal', () => {
      for (const v of ['', ' ', 'abc', '1,5', '1.2.3', '.', '-', '1e', 'NaN', 'Infinity']) {
        expect(() => paraCentavos(v), v).toThrow();
      }
      expect(() => paraCentavos(Number.NaN)).toThrow();
      expect(() => paraCentavos(Number.POSITIVE_INFINITY)).toThrow();
    });
  });

  it('dividirHalfUp arredonda o meio para longe do zero', () => {
    expect(dividirHalfUp(5n, 10n)).toBe(1n);
    expect(dividirHalfUp(4n, 10n)).toBe(0n);
    expect(dividirHalfUp(15n, 10n)).toBe(2n);
    expect(dividirHalfUp(25n, 10n)).toBe(3n);
    expect(dividirHalfUp(-5n, 10n)).toBe(-1n);
    expect(dividirHalfUp(-4n, 10n)).toBe(0n);
  });
});
