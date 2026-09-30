import { dataBr, moedaCentavos, percentualBr, quantidadeBr } from './formatos-pdf';

describe('formatos-pdf', () => {
  it('moedaCentavos formata centavos inteiros em pt-BR com espaço comum', () => {
    expect(moedaCentavos(123456)).toBe('R$ 1.234,56');
    expect(moedaCentavos(0)).toBe('R$ 0,00');
    expect(moedaCentavos(5)).toBe('R$ 0,05');
    expect(moedaCentavos(100)).toBe('R$ 1,00');
    expect(moedaCentavos(123456789012)).toBe('R$ 1.234.567.890,12');
    expect(moedaCentavos(-5000)).toBe('-R$ 50,00');
  });

  it('moedaCentavos arredonda fração de centavo e trata valor inválido como zero', () => {
    expect(moedaCentavos(10.6)).toBe('R$ 0,11');
    expect(moedaCentavos(Number.NaN)).toBe('R$ 0,00');
  });

  it('dataBr converte ISO para dd/mm/aaaa; ausente ou inválida vira vazio', () => {
    expect(dataBr('2026-10-01')).toBe('01/10/2026');
    expect(dataBr('2026-12-31T23:59:00Z')).toBe('31/12/2026');
    expect(dataBr(null)).toBe('');
    expect(dataBr(undefined)).toBe('');
    expect(dataBr('ontem')).toBe('');
  });

  it('quantidadeBr usa vírgula, milhar com ponto e sem zeros à direita', () => {
    expect(quantidadeBr(1.5)).toBe('1,5');
    expect(quantidadeBr(10)).toBe('10');
    expect(quantidadeBr(2.25)).toBe('2,25');
    expect(quantidadeBr(0.125)).toBe('0,125');
    expect(quantidadeBr(1234.5)).toBe('1.234,5');
    expect(quantidadeBr(0)).toBe('0');
  });

  it('percentualBr acrescenta % no formato pt-BR', () => {
    expect(percentualBr(10)).toBe('10%');
    expect(percentualBr(12.5)).toBe('12,5%');
    expect(percentualBr(0)).toBe('0%');
  });
});
