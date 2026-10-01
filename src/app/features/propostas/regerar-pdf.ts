import { EntradaPdf } from '../../core/pdf/pdf-models';
import { arquivoPdf } from './compartilhar';

/** O que "Gerar PDF novamente" precisa do repositório e do `PdfService` (testável sem os dois). */
interface Regerador {
  regerarDocumento(id: string, gerarPdf: (entrada: EntradaPdf) => Promise<Blob>): Promise<{ blob: Blob; codigoExibido: string }>;
}
interface GeradorDePdf {
  gerarBlob(entrada: EntradaPdf): Promise<Blob>;
}

/**
 * "Gerar PDF novamente" (P4b-R13), a parte comum do detalhe da proposta e das Pendências: `regerarDocumento` (que troca
 * o documento e reenfileira o upload) e o PDF como `File`, com o código impresso nele no nome. Quem chama compartilha
 * (`compartilharArquivo`) e trata o `precisa-toque` com o painel "PDF pronto".
 */
export async function regerarPdf(repo: Regerador, pdf: GeradorDePdf, id: string): Promise<{ arquivo: File; blob: Blob }> {
  const { blob, codigoExibido } = await repo.regerarDocumento(id, (entrada) => pdf.gerarBlob(entrada));
  return { arquivo: arquivoPdf(blob, `Proposta-${codigoExibido}.pdf`), blob };
}
