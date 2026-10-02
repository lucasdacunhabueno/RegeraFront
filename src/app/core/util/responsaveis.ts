import type { UsuarioResumo } from '../sync/sync-models';

/** Uma opção do select de responsável (o detalhe da proposta e a OS avulsa). */
export interface OpcaoResponsavel {
  id: string;
  rotulo: string;
}

/** N1: o rótulo do responsável atual que não está na lista de usuários do aparelho. */
export const RESPONSAVEL_FORA_DA_LISTA = 'Responsável atual (não está neste aparelho)';

/**
 * Os responsáveis possíveis: ADMIN e COMERCIAL ativos e, se for o caso, o atual inativo (marcado), em ordem pt-BR. O
 * atual que não está na lista do aparelho vem primeiro, com um rótulo próprio: o select o mostra escolhido, e salvar
 * com ele só fecha. Função pura, a mesma regra na proposta e na OS.
 */
export function opcoesDeResponsavel(usuarios: readonly UsuarioResumo[], atual: string | null): OpcaoResponsavel[] {
  const lista = usuarios
    .filter((u) => (u.perfil === 'ADMIN' || u.perfil === 'COMERCIAL') && (u.ativo !== false || u.id === atual))
    .map((u) => ({ id: u.id, rotulo: u.ativo === false ? `${u.nome} (inativo)` : u.nome }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  return atual && !usuarios.some((u) => u.id === atual) ? [{ id: atual, rotulo: RESPONSAVEL_FORA_DA_LISTA }, ...lista] : lista;
}
