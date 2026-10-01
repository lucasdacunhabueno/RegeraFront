import { vi } from 'vitest';
import { compartilharPdf } from './compartilhar';

type NavegadorComShare = Navigator & { share?: unknown; canShare?: unknown };

describe('compartilharPdf', () => {
  const nav = navigator as NavegadorComShare;
  const originais = { share: nav.share, canShare: nav.canShare };
  const blob = new Blob(['%PDF'], { type: 'application/pdf' });

  function definir(share: unknown, canShare: unknown) {
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: canShare });
  }

  const urlOriginais = { criar: URL.createObjectURL, revogar: URL.revokeObjectURL };
  /** O download é um `<a download>` clicado (`baixarArquivo`): os testes olham o link clicado e o blob dele. */
  const baixar = vi.fn<(blob: Blob, nome: string) => void>();
  beforeEach(() => {
    baixar.mockClear();
    let ultimo: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => {
      ultimo = b;
      return 'blob:pdf';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      baixar(ultimo!, this.download);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    definir(originais.share, originais.canShare);
    URL.createObjectURL = urlOriginais.criar;
    URL.revokeObjectURL = urlOriginais.revogar;
  });

  it('canShare({ files }) verdadeiro: compartilha o arquivo PDF com o nome e não baixa', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    definir(share, canShare);
    await expect(compartilharPdf(blob, 'Proposta-PROV-ABC123.pdf')).resolves.toBe('compartilhado');
    const arquivo = canShare.mock.calls[0][0].files[0] as File;
    expect(arquivo.name).toBe('Proposta-PROV-ABC123.pdf');
    expect(arquivo.type).toBe('application/pdf');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [arquivo] }));
    expect(baixar).not.toHaveBeenCalled();
  });

  it('canShare falso: baixa com o nome, sem chamar share', async () => {
    const share = vi.fn();
    definir(share, vi.fn().mockReturnValue(false));
    await expect(compartilharPdf(blob, 'Proposta-000277.pdf')).resolves.toBe('baixado');
    expect(share).not.toHaveBeenCalled();
    expect(baixar).toHaveBeenCalledWith(blob, 'Proposta-000277.pdf');
  });

  it('sem Web Share (desktop antigo): baixa', async () => {
    definir(undefined, undefined);
    await expect(compartilharPdf(blob, 'Proposta-000277.pdf')).resolves.toBe('baixado');
    expect(baixar).toHaveBeenCalledWith(blob, 'Proposta-000277.pdf');
  });

  it('AbortError (o usuário fechou a folha): cancelado, sem erro e sem baixar', async () => {
    definir(vi.fn().mockRejectedValue(new DOMException('cancelado', 'AbortError')), vi.fn().mockReturnValue(true));
    await expect(compartilharPdf(blob, 'Proposta-000277.pdf')).resolves.toBe('cancelado');
    expect(baixar).not.toHaveBeenCalled();
  });

  it('NotAllowedError (o gesto expirou durante a geração): baixa', async () => {
    definir(vi.fn().mockRejectedValue(new DOMException('sem gesto', 'NotAllowedError')), vi.fn().mockReturnValue(true));
    await expect(compartilharPdf(blob, 'Proposta-000277.pdf')).resolves.toBe('baixado');
    expect(baixar).toHaveBeenCalledWith(blob, 'Proposta-000277.pdf');
  });

  it('outra falha do share (ex.: DataError): baixa, para o PDF não se perder', async () => {
    definir(vi.fn().mockRejectedValue(new DOMException('x', 'DataError')), vi.fn().mockReturnValue(true));
    await expect(compartilharPdf(blob, 'Proposta-000277.pdf')).resolves.toBe('baixado');
  });

  it('canShare que lança (navegador recusa o File): baixa', async () => {
    definir(vi.fn(), vi.fn(() => {
      throw new TypeError('files');
    }));
    await expect(compartilharPdf(blob, 'Proposta-000277.pdf')).resolves.toBe('baixado');
  });
});
