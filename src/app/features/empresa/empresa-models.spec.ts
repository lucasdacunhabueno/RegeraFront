import { dadosDaEmpresa, ID_EMPRESA, paraEmpresaLocal } from './empresa-models';

describe('empresa-models', () => {
  it('a empresa completa (ADMIN e COMERCIAL) faz a ida e volta', () => {
    const d = {
      razaoSocial: 'Regera Energia Ltda', nomeFantasia: 'Regera', cnpj: '11222333000181', endereco: 'Rua A, 1',
      telefone: '1133334444', email: 'contato@regera.com', site: 'regera.com', logoArquivoId: 'logo-1',
      corPrimaria: '#123456', validadePadraoDias: 10, condicoesPagamentoPadrao: '30/60/90',
    };
    const e = paraEmpresaLocal(ID_EMPRESA, 3, d);
    expect(e).toEqual({ id: ID_EMPRESA, version: 3, ...d });
    expect(dadosDaEmpresa(e)).toEqual(d);
  });

  it('a do TECNICO chega sem os padrões comerciais (M2P1-R25): ficam null, sem valor inventado', () => {
    const e = paraEmpresaLocal(ID_EMPRESA, 3, {
      razaoSocial: 'Regera Energia Ltda', cnpj: '11222333000181', logoArquivoId: 'logo-1', corPrimaria: '#123456',
    });
    expect(e).toMatchObject({ razaoSocial: 'Regera Energia Ltda', logoArquivoId: 'logo-1', validadePadraoDias: null, condicoesPagamentoPadrao: null });
    expect(dadosDaEmpresa(e)).toMatchObject({ validadePadraoDias: null, condicoesPagamentoPadrao: null });
  });
});
