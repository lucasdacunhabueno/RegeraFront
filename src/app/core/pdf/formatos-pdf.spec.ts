import { dataBr, dataHoraBr, linhasDeTotais, moedaCentavos, percentualBr, quantidadeBr } from './formatos-pdf';

describe('formatos-pdf', () => {
  it('dataHoraBr: instante ISO → dd/mm/aaaa hh:mm na hora de São Paulo; ausente ou inválido → vazio', () => {
    expect(dataHoraBr('2026-10-02T01:30:00Z')).toBe('01/10/2026 22:30');
    expect(dataHoraBr('2026-09-20T00:00:00-03:00')).toBe('20/09/2026 00:00');
    expect(dataHoraBr(null)).toBe('');
    expect(dataHoraBr('ontem')).toBe('');
  });

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
    expect(dataBr('2026-13-01')).toBe('');
    expect(dataBr('2026-00-10')).toBe('');
    expect(dataBr('2026-10-32')).toBe('');
    expect(dataBr('2026-10-00')).toBe('');
    expect(dataBr('2026-01-31')).toBe('31/01/2026');
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

describe('linhasDeTotais (P4a-R6)', () => {
  it('com descontos: Subtotal = total + descontos (bruto), Descontos negativos e Total', () => {
    expect(linhasDeTotais(1846, 264, true)).toEqual([
      { rotulo: 'Subtotal', centavos: 2110, total: false },
      { rotulo: 'Descontos', centavos: -264, total: false },
      { rotulo: 'Total', centavos: 1846, total: true },
    ]);
  });

  it('sem desconto nenhum: Subtotal e Total; sem mostrarDescontos: só o Total', () => {
    expect(linhasDeTotais(500, 0, true).map((l) => l.rotulo)).toEqual(['Subtotal', 'Total']);
    expect(linhasDeTotais(500, 30, false)).toEqual([{ rotulo: 'Total', centavos: 500, total: true }]);
  });

  it('descontos negativos (dado estranho) contam como zero', () => {
    expect(linhasDeTotais(500, -10, true)[0]).toEqual({ rotulo: 'Subtotal', centavos: 500, total: false });
  });
});
