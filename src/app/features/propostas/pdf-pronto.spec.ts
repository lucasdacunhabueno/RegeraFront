import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { arquivoPdf, ResultadoCompartilhar } from './compartilhar';
import { PdfPronto } from './pdf-pronto';

const arquivo = arquivoPdf(new Blob(['%PDF'], { type: 'application/pdf' }), 'Proposta-PROV-ABC123.pdf');

@Component({
  imports: [PdfPronto],
  template: `<app-pdf-pronto [arquivo]="arquivo" (concluido)="resultados.update((r) => [...r, $event])" />`,
})
class Hospedeiro {
  readonly arquivo = arquivo;
  readonly resultados = signal<(ResultadoCompartilhar | 'fechado')[]>([]);
}

describe('PdfPronto', () => {
  const nav = navigator as Navigator & { share?: unknown; canShare?: unknown };
  const originais = { share: nav.share, canShare: nav.canShare, criar: URL.createObjectURL, revogar: URL.revokeObjectURL };
  function definir(share: unknown) {
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: () => true });
  }
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: originais.share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: originais.canShare });
    URL.createObjectURL = originais.criar;
    URL.revokeObjectURL = originais.revogar;
  });

  async function montar() {
    const fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, painel: el.querySelector<HTMLElement>('[role=dialog]')! };
  }
  const botao = (el: HTMLElement, texto: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto)!;

  it('é um diálogo rotulado, com o nome do arquivo, e recebe o foco', async () => {
    const { el, painel } = await montar();
    expect(document.getElementById(painel.getAttribute('aria-labelledby')!)?.textContent).toBe('PDF pronto');
    expect(painel.textContent).toContain('Proposta-PROV-ABC123.pdf');
    await vi.waitFor(() => expect(document.activeElement).toBe(painel));
    expect(botao(el, 'Compartilhar').classList).toContain('h-12');
  });

  it('"Compartilhar" chama navigator.share no próprio clique, com o mesmo File', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    definir(share);
    const { fixture, el } = await montar();
    botao(el, 'Compartilhar').click();
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].files[0]).toBe(arquivo);
    await vi.waitFor(() => expect(fixture.componentInstance.resultados()).toEqual(['compartilhado']));
  });

  it('NotAllowedError de novo: avisa e continua aberto', async () => {
    definir(vi.fn().mockRejectedValue(new DOMException('x', 'NotAllowedError')));
    const { fixture, el } = await montar();
    botao(el, 'Compartilhar').click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[role=alert]')?.textContent).toContain('não abriu o compartilhamento');
    });
    expect(fixture.componentInstance.resultados()).toEqual([]);
  });

  it('"Baixar PDF" baixa o arquivo; Esc e "Fechar" fecham', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { fixture, el, painel } = await montar();
    botao(el, 'Baixar PDF').click();
    expect((clique.mock.contexts[0] as HTMLAnchorElement).download).toBe('Proposta-PROV-ABC123.pdf');
    painel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    botao(el, 'Fechar').click();
    expect(fixture.componentInstance.resultados()).toEqual(['baixado', 'fechado', 'fechado']);
  });
});
