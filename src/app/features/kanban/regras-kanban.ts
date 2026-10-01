import type { Perfil } from '../../core/auth/auth-models';
import { exigeMotivo, ordenarPorAtualizacao, PropostaLocal, StatusProposta, transicoesPermitidas } from '../propostas/proposta-models';

/**
 * Regras puras do kanban (§13). Quem pode mover o quê vem só de `transicoesPermitidas` (o espelho do §8/§10, conferido
 * contra `casos-transicoes.json`): aqui não há tabela própria. A única particularidade é RASCUNHO→ENVIADA, que é
 * permitida mas não transiciona: o envio gera o PDF oficial, então o kanban leva ao passo de envio do wizard.
 */

const FLUXO: readonly StatusProposta[] = ['RASCUNHO', 'ENVIADA', 'APROVADA', 'EM_EXECUCAO', 'FINALIZADA'];
const ENCERRADAS: readonly StatusProposta[] = ['RECUSADA', 'CANCELADA'];

/** As colunas, na ordem do fluxo; "Mostrar encerradas" acrescenta RECUSADA e CANCELADA. */
export function colunas(mostrarEncerradas: boolean): StatusProposta[] {
  return mostrarEncerradas ? [...FLUXO, ...ENCERRADAS] : [...FLUXO];
}

type Movivel = Pick<PropostaLocal, 'status' | 'responsavelId'>;

/** Os destinos que o usuário pode escolher para o card, na ordem de `transicoesPermitidas`. Sem sessão: nenhum. */
export function destinos(p: Movivel, perfil: Perfil | null | undefined, eu: string | null | undefined): StatusProposta[] {
  if (!perfil || !eu) return [];
  return transicoesPermitidas(p.status, perfil, p.responsavelId === eu);
}

/** O card pode ir para a coluna `para` (soltar na própria coluna não é movimento). */
export function podeSoltar(p: Movivel, para: StatusProposta, perfil: Perfil | null | undefined, eu: string | null | undefined): boolean {
  return para !== p.status && destinos(p, perfil, eu).includes(para);
}

/** O que o movimento permitido faz: `enviar` abre o wizard no envio; `motivo` pede o motivo antes; `transicionar` grava. */
export function acaoDoMovimento(de: StatusProposta, para: StatusProposta): 'enviar' | 'motivo' | 'transicionar' {
  if (de === 'RASCUNHO' && para === 'ENVIADA') return 'enviar';
  return exigeMotivo(para) ? 'motivo' : 'transicionar';
}

/** Uma lista por coluna (na ordem das colunas), cada uma por `atualizadoEm` desc. Sem coluna visível, fica de fora. */
export function agrupar<T extends Pick<PropostaLocal, 'id' | 'status' | 'atualizadoEm'>>(
  lista: readonly T[],
  cols: readonly StatusProposta[],
): Map<StatusProposta, T[]> {
  const grupos = new Map<StatusProposta, T[]>(cols.map((s) => [s, []]));
  for (const p of lista) grupos.get(p.status)?.push(p);
  for (const g of grupos.values()) ordenarPorAtualizacao(g);
  return grupos;
}

/** A soma dos totais da coluna em centavos (total ausente conta zero). */
export function somarTotais(lista: readonly Pick<PropostaLocal, 'totalCentavos'>[]): number {
  return lista.reduce((soma, p) => soma + (p.totalCentavos ?? 0), 0);
}

/** A emissão (`aaaa-mm-dd`) está entre `de` e `ate`, inclusive; limite vazio é aberto. */
export function noPeriodo(dataEmissao: string, de: string, ate: string): boolean {
  const d = dataEmissao.slice(0, 10);
  return (!de || d >= de) && (!ate || d <= ate);
}
