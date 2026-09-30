import {
  aplicarPadrao,
  formatarCep,
  formatarDocumento,
  formatarTelefone,
  mascararDocumento,
  normalizarBusca,
  somenteDigitos,
} from './formatos';

describe('formatos', () => {
  it('aplica padrão progressivamente sem separador sobrando', () => {
    expect(aplicarPadrao('123', '###.###')).toBe('123');
    expect(aplicarPadrao('1234', '###.###')).toBe('123.4');
  });

  it('mascara CPF enquanto digita e corta excesso', () => {
    expect(mascararDocumento('PF', '5299822')).toBe('529.982.2');
    expect(mascararDocumento('PF', '529982247251234')).toBe('529.982.247-25');
    expect(mascararDocumento('PF', '52a99')).toBe('529.9');
  });

  it('mascara CNPJ alfanumérico em maiúsculas', () => {
    expect(mascararDocumento('PJ', '12abc34501de35')).toBe('12.ABC.345/01DE-35');
  });

  it('formata documento salvo', () => {
    expect(formatarDocumento('52998224725')).toBe('529.982.247-25');
    expect(formatarDocumento('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatarDocumento('123')).toBe('123');
  });

  it('formata telefone fixo e celular', () => {
    expect(formatarTelefone('1133334444')).toBe('(11) 3333-4444');
    expect(formatarTelefone('11999998888')).toBe('(11) 99999-8888');
    expect(formatarTelefone(null)).toBe('');
  });

  it('formata CEP e extrai dígitos', () => {
    expect(formatarCep('01001000')).toBe('01001-000');
    expect(somenteDigitos('(11) 9-99')).toBe('11999');
  });

  it('normaliza busca sem acento e em minúsculas', () => {
    expect(normalizarBusca('  João Ávila ')).toBe('joao avila');
  });
});
