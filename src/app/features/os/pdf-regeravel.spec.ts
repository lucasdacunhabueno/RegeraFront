import type { Perfil } from '../../core/auth/auth-models';
import { Pendencia, TIPO_UPLOAD_ANEXO_OS } from '../../core/sync/sync-models';
import { OsDados, OsLocal, paraOsLocal, StatusOs } from './os-models';
import { bloqueioDoPdfOs, concluidaPorOutro, pdfRegeravel, recusaDePdfRegeravel, RECUSAS_PDF_OS_QUE_SE_REGERAM } from './pdf-regeravel';

const TEC = 'u-tec';
const usuario = (perfil: Perfil, id = perfil === 'TECNICO' ? TEC : `u-${perfil.toLowerCase()}`) => ({ id, perfil });

const os = (status: StatusOs = 'CONCLUIDA', extra: Partial<OsDados> = {}): OsLocal =>
  paraOsLocal('o1', 3, {
    codigoProvisorio: 'OSP-AAAAAA', numero: 7, revisao: 1, propostaId: 'p1', clienteId: 'c1', tipo: 'SERVICO', status,
    responsavelId: 'u-comercial', tecnicoId: TEC, urgente: false, concluiProposta: true, assinaturaRecusada: false, itens: [],
    notas: [], historico: [], ...extra,
  });

const concluidaPor = (usuarioId: string, em = '2026-10-01T10:00:00Z') =>
  ({ statusDe: 'EM_ANDAMENTO' as const, statusPara: 'CONCLUIDA' as const, usuarioId, em });

const pendencia = (codigo: string, extra: Partial<Pendencia> = {}): Pendencia => ({
  mutationId: 'up1', entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', tipo: 'REJEITADO', criadaEm: '2026-10-01T10:00:00Z',
  erro: { codigo, mensagem: 'x' },
  mutacao: { mutationId: 'up1', entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', op: 'UPLOAD', baseVersion: null, dados: { anexoId: 'd1' }, criadaEm: '' },
  ...extra,
});

describe('pdf-regeravel', () => {
  describe('concluidaPorOutro (o AnexoOsService sobre o histórico)', () => {
    it('a última conclusão (por data) de outro usuário', () => {
      expect(concluidaPorOutro(os('CONCLUIDA', { historico: [concluidaPor('u-adm')] }), TEC)).toBe(true);
      expect(concluidaPorOutro(os('CONCLUIDA', { historico: [concluidaPor(TEC)] }), TEC)).toBe(false);
      expect(concluidaPorOutro(os('CONCLUIDA', {
        historico: [concluidaPor('u-adm', '2026-10-01T09:00:00Z'), concluidaPor(TEC, '2026-10-01T11:00:00Z')],
      }), TEC)).toBe(false);
      expect(concluidaPorOutro(os(), TEC)).toBe(false);
    });

    it('o registro sem transição (CONCLUIDA → CONCLUIDA) não conta', () => {
      const h = [concluidaPor(TEC), { statusDe: 'CONCLUIDA' as const, statusPara: 'CONCLUIDA' as const, usuarioId: 'u-adm', em: '2026-10-02T00:00:00Z' }];
      expect(concluidaPorOutro(os('CONCLUIDA', { historico: h }), TEC)).toBe(false);
    });
  });

  describe('bloqueioDoPdfOs / pdfRegeravel', () => {
    it.each<[string, { id: string; perfil: Perfil } | null, 'ACESSO' | null]>([
      ['ADMIN', usuario('ADMIN'), null],
      ['técnico atribuído', usuario('TECNICO'), null],
      ['outro técnico', usuario('TECNICO', 'u-tec2'), 'ACESSO'],
      ['COMERCIAL (mesmo o responsável)', usuario('COMERCIAL'), 'ACESSO'],
      ['sem sessão', null, 'ACESSO'],
    ])('quem: %s', (_quem, u, esperado) => {
      expect(bloqueioDoPdfOs(os(), u, [], false)).toBe(esperado);
      expect(pdfRegeravel(os(), u, [], false)).toBe(esperado === null);
    });

    it.each<StatusOs>(['ABERTA', 'EM_ANDAMENTO', 'CANCELADA'])('só a OS concluída (%s não)', (status) => {
      expect(bloqueioDoPdfOs(os(status), usuario('ADMIN'), [], false)).toBe('STATUS');
    });

    it('o técnico com OS_CONCLUIDA_POR_OUTRO em qualquer pendência da OS: não; o ADMIN, sim', () => {
      const recusa = [pendencia('OS_CONCLUIDA_POR_OUTRO')];
      expect(bloqueioDoPdfOs(os(), usuario('TECNICO'), recusa, false)).toBe('CONCLUIDA_POR_OUTRO');
      // mesmo com a conclusão dele na fila: o servidor já disse
      expect(bloqueioDoPdfOs(os(), usuario('TECNICO'), recusa, true)).toBe('CONCLUIDA_POR_OUTRO');
      expect(bloqueioDoPdfOs(os(), usuario('ADMIN'), recusa, false)).toBeNull();
    });

    it('o técnico com o histórico dizendo que outro concluiu: não, salvo com a conclusão dele ainda na fila', () => {
      const porOutro = os('CONCLUIDA', { historico: [concluidaPor('u-adm')] });
      expect(bloqueioDoPdfOs(porOutro, usuario('TECNICO'), [], false)).toBe('CONCLUIDA_POR_OUTRO');
      expect(bloqueioDoPdfOs(porOutro, usuario('TECNICO'), [], true)).toBeNull();
      expect(bloqueioDoPdfOs(porOutro, usuario('ADMIN'), [], false)).toBeNull();
    });
  });

  describe('recusaDePdfRegeravel', () => {
    it.each([...RECUSAS_PDF_OS_QUE_SE_REGERAM])('a recusa %s do PDF da revisão atual', (codigo) => {
      expect(recusaDePdfRegeravel(pendencia(codigo), os(), 1)).toBe(true);
    });

    it('as que gerar de novo não resolve, e outro tipo de pendência', () => {
      for (const codigo of ['REVISAO_INVALIDA', 'STATUS_INVALIDO', 'OS_CONCLUIDA_POR_OUTRO', 'LIMITE_DOCUMENTOS']) {
        expect(recusaDePdfRegeravel(pendencia(codigo), os(), 1), codigo).toBe(false);
      }
      expect(recusaDePdfRegeravel(pendencia('ANEXO_AUSENTE', { tipo: 'CONFLITO' }), os(), 1)).toBe(false);
      expect(recusaDePdfRegeravel(pendencia('ANEXO_AUSENTE', { entidade: 'os' }), os(), 1)).toBe(false);
    });

    it('o PDF de outra revisão (ou um anexo que não é PDF, sem revisão) fica', () => {
      expect(recusaDePdfRegeravel(pendencia('ANEXO_AUSENTE'), os('CONCLUIDA', { revisao: 2 }), 1)).toBe(false);
      expect(recusaDePdfRegeravel(pendencia('ANEXO_AUSENTE'), os('CONCLUIDA', { revisao: 2 }), 2)).toBe(true);
      expect(recusaDePdfRegeravel(pendencia('ANEXO_AUSENTE'), os(), undefined)).toBe(false);
      // sem revisão na OS, conta a 1
      expect(recusaDePdfRegeravel(pendencia('ANEXO_AUSENTE'), os('CONCLUIDA', { revisao: null }), 1)).toBe(true);
    });
  });
});
