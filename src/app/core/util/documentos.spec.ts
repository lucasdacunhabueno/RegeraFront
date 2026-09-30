import { cnpjValido, cpfValido, documentoValido, normalizarDocumento } from './documentos';

describe('documentos', () => {
  it('normaliza pontuação e minúsculas', () => {
    expect(normalizarDocumento('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(normalizarDocumento(' 529.982.247-25 ')).toBe('52998224725');
    expect(normalizarDocumento(null)).toBe('');
  });

  it.each(['52998224725', '11144477735'])('aceita CPF %s', (cpf) => {
    expect(cpfValido(cpf)).toBe(true);
  });

  it.each(['52998224724', '11111111111', '1234567890', '5299822472A', ''])('recusa CPF %s', (cpf) => {
    expect(cpfValido(cpf)).toBe(false);
  });

  it.each(['11222333000181', '12ABC34501DE35'])('aceita CNPJ %s', (cnpj) => {
    expect(cnpjValido(cnpj)).toBe(true);
  });

  it.each(['11222333000182', '12ABC34501DE34', '00000000000000', '12ABC34501DE3A', ''])('recusa CNPJ %s', (cnpj) => {
    expect(cnpjValido(cnpj)).toBe(false);
  });

  it('valida conforme o tipo', () => {
    expect(documentoValido('PF', '52998224725')).toBe(true);
    expect(documentoValido('PJ', '52998224725')).toBe(false);
    expect(documentoValido('PJ', '12ABC34501DE35')).toBe(true);
  });
});
