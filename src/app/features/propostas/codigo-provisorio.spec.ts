import { ALFABETO_PROVISORIO, codigoProvisorioValido, gerarCodigoComPrefixo, gerarCodigoProvisorio } from './codigo-provisorio';

describe('codigo-provisorio', () => {
  it('alfabeto é base32 Crockford sem I, L, O e U', () => {
    expect(ALFABETO_PROVISORIO).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(ALFABETO_PROVISORIO).toHaveLength(32);
  });

  it('gera PROV- seguido de 6 caracteres do alfabeto, com o crypto padrão', () => {
    for (let i = 0; i < 200; i++) {
      const c = gerarCodigoProvisorio();
      expect(c).toMatch(/^PROV-[0-9A-HJKMNP-TV-Z]{6}$/);
      expect(codigoProvisorioValido(c)).toBe(true);
    }
  });

  it('usa um byte por caractere (byte mod 32, sem viés: 256 é múltiplo de 32)', () => {
    const rand = vi.fn((a: Uint8Array) => {
      a.set([0, 31, 32, 63, 255, 18]);
      return a;
    });
    expect(gerarCodigoProvisorio(rand)).toBe('PROV-0Z0ZZJ');
    expect(rand).toHaveBeenCalledTimes(1);
    expect(rand.mock.calls[0][0]).toHaveLength(6);
  });

  it('gerarCodigoComPrefixo: o mesmo gerador com outro prefixo (o OSP- da OS); o PROV- é ele com PROV', () => {
    const rand = (a: Uint8Array) => {
      a.set([1, 2, 3, 4, 5, 6]);
      return a;
    };
    expect(gerarCodigoComPrefixo('OSP', rand)).toBe('OSP-123456');
    expect(gerarCodigoProvisorio(rand)).toBe(gerarCodigoComPrefixo('PROV', rand));
    expect(gerarCodigoComPrefixo('X')).toMatch(/^X-[0-9A-HJKMNP-TV-Z]{6}$/);
  });

  it('códigos diferentes em chamadas seguidas', () => {
    const vistos = new Set(Array.from({ length: 100 }, () => gerarCodigoProvisorio()));
    expect(vistos.size).toBeGreaterThan(95);
  });

  it('codigoProvisorioValido recusa letras fora do alfabeto, minúsculas e tamanhos errados', () => {
    for (const c of ['PROV-ABCDEI', 'PROV-ABCDEL', 'PROV-ABCDEO', 'PROV-ABCDEU', 'PROV-abcdef', 'PROV-ABCDE', 'PROV-ABCDEFG',
      'PRO-ABCDEF', ' PROV-ABCDEF', 'PROV-ABCDEF ', '']) {
      expect(codigoProvisorioValido(c), c).toBe(false);
    }
    expect(codigoProvisorioValido('PROV-0Z9XY7')).toBe(true);
  });
});
