import { formatarMoeda, formatarMoedaInput, parseMoeda } from './moeda';

describe('moeda', () => {
  it('interpreta formato brasileiro, americano simples e com R$', () => {
    expect(parseMoeda('1.234,56')).toBe(1234.56);
    expect(parseMoeda('10,5')).toBe(10.5);
    expect(parseMoeda('R$ 25,50')).toBe(25.5);
    expect(parseMoeda('10.50')).toBe(10.5);
    expect(parseMoeda('1234')).toBe(1234);
  });

  it('vazio é null e texto inválido é NaN', () => {
    expect(parseMoeda('  ')).toBeNull();
    expect(parseMoeda('abc')).toBeNaN();
    expect(parseMoeda('1,234')).toBeNaN();
    expect(parseMoeda('-5')).toBeNaN();
  });

  it('formata para exibição e para input', () => {
    expect(formatarMoeda(1234.5)).toMatch(/^R\$\s1\.234,50$/);
    expect(formatarMoeda(null)).toBe('—');
    expect(formatarMoedaInput(1234.5)).toBe('1.234,50');
    expect(formatarMoedaInput(undefined)).toBe('');
  });
});
