// NOTA: casos-transicoes.json precisa ficar IDÊNTICO a RegeraServer/src/test/resources/casos-transicoes.json
// (TransicoesPropostaTest). Ao mudar um, copie para o outro e atualize SHA_CASOS_TRANSICOES nos dois testes.
// Limitação: o SHA só pega uma cópia alterada sozinha. Quem muda o arquivo e o SHA juntos num repo só vê esse
// repo passar; a divergência aparece apenas no teste do outro repo, que continua com o SHA antigo.
import casosTexto from './casos-transicoes.json' with { loader: 'text' };
import type { Perfil } from '../../core/auth/auth-models';
import {
  codigoBase,
  codigoExibido,
  ContextoTransicao,
  dadosDaProposta,
  exigeMotivo,
  motivoValido,
  numeroExibido,
  paraPropostaLocal,
  podeAlterarResponsavel,
  podeAlterarTecnico,
  podeEditar,
  PropostaDados,
  STATUS_PROPOSTA,
  StatusProposta,
  stripJava,
  terminal,
  transicoesPermitidas,
  validarTransicao,
} from './proposta-models';

/** SHA-256 do arquivo com fins de linha normalizados para LF. O teste Java tem a mesma constante. */
const SHA_CASOS_TRANSICOES = 'e37d109d94fafdf07befd06242a01fc4dced43c04ac08389e7b925a0f534581a';

interface CasoTransicao {
  grupo: string;
  de: StatusProposta | null;
  para: StatusProposta;
  perfil: Perfil;
  ehResponsavel: boolean;
  dados: ContextoTransicao;
  resultado: string;
  campos?: string[];
}

const texto = (casosTexto as unknown as string).replace(/\r\n/g, '\n');
const casos = (JSON.parse(texto) as { casos: CasoTransicao[] }).casos;

const STATUS: StatusProposta[] = ['RASCUNHO', 'ENVIADA', 'APROVADA', 'EM_EXECUCAO', 'FINALIZADA', 'RECUSADA', 'CANCELADA'];
const PERFIS: Perfil[] = ['ADMIN', 'COMERCIAL', 'TECNICO'];

const ID = '0190a000-0000-7000-8000-000000000001';

function dadosAdmin(): PropostaDados {
  return {
    codigoProvisorio: 'PROV-0Z9XY7',
    numero: 277,
    revisao: 2,
    tipo: 'LOCACAO',
    status: 'ENVIADA',
    clienteId: 'c1',
    templateId: 't1',
    responsavelId: 'u1',
    tecnicoId: 'u3',
    dataEmissao: '2026-10-01',
    validadeAte: '2026-10-31',
    condicoesPagamento: '30 dias',
    prazoExecucao: '10 dias',
    observacoes: 'Obs.',
    descontoGeralPercentual: 12.5,
    totalItens: 1999999999999.98,
    totalDescontos: 250000000000,
    total: 1749999999999.98,
    motivoEncerramento: null,
    itens: [
      {
        id: 'l1', itemCatalogoId: 'i1', codigo: 'GER-1', nome: 'Gerador', descricao: null, unidade: 'un', natureza: 'PRODUTO',
        precoCusto: 0.07, quantidade: 1.333, precoUnitario: 999999999999.99, descontoPercentual: 33.33, meses: 12,
        subtotal: 1999999999999.98, ordem: 0,
      },
      {
        id: 'l2', itemCatalogoId: 'i2', codigo: 'SRV-1', nome: 'Instalação', descricao: 'Montagem', unidade: 'h', natureza: 'SERVICO',
        precoCusto: 0, quantidade: 999999.999, precoUnitario: 0, descontoPercentual: 0, meses: null, subtotal: 0, ordem: 1,
      },
    ],
    historico: [{ statusDe: null, statusPara: 'RASCUNHO', usuarioId: 'u1', em: '2026-10-01T10:00:00Z', observacao: null }],
    documentos: [{ id: 'd1', revisao: 1, codigoExibido: '000277', arquivoId: 'a1', sha256: 'ab'.repeat(32), geradoEm: '2026-10-01T11:00:00Z', geradoPor: 'u1' }],
    atualizadoEm: '2026-10-01T12:34:56.123456Z',
  };
}

describe('proposta-models', () => {
  describe('validarTransicao: casos compartilhados com o TransicoesProposta do servidor', () => {
    it('o arquivo é o mesmo do servidor (SHA_CASOS_TRANSICOES)', async () => {
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
      expect([...hash].map((b) => b.toString(16).padStart(2, '0')).join('')).toBe(SHA_CASOS_TRANSICOES);
    });

    it('tem os casos esperados', () => {
      expect(casos.length).toBeGreaterThan(1500);
    });

    it('todos os casos dão o resultado do servidor (código e campos, na ordem)', () => {
      const falhas: string[] = [];
      casos.forEach((c, n) => {
        const erro = validarTransicao(c.de, c.para, c.perfil, c.ehResponsavel, c.dados);
        const nome = `${n} ${c.grupo}: ${c.de} -> ${c.para}, ${c.perfil}${c.ehResponsavel ? ' responsável' : ''} ${JSON.stringify(c.dados)}`;
        if (c.resultado === 'OK') {
          if (erro !== null) falhas.push(`${nome}: esperado OK, veio ${erro.codigo}`);
          return;
        }
        if (erro === null) {
          falhas.push(`${nome}: esperado ${c.resultado}, veio OK`);
          return;
        }
        if (erro.codigo !== c.resultado) falhas.push(`${nome}: esperado ${c.resultado}, veio ${erro.codigo}`);
        if (!erro.mensagem.trim()) falhas.push(`${nome}: sem mensagem`);
        if (c.resultado === 'VALIDACAO') {
          if (JSON.stringify(Object.keys(erro.campos ?? {})) !== JSON.stringify(c.campos)) {
            falhas.push(`${nome}: campos ${JSON.stringify(Object.keys(erro.campos ?? {}))} != ${JSON.stringify(c.campos)}`);
          }
        } else if (erro.campos !== undefined) {
          falhas.push(`${nome}: campos inesperados`);
        }
      });
      expect(falhas).toEqual([]);
    });
  });

  describe('transicoesPermitidas', () => {
    it('é exatamente o conjunto de destinos que a validação aceitaria com dados completos', () => {
      const completo: ContextoTransicao = {
        temCliente: true, temTemplate: true, itens: 1, motivo: 'Motivo suficiente', alteraCampos: false, alteraAtribuicao: false,
      };
      for (const de of STATUS) {
        for (const perfil of PERFIS) {
          for (const eh of [true, false]) {
            const esperado = STATUS.filter((para) => para !== de && validarTransicao(de, para, perfil, eh, completo) === null);
            expect([...transicoesPermitidas(de, perfil, eh)].sort(), `${de} ${perfil} ${eh}`).toEqual(esperado.sort());
          }
        }
      }
    });

    it('exemplos da tabela do §8', () => {
      expect(transicoesPermitidas('RASCUNHO', 'COMERCIAL', true)).toEqual(['ENVIADA', 'CANCELADA']);
      expect(transicoesPermitidas('ENVIADA', 'ADMIN', false)).toEqual(['RASCUNHO', 'APROVADA', 'RECUSADA', 'CANCELADA']);
      expect(transicoesPermitidas('EM_EXECUCAO', 'COMERCIAL', true)).toEqual(['FINALIZADA']);
      expect(transicoesPermitidas('EM_EXECUCAO', 'ADMIN', false)).toEqual(['FINALIZADA', 'CANCELADA']);
      expect(transicoesPermitidas('ENVIADA', 'COMERCIAL', false)).toEqual([]);
      expect(transicoesPermitidas('ENVIADA', 'TECNICO', true)).toEqual([]);
      for (const s of ['FINALIZADA', 'RECUSADA', 'CANCELADA'] as const) expect(transicoesPermitidas(s, 'ADMIN', true)).toEqual([]);
    });
  });

  it('motivoValido tira das pontas o mesmo que o String.strip() do Java', () => {
    const c = (...codigos: number[]) => String.fromCharCode(...codigos);
    expect(motivoValido(null)).toBe(false);
    expect(motivoValido(`${c(0x3000, 0x2028, 0x1f)}ab${c(0x205f, 0x0b)}`)).toBe(false);
    expect(motivoValido(`${c(0x2003)}abc${c(0x2003)}`)).toBe(true);
    // não separáveis não são espaço para o Java: contam no tamanho
    expect(motivoValido(`${c(0xa0)}ab`)).toBe(true);
    expect(motivoValido(`${c(0x2007)}ab`)).toBe(true);
    expect(motivoValido(`ab${c(0x202f)}`)).toBe(true);
    expect(motivoValido('x'.repeat(500))).toBe(true);
    expect(motivoValido(` ${'x'.repeat(500)}${c(0x0a)}`)).toBe(true);
    expect(motivoValido('x'.repeat(501))).toBe(false);
  });

  it('podeEditar só em RASCUNHO; terminal e exigeMotivo', () => {
    expect(STATUS.filter(podeEditar)).toEqual(['RASCUNHO']);
    expect(STATUS.filter(terminal)).toEqual(['FINALIZADA', 'RECUSADA', 'CANCELADA']);
    expect(STATUS.filter(exigeMotivo)).toEqual(['RECUSADA', 'CANCELADA']);
  });

  it('atribuição (P4b-R3): responsável só o ADMIN; técnico o ADMIN ou o responsável; nunca em status terminal', () => {
    for (const s of STATUS) {
      const aberta = !terminal(s);
      expect(podeAlterarResponsavel(s, 'ADMIN'), s).toBe(aberta);
      expect(podeAlterarResponsavel(s, 'COMERCIAL'), s).toBe(false);
      expect(podeAlterarResponsavel(s, 'TECNICO'), s).toBe(false);
      expect(podeAlterarTecnico(s, 'ADMIN', false), s).toBe(aberta);
      expect(podeAlterarTecnico(s, 'COMERCIAL', true), s).toBe(aberta);
      expect(podeAlterarTecnico(s, 'COMERCIAL', false), s).toBe(false);
      expect(podeAlterarTecnico(s, 'TECNICO', true), s).toBe(false);
    }
  });

  it('cada status tem rótulo e cor', () => {
    expect(Object.keys(STATUS_PROPOSTA).sort()).toEqual([...STATUS].sort());
    expect(STATUS_PROPOSTA.EM_EXECUCAO.rotulo).toBe('Em execução');
    expect(STATUS_PROPOSTA.RASCUNHO.rotulo).toBe('Rascunho');
    for (const s of STATUS) {
      expect(STATUS_PROPOSTA[s].rotulo.length, s).toBeGreaterThan(0);
      expect(STATUS_PROPOSTA[s].cor, s).toMatch(/^bg-\S+ text-\S+$/);
    }
    expect(new Set(STATUS.map((s) => STATUS_PROPOSTA[s].cor)).size).toBeGreaterThan(4);
  });

  it('numeração: 6 dígitos, -R<n> quando revisão > 1; sem número, o PROV', () => {
    expect(numeroExibido(277, 1)).toBe('000277');
    expect(numeroExibido(277, null)).toBe('000277');
    expect(numeroExibido(277, 2)).toBe('000277-R2');
    expect(numeroExibido(1234567, 3)).toBe('1234567-R3');
    expect(codigoExibido({ numero: 277, revisao: 2, codigoProvisorio: 'PROV-0Z9XY7' })).toBe('000277-R2');
    expect(codigoExibido({ numero: null, revisao: null, codigoProvisorio: 'PROV-0Z9XY7' })).toBe('PROV-0Z9XY7');
  });

  it('stripJava: tira só o que o Character.isWhitespace do Java aceita (NBSP e U+2007 ficam)', () => {
    expect(stripJava(' \u00A0ab\u2007\t')).toBe('\u00A0ab\u2007');
    expect(stripJava('\u2003\u3000\u2028ab\u205F\u001C')).toBe('ab');
    expect(stripJava('\u0085x')).toBe('\u0085x'); // NEL não é whitespace no Java
    expect(stripJava('   ')).toBe('');
  });

  it('P4b-R18: o PROV também leva -R<n> na revisão > 1 (como codigosExibidos do servidor); a base não leva', () => {
    expect(codigoExibido({ numero: null, revisao: 2, codigoProvisorio: 'PROV-0Z9XY7' })).toBe('PROV-0Z9XY7-R2');
    expect(codigoExibido({ numero: null, revisao: 1, codigoProvisorio: 'PROV-0Z9XY7' })).toBe('PROV-0Z9XY7');
    expect(codigoBase({ numero: 277, codigoProvisorio: 'PROV-0Z9XY7' })).toBe('000277');
    expect(codigoBase({ numero: null, codigoProvisorio: 'PROV-0Z9XY7' })).toBe('PROV-0Z9XY7');
  });

  describe('dados ↔ PropostaLocal', () => {
    it('ADMIN: valores em centavos, milésimos e centésimos inteiros, e volta igual', () => {
      const d = dadosAdmin();
      const p = paraPropostaLocal(ID, 5, d);
      expect(p.id).toBe(ID);
      expect(p.version).toBe(5);
      expect(p.descontoGeralCentesimos).toBe(1250);
      expect(p.totalItensCentavos).toBe(199999999999998);
      expect(p.totalDescontosCentavos).toBe(25000000000000);
      expect(p.totalCentavos).toBe(174999999999998);
      expect(p.itens[0]).toEqual({
        id: 'l1', itemCatalogoId: 'i1', codigo: 'GER-1', nome: 'Gerador', descricao: null, unidade: 'un', natureza: 'PRODUTO',
        precoCustoCentavos: 7, quantidadeMilesimos: 1333, precoUnitarioCentavos: 99999999999999, descontoCentesimos: 3333,
        meses: 12, subtotalCentavos: 199999999999998, ordem: 0,
      });
      expect(p.itens[1].quantidadeMilesimos).toBe(999999999);
      expect(p.historico).toEqual(d.historico);
      expect(p.documentos).toEqual(d.documentos);
      expect(p.atualizadoEm).toBe('2026-10-01T12:34:56.123456Z');
      expect(dadosDaProposta(p)).toEqual(d);
      // na rede, os decimais saem exatos (sem resíduo de float)
      expect(JSON.stringify(dadosDaProposta(p).itens[0])).toContain('"quantidade":1.333,"precoUnitario":999999999999.99,"descontoPercentual":33.33');
    });

    it('COMERCIAL: sem custo (chave ausente = null)', () => {
      const d = dadosAdmin();
      d.itens.forEach((i) => delete i.precoCusto);
      const p = paraPropostaLocal(ID, 1, d);
      expect(p.itens.map((i) => i.precoCustoCentavos)).toEqual([null, null]);
      expect(p.itens[0].precoUnitarioCentavos).toBe(99999999999999);
    });

    it('TECNICO: sem nenhum valor e sem documentos', () => {
      const d = dadosAdmin() as Partial<PropostaDados> & PropostaDados;
      delete d.condicoesPagamento;
      delete d.descontoGeralPercentual;
      delete d.totalItens;
      delete d.totalDescontos;
      delete d.total;
      d.documentos = [];
      d.itens.forEach((i) => {
        delete i.precoCusto;
        delete i.precoUnitario;
        delete i.descontoPercentual;
        delete i.subtotal;
      });
      const p = paraPropostaLocal(ID, 1, d);
      expect(p.condicoesPagamento).toBeNull();
      expect([p.descontoGeralCentesimos, p.totalItensCentavos, p.totalDescontosCentavos, p.totalCentavos]).toEqual([null, null, null, null]);
      expect(p.itens[0]).toMatchObject({ precoCustoCentavos: null, precoUnitarioCentavos: null, descontoCentesimos: null, subtotalCentavos: null });
      expect(p.itens[0].quantidadeMilesimos).toBe(1333);
      expect(p.documentos).toEqual([]);
    });

    it('chaves ausentes viram null e listas ausentes viram []', () => {
      const p = paraPropostaLocal(ID, null, {
        codigoProvisorio: 'PROV-0Z9XY7', tipo: 'VENDA', status: 'RASCUNHO', responsavelId: 'u1', dataEmissao: '2026-10-01',
        descontoGeralPercentual: 0, itens: [{ id: 'l1', itemCatalogoId: 'i1', quantidade: 2, precoUnitario: 10, descontoPercentual: 0 }],
      } as PropostaDados);
      expect(p).toMatchObject({
        numero: null, revisao: null, clienteId: null, templateId: null, tecnicoId: null, validadeAte: null,
        condicoesPagamento: null, prazoExecucao: null, observacoes: null, totalItensCentavos: null, motivoEncerramento: null,
        historico: [], documentos: [], descontoGeralCentesimos: 0, atualizadoEm: null,
      });
      expect(p.itens[0]).toMatchObject({ codigo: null, nome: null, meses: null, subtotalCentavos: null, ordem: null, quantidadeMilesimos: 2000 });
      const volta = dadosDaProposta(p);
      expect(volta.numero).toBeNull();
      expect(volta.itens[0]).toMatchObject({ quantidade: 2, precoUnitario: 10, descontoPercentual: 0, meses: null });
    });

    it('aceita decimais como string (BigDecimal serializado como texto)', () => {
      const d = dadosAdmin() as unknown as Record<string, unknown>;
      d['descontoGeralPercentual'] = '12.50';
      d['total'] = '1749999999999.98';
      const p = paraPropostaLocal(ID, 1, d as unknown as PropostaDados);
      expect(p.descontoGeralCentesimos).toBe(1250);
      expect(p.totalCentavos).toBe(174999999999998);
    });
  });
});
