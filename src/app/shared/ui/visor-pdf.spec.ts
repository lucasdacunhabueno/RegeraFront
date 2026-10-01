import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { VisorPdf } from './visor-pdf';

@Component({
  imports: [VisorPdf],
  template: `<app-visor-pdf nomeArquivo="previa-x.pdf" />`,
})
class Hospedeiro {
  readonly visor = viewChild.required(VisorPdf);
}

@Component({
  imports: [VisorPdf],
  template: `<app-visor-pdf nomeArquivo="Proposta-000277.pdf" titulo="Documento" rotuloAbrir="Abrir PDF" />`,
})
class Outro {
  readonly visor = viewChild.required(VisorPdf);
}

describe('VisorPdf', () => {
  let urls: number;
  const criar = vi.fn(() => `blob:http://localhost/pdf-${++urls}`);
  const revogar = vi.fn();
  const originais = { criar: URL.createObjectURL, revogar: URL.revokeObjectURL, largura: window.innerWidth };
  const largura = (px: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: px });
  const janelaFalsa = () => ({ location: { href: '' }, close: vi.fn(), opener: {} as unknown, document: { title: '', body: { textContent: '' } } });
  const pdf = () => new Blob(['%PDF'], { type: 'application/pdf' });

  beforeEach(() => {
    urls = 0;
    criar.mockClear();
    revogar.mockClear();
    URL.createObjectURL = criar;
    URL.revokeObjectURL = revogar;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = originais.criar;
    URL.revokeObjectURL = originais.revogar;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originais.largura });
  });

  function montar() {
    const fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, visor: fixture.componentInstance.visor() };
  }
  const link = (el: HTMLElement, texto: string) => [...el.querySelectorAll('a')].find((a) => a.textContent?.trim() === texto);

  it('desktop: iframe com o blob, sem janela e sem "Baixar PDF"', async () => {
    largura(1280);
    const abrir = vi.spyOn(window, 'open');
    const { fixture, el, visor } = montar();
    await visor.abrir(async () => pdf());
    fixture.detectChanges();
    expect(abrir).not.toHaveBeenCalled();
    expect(el.querySelector('iframe[title="Prévia do PDF"]')?.getAttribute('src')).toBe('blob:http://localhost/pdf-1');
    expect(link(el, 'Baixar PDF')).toBeUndefined();
  });

  it('celular: abre a aba antes de gerar (no gesto) e depois aponta para o blob; mostra "Baixar PDF"', async () => {
    largura(390);
    const janela = janelaFalsa();
    const abrir = vi.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);
    const { fixture, el, visor } = montar();
    let liberar!: (b: Blob) => void;
    const gerar = vi.fn(() => new Promise<Blob>((r) => (liberar = r)));
    const feito = visor.abrir(gerar);
    expect(abrir).toHaveBeenCalledWith('', '_blank');
    expect(janela.document.body.textContent).toBe('Gerando prévia…');
    liberar(pdf());
    await feito;
    fixture.detectChanges();
    expect(janela.location.href).toBe('blob:http://localhost/pdf-1');
    expect(el.textContent).toContain('A prévia foi aberta em uma nova aba.');
    expect(link(el, 'Baixar PDF')?.getAttribute('download')).toBe('previa-x.pdf');
  });

  it('popup bloqueado: link "Abrir prévia" e "Baixar PDF"', async () => {
    largura(390);
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { fixture, el, visor } = montar();
    await visor.abrir(async () => pdf());
    fixture.detectChanges();
    expect(el.textContent).toContain('O navegador bloqueou a nova aba.');
    expect(link(el, 'Abrir prévia')?.getAttribute('href')).toBe('blob:http://localhost/pdf-1');
    expect(link(el, 'Baixar PDF')?.getAttribute('href')).toBe('blob:http://localhost/pdf-1');
  });

  it('falha na geração fecha a aba e repassa o erro, sem criar URL', async () => {
    largura(390);
    const janela = janelaFalsa();
    vi.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);
    const { visor } = montar();
    await expect(visor.abrir(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(janela.close).toHaveBeenCalled();
    expect(criar).not.toHaveBeenCalled();
  });

  it('nova prévia revoga a anterior; o destroy revoga a atual', async () => {
    largura(1280);
    const { fixture, visor } = montar();
    await visor.abrir(async () => pdf());
    await visor.abrir(async () => pdf());
    expect(revogar).toHaveBeenCalledWith('blob:http://localhost/pdf-1');
    fixture.destroy();
    expect(revogar).toHaveBeenCalledWith('blob:http://localhost/pdf-2');
  });

  it('textos configuráveis (Abrir documento)', async () => {
    largura(390);
    vi.spyOn(window, 'open').mockReturnValue(null);
    const fixture = TestBed.createComponent(Outro);
    fixture.detectChanges();
    await fixture.componentInstance.visor().abrir(async () => pdf());
    fixture.detectChanges();
    expect(link(fixture.nativeElement, 'Abrir PDF')).toBeTruthy();
  });
});
