import { DestroyRef, effect, inject, Signal } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';

/** Página de formulário que sabe se há alterações ainda não salvas. */
export interface ComAlteracoes {
  temAlteracoes(): boolean;
}

export const MENSAGEM_ALTERACOES = 'Você tem alterações não salvas. Sair mesmo assim?';

/** P4a-R12: sair de um formulário com alterações pede confirmação; cancelar mantém a página. */
export const alteracoesGuard: CanDeactivateFn<ComAlteracoes> = (pagina) =>
  !pagina?.temAlteracoes() || window.confirm(MENSAGEM_ALTERACOES);

/**
 * Enquanto `alterado()` for true, fechar ou recarregar a aba pede confirmação do navegador (`beforeunload`). O ouvinte
 * só existe enquanto há alterações (um `beforeunload` permanente atrapalha o bfcache) e sai no destroy.
 * Chamar num contexto de injeção (construtor do componente).
 */
export function avisarAoSairDaPagina(alterado: Signal<boolean>): void {
  const barrar = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    // navegadores antigos só mostram o aviso com returnValue preenchido
    e.returnValue = '';
  };
  let registrado = false;
  const aplicar = (ligar: boolean) => {
    if (ligar === registrado) return;
    registrado = ligar;
    if (ligar) window.addEventListener('beforeunload', barrar);
    else window.removeEventListener('beforeunload', barrar);
  };
  effect(() => aplicar(alterado()));
  inject(DestroyRef).onDestroy(() => aplicar(false));
}

/** JSON estável para comparar estados de formulário: chaves de objeto ordenadas; a ordem dos arrays conta. */
export function instantaneo(valor: unknown): string {
  return JSON.stringify(valor, (_chave, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
