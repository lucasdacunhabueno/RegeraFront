import type { Perfil } from '../../core/auth/auth-models';
import { type Pendencia, TIPO_UPLOAD_ANEXO_OS } from '../../core/sync/sync-models';
import type { OsLocal } from './os-models';

/**
 * Quando o PDF da OS pode ser gerado de novo (M2P2-R18): uma regra só, usada pelo `OsRepo.regerarPdf`
 * (`exigirPdfPossivel`), pela tela da OS (`motivoParaRegerarOs`) e pelas Pendências. Funções puras.
 */

/**
 * As recusas do upload do PDF que gerar de novo resolve: o código impresso mudou (o `OSP-` trocado, a numeração que
 * chegou) ou o arquivo sumiu do aparelho. `REVISAO_INVALIDA` e `STATUS_INVALIDO` (a OS reaberta lá) e
 * `OS_CONCLUIDA_POR_OUTRO` não se resolvem assim.
 */
export const RECUSAS_PDF_OS_QUE_SE_REGERAM: ReadonlySet<string> = new Set(['CODIGO_EXIBIDO_INVALIDO', 'ANEXO_AUSENTE']);

/**
 * O `concluidaPorOutro` do `AnexoOsService` sobre o histórico do servidor: a última transição para CONCLUIDA (por data;
 * no empate, a que vem depois na ordem do pull) foi de outro usuário. Os registros sem transição não contam.
 */
export function concluidaPorOutro(os: Pick<OsLocal, 'historico'>, usuarioId: string): boolean {
  let ultima: OsLocal['historico'][number] | undefined;
  for (const h of os.historico) {
    if (h.statusPara !== 'CONCLUIDA' || h.statusDe === 'CONCLUIDA') continue;
    if (!ultima || h.em >= ultima.em) ultima = h;
  }
  return !!ultima && ultima.usuarioId !== usuarioId;
}

/** Por que não dá para gerar o PDF de novo: quem (`ACESSO`), o status (`STATUS`) ou outro concluiu (`CONCLUIDA_POR_OUTRO`). */
export type BloqueioPdfOs = 'ACESSO' | 'STATUS' | 'CONCLUIDA_POR_OUTRO';

/**
 * Por que `usuario` não gera de novo o PDF da OS; null = pode. Na ordem:
 * - quem executa: o ADMIN ou o técnico atribuído (`ACESSO`);
 * - a OS concluída (`STATUS`);
 * - o TECNICO, não se o servidor disse que outro usuário concluiu a OS (o PDF dele voltaria 403
 *   `OS_CONCLUIDA_POR_OUTRO`, M2P1-R28/R29): a pendência com esse código, ou o histórico (`concluidaPorOutro`), que só
 *   vale com a conclusão deste aparelho fora da fila (`conclusaoNaFila` false; com ela na fila, a última conclusão no
 *   servidor vai ser a dele). O repositório sabe da fila; a tela usa `concluidaEm` null (a conclusão daqui que o
 *   servidor ainda não devolveu).
 */
export function bloqueioDoPdfOs(
  os: Pick<OsLocal, 'status' | 'tecnicoId' | 'historico'>,
  usuario: { id: string; perfil: Perfil } | null | undefined,
  pendencias: readonly Pendencia[],
  conclusaoNaFila: boolean,
): BloqueioPdfOs | null {
  if (!usuario || !(usuario.perfil === 'ADMIN' || (usuario.perfil === 'TECNICO' && os.tecnicoId === usuario.id))) return 'ACESSO';
  if (os.status !== 'CONCLUIDA') return 'STATUS';
  if (usuario.perfil === 'TECNICO') {
    const recusado = pendencias.some((x) => x.erro?.codigo === 'OS_CONCLUIDA_POR_OUTRO');
    if (recusado || (!conclusaoNaFila && concluidaPorOutro(os, usuario.id))) return 'CONCLUIDA_POR_OUTRO';
  }
  return null;
}

/** `bloqueioDoPdfOs` sem bloqueio. */
export function pdfRegeravel(
  os: Pick<OsLocal, 'status' | 'tecnicoId' | 'historico'>,
  usuario: { id: string; perfil: Perfil } | null | undefined,
  pendencias: readonly Pendencia[],
  conclusaoNaFila: boolean,
): boolean {
  return bloqueioDoPdfOs(os, usuario, pendencias, conclusaoNaFila) === null;
}

/**
 * A pendência é a recusa do upload de um PDF da revisão atual da OS que gerar de novo resolve
 * (`RECUSAS_PDF_OS_QUE_SE_REGERAM`). `revisaoDoAnexo`: a revisão do PDF da pendência (undefined se o anexo não é um
 * PDF deste aparelho); sem revisão na OS, conta a 1, como o `pdfsATrocar`.
 */
export function recusaDePdfRegeravel(p: Pendencia, os: Pick<OsLocal, 'revisao'>, revisaoDoAnexo: number | undefined): boolean {
  return p.tipo === 'REJEITADO' && p.entidade === TIPO_UPLOAD_ANEXO_OS && RECUSAS_PDF_OS_QUE_SE_REGERAM.has(p.erro?.codigo ?? '')
    && revisaoDoAnexo !== undefined && revisaoDoAnexo === (os.revisao ?? 1);
}
