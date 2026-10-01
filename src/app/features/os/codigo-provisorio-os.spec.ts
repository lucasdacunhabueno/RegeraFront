import { codigoProvisorioOsValido, gerarCodigoProvisorioOs } from './codigo-provisorio-os';

describe('codigo-provisorio-os', () => {
  it('gera OSP- seguido de 6 caracteres Crockford (o @Pattern do OsDados), com o crypto padrão', () => {
    for (let i = 0; i < 200; i++) {
      const c = gerarCodigoProvisorioOs();
      expect(c).toMatch(/^OSP-[0-9A-HJKMNP-TV-Z]{6}$/);
      expect(codigoProvisorioOsValido(c)).toBe(true);
    }
  });

  it('usa o mesmo gerador da proposta: um byte por caractere, byte mod 32', () => {
    const rand = vi.fn((a: Uint8Array) => {
      a.set([0, 31, 32, 63, 255, 18]);
      return a;
    });
    expect(gerarCodigoProvisorioOs(rand)).toBe('OSP-0Z0ZZJ');
    expect(rand).toHaveBeenCalledTimes(1);
    expect(rand.mock.calls[0][0]).toHaveLength(6);
  });

  it('codigoProvisorioOsValido recusa o PROV da proposta, letras fora do alfabeto, minúsculas e tamanhos errados', () => {
    for (const c of ['PROV-ABCDEF', 'OSP-ABCDEI', 'OSP-ABCDEL', 'OSP-ABCDEO', 'OSP-ABCDEU', 'OSP-abcdef', 'OSP-ABCDE',
      'OSP-ABCDEFG', 'OS-ABCDEF', ' OSP-ABCDEF', 'OSP-ABCDEF ', '']) {
      expect(codigoProvisorioOsValido(c), c).toBe(false);
    }
    expect(codigoProvisorioOsValido('OSP-0Z9XY7')).toBe(true);
  });
});
