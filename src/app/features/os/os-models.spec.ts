// NOTA: casos-transicoes-os.json e casos-edicao-os.json precisam ficar IDÊNTICOS aos de RegeraServer/src/test/resources
// (TransicoesOsTest e EdicaoOsTest). Ao regenerar um, copie para o outro repo e atualize SHA_CASOS_TRANSICOES_OS /
// SHA_CASOS_EDICAO_OS nos dois testes. Limitação: o SHA só pega uma cópia alterada sozinha. Quem muda o arquivo e o SHA
// juntos num repo só vê esse repo passar; a divergência aparece apenas no teste do outro repo, que tem o SHA antigo.
import casosTransicoesTexto from './casos-transicoes-os.json' with { loader: 'text' };
import casosEdicaoTexto from './casos-edicao-os.json' with { loader: 'text' };
import type { Perfil } from '../../core/auth/auth-models';
import type { ErroMutacao } from '../../core/sync/sync-models';
import {
  CAMPOS_EDICAO_OS,
  CampoEdicaoOs,
  camposEditaveisOs,
  codigoOsBase,
  codigoOsExibido,
  ContextoTransicaoOs,
  corStatusOs,
  dadosDaOs,
  OsDados,
  paraOsLocal,
  podeEditarCabecalho,
  podeExecutar,
  rotuloStatusOs,
  rotuloTipoOs,
  STATUS_OS,
  StatusOs,
  tamanhoTextoOs,
  TIPOS_OS,
  transicoesPermitidasOs,
  validarEdicaoOs,
  validarMutacaoOs,
  validarTransicaoOs,
} from './os-models';

/** SHA-256 dos arquivos com fins de linha normalizados para LF. Os testes Java têm as mesmas constantes. */
const SHA_CASOS_TRANSICOES_OS = 'aed65ce71c5da769d0d40cfb090145fcb30adf4dbb494a72a3fa96726aac0e5e';
const SHA_CASOS_EDICAO_OS = 'a29d3e470561ab58082b888efc63d056a22d991830e23680e8d4548338ab4722';

interface CasoTransicaoOs {
  grupo: string;
  de: StatusOs | null;
  para: StatusOs;
  perfil: Perfil;
  ehResponsavel: boolean;
  ehTecnicoAtribuido: boolean;
  dados: ContextoTransicaoOs;
  resultado: string;
  campos?: string[];
}

interface PermitidasOs {
  de: StatusOs | null;
  perfil: Perfil;
  ehResponsavel: boolean;
  ehTecnicoAtribuido: boolean;
  permitidas: StatusOs[];
}

interface CasoEdicaoOs {
  grupo: string;
  statusServidor: StatusOs | null;
  statusDestino: StatusOs;
  perfil: Perfil;
  ehResponsavel: boolean;
  ehTecnicoAtribuido: boolean;
  camposAlterados: CampoEdicaoOs[];
  resultado: string;
  campos?: string[];
}

const lf = (t: unknown) => (t as string).replace(/\r\n/g, '\n');
const textoTransicoes = lf(casosTransicoesTexto);
const textoEdicao = lf(casosEdicaoTexto);
const arquivoTransicoes = JSON.parse(textoTransicoes) as { casos: CasoTransicaoOs[]; permitidas: PermitidasOs[] };
const arquivoEdicao = JSON.parse(textoEdicao) as { campos: string[]; casos: CasoEdicaoOs[] };

const STATUS: StatusOs[] = ['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'];
const PERFIS: Perfil[] = ['ADMIN', 'COMERCIAL', 'TECNICO'];
const POSSES: [boolean, boolean][] = [[true, true], [true, false], [false, true], [false, false]];

/** O `completo` do `TransicoesOsTest.permitidasCompartilhadas`. */
const COMPLETO: ContextoTransicaoOs = {
  temTecnico: true, resumoExecucao: 'Resumo da execução', temAssinatura: true, assinaturaRecusada: false,
  motivoRecusa: null, motivo: 'Motivo informado',
};

async function sha256(texto: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compara o erro com o resultado esperado de um caso; devolve a descrição da falha ou null. */
function divergencia(erro: ErroMutacao | null, resultado: string, campos: string[] | undefined, comCampos: string): string | null {
  if (resultado === 'OK') return erro === null ? null : `esperado OK, veio ${erro.codigo} ${JSON.stringify(erro.campos)}`;
  if (erro === null) return `esperado ${resultado}, veio OK`;
  if (erro.codigo !== resultado) return `esperado ${resultado}, veio ${erro.codigo}`;
  if (!erro.mensagem.trim()) return 'sem mensagem';
  if (resultado === comCampos) {
    const chaves = Object.keys(erro.campos ?? {});
    if (JSON.stringify(chaves) !== JSON.stringify(campos)) return `campos ${JSON.stringify(chaves)} != ${JSON.stringify(campos)}`;
    if (Object.values(erro.campos ?? {}).some((m) => !m.trim())) return 'campo sem mensagem';
  } else if (erro.campos !== undefined) {
    return 'campos inesperados';
  }
  return null;
}

const ID = '0190a000-0000-7000-8000-0000000000a1';

function dadosCompletos(): OsDados {
  return {
    codigoProvisorio: 'OSP-0Z9XY7',
    numero: 123,
    revisao: 2,
    propostaId: 'p1',
    clienteId: 'c1',
    tipo: 'INSTALACAO',
    status: 'EM_ANDAMENTO',
    responsavelId: 'u1',
    tecnicoId: 'u3',
    dataPrevista: '2026-10-10',
    urgente: true,
    descricao: 'Instalar o gerador',
    enderecoCep: '01001000',
    enderecoLogradouro: 'Praça da Sé',
    enderecoNumero: '1',
    enderecoComplemento: 'Sala 2',
    enderecoBairro: 'Sé',
    enderecoCidade: 'São Paulo',
    enderecoUf: 'SP',
    iniciadaEm: '2026-10-10T12:00:00.123456Z',
    concluidaEm: null,
    resumoExecucao: 'Troca do disjuntor',
    motivoCancelamento: null,
    assinaturaAnexoId: 'a2',
    assinanteNome: 'Maria',
    assinantePapel: 'Síndica',
    assinadaEm: '2026-10-10T13:00:00Z',
    assinaturaRecusada: false,
    motivoRecusa: null,
    itens: [
      { id: 'l1', itemCatalogoId: 'i1', codigo: 'GER-1', nome: 'Gerador', unidade: 'un', natureza: 'PRODUTO', quantidadePrevista: 1.333, ordem: 0 },
      { id: 'l2', itemCatalogoId: null, codigo: 'SRV', nome: 'Montagem', unidade: 'h', natureza: 'SERVICO', quantidadePrevista: 999999.999, ordem: 1 },
    ],
    notas: [{ id: 'n1', texto: 'Cheguei', autorId: 'u3', criadaEm: '2026-10-10T12:01:00Z' }],
    anexos: [
      { id: 'a1', tipo: 'FOTO', arquivoId: 'f1', sha256: 'ab'.repeat(32), legenda: 'Quadro', momento: 'ANTES', tiradaEm: '2026-10-10T12:02:00Z', autorId: 'u3', criadoEm: '2026-10-10T12:03:00Z' },
      { id: 'a2', tipo: 'ASSINATURA', arquivoId: 'f2', sha256: 'cd'.repeat(32), legenda: 'Maria — Síndica', tiradaEm: '2026-10-10T13:00:00Z', assinanteNome: 'Maria', assinantePapel: 'Síndica', autorId: 'u3', criadoEm: '2026-10-10T13:00:01Z' },
    ],
    historico: [
      { statusPara: 'ABERTA', usuarioId: 'u1', em: '2026-10-09T10:00:00Z' },
      { statusDe: 'ABERTA', statusPara: 'EM_ANDAMENTO', usuarioId: 'u3', em: '2026-10-10T12:00:00Z', observacao: null },
    ],
    atualizadoEm: '2026-10-10T13:00:01.5Z',
  };
}

describe('os-models', () => {
  describe('validarTransicaoOs: casos compartilhados com o TransicoesOs do servidor', () => {
    it('o arquivo é o mesmo do servidor (SHA_CASOS_TRANSICOES_OS)', async () => {
      expect(await sha256(textoTransicoes)).toBe(SHA_CASOS_TRANSICOES_OS);
    });

    it('tem a grade completa e os casos esperados', () => {
      expect(arquivoTransicoes.casos.length).toBeGreaterThan(700);
      const grade = new Set(arquivoTransicoes.casos.filter((c) => c.grupo.startsWith('grade ')).map((c) =>
        [c.grupo, c.de, c.para, c.perfil, c.ehResponsavel, c.ehTecnicoAtribuido].join('>')));
      expect(grade.size).toBe(5 * 4 * 3 * 2 * 2 * 2);
    });

    it('todos os casos dão o resultado do servidor (código e campos, na ordem)', () => {
      const falhas: string[] = [];
      arquivoTransicoes.casos.forEach((c, n) => {
        const erro = validarTransicaoOs(c.de, c.para, c.perfil, c.ehResponsavel, c.ehTecnicoAtribuido, c.dados);
        const falha = divergencia(erro, c.resultado, c.campos, 'VALIDACAO');
        if (falha) {
          falhas.push(`${n} ${c.grupo}: ${c.de} -> ${c.para}, ${c.perfil} ${c.ehResponsavel} ${c.ehTecnicoAtribuido} ${JSON.stringify(c.dados).slice(0, 200)}: ${falha}`);
        }
      });
      expect(falhas).toEqual([]);
    });

    it('permitidas: as do arquivo, na ordem; e validar aceita com dados completos exatamente esses destinos', () => {
      expect(arquivoTransicoes.permitidas).toHaveLength(5 * 3 * 4);
      for (const p of arquivoTransicoes.permitidas) {
        const nome = `${p.de} ${p.perfil} ${p.ehResponsavel} ${p.ehTecnicoAtribuido}`;
        expect(transicoesPermitidasOs(p.de, p.perfil, p.ehResponsavel, p.ehTecnicoAtribuido), nome).toEqual(p.permitidas);
        for (const para of STATUS) {
          if (para === p.de) continue;
          const aceita = validarTransicaoOs(p.de, para, p.perfil, p.ehResponsavel, p.ehTecnicoAtribuido, COMPLETO) === null;
          expect(aceita, `${nome} / ${para}`).toBe(p.permitidas.includes(para));
        }
      }
    });

    it('mensagens do servidor (pt-BR) nos erros principais', () => {
      expect(validarTransicaoOs('ABERTA', 'EM_ANDAMENTO', 'TECNICO', false, false, COMPLETO)).toEqual({
        codigo: 'ACESSO_NEGADO', mensagem: 'Você só altera as OS atribuídas a você.',
      });
      expect(validarTransicaoOs('ABERTA', 'CANCELADA', 'COMERCIAL', false, true, COMPLETO)?.mensagem)
        .toBe('Você só altera as OS em que é o responsável.');
      expect(validarTransicaoOs(null, 'EM_ANDAMENTO', 'ADMIN', false, false, COMPLETO)).toEqual({
        codigo: 'TRANSICAO_INVALIDA', mensagem: 'Uma OS nova começa como aberta.',
      });
      expect(validarTransicaoOs('CANCELADA', 'ABERTA', 'ADMIN', false, false, COMPLETO)?.mensagem)
        .toBe('Não é possível passar de cancelada para aberta.');
      expect(validarTransicaoOs('EM_ANDAMENTO', 'CANCELADA', 'COMERCIAL', true, false, COMPLETO)).toEqual({
        codigo: 'ACESSO_NEGADO', mensagem: 'Só o administrador cancela uma OS em andamento.',
      });
      expect(validarTransicaoOs(null, 'ABERTA', 'TECNICO', false, true, COMPLETO)?.mensagem).toBe('O técnico não cria OS.');
      const vazio: ContextoTransicaoOs = {
        temTecnico: false, resumoExecucao: null, temAssinatura: false, assinaturaRecusada: true, motivoRecusa: 'ab', motivo: null,
      };
      expect(validarTransicaoOs('EM_ANDAMENTO', 'CONCLUIDA', 'ADMIN', false, false, vazio)).toEqual({
        codigo: 'VALIDACAO',
        mensagem: 'Dados inválidos.',
        campos: {
          resumoExecucao: 'Informe o resumo da execução (de 3 a 4000 caracteres).',
          motivoRecusa: 'Informe o motivo da recusa (de 3 a 500 caracteres).',
        },
      });
      expect(validarTransicaoOs('ABERTA', 'EM_ANDAMENTO', 'ADMIN', false, false, vazio)?.campos)
        .toEqual({ tecnicoId: 'Atribua um técnico antes de iniciar.' });
      expect(validarTransicaoOs('EM_ANDAMENTO', 'CONCLUIDA', 'ADMIN', false, false, { ...vazio, assinaturaRecusada: false, resumoExecucao: 'abc' })?.campos)
        .toEqual({ assinatura: 'Colete a assinatura ou registre a recusa com o motivo.' });
      expect(validarTransicaoOs('CONCLUIDA', 'EM_ANDAMENTO', 'ADMIN', false, false, vazio)?.campos)
        .toEqual({ motivoReabertura: 'Informe o motivo da reabertura (de 3 a 500 caracteres).' });
      expect(validarTransicaoOs('ABERTA', 'CANCELADA', 'ADMIN', false, false, vazio)?.campos)
        .toEqual({ motivoCancelamento: 'Informe o motivo do cancelamento (de 3 a 500 caracteres).' });
    });
  });

  describe('validarEdicaoOs: casos compartilhados com o EdicaoOs do servidor', () => {
    it('o arquivo é o mesmo do servidor (SHA_CASOS_EDICAO_OS)', async () => {
      expect(await sha256(textoEdicao)).toBe(SHA_CASOS_EDICAO_OS);
    });

    it('os campos na mesma ordem do arquivo', () => {
      expect(CAMPOS_EDICAO_OS).toEqual(arquivoEdicao.campos);
    });

    it('tem a grade completa e os casos esperados', () => {
      expect(arquivoEdicao.casos.length).toBeGreaterThan(1700);
      const grade = new Set(arquivoEdicao.casos.filter((c) => c.grupo === 'grade').map((c) =>
        [c.statusServidor, c.perfil, c.ehResponsavel, c.ehTecnicoAtribuido, JSON.stringify(c.camposAlterados)].join('>')));
      expect(grade.size).toBe(5 * 3 * 4 * (1 + CAMPOS_EDICAO_OS.length));
    });

    it('todos os casos dão o resultado do servidor (código e campos, na ordem)', () => {
      const falhas: string[] = [];
      arquivoEdicao.casos.forEach((c, n) => {
        const erro = validarEdicaoOs(c.statusServidor, c.statusDestino, c.perfil, c.ehResponsavel, c.ehTecnicoAtribuido, c.camposAlterados);
        const falha = divergencia(erro, c.resultado, c.campos, 'OS_NAO_EDITAVEL');
        if (falha) {
          falhas.push(`${n} ${c.grupo}: ${c.statusServidor} -> ${c.statusDestino}, ${c.perfil} ${c.ehResponsavel} ${c.ehTecnicoAtribuido} ${JSON.stringify(c.camposAlterados)}: ${falha}`);
        }
      });
      expect(falhas).toEqual([]);
    });

    it('campo desconhecido é erro de programação', () => {
      expect(() => validarEdicaoOs('ABERTA', 'ABERTA', 'ADMIN', false, false, ['tipoOs' as CampoEdicaoOs])).toThrow(/tipoOs/);
    });

    it('mensagens do servidor por motivo', () => {
      expect(validarEdicaoOs('ABERTA', 'ABERTA', 'ADMIN', false, false, ['clienteId', 'resumoExecucao', 'tipo'])).toEqual({
        codigo: 'OS_NAO_EDITAVEL',
        mensagem: 'Alguns campos não podem ser alterados nesta OS.',
        campos: { clienteId: 'Não muda depois da criação da OS.', resumoExecucao: 'Não pode ser alterado com a OS aberta.' },
      });
      expect(validarEdicaoOs('EM_ANDAMENTO', 'EM_ANDAMENTO', 'TECNICO', false, true, ['tipo'])?.campos)
        .toEqual({ tipo: 'Você não altera este campo.' });
      expect(validarEdicaoOs(null, 'ABERTA', 'COMERCIAL', true, false, ['propostaId', 'clienteId'])).toBeNull();
      expect(validarEdicaoOs('ABERTA', 'ABERTA', 'COMERCIAL', false, false, [])).toEqual({
        codigo: 'ACESSO_NEGADO', mensagem: 'Você só altera as OS em que é o responsável.',
      });
    });
  });

  describe('validarMutacaoOs (M2P1-R13): transição primeiro, edição só se ela aceitar', () => {
    it('em todos os casos de edição: o erro da transição vence; sem ele, vale o resultado do caso', () => {
      const falhas: string[] = [];
      arquivoEdicao.casos.forEach((c, n) => {
        const args = [c.statusServidor, c.statusDestino, c.perfil, c.ehResponsavel, c.ehTecnicoAtribuido] as const;
        const daTransicao = validarTransicaoOs(...args, COMPLETO);
        const erro = validarMutacaoOs(...args, COMPLETO, c.camposAlterados);
        const falha = daTransicao
          ? (JSON.stringify(erro) === JSON.stringify(daTransicao) ? null : `esperado ${JSON.stringify(daTransicao)}, veio ${JSON.stringify(erro)}`)
          : divergencia(erro, c.resultado, c.campos, 'OS_NAO_EDITAVEL');
        if (falha) falhas.push(`${n}: ${falha}`);
      });
      expect(falhas).toEqual([]);
    });

    it('cancelar (só ADMIN em andamento) e mudar o tipo: sai o ACESSO_NEGADO da transição, não o OS_NAO_EDITAVEL', () => {
      expect(validarMutacaoOs('EM_ANDAMENTO', 'CANCELADA', 'COMERCIAL', true, false, COMPLETO, ['tipo'])?.codigo).toBe('ACESSO_NEGADO');
      expect(validarMutacaoOs('ABERTA', 'ABERTA', 'COMERCIAL', true, false, COMPLETO, ['resumoExecucao'])?.codigo).toBe('OS_NAO_EDITAVEL');
      expect(validarMutacaoOs('ABERTA', 'ABERTA', 'COMERCIAL', true, false, COMPLETO, ['tipo'])).toBeNull();
      expect(validarMutacaoOs('EM_ANDAMENTO', 'CONCLUIDA', 'TECNICO', false, true, { ...COMPLETO, resumoExecucao: 'ab' }, ['tipo'])?.codigo)
        .toBe('VALIDACAO');
    });

    it('o validador de edição nem é consultado quando a transição recusa (campo desconhecido não estoura)', () => {
      expect(validarMutacaoOs('CANCELADA', 'ABERTA', 'ADMIN', false, false, COMPLETO, ['tipoOs' as CampoEdicaoOs])?.codigo)
        .toBe('TRANSICAO_INVALIDA');
      expect(() => validarMutacaoOs('ABERTA', 'ABERTA', 'ADMIN', false, false, COMPLETO, ['tipoOs' as CampoEdicaoOs])).toThrow();
    });
  });

  describe('textos medidos em code points depois do stripJava (M2P1-R7)', () => {
    const c = (...codigos: number[]) => String.fromCodePoint(...codigos);
    const joinha = c(0x1f44d);

    it('tamanhoTextoOs', () => {
      expect(tamanhoTextoOs(null)).toBe(0);
      expect(tamanhoTextoOs('  ab \t')).toBe(2);
      expect(tamanhoTextoOs(`a${joinha}`)).toBe(2);
      expect(`a${joinha}`.length).toBe(3); // a contagem UTF-16 daria 3
      expect(tamanhoTextoOs(joinha.repeat(4000))).toBe(4000);
      expect(tamanhoTextoOs(`${c(0xa0)}ab`)).toBe(3); // NBSP não é espaço no Java
      expect(tamanhoTextoOs(`${c(0x1c)}ab${c(0x1f)}`)).toBe(2);
      expect(tamanhoTextoOs(`${c(0x0b)}ab${c(0x0c)}`)).toBe(2);
      expect(tamanhoTextoOs(`${c(0xfeff)}ab`)).toBe(3); // BOM fica
      expect(tamanhoTextoOs(`${c(0x85)}ab`)).toBe(3); // NEL fica
      expect(tamanhoTextoOs(`${c(0x3000)}ab${c(0x3000)}`)).toBe(2);
      expect(tamanhoTextoOs(c(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467))).toBe(5);
    });

    it('resumo de 4000 emoji conclui; 4001 não; motivo de 2 emoji não cancela, 3 sim', () => {
      const ctx = (resumo: string): ContextoTransicaoOs => ({ ...COMPLETO, resumoExecucao: resumo });
      expect(validarTransicaoOs('EM_ANDAMENTO', 'CONCLUIDA', 'ADMIN', false, false, ctx(joinha.repeat(4000)))).toBeNull();
      expect(validarTransicaoOs('EM_ANDAMENTO', 'CONCLUIDA', 'ADMIN', false, false, ctx(joinha.repeat(4001)))?.campos)
        .toHaveProperty('resumoExecucao');
      const motivo = (m: string): ContextoTransicaoOs => ({ ...COMPLETO, motivo: m });
      expect(validarTransicaoOs('ABERTA', 'CANCELADA', 'ADMIN', false, false, motivo(joinha.repeat(2)))?.campos)
        .toHaveProperty('motivoCancelamento');
      expect(validarTransicaoOs('ABERTA', 'CANCELADA', 'ADMIN', false, false, motivo(joinha.repeat(3)))).toBeNull();
    });
  });

  describe('permissões derivadas da matriz do EdicaoOs', () => {
    it('camposEditaveisOs: exatamente os que o validarEdicaoOs aceita, na ordem fixa', () => {
      for (const s of STATUS) {
        for (const perfil of PERFIS) {
          for (const [resp, atrib] of POSSES) {
            const esperado = CAMPOS_EDICAO_OS.filter((campo) => validarEdicaoOs(s, s, perfil, resp, atrib, [campo]) === null);
            expect(camposEditaveisOs(s, perfil, resp, atrib), `${s} ${perfil} ${resp} ${atrib}`).toEqual(esperado);
          }
        }
      }
      expect(camposEditaveisOs('EM_ANDAMENTO', 'TECNICO', false, true)).toEqual(['resumoExecucao', 'assinaturaRecusada', 'motivoRecusa', 'notas']);
      expect(camposEditaveisOs('ABERTA', 'TECNICO', false, false)).toEqual([]);
    });

    it('podeEditarCabecalho: ADMIN ou COMERCIAL responsável, em ABERTA e EM_ANDAMENTO', () => {
      for (const s of STATUS) {
        const aberta = s === 'ABERTA' || s === 'EM_ANDAMENTO';
        expect(podeEditarCabecalho(s, 'ADMIN', false), s).toBe(aberta);
        expect(podeEditarCabecalho(s, 'COMERCIAL', true), s).toBe(aberta);
        expect(podeEditarCabecalho(s, 'COMERCIAL', false), s).toBe(false);
        expect(podeEditarCabecalho(s, 'TECNICO', true), s).toBe(false);
      }
    });

    it('podeExecutar: ADMIN ou TECNICO atribuído, só em EM_ANDAMENTO', () => {
      for (const s of STATUS) {
        const andamento = s === 'EM_ANDAMENTO';
        expect(podeExecutar(s, 'ADMIN', false), s).toBe(andamento);
        expect(podeExecutar(s, 'TECNICO', true), s).toBe(andamento);
        expect(podeExecutar(s, 'TECNICO', false), s).toBe(false);
        expect(podeExecutar(s, 'COMERCIAL', true), s).toBe(false);
      }
    });
  });

  describe('exibição', () => {
    it('codigoOsExibido: OS-000123 ou o OSP, com -R<n> na revisão > 1 (codigosExibidos do servidor)', () => {
      expect(codigoOsExibido({ numero: 123, revisao: 1, codigoProvisorio: 'OSP-0Z9XY7' })).toBe('OS-000123');
      expect(codigoOsExibido({ numero: 123, revisao: null, codigoProvisorio: 'OSP-0Z9XY7' })).toBe('OS-000123');
      expect(codigoOsExibido({ numero: 123, revisao: 2, codigoProvisorio: 'OSP-0Z9XY7' })).toBe('OS-000123-R2');
      expect(codigoOsExibido({ numero: null, revisao: null, codigoProvisorio: 'OSP-0Z9XY7' })).toBe('OSP-0Z9XY7');
      expect(codigoOsExibido({ numero: null, revisao: 3, codigoProvisorio: 'OSP-0Z9XY7' })).toBe('OSP-0Z9XY7-R3');
      expect(codigoOsExibido({ numero: 1234567, revisao: 1, codigoProvisorio: 'OSP-0Z9XY7' })).toBe('OS-1234567');
      expect(codigoOsBase({ numero: 7, codigoProvisorio: 'OSP-0Z9XY7' })).toBe('OS-000007');
      expect(codigoOsBase({ numero: null, codigoProvisorio: 'OSP-0Z9XY7' })).toBe('OSP-0Z9XY7');
    });

    it('rótulos e cores de status; rótulos de tipo', () => {
      expect(Object.keys(STATUS_OS)).toEqual(STATUS);
      expect(STATUS.map(rotuloStatusOs)).toEqual(['Aberta', 'Em andamento', 'Concluída', 'Cancelada']);
      for (const s of STATUS) expect(corStatusOs(s), s).toMatch(/^bg-\S+ text-\S+$/);
      expect(new Set(STATUS.map(corStatusOs)).size).toBe(4);
      expect(TIPOS_OS).toEqual(['INSTALACAO', 'MANUTENCAO', 'CORRETIVA', 'PREVENTIVA', 'ENTREGA', 'RETIRADA', 'SERVICO']);
      expect(TIPOS_OS.map(rotuloTipoOs)).toEqual(['Instalação', 'Manutenção', 'Corretiva', 'Preventiva', 'Entrega', 'Retirada', 'Serviço']);
    });
  });

  describe('dados ↔ OsLocal', () => {
    it('ida e volta igual, com a quantidade em milésimos inteiros', () => {
      const d = dadosCompletos();
      const os = paraOsLocal(ID, 7, d);
      expect(os.id).toBe(ID);
      expect(os.version).toBe(7);
      expect(os.itens[0]).toEqual({
        id: 'l1', itemCatalogoId: 'i1', codigo: 'GER-1', nome: 'Gerador', unidade: 'un', natureza: 'PRODUTO',
        quantidadePrevistaMilesimos: 1333, ordem: 0,
      });
      expect(os.itens[1].quantidadePrevistaMilesimos).toBe(999999999);
      expect(os.historico[0]).toEqual({ statusDe: null, statusPara: 'ABERTA', usuarioId: 'u1', em: '2026-10-09T10:00:00Z', observacao: null });
      expect(os.anexos[1]).toMatchObject({ assinanteNome: 'Maria', momento: null, revisaoOs: null, codigoExibido: null });
      const volta = dadosDaOs(os);
      expect(volta).toEqual({
        ...d,
        historico: [{ statusDe: null, observacao: null, ...d.historico![0] }, d.historico![1]],
        anexos: [
          { assinanteNome: null, assinantePapel: null, revisaoOs: null, codigoExibido: null, ...d.anexos![0] },
          { momento: null, revisaoOs: null, codigoExibido: null, ...d.anexos![1] },
        ],
      });
      expect(JSON.stringify(volta.itens)).toContain('"quantidadePrevista":1.333');
      expect(JSON.stringify(volta.itens)).toContain('"quantidadePrevista":999999.999');
      // de novo para local dá o mesmo registro
      expect(paraOsLocal(ID, 7, volta)).toEqual(os);
    });

    it('chaves ausentes viram null e listas ausentes viram []', () => {
      const os = paraOsLocal(ID, null, {
        codigoProvisorio: 'OSP-0Z9XY7', tipo: 'SERVICO', status: 'ABERTA', urgente: false, assinaturaRecusada: false,
        itens: [{ id: 'l1', codigo: 'X', nome: 'Y', unidade: 'un', natureza: 'SERVICO', quantidadePrevista: '2.500' }],
      } as OsDados);
      expect(os).toMatchObject({
        version: null, numero: null, revisao: null, propostaId: null, clienteId: null, responsavelId: null, tecnicoId: null,
        dataPrevista: null, descricao: null, enderecoCep: null, enderecoLogradouro: null, enderecoNumero: null,
        enderecoComplemento: null, enderecoBairro: null, enderecoCidade: null, enderecoUf: null, iniciadaEm: null,
        concluidaEm: null, resumoExecucao: null, motivoCancelamento: null, assinaturaAnexoId: null, assinanteNome: null,
        assinantePapel: null, assinadaEm: null, motivoRecusa: null, notas: [], anexos: [], historico: [], atualizadoEm: null,
      });
      expect(os.itens[0]).toEqual({
        id: 'l1', itemCatalogoId: null, codigo: 'X', nome: 'Y', unidade: 'un', natureza: 'SERVICO', quantidadePrevistaMilesimos: 2500, ordem: null,
      });
      expect(dadosDaOs(os).itens[0].quantidadePrevista).toBe(2.5);
    });

    it('nota sem autor e sem data (ainda não aceita) fica null e assim vai para a rede', () => {
      const os = paraOsLocal(ID, 1, { ...dadosCompletos(), notas: [{ id: 'n9', texto: 'Nova' }] });
      expect(os.notas).toEqual([{ id: 'n9', texto: 'Nova', autorId: null, criadaEm: null }]);
      expect(dadosDaOs(os).notas).toEqual([{ id: 'n9', texto: 'Nova', autorId: null, criadaEm: null }]);
    });

    it('comandos de entrada (motivoReabertura, aceitarTrabalho) não ficam no registro local; saem só quando passados', () => {
      const d = { ...dadosCompletos(), motivoReabertura: 'Faltou testar', aceitarTrabalho: true };
      const os = paraOsLocal(ID, 1, d);
      expect('motivoReabertura' in os).toBe(false);
      expect('aceitarTrabalho' in os).toBe(false);
      const semComando = dadosDaOs(os);
      expect('motivoReabertura' in semComando).toBe(false);
      expect('aceitarTrabalho' in semComando).toBe(false);
      const comComando = dadosDaOs(os, { motivoReabertura: 'Faltou testar', aceitarTrabalho: true });
      expect(comComando.motivoReabertura).toBe('Faltou testar');
      expect(comComando.aceitarTrabalho).toBe(true);
    });

    it('nenhum campo de valor na OS (o técnico nunca vê R$), em nenhum nível', () => {
      const proibidos = /preco|custo|valor|total|desconto|subtotal/i;
      const chaves = (o: unknown): string[] => {
        if (Array.isArray(o)) return o.flatMap(chaves);
        if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => [k, ...chaves(v)]);
        return [];
      };
      const os = paraOsLocal(ID, 1, dadosCompletos());
      expect(chaves(os).filter((k) => proibidos.test(k))).toEqual([]);
      expect(chaves(dadosDaOs(os, { aceitarTrabalho: true })).filter((k) => proibidos.test(k))).toEqual([]);
      // valores que um servidor antigo mandasse por engano não entram no registro local
      const comPreco = dadosCompletos() as unknown as { itens: Record<string, unknown>[] };
      comPreco.itens[0]['precoUnitario'] = 10;
      expect(chaves(paraOsLocal(ID, 1, comPreco as unknown as OsDados)).filter((k) => proibidos.test(k))).toEqual([]);
    });

    it('o registro local não divide referências com o objeto da rede', () => {
      const d = dadosCompletos();
      const os = paraOsLocal(ID, 1, d);
      d.itens[0].nome = 'Mudou';
      d.notas[0].texto = 'Mudou';
      d.anexos![0].legenda = 'Mudou';
      expect([os.itens[0].nome, os.notas[0].texto, os.anexos[0].legenda]).toEqual(['Gerador', 'Cheguei', 'Quadro']);
    });
  });
});
