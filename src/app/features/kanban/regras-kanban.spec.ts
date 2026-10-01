import casosTexto from '../propostas/casos-transicoes.json' with { loader: 'text' };
import type { Perfil } from '../../core/auth/auth-models';
import { PropostaLocal, StatusProposta, transicoesPermitidas } from '../propostas/proposta-models';
import { acaoDoMovimento, agrupar, colunas, destinos, noPeriodo, podeSoltar, somarTotais } from './regras-kanban';

interface CasoGrade {
  grupo: string;
  de: StatusProposta | null;
  para: StatusProposta;
  perfil: Perfil;
  ehResponsavel: boolean;
  dados: { alteraCampos: boolean; alteraAtribuicao: boolean };
  resultado: string;
}

const casos = (JSON.parse((casosTexto as unknown as string).replace(/\r\n/g, '\n')) as { casos: CasoGrade[] }).casos;

const STATUS: StatusProposta[] = ['RASCUNHO', 'ENVIADA', 'APROVADA', 'EM_EXECUCAO', 'FINALIZADA', 'RECUSADA', 'CANCELADA'];
const PERFIS: Perfil[] = ['ADMIN', 'COMERCIAL', 'TECNICO'];
const EU = 'u-eu';
const OUTRO = 'u-outro';

const p = (status: StatusProposta, responsavelId = EU) => ({ status, responsavelId });

describe('regras-kanban', () => {
  describe('colunas', () => {
    it('as cinco do fluxo; "Mostrar encerradas" acrescenta RECUSADA e CANCELADA', () => {
      expect(colunas(false)).toEqual(['RASCUNHO', 'ENVIADA', 'APROVADA', 'EM_EXECUCAO', 'FINALIZADA']);
      expect(colunas(true)).toEqual(['RASCUNHO', 'ENVIADA', 'APROVADA', 'EM_EXECUCAO', 'FINALIZADA', 'RECUSADA', 'CANCELADA']);
    });
  });

  describe('podeSoltar', () => {
    it('confere com a grade de casos-transicoes.json (perfil × status × posse; o servidor é a referência)', () => {
      const grade = casos.filter(
        (c) => c.grupo === 'grade' && c.de !== null && c.de !== c.para && !c.dados.alteraCampos && !c.dados.alteraAtribuicao,
      );
      // 7 origens × 6 destinos × 3 perfis × 2 posses
      expect(grade.length).toBe(7 * 6 * 3 * 2);
      const divergentes = grade.filter(
        (c) => podeSoltar(p(c.de!, c.ehResponsavel ? EU : OUTRO), c.para, c.perfil, EU) !== (c.resultado === 'OK'),
      );
      expect(divergentes.map((c) => `${c.de}→${c.para} ${c.perfil} ${c.ehResponsavel}`)).toEqual([]);
    });

    it('delega a transicoesPermitidas (com RASCUNHO→ENVIADA, que vira o envio pelo wizard)', () => {
      for (const de of STATUS) {
        for (const perfil of PERFIS) {
          for (const dono of [EU, OUTRO]) {
            const esperado = transicoesPermitidas(de, perfil, dono === EU);
            expect(STATUS.filter((para) => podeSoltar(p(de, dono), para, perfil, EU)), `${de} ${perfil} ${dono}`).toEqual(
              STATUS.filter((s) => esperado.includes(s)),
            );
          }
        }
      }
      expect(podeSoltar(p('RASCUNHO'), 'ENVIADA', 'COMERCIAL', EU)).toBe(true);
    });

    it('soltar na própria coluna não é movimento', () => {
      for (const s of STATUS) expect(podeSoltar(p(s), s, 'ADMIN', EU)).toBe(false);
    });

    it('Review Focus #2: EM_EXECUCAO→CANCELADA só para o ADMIN; o comercial dono só finaliza', () => {
      expect(podeSoltar(p('EM_EXECUCAO'), 'CANCELADA', 'ADMIN', EU)).toBe(true);
      expect(podeSoltar(p('EM_EXECUCAO', OUTRO), 'CANCELADA', 'ADMIN', EU)).toBe(true);
      expect(podeSoltar(p('EM_EXECUCAO'), 'CANCELADA', 'COMERCIAL', EU)).toBe(false);
      expect(podeSoltar(p('EM_EXECUCAO'), 'FINALIZADA', 'COMERCIAL', EU)).toBe(true);
    });

    it('o comercial não move a proposta de outro responsável; o técnico e sem sessão não movem nada', () => {
      for (const para of STATUS) {
        expect(podeSoltar(p('ENVIADA', OUTRO), para, 'COMERCIAL', EU)).toBe(false);
        expect(podeSoltar(p('ENVIADA'), para, 'TECNICO', EU)).toBe(false);
        expect(podeSoltar(p('ENVIADA'), para, null, null)).toBe(false);
        expect(podeSoltar(p('ENVIADA'), para, 'COMERCIAL', null)).toBe(false);
      }
    });

    it('nada sai das encerradas (FINALIZADA, RECUSADA, CANCELADA)', () => {
      for (const de of ['FINALIZADA', 'RECUSADA', 'CANCELADA'] as const) {
        for (const para of STATUS) expect(podeSoltar(p(de), para, 'ADMIN', EU)).toBe(false);
      }
    });
  });

  describe('destinos', () => {
    it('os destinos permitidos, na ordem de transicoesPermitidas', () => {
      expect(destinos(p('ENVIADA'), 'COMERCIAL', EU)).toEqual(['RASCUNHO', 'APROVADA', 'RECUSADA', 'CANCELADA']);
      expect(destinos(p('RASCUNHO'), 'ADMIN', EU)).toEqual(['ENVIADA', 'CANCELADA']);
      expect(destinos(p('EM_EXECUCAO'), 'COMERCIAL', EU)).toEqual(['FINALIZADA']);
      expect(destinos(p('EM_EXECUCAO', OUTRO), 'ADMIN', EU)).toEqual(['FINALIZADA', 'CANCELADA']);
      expect(destinos(p('APROVADA', OUTRO), 'COMERCIAL', EU)).toEqual([]);
      expect(destinos(p('FINALIZADA'), 'ADMIN', EU)).toEqual([]);
      expect(destinos(p('APROVADA'), undefined, undefined)).toEqual([]);
    });
  });

  describe('acaoDoMovimento', () => {
    it('RASCUNHO→ENVIADA vai ao wizard (o envio gera o PDF); RECUSADA e CANCELADA pedem motivo; o resto transiciona', () => {
      expect(acaoDoMovimento('RASCUNHO', 'ENVIADA')).toBe('enviar');
      expect(acaoDoMovimento('ENVIADA', 'RECUSADA')).toBe('motivo');
      expect(acaoDoMovimento('RASCUNHO', 'CANCELADA')).toBe('motivo');
      expect(acaoDoMovimento('EM_EXECUCAO', 'CANCELADA')).toBe('motivo');
      expect(acaoDoMovimento('ENVIADA', 'APROVADA')).toBe('transicionar');
      expect(acaoDoMovimento('ENVIADA', 'RASCUNHO')).toBe('transicionar');
      expect(acaoDoMovimento('APROVADA', 'EM_EXECUCAO')).toBe('transicionar');
    });
  });

  describe('agrupar', () => {
    const item = (id: string, status: StatusProposta, atualizadoEm: string | null) =>
      ({ id, status, atualizadoEm }) as Pick<PropostaLocal, 'id' | 'status' | 'atualizadoEm'>;

    it('uma lista por coluna, por atualizadoEm desc (pelo instante; sem data por último; empate por id desc)', () => {
      const grupos = agrupar(
        [
          item('a', 'ENVIADA', '2026-09-01T10:00:00.000001Z'),
          item('b', 'ENVIADA', null),
          item('c', 'ENVIADA', '2026-09-30T08:00:00Z'),
          item('d', 'ENVIADA', '2026-09-01T10:00:00.5Z'),
          item('e', 'RASCUNHO', '2026-09-02T00:00:00Z'),
          item('f', 'ENVIADA', '2026-09-30T08:00:00Z'),
        ],
        colunas(false),
      );
      expect([...grupos.keys()]).toEqual(colunas(false));
      expect(grupos.get('ENVIADA')!.map((x) => x.id)).toEqual(['f', 'c', 'd', 'a', 'b']);
      expect(grupos.get('RASCUNHO')!.map((x) => x.id)).toEqual(['e']);
      expect(grupos.get('APROVADA')).toEqual([]);
    });

    it('as que não têm coluna visível ficam de fora (encerradas ocultas)', () => {
      const grupos = agrupar([item('a', 'CANCELADA', null), item('b', 'RECUSADA', null)], colunas(false));
      expect([...grupos.values()].flat()).toEqual([]);
      expect(agrupar([item('a', 'CANCELADA', null)], colunas(true)).get('CANCELADA')!.map((x) => x.id)).toEqual(['a']);
    });

    it('não altera a lista recebida', () => {
      const lista = [item('a', 'ENVIADA', null), item('b', 'ENVIADA', '2026-09-30T08:00:00Z')];
      agrupar(lista, colunas(false));
      expect(lista.map((x) => x.id)).toEqual(['a', 'b']);
    });
  });

  describe('somarTotais', () => {
    it('soma os centavos; total ausente conta zero', () => {
      expect(somarTotais([{ totalCentavos: 150000 }, { totalCentavos: null }, { totalCentavos: 99 }])).toBe(150099);
      expect(somarTotais([])).toBe(0);
    });
  });

  describe('noPeriodo', () => {
    it('emissão entre de e até, inclusive; limite vazio é aberto', () => {
      expect(noPeriodo('2026-09-20', '', '')).toBe(true);
      expect(noPeriodo('2026-09-20', '2026-09-20', '2026-09-20')).toBe(true);
      expect(noPeriodo('2026-09-20', '2026-09-21', '')).toBe(false);
      expect(noPeriodo('2026-09-20', '', '2026-09-19')).toBe(false);
      expect(noPeriodo('2026-09-20', '2026-09-01', '2026-09-30')).toBe(true);
      expect(noPeriodo('2026-09-20T00:00:00', '', '2026-09-20')).toBe(true);
    });
  });
});
