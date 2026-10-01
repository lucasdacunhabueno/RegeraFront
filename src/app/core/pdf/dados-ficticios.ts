import { EmpresaLocal } from '../../features/empresa/empresa-models';
import { Bloco, TipoProposta } from '../../features/templates/template-models';
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

/** quantidade × preço × (meses, se houver), antes do desconto do item. */
function brutoCentavos(i: Pick<ItemPdf, 'quantidade' | 'precoUnitarioCentavos' | 'meses'>): number {
  return Math.round(i.quantidade * i.precoUnitarioCentavos * (i.meses ?? 1));
}

function item(p: Omit<ItemPdf, 'subtotalCentavos'>): ItemPdf {
  return { ...p, subtotalCentavos: Math.round(brutoCentavos(p) * (1 - p.descontoPercentual / 100)) };
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

/** Só na LOCACAO: item locável, preço mensal × meses. */
const ITEM_LOCACAO: ItemPdf = item({ codigo: 'L-0001', nome: 'Locação de grupo gerador 150 kVA', descricao: 'Preço mensal',
  unidade: 'UN', natureza: 'PRODUTO', quantidade: 1, precoUnitarioCentavos: 450000, descontoPercentual: 0, meses: 6 });

/**
 * Entrada fictícia para a prévia do template (editor): a empresa real quando existe, cliente, itens e totais
 * inventados, mas coerentes. Determinística (datas fixas), para a prévia não mudar a cada clique.
 */
export function entradaFicticia(
  blocos: Bloco[],
  empresa: EmpresaLocal | null,
  logoDataUrl: string | null,
  tipo: TipoProposta = 'VENDA',
): EntradaPdf {
  const itens = [...ITENS, ...(tipo === 'LOCACAO' ? [ITEM_LOCACAO] : [])].map((i) => ({ ...i }));
  // §7.3: total_itens = Σ subtotal; total = total_itens × (1 − geral%), aqui sem desconto geral;
  // total_descontos = Σ(bruto − subtotal) + (total_itens − total)
  const bruto = itens.reduce((s, i) => s + brutoCentavos(i), 0);
  const totalItens = itens.reduce((s, i) => s + i.subtotalCentavos, 0);
  const total = totalItens;
  const totalDescontos = bruto - totalItens + (totalItens - total);
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
      tipo,
      dataEmissao: '2026-10-01',
      validadeAte: '2026-10-16',
      condicoesPagamento: '30% na assinatura e 70% na entrega',
      prazoExecucao: '30 dias',
      observacoes: 'Valores de exemplo.',
      totalItensCentavos: totalItens,
      totalDescontosCentavos: totalDescontos,
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
