import { Bloco, TipoProposta } from '../../features/templates/template-models';

/** Dados da empresa no PDF. Telefone e CNPJ chegam só com dígitos; o motor formata. */
export interface EmpresaPdf {
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string | null;
  endereco: string | null;
  telefone: string | null;
  email: string | null;
  site: string | null;
  corPrimaria: string;
}

export interface ClientePdf {
  nome: string;
  /** null quando o aparelho não tem o CPF/CNPJ (o TECNICO não o recebe, Q14): sai em branco. */
  documento: string | null;
  endereco: string | null;
  contato: string | null;
  telefone: string | null;
  email: string | null;
}

/** Valores em centavos inteiros; datas ISO (`aaaa-mm-dd`). */
export interface PropostaPdf {
  codigoExibido: string;
  referenciaProvisoria: string | null;
  revisao: number;
  tipo: TipoProposta;
  dataEmissao: string;
  validadeAte: string | null;
  condicoesPagamento: string | null;
  prazoExecucao: string | null;
  observacoes: string | null;
  totalItensCentavos: number;
  totalDescontosCentavos: number;
  totalCentavos: number;
  responsavelNome: string | null;
  responsavelEmail: string | null;
}

export interface ItemPdf {
  codigo: string;
  nome: string;
  descricao: string | null;
  unidade: string;
  natureza: 'PRODUTO' | 'SERVICO';
  quantidade: number;
  precoUnitarioCentavos: number;
  descontoPercentual: number;
  meses: number | null;
  subtotalCentavos: number;
}

/** Tudo o que o motor de PDF precisa; `gerarDocumento` não lê nada fora daqui. */
export interface EntradaPdf {
  empresa: EmpresaPdf;
  cliente: ClientePdf | null;
  proposta: PropostaPdf;
  itens: ItemPdf[];
  blocos: Bloco[];
  logoDataUrl: string | null;
  previa: boolean;
}
