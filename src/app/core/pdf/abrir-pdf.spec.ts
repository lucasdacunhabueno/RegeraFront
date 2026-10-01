import { vi } from 'vitest';
import { abrirJanelaEmBranco, baixarArquivo, ESPERA_REVOGAR_MS, previaNoIframe, revogarUrl } from './abrir-pdf';

describe('abrir-pdf', () => {
  const originais = { largura: window.innerWidth, matchMedia: window.matchMedia, criar: URL.createObjectURL, revogar: URL.revokeObjectURL };
  const largura = (px: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: px });
  const ponteiroGrosso = () =>
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (q: string) => ({ matches: q === '(pointer: coarse)', media: q }),
    });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originais.largura });
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: originais.matchMedia });
    URL.createObjectURL = originais.criar;
    URL.revokeObjectURL = originais.revogar;
  });

  describe('previaNoIframe', () => {
    it('só em tela de 1024 px ou mais, com mouse e fora do iOS', () => {
      largura(1023);
      expect(previaNoIframe()).toBe(false);
      largura(1024);
      expect(previaNoIframe()).toBe(true);
    });

    it('ponteiro grosso (tablet) vai para a aba mesmo em tela larga', () => {
      largura(1280);
      ponteiroGrosso();
      expect(previaNoIframe()).toBe(false);
    });

    it('iPad que se apresenta como Mac (toque) vai para a aba', () => {
      largura(1366);
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
      // o jsdom não tem maxTouchPoints
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
      try {
        expect(previaNoIframe()).toBe(false);
      } finally {
        delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
      }
    });
  });

  describe('abrirJanelaEmBranco', () => {
    it('abre a aba em branco, corta o opener e escreve o aviso', () => {
      const janela = { opener: {} as unknown, document: { title: '', body: { textContent: '' } } };
      const abrir = vi.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);
      expect(abrirJanelaEmBranco('Prévia do PDF', 'Gerando prévia…')).toBe(janela);
      expect(abrir).toHaveBeenCalledWith('', '_blank');
      expect(janela.opener).toBeNull();
      expect(janela.document.title).toBe('Prévia do PDF');
      expect(janela.document.body.textContent).toBe('Gerando prévia…');
    });

    it('popup bloqueado devolve null', () => {
      vi.spyOn(window, 'open').mockReturnValue(null);
      expect(abrirJanelaEmBranco('x', 'y')).toBeNull();
    });

    it('sem acesso ao documento da aba, devolve a aba mesmo assim', () => {
      const janela = {
        set opener(_v: unknown) {
          throw new Error('cross-origin');
        },
      };
      vi.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);
      expect(abrirJanelaEmBranco('x', 'y')).toBe(janela);
    });
  });

  describe('revogarUrl', () => {
    it('revoga já ou depois de 60 s', () => {
      vi.useFakeTimers();
      const revogar = vi.fn();
      URL.revokeObjectURL = revogar;
      revogarUrl('blob:a', false);
      expect(revogar).toHaveBeenCalledWith('blob:a');
      revogarUrl('blob:b', true);
      expect(revogar).not.toHaveBeenCalledWith('blob:b');
      vi.advanceTimersByTime(ESPERA_REVOGAR_MS);
      expect(revogar).toHaveBeenCalledWith('blob:b');
    });
  });

  describe('baixarArquivo', () => {
    it('clica num <a download> com o nome, tira o link e revoga o URL depois', () => {
      vi.useFakeTimers();
      URL.createObjectURL = vi.fn(() => 'blob:pdf');
      const revogar = vi.fn();
      URL.revokeObjectURL = revogar;
      const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      baixarArquivo(new Blob(['%PDF']), 'Proposta-PROV-ABC123.pdf');
      const clicado = clique.mock.contexts[0] as HTMLAnchorElement | undefined;
      expect(clicado?.getAttribute('href')).toBe('blob:pdf');
      expect(clicado?.getAttribute('download')).toBe('Proposta-PROV-ABC123.pdf');
      expect(clicado?.isConnected).toBe(false);
      expect(revogar).not.toHaveBeenCalled();
      vi.advanceTimersByTime(ESPERA_REVOGAR_MS);
      expect(revogar).toHaveBeenCalledWith('blob:pdf');
    });
  });
});
