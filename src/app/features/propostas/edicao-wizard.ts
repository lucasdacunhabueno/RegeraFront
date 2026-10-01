import type { ItemLocal } from '../catalogo/item-models';
import type { TipoProposta } from '../templates/template-models';
import { calcular, deEscalado, ErroDecimal, lerDecimalEstrito, TotaisCalculo } from './calculo';
import type { ItemPropostaLocal } from './proposta-models';
import type { LinhaRascunho } from './propostas-repo';

/**
 * Funções puras do wizard da proposta (§13): o texto que se digita nas linhas e nos percentuais, os limites de
 * entrada do servidor (os mesmos de `PropostasRepo.validarEdicao`) e os totais ao vivo, por `calcular` (bigint).
 */

export type Passo = 1 | 2 | 3 | 4;

export const ROTULO_PASSO: Readonly<Record<Passo, string>> = { 1: 'Tipo e cliente', 2: 'Itens', 3: 'Condições', 4: 'Revisão' };

// limites de entrada do servidor (§7.3), nas unidades escaladas
export const QUANTIDADE_MIN = 1n; // 0,001
export const QUANTIDADE_MAX = 999_999_999n; // 999.999,999
export const PRECO_MAX = 99_999_999_999_999n; // 999.999.999.999,99
export const PERCENTUAL_MAX = 10_000n; // 100%
export const MESES_MAX = 120;

export const ERRO_QUANTIDADE = 'A quantidade vai de 0,001 a 999.999,999.';
export const ERRO_PRECO = 'O preço vai de 0 a 999.999.999.999,99.';
export const ERRO_DESCONTO = 'O desconto vai de 0 a 100%.';
export const ERRO_MESES = `De 1 a ${MESES_MAX} meses.`;

/** Global Constraints: as mensagens do que `lerDecimalEstrito` recusa. */
export function mensagemDecimal(erro: ErroDecimal, casas: number): string {
  switch (erro) {
    case 'VAZIO':
      return 'Informe o valor.';
    case 'NEGATIVO':
      return 'Não pode ser negativo.';
    case 'CASAS':
      return `Até ${casas} casas decimais.`;
    case 'AMBIGUO':
      return 'Use vírgula para decimais (ex.: 1,5).';
    default:
      return 'Valor inválido.';
  }
}

/** Valor escalado para o campo de texto: vírgula decimal e sem milhar (`1234,56`), que `lerDecimalEstrito` relê igual. */
export function textoDecimal(valor: bigint, casas: number, fixo: boolean): string {
  return deEscalado(valor, casas, fixo).replace('.', ',');
}

/** O texto digitado como inteiro escalado por 10^casas, ou a mensagem do erro (digitação ou fora de `min`..`max`). */
export function lerCampoDecimal(texto: string, casas: number, min: bigint, max: bigint, foraDoLimite: string): bigint | string {
  const v = lerDecimalEstrito(texto, casas);
  if (typeof v !== 'bigint') return mensagemDecimal(v, casas);
  return v < min || v > max ? foraDoLimite : v;
}

/** Linha como a tela a edita: os valores como texto, o resto como veio da proposta. */
export interface LinhaEditavel {
  id: string;
  itemCatalogoId: string;
  codigo: string | null;
  nome: string | null;
  descricao: string | null;
  unidade: string | null;
  natureza: ItemPropostaLocal['natureza'];
  precoCustoCentavos: number | null;
  quantidade: string;
  preco: string;
  desconto: string;
  meses: string;
  /** Os meses que a linha tinha: decidem o campo quando o item do catálogo não está no aparelho. */
  mesesAoCarregar: number | null;
}

export type CampoLinha = 'quantidade' | 'preco' | 'desconto' | 'meses';
export type ErrosLinha = Partial<Record<CampoLinha | 'geral', string>>;

export interface LinhaLida {
  /** A linha pronta para `salvarRascunho`; null se algum campo tem erro. */
  linha: LinhaRascunho | null;
  erros: ErrosLinha;
}

export function paraLinhaEditavel(l: ItemPropostaLocal): LinhaEditavel {
  return {
    id: l.id,
    itemCatalogoId: l.itemCatalogoId,
    codigo: l.codigo,
    nome: l.nome,
    descricao: l.descricao,
    unidade: l.unidade,
    natureza: l.natureza,
    precoCustoCentavos: l.precoCustoCentavos,
    quantidade: textoDecimal(BigInt(l.quantidadeMilesimos), 3, false),
    preco: textoDecimal(BigInt(l.precoUnitarioCentavos ?? 0), 2, true),
    desconto: textoDecimal(BigInt(l.descontoCentesimos ?? 0), 2, false),
    meses: l.meses === null ? '' : String(l.meses),
    mesesAoCarregar: l.meses,
  };
}

/** `meses` existe só em LOCACAO com item locável (regra do servidor); sem o item no aparelho, vale o que a linha tinha. */
export function linhaComMeses(tipo: TipoProposta, l: LinhaEditavel, catalogo: ItemLocal | undefined): boolean {
  if (tipo !== 'LOCACAO') return false;
  return catalogo ? catalogo.locavel : l.mesesAoCarregar !== null;
}

const INTEIRO = /^\d{1,3}$/;

export function lerLinha(l: LinhaEditavel, comMeses: boolean): LinhaLida {
  const erros: ErrosLinha = {};
  const quantidade = lerCampoDecimal(l.quantidade, 3, QUANTIDADE_MIN, QUANTIDADE_MAX, ERRO_QUANTIDADE);
  const preco = lerCampoDecimal(l.preco, 2, 0n, PRECO_MAX, ERRO_PRECO);
  const desconto = lerCampoDecimal(l.desconto, 2, 0n, PERCENTUAL_MAX, ERRO_DESCONTO);
  if (typeof quantidade === 'string') erros.quantidade = quantidade;
  if (typeof preco === 'string') erros.preco = preco;
  if (typeof desconto === 'string') erros.desconto = desconto;
  let meses: number | null = null;
  if (comMeses) {
    const t = l.meses.trim();
    meses = INTEIRO.test(t) ? Number(t) : null;
    if (t === '') erros.meses = mensagemDecimal('VAZIO', 0);
    else if (meses === null || meses < 1 || meses > MESES_MAX) erros.meses = ERRO_MESES;
  }
  if (typeof quantidade === 'string' || typeof preco === 'string' || typeof desconto === 'string' || erros.meses) {
    return { linha: null, erros };
  }
  return {
    linha: {
      id: l.id,
      itemCatalogoId: l.itemCatalogoId,
      codigo: l.codigo,
      nome: l.nome,
      descricao: l.descricao,
      unidade: l.unidade,
      natureza: l.natureza,
      precoCustoCentavos: l.precoCustoCentavos,
      quantidadeMilesimos: Number(quantidade),
      precoUnitarioCentavos: Number(preco),
      descontoCentesimos: Number(desconto),
      meses,
    },
    erros,
  };
}

/** Os totais como o servidor os calcula (`calcular`, como `comTotais` do repositório). */
export function totaisDe(linhas: readonly LinhaRascunho[], descontoGeralCentesimos: bigint, tipo: TipoProposta): TotaisCalculo {
  return calcular(
    linhas.map((l) => ({
      quantidadeMilesimos: BigInt(l.quantidadeMilesimos),
      precoUnitarioCentavos: BigInt(l.precoUnitarioCentavos ?? 0),
      descontoCentesimos: BigInt(l.descontoCentesimos ?? 0),
      meses: l.meses,
    })),
    descontoGeralCentesimos,
    tipo === 'LOCACAO',
  );
}

const CAMPO_DA_LINHA: Readonly<Record<string, CampoLinha>> = {
  quantidade: 'quantidade', precoUnitario: 'preco', descontoPercentual: 'desconto', meses: 'meses',
};
const LINHA = /^itens\[(\d+)\]\.(\w+)/;

/** `itens[3].precoUnitario` (nome do servidor) → a linha 3, campo `preco`; outros campos da linha → `geral`. */
export function campoDaLinha(campo: string): { indice: number; campo: CampoLinha | 'geral' } | null {
  const m = LINHA.exec(campo);
  return m ? { indice: Number(m[1]), campo: CAMPO_DA_LINHA[m[2]] ?? 'geral' } : null;
}

/** O passo do wizard onde fica o campo de um erro do repositório (null: erro da proposta, sem campo). */
export function passoDoCampo(campo: string): Passo | null {
  if (campo === 'tipo' || campo === 'clienteId') return 1;
  if (campo === 'itens' || campo.startsWith('itens[')) return 2;
  if (campo === 'proposta') return null;
  return 3;
}
