import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { paraEmpresaLocal } from '../../features/empresa/empresa-models';
import { ArquivosService } from '../arquivos/arquivos-service';
import { entradaFicticia } from './dados-ficticios';
import { PdfService } from './pdf-service';

const pdf = vi.hoisted(() => {
  const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
  const getBlob = vi.fn(async () => blob);
  const createPdf = vi.fn<(dd: unknown) => { getBlob: typeof getBlob }>(() => ({ getBlob }));
  const addVirtualFileSystem = vi.fn();
  const carregamentos = { pdfmake: 0, vfs: 0 };
  return { blob, getBlob, createPdf, addVirtualFileSystem, carregamentos };
});

vi.mock('pdfmake/build/pdfmake', () => {
  pdf.carregamentos.pdfmake++;
  return { default: { createPdf: pdf.createPdf, addVirtualFileSystem: pdf.addVirtualFileSystem } };
});
vi.mock('pdfmake/build/vfs_fonts', () => {
  pdf.carregamentos.vfs++;
  return { default: { 'Roboto-Regular.ttf': 'AAAA' } };
});

describe('PdfService', () => {
  const obterDataUrl = vi.fn<(id: string) => Promise<string | null>>();
  let svc: PdfService;

  beforeEach(() => {
    obterDataUrl.mockReset();
    TestBed.configureTestingModule({ providers: [{ provide: ArquivosService, useValue: { obterDataUrl } }] });
    svc = TestBed.inject(PdfService);
  });

  it('gerarBlob carrega o pdfmake sob demanda uma vez só e chama createPdf(dd).getBlob()', async () => {
    const e = entradaFicticia([], null, null);
    const b1 = await svc.gerarBlob(e);
    const b2 = await svc.gerarBlob(e);
    expect(b1).toBe(pdf.blob);
    expect(b2).toBe(pdf.blob);
    expect(pdf.carregamentos).toEqual({ pdfmake: 1, vfs: 1 });
    expect(pdf.addVirtualFileSystem).toHaveBeenCalledTimes(1);
    expect(pdf.addVirtualFileSystem).toHaveBeenCalledWith({ 'Roboto-Regular.ttf': 'AAAA' });
    expect(pdf.createPdf).toHaveBeenCalledTimes(2);
    expect(pdf.createPdf.mock.calls[0][0]).toMatchObject({ pageSize: 'A4', watermark: { text: 'PRÉVIA' } });
    expect(pdf.getBlob).toHaveBeenCalledTimes(2);
  });

  it('falha na carga do pdfmake não fica em cache: a chamada seguinte tenta de novo e funciona', async () => {
    pdf.addVirtualFileSystem.mockClear();
    pdf.createPdf.mockClear();
    pdf.addVirtualFileSystem.mockImplementationOnce(() => {
      throw new Error('chunk indisponível');
    });
    const e = entradaFicticia([], null, null);
    await expect(svc.gerarBlob(e)).rejects.toThrow('chunk indisponível');
    expect(pdf.createPdf).not.toHaveBeenCalled();
    await expect(svc.gerarBlob(e)).resolves.toBe(pdf.blob);
    expect(pdf.addVirtualFileSystem).toHaveBeenCalledTimes(2);
    expect(pdf.createPdf).toHaveBeenCalledTimes(1);
  });

  it('logoDataUrl usa ArquivosService.obterDataUrl com o id da logo', async () => {
    obterDataUrl.mockResolvedValue('data:image/png;base64,AAAA');
    const empresa = paraEmpresaLocal('e', 1, { razaoSocial: 'X', logoArquivoId: 'logo1' });
    expect(await svc.logoDataUrl(empresa)).toBe('data:image/png;base64,AAAA');
    expect(obterDataUrl).toHaveBeenCalledWith('logo1');
  });

  it('logoDataUrl devolve null sem empresa, sem logo, sem bytes ou com formato que o pdfmake não lê', async () => {
    expect(await svc.logoDataUrl(null)).toBeNull();
    expect(await svc.logoDataUrl(paraEmpresaLocal('e', 1, { razaoSocial: 'X' }))).toBeNull();
    expect(obterDataUrl).not.toHaveBeenCalled();

    const empresa = paraEmpresaLocal('e', 1, { razaoSocial: 'X', logoArquivoId: 'logo1' });
    obterDataUrl.mockResolvedValueOnce(null);
    expect(await svc.logoDataUrl(empresa)).toBeNull();
    obterDataUrl.mockResolvedValueOnce('data:image/webp;base64,AAAA');
    expect(await svc.logoDataUrl(empresa)).toBeNull();
    obterDataUrl.mockResolvedValueOnce('data:image/jpeg;base64,/9j/');
    expect(await svc.logoDataUrl(empresa)).toBe('data:image/jpeg;base64,/9j/');
    obterDataUrl.mockResolvedValueOnce('data:image/jpg;base64,/9j/');
    expect(await svc.logoDataUrl(empresa)).toBe('data:image/jpg;base64,/9j/');
    obterDataUrl.mockResolvedValueOnce('data:IMAGE/PNG;base64,iVBO');
    expect(await svc.logoDataUrl(empresa)).toBe('data:IMAGE/PNG;base64,iVBO');
    obterDataUrl.mockResolvedValueOnce('data:image/svg+xml;base64,PHN2Zz4=');
    expect(await svc.logoDataUrl(empresa)).toBeNull();
  });
});
