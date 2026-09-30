import { EmpresaLocal } from '../../features/empresa/empresa-models';
import { Bloco } from '../../features/templates/template-models';
import { EmpresaPdf, EntradaPdf, ItemPdf } from './pdf-models';

const EMPRESA_FICTICIA: EmpresaPdf = {
  razaoSocial: 'Sua Empresa Ltda',
  nomeFantasia: null,
  cnpj: null,
  endereco: null,
  telefone: null,
  email: null,
  site: null,
  corPrimaria: '#1d4ed8',
};

function item(p: Omit<ItemPdf, 'subtotalCentavos'>): ItemPdf {
  const bruto = Math.round(p.quantidade * p.precoUnitarioCentavos);
  return { ...p, subtotalCentavos: bruto - Math.round((bruto * p.descontoPercentual) / 100) };
}

/** Dois produtos e um serviço; o inversor tem 10% de desconto. */
const ITENS: readonly ItemPdf[] = [
  item({ codigo: 'P-0001', nome: 'Módulo fotovoltaico 550 W', descricao: 'Monocristalino, garantia de 12 anos', unidade: 'UN',
    natureza: 'PRODUTO', quantidade: 10, precoUnitarioCentavos: 89000, descontoPercentual: 0, meses: null }),
  item({ codigo: 'P-0002', nome: 'Inversor 5 kW', descricao: null, unidade: 'UN', natureza: 'PRODUTO', quantidade: 1,
    precoUnitarioCentavos: 520000, descontoPercentual: 10, meses: null }),
  item({ codigo: 'S-0001', nome: 'Instalação e comissionamento', descricao: 'Inclui projeto e homologação', unidade: 'SV',
    natureza: 'SERVICO', quantidade: 1, precoUnitarioCentavos: 250000, descontoPercentual: 0, meses: null }),
];

/**
 * Entrada fictícia para a prévia do template (editor): a empresa real quando existe, cliente, itens e totais
 * inventados, mas coerentes. Determinística (datas fixas), para a prévia não mudar a cada clique.
 */
export function entradaFicticia(blocos: Bloco[], empresa: EmpresaLocal | null, logoDataUrl: string | null): EntradaPdf {
  const itens = ITENS.map((i) => ({ ...i }));
  const totalItens = itens.reduce((s, i) => s + Math.round(i.quantidade * i.precoUnitarioCentavos), 0);
  const total = itens.reduce((s, i) => s + i.subtotalCentavos, 0);
  return {
    empresa: empresa
      ? {
          razaoSocial: empresa.razaoSocial,
          nomeFantasia: empresa.nomeFantasia,
          cnpj: empresa.cnpj,
          endereco: empresa.endereco,
          telefone: empresa.telefone,
          email: empresa.email,
          site: empresa.site,
          corPrimaria: empresa.corPrimaria,
        }
      : { ...EMPRESA_FICTICIA },
    cliente: {
      nome: 'Cliente Exemplo Ltda',
      documento: '11444777000161',
      endereco: 'Av. Paulista, 1000 - São Paulo/SP',
      contato: 'Maria Silva',
      telefone: '11988887777',
      email: 'maria@cliente-exemplo.com.br',
    },
    proposta: {
      codigoExibido: '000123',
      referenciaProvisoria: null,
      revisao: 1,
      tipo: 'VENDA',
      dataEmissao: '2026-10-01',
      validadeAte: '2026-10-16',
      condicoesPagamento: '30% na assinatura e 70% na entrega',
      prazoExecucao: '30 dias',
      observacoes: 'Valores de exemplo.',
      totalItensCentavos: totalItens,
      totalDescontosCentavos: totalItens - total,
      totalCentavos: total,
      responsavelNome: 'João Souza',
      responsavelEmail: 'joao@suaempresa.com.br',
    },
    itens,
    blocos,
    logoDataUrl,
    previa: true,
  };
}
