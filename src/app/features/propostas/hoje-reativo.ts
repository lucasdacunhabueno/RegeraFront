import { DestroyRef, DOCUMENT, inject, Signal, signal } from '@angular/core';
import { hojeEmSaoPaulo, msAteAmanhaEmSaoPaulo } from './propostas-repo';

/**
 * A data civil de São Paulo (`aaaa-mm-dd`, o selo Expirada) como sinal: refeita à meia-noite de São Paulo e quando a
 * aba volta a ficar visível (o timer atrasa com o aparelho dormindo). Timer e ouvinte saem no destroy. Chamar num
 * contexto de injeção (construtor do componente). Usado pela lista e pelo detalhe da proposta.
 */
export function hojeReativo(): Signal<string> {
  const documento = inject(DOCUMENT);
  const hoje = signal(hojeEmSaoPaulo());
  const atualizar = () => hoje.set(hojeEmSaoPaulo());
  const aoMudarVisibilidade = () => {
    if (documento.visibilityState === 'visible') atualizar();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  // +1 s de folga para já estar no dia seguinte; se disparar cedo (dia com mudança de fuso), reagenda o resto.
  const agendar = () => {
    timer = setTimeout(() => {
      atualizar();
      agendar();
    }, msAteAmanhaEmSaoPaulo() + 1000);
  };
  documento.addEventListener('visibilitychange', aoMudarVisibilidade);
  agendar();
  inject(DestroyRef).onDestroy(() => {
    clearTimeout(timer);
    documento.removeEventListener('visibilitychange', aoMudarVisibilidade);
  });
  return hoje.asReadonly();
}
