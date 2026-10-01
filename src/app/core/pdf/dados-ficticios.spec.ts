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
    // §7.3: total_itens = Σ subtotal; sem desconto geral, total = total_itens;
    // total_descontos = Σ(bruto − subtotal) + (total_itens − total)
    const bruto = e.itens.reduce((s, i) => s + Math.round(i.quantidade * i.precoUnitarioCentavos * (i.meses ?? 1)), 0);
    const somaSubtotais = e.itens.reduce((s, i) => s + i.subtotalCentavos, 0);
    expect(e.proposta.totalItensCentavos).toBe(somaSubtotais);
    expect(e.proposta.totalCentavos).toBe(somaSubtotais);
    expect(e.proposta.totalDescontosCentavos).toBe(bruto - somaSubtotais + (e.proposta.totalItensCentavos - e.proposta.totalCentavos));
    expect(e.proposta.totalDescontosCentavos).toBe(52000);
    expect(e.proposta.totalCentavos + e.proposta.totalDescontosCentavos).toBe(bruto);
    expect(e.cliente?.nome).toBeTruthy();
    expect(e.empresa.razaoSocial).toBeTruthy();
  });

  it('usa o tipo do template; sem tipo é VENDA e nenhum item tem meses', () => {
    expect(entradaFicticia([], null, null, 'MANUTENCAO').proposta.tipo).toBe('MANUTENCAO');
    const venda = entradaFicticia([], null, null);
    expect(venda.proposta.tipo).toBe('VENDA');
    expect(venda.itens.every((i) => i.meses === null)).toBe(true);
  });

  it('LOCACAO: entra um item locável com meses e os totais seguem o §7.3', () => {
    const e = entradaFicticia([], null, null, 'LOCACAO');
    expect(e.proposta.tipo).toBe('LOCACAO');
    const locaveis = e.itens.filter((i) => typeof i.meses === 'number' && i.meses > 0);
    expect(locaveis).toHaveLength(1);
    const [l] = locaveis;
    // subtotal = quantidade × preço × (1 − desconto%) × meses
    expect(l.subtotalCentavos).toBe(Math.round(l.quantidade * l.precoUnitarioCentavos * l.meses! * (1 - l.descontoPercentual / 100)));
    const bruto = e.itens.reduce((s, i) => s + Math.round(i.quantidade * i.precoUnitarioCentavos * (i.meses ?? 1)), 0);
    const somaSubtotais = e.itens.reduce((s, i) => s + i.subtotalCentavos, 0);
    expect(e.proposta.totalItensCentavos).toBe(somaSubtotais);
    expect(e.proposta.totalCentavos).toBe(somaSubtotais);
    expect(e.proposta.totalCentavos + e.proposta.totalDescontosCentavos).toBe(bruto);
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
