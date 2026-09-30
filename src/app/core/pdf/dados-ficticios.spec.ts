import { blocosIniciais } from '../../features/templates/template-models';
import { paraEmpresaLocal } from '../../features/empresa/empresa-models';
import { entradaFicticia } from './dados-ficticios';
import { gerarDocumento } from './gerar-documento';

describe('entradaFicticia', () => {
  it('dois produtos e um serviço, um com desconto, com totais coerentes e prévia ligada', () => {
    const e = entradaFicticia(blocosIniciais(), null, null);
    expect(e.previa).toBe(true);
    expect(e.itens.filter((i) => i.natureza === 'PRODUTO')).toHaveLength(2);
    expect(e.itens.filter((i) => i.natureza === 'SERVICO')).toHaveLength(1);
    expect(e.itens.filter((i) => i.descontoPercentual > 0)).toHaveLength(1);
    const bruto = e.itens.reduce((s, i) => s + Math.round(i.quantidade * i.precoUnitarioCentavos), 0);
    const liquido = e.itens.reduce((s, i) => s + i.subtotalCentavos, 0);
    expect(e.proposta.totalItensCentavos).toBe(bruto);
    expect(e.proposta.totalDescontosCentavos).toBe(bruto - liquido);
    expect(e.proposta.totalDescontosCentavos).toBeGreaterThan(0);
    expect(e.proposta.totalCentavos).toBe(liquido);
    expect(e.cliente?.nome).toBeTruthy();
    expect(e.empresa.razaoSocial).toBeTruthy();
  });

  it('usa os dados reais da empresa e a logo quando existem', () => {
    const empresa = paraEmpresaLocal('e', 1, { razaoSocial: 'Regera S.A.', nomeFantasia: 'Regera', cnpj: '11222333000181', corPrimaria: '#0f766e' });
    const e = entradaFicticia([], empresa, 'data:image/png;base64,AAAA');
    expect(e.empresa).toEqual({
      razaoSocial: 'Regera S.A.', nomeFantasia: 'Regera', cnpj: '11222333000181', endereco: null, telefone: null, email: null,
      site: null, corPrimaria: '#0f766e',
    });
    expect(e.logoDataUrl).toBe('data:image/png;base64,AAAA');
  });

  it('é determinística e gera um documento válido com os blocos iniciais', () => {
    const blocos = blocosIniciais();
    expect(JSON.stringify(entradaFicticia(blocos, null, null))).toBe(JSON.stringify(entradaFicticia(blocos, null, null)));
    const dd = gerarDocumento(entradaFicticia(blocos, null, null));
    expect(dd.content).toHaveLength(5);
    expect(JSON.stringify(dd)).not.toMatch(/undefined|null/i);
  });
});
