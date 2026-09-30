import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ToastHost } from './toast-host';
import { Toasts } from './toasts';

function montar() {
  const fixture = TestBed.createComponent(ToastHost);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, toasts: TestBed.inject(Toasts) };
}

describe('ToastHost', () => {
  it('toast de erro usa role alert', async () => {
    const { fixture, el, toasts } = montar();
    toasts.mostrar('Falhou', { tipo: 'erro', fixo: true });
    await fixture.whenStable();

    const toast = el.querySelector('[role=alert]');
    expect(toast?.textContent).toContain('Falhou');
    expect(el.querySelector('[role=status]')).toBeNull();
  });

  it('toast informativo usa role status', async () => {
    const { fixture, el, toasts } = montar();
    toasts.mostrar('Salvo', { fixo: true });
    await fixture.whenStable();

    const toast = el.querySelector('[role=status]');
    expect(toast?.textContent).toContain('Salvo');
    expect(el.querySelector('[role=alert]')).toBeNull();
  });

  it('botão de ação chama aoAgir e remove o toast', async () => {
    const { fixture, el, toasts } = montar();
    const aoAgir = vi.fn();
    toasts.mostrar('Nova versão disponível.', { acao: 'Atualizar', aoAgir, fixo: true });
    await fixture.whenStable();

    const botao = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Atualizar')!;
    botao.click();
    await fixture.whenStable();

    expect(aoAgir).toHaveBeenCalledTimes(1);
    expect(toasts.itens()).toEqual([]);
    expect(el.querySelector('[role=status]')).toBeNull();
  });
});
