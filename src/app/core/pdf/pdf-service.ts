import { inject, Injectable } from '@angular/core';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { EmpresaLocal } from '../../features/empresa/empresa-models';
import { ArquivosService } from '../arquivos/arquivos-service';
import { gerarDocumento } from './gerar-documento';
import { EntradaPdf } from './pdf-models';

interface PdfMake {
  createPdf(dd: TDocumentDefinitions): { getBlob(): Promise<Blob> };
}

/** O pdfmake só lê PNG e JPEG (`image/jpg` é um mime não padrão, mas comum, para JPEG). */
const LOGO_SUPORTADA = /^data:image\/(png|jpe?g);base64,/i;

/** Gera o PDF no aparelho. O pdfmake (~1 MB com as fontes) é carregado sob demanda, num chunk lazy, e fica em cache. */
@Injectable({ providedIn: 'root' })
export class PdfService {
  private readonly arquivos = inject(ArquivosService);
  private modulo?: Promise<PdfMake>;

  async gerarBlob(e: EntradaPdf): Promise<Blob> {
    const pdfMake = await this.carregar();
    return pdfMake.createPdf(gerarDocumento(e)).getBlob();
  }

  /** Logo da empresa como data URL (do cache local, ou baixada se houver internet); null se não houver ou não servir. */
  async logoDataUrl(empresa: EmpresaLocal | null): Promise<string | null> {
    const id = empresa?.logoArquivoId;
    if (!id) return null;
    const url = await this.arquivos.obterDataUrl(id);
    return url && LOGO_SUPORTADA.test(url) ? url : null;
  }

  private carregar(): Promise<PdfMake> {
    if (!this.modulo) {
      const p = (async () => {
        const [pdfMake, vfs] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
        const pm = (pdfMake as unknown as { default?: unknown }).default ?? pdfMake;
        const fontes = (vfs as unknown as { default?: unknown }).default ?? vfs;
        (pm as { addVirtualFileSystem(v: unknown): void }).addVirtualFileSystem(fontes);
        return pm as PdfMake;
      })();
      this.modulo = p;
      // falha de carga (ex.: chunk ausente offline) não fica em cache: a próxima tentativa carrega de novo
      p.catch(() => {
        if (this.modulo === p) this.modulo = undefined;
      });
    }
    return this.modulo;
  }
}
