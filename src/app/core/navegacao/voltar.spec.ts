import { destinoDeVolta } from './voltar';

describe('destinoDeVolta', () => {
  it('aceita um caminho interno de /propostas/ e acrescenta os parâmetros', () => {
    expect(destinoDeVolta('/propostas/nova?tipo=LOCACAO', { clienteId: 'c-1' })).toBe('/propostas/nova?tipo=LOCACAO&clienteId=c-1');
    expect(destinoDeVolta('/propostas/p1/editar?passo=1', { clienteId: 'c 2' })).toBe('/propostas/p1/editar?passo=1&clienteId=c+2');
    expect(destinoDeVolta('/propostas/nova')).toBe('/propostas/nova');
  });

  it('substitui um clienteId que já estava no caminho', () => {
    expect(destinoDeVolta('/propostas/nova?clienteId=velho', { clienteId: 'novo' })).toBe('/propostas/nova?clienteId=novo');
  });

  it.each([
    undefined,
    null,
    '',
    'https://evil.example/propostas/nova',
    '//evil.example/propostas/nova',
    '/\\evil.example/propostas/',
    '/propostas\\..\\usuarios',
    '/clientes',
    '/propostasx',
    '/propostas/../usuarios',
    '/propostas/%2e%2e/usuarios',
    'javascript:alert(1)//propostas/',
    '/propostas/nova\n',
    ' /propostas/nova',
    `/propostas/${'x'.repeat(2100)}`,
  ])('recusa %j (não vira redirecionamento aberto)', (voltar) => {
    expect(destinoDeVolta(voltar as string | null | undefined, { clienteId: 'c' })).toBeNull();
  });
});
