import { ErroCampo } from '../../core/util/erro-campo';
import { ErroOs } from './erro-os';
import { paraClienteLocal } from '../clientes/cliente-models';
import {
  atrasadaOs, CODIGOS_ERRO_OS, correspondeABuscaOs, criacaoOs, localDaOs, mensagemErroOs, osEncerrada, rotuloCampoOs,
  selosDaOs, textoPerdaOs,
} from './formatos-os';
import { OsDados, OsLocal, paraOsLocal, StatusOs } from './os-models';

/** Um UUIDv7 com o instante `iso` nos 48 bits do começo. */
const idV7 = (iso: string) => {
  const h = Date.parse(iso).toString(16).padStart(12, '0');
  return `${h.slice(0, 8)}-${h.slice(8)}-7abc-8def-0123456789ab`;
};
/** Um UUID que não é v7 (o v5 da importação do SIGEM). */
const ID_V5 = '2f1e9c3a-8b7d-5c4e-9a1b-0c2d3e4f5a6b';

const GENERICA = 'Não foi possível concluir. Tente de novo.';

describe('formatos-os', () => {
  describe('mensagemErroOs', () => {
    it('a recusa do repositório (ErroOs/ErroCampo) com mensagem: a própria mensagem', () => {
      expect(mensagemErroOs(new ErroOs('RESOLVA_A_PENDENCIA', 'os', 'Resolva a pendência desta OS antes de concluí-la.')))
        .toBe('Resolva a pendência desta OS antes de concluí-la.');
      expect(mensagemErroOs(new ErroCampo('legenda', 'Máximo de 200 caracteres.'))).toBe('Máximo de 200 caracteres.');
    });

    it.each([
      // do aparelho e do servidor (os do OsRepo, da captura e do sync da OS)
      'ACESSO_NEGADO', 'TRANSICAO_INVALIDA', 'OS_NAO_EDITAVEL', 'VALIDACAO', 'STATUS_INVALIDO', 'LIMITE_FOTOS',
      'LIMITE_ASSINATURAS', 'LIMITE_DOCUMENTOS', 'NAO_ENCONTRADA', 'RESOLVA_A_PENDENCIA', 'ASSINATURA_COLHIDA',
      'ASSINATURA_GRANDE', 'ASSINATURA_FALHOU', 'SEM_ESPACO', 'OS_JA_CONCLUIDA', 'OS_ALTERADA', 'SNAPSHOT_GRANDE', 'PDF_GRANDE',
      'OS_SINCRONIZANDO', 'PROPOSTA_NAO_CANCELADA', 'OS_CANCELADA', 'FOTO_TIPO', 'FOTO_ILEGIVEL', 'FOTO_GRANDE',
      // só do servidor (push e upload de anexo)
      'OS_CONCLUIDA_POR_OUTRO', 'OS_NAO_ENCONTRADA', 'REGISTRO_EXCLUIDO', 'REGISTRO_NAO_ENCONTRADO', 'CODIGO_PROVISORIO_DUPLICADO',
      'CLIENTE_COM_OS', 'ARQUIVO_VAZIO', 'ARQUIVO_GRANDE', 'SHA_DIVERGENTE', 'TIPO_NAO_SUPORTADO', 'CORPO_INVALIDO',
      'ANEXO_DIVERGENTE', 'REVISAO_INVALIDA', 'CODIGO_EXIBIDO_INVALIDO',
    ])('%s sem mensagem: o texto do código, em pt-BR', (codigo) => {
      expect(CODIGOS_ERRO_OS).toContain(codigo);
      const m = mensagemErroOs(new ErroOs(codigo, 'os', ''));
      expect(m).not.toBe(GENERICA);
      expect(m).toMatch(/^[A-ZÀ-Ú].*\.$/);
    });

    it('os dois casos de aceite do trabalho e os 403 do PDF', () => {
      expect(mensagemErroOs(new ErroOs('PROPOSTA_NAO_CANCELADA', 'os', ''))).toContain('a proposta desta OS está cancelada');
      expect(mensagemErroOs(new ErroOs('OS_CANCELADA', 'os', ''))).toContain('cancelada');
      expect(mensagemErroOs(new ErroOs('OS_CONCLUIDA_POR_OUTRO', 'os', ''))).toBe('Esta OS foi concluída pelo escritório.');
    });

    it('erro técnico (Dexie, PDF, rede) ou código desconhecido: a mensagem genérica', () => {
      expect(mensagemErroOs(new Error('DatabaseClosedError'))).toBe(GENERICA);
      expect(mensagemErroOs('x')).toBe(GENERICA);
      expect(mensagemErroOs(new ErroOs('constructor', 'os', ''))).toBe(GENERICA);
      expect(mensagemErroOs(new ErroOs('NOVO_CODIGO', 'os', ' '))).toBe(GENERICA);
    });
  });

  describe('textoPerdaOs (M1)', () => {
    it('nomeia o que sai, na ordem do trabalho de campo, numa frase que vale para um item ou vários', () => {
      expect(textoPerdaOs(['recusa'])).toBe('Isto descarta o que esta OS tem neste aparelho e ainda não foi enviado: a recusa da assinatura.');
      expect(textoPerdaOs(['pdf', 'resumo', 'conclusao', 'notas', 'inicio'])).toBe(
        'Isto descarta o que esta OS tem neste aparelho e ainda não foi enviado: o início, as notas, a conclusão, o resumo e o PDF.');
      expect(textoPerdaOs(['fotos', 'assinatura', 'precisaVoltar', 'cancelamento', 'reabertura'])).toBe(
        'Isto descarta o que esta OS tem neste aparelho e ainda não foi enviado: as fotos, a assinatura, o "Precisa voltar", '
        + 'o cancelamento e a reabertura.');
    });
  });

  describe('rotuloCampoOs (N1)', () => {
    it.each([
      ['notas[3].texto', 'Nota'],
      ['notas[0]', 'Nota'],
      ['itens[0].quantidadePrevista', 'Item 1 (quantidade prevista)'],
      ['itens[11].codigo', 'Item 12 (código)'],
      ['itens[2]', 'Item 3'],
      ['itens[1].novo', 'Item 2 (novo)'],
      ['resumoExecucao', 'Resumo da execução'],
      ['motivoRecusa', 'Motivo da recusa'],
      ['tecnicoId', 'Técnico'],
      ['enderecoUf', 'UF'],
      ['concluiProposta', 'Conclui a proposta'],
      // os do upload de anexo, do mesmo mapa
      ['assinanteNome', 'Nome de quem assina'],
      ['revisaoOs', 'Revisão da OS'],
      // desconhecido: o caminho cru; nada do protótipo
      ['campoNovo', 'campoNovo'],
      ['constructor', 'constructor'],
    ])('%s → %s', (campo, rotulo) => {
      expect(rotuloCampoOs(campo)).toBe(rotulo);
    });
  });

  describe('selos e prazo (Q10)', () => {
    /** 13:00 UTC = 10:00 em São Paulo. */
    const ID_HOJE = idV7('2026-10-01T13:00:00Z');
    const os = (status: StatusOs, extra: Partial<OsDados> = {}, id = ID_HOJE): OsLocal =>
      paraOsLocal(id, 1, {
        codigoProvisorio: 'OSP-AAAAAA', numero: 1, revisao: 1, clienteId: 'c1', tipo: 'MANUTENCAO', status, urgente: false,
        concluiProposta: true, assinaturaRecusada: false, dataPrevista: null, itens: [], notas: [], anexos: [], historico: [],
        ...extra,
      });
    const criada = (em: string): Partial<OsDados> => ({ historico: [{ statusDe: null, statusPara: 'ABERTA', usuarioId: 'u', em }] });

    it('criacaoOs: a data em São Paulo da criação no histórico (a do servidor), senão o instante do UUIDv7', () => {
      // 01:30 UTC de 10-02 ainda é 10-01 em São Paulo
      expect(criacaoOs(os('ABERTA', criada('2026-10-02T01:30:00Z')))).toBe('2026-10-01');
      expect(criacaoOs(os('ABERTA', criada('2026-10-02T03:00:00Z')))).toBe('2026-10-02');
      // o histórico vale mais que o id (o relógio do aparelho que criou pode estar errado)
      expect(criacaoOs(os('ABERTA', criada('2026-09-20T12:00:00Z')))).toBe('2026-09-20');
      expect(criacaoOs(os('ABERTA'))).toBe('2026-10-01');
      // criada offline às 23:30 de São Paulo (02:30 UTC do dia seguinte), ainda sem histórico do servidor
      expect(criacaoOs(os('ABERTA', {}, idV7('2026-10-02T02:30:00Z')))).toBe('2026-10-01');
      // as transições não são a criação
      expect(criacaoOs(os('ABERTA', { historico: [{ statusDe: 'ABERTA', statusPara: 'EM_ANDAMENTO', usuarioId: 'u', em: '2026-09-01T12:00:00Z' }] })))
        .toBe('2026-10-01');
      // sem v7 e sem a criação no histórico: sem data
      expect(criacaoOs(os('ABERTA', {}, ID_V5))).toBeNull();
    });

    it('urgente: atrasada com a data prevista mais de 7 dias depois da criação, ou já passada', () => {
      const hoje = '2026-10-01';
      expect(atrasadaOs(os('ABERTA', { urgente: true, dataPrevista: '2026-10-08' }), hoje)).toBe(false);
      expect(atrasadaOs(os('ABERTA', { urgente: true, dataPrevista: '2026-10-09' }), hoje)).toBe(true);
      expect(atrasadaOs(os('ABERTA', { urgente: true, dataPrevista: '2026-10-01' }), hoje)).toBe(false);
      expect(atrasadaOs(os('EM_ANDAMENTO', { urgente: true, dataPrevista: '2026-09-30' }), hoje)).toBe(true);
    });

    it('normal: mais de 20 dias depois da criação, ou já passada', () => {
      const hoje = '2026-10-01';
      expect(atrasadaOs(os('ABERTA', { dataPrevista: '2026-10-21' }), hoje)).toBe(false);
      expect(atrasadaOs(os('ABERTA', { dataPrevista: '2026-10-22' }), hoje)).toBe(true);
      expect(atrasadaOs(os('EM_ANDAMENTO', { dataPrevista: '2026-09-30' }), hoje)).toBe(true);
    });

    it('a criação conta pela data de São Paulo: criada às 22:30 de 10-01 (01:30 UTC de 10-02), o limite da urgente é 10-08', () => {
      const noite = criada('2026-10-02T01:30:00Z');
      expect(atrasadaOs(os('ABERTA', { ...noite, urgente: true, dataPrevista: '2026-10-08' }), '2026-10-01')).toBe(false);
      expect(atrasadaOs(os('ABERTA', { ...noite, urgente: true, dataPrevista: '2026-10-09' }), '2026-10-01')).toBe(true);
    });

    it('o prazo atravessa o fim do mês e do ano', () => {
      const dezembro = criada('2026-12-28T15:00:00Z');
      expect(atrasadaOs(os('ABERTA', { ...dezembro, urgente: true, dataPrevista: '2027-01-04' }), '2026-12-28')).toBe(false);
      expect(atrasadaOs(os('ABERTA', { ...dezembro, urgente: true, dataPrevista: '2027-01-05' }), '2026-12-28')).toBe(true);
    });

    it('sem data prevista: atrasada quando o prazo contado da criação já passou', () => {
      expect(atrasadaOs(os('ABERTA', { urgente: true }), '2026-10-08')).toBe(false);
      expect(atrasadaOs(os('ABERTA', { urgente: true }), '2026-10-09')).toBe(true);
      expect(atrasadaOs(os('ABERTA'), '2026-10-21')).toBe(false);
      expect(atrasadaOs(os('ABERTA'), '2026-10-22')).toBe(true);
    });

    it('sem data de criação conhecida: só a data prevista passada conta', () => {
      const semCriacao = (extra: Partial<OsDados>) => os('ABERTA', extra, ID_V5);
      expect(atrasadaOs(semCriacao({ urgente: true, dataPrevista: '2027-01-01' }), '2026-10-01')).toBe(false);
      expect(atrasadaOs(semCriacao({ dataPrevista: '2026-09-30' }), '2026-10-01')).toBe(true);
      expect(atrasadaOs(semCriacao({}), '2030-01-01')).toBe(false);
    });

    it('concluída ou cancelada nunca está atrasada', () => {
      for (const s of ['CONCLUIDA', 'CANCELADA'] as const) {
        expect(atrasadaOs(os(s, { urgente: true, dataPrevista: '2026-09-01' }), '2026-10-01')).toBe(false);
      }
    });

    it('selosDaOs: Urgente, Atrasada e Não sincronizada, nesta ordem; Urgente só com a OS aberta ou em andamento', () => {
      const hoje = '2026-10-01';
      const rotulos = (o: OsLocal, naoSincronizada = false) => selosDaOs(o, { naoSincronizada, hoje }).map((s) => s.rotulo);
      expect(rotulos(os('ABERTA', { urgente: true, dataPrevista: '2026-09-30' }), true)).toEqual(['Urgente', 'Atrasada', 'Não sincronizada']);
      expect(selosDaOs(os('EM_ANDAMENTO', { urgente: true, dataPrevista: '2026-10-02' }), { naoSincronizada: false, hoje }).map((s) => s.tipo))
        .toEqual(['urgente']);
      expect(rotulos(os('ABERTA', { dataPrevista: '2026-10-02' }))).toEqual([]);
      expect(rotulos(os('CONCLUIDA', { urgente: true, dataPrevista: '2026-09-01' }), true)).toEqual(['Não sincronizada']);
      expect(rotulos(os('CANCELADA', { urgente: true }))).toEqual([]);
    });

    it('osEncerrada: concluída e cancelada', () => {
      expect((['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'] as const).map(osEncerrada)).toEqual([false, false, true, true]);
    });
  });

  describe('localDaOs', () => {
    const com = (enderecoBairro: string | null, enderecoCidade: string | null) => ({ enderecoBairro, enderecoCidade });

    it('bairro e cidade do snapshot, o que existir', () => {
      expect(localDaOs(com('Bela Vista', 'São Paulo'))).toBe('Bela Vista · São Paulo');
      expect(localDaOs(com(null, 'Santos'))).toBe('Santos');
      expect(localDaOs(com('Centro', null))).toBe('Centro');
      expect(localDaOs(com(null, null))).toBe('');
    });
  });

  describe('correspondeABuscaOs', () => {
    const os = paraOsLocal('o1', 1, {
      codigoProvisorio: 'OSP-K7Q2ZP', numero: 123, revisao: 2, propostaCodigoExibido: '000277-R2', clienteId: 'c1',
      tipo: 'MANUTENCAO', status: 'ABERTA', urgente: false, concluiProposta: true, assinaturaRecusada: false, itens: [],
      notas: [], anexos: [], historico: [],
    });
    const cliente = paraClienteLocal('c1', 1, {
      tipo: 'PJ', documento: '11444777000161', nome: 'Padaria São João', nomeFantasia: 'Pão Quente', inscricaoEstadual: null,
      inscricaoMunicipal: null, email: null, telefone: null, whatsapp: null, contatoNome: null, observacoes: null, enderecos: [],
    });

    it.each([
      ['', true], ['  ', true], ['OS-000123', true], ['123', true], ['os-000123-r2', true], ['osp-k7q', true],
      ['000277', true], ['sao joao', true], ['PÃO QUENTE', true], ['11.444.777/0001', true], ['nada', false], ['11', false],
    ])('"%s" → %s', (busca, esperado) => {
      expect(correspondeABuscaOs(os, cliente, busca)).toBe(esperado);
    });

    it('sem o cliente no aparelho: só os códigos', () => {
      expect(correspondeABuscaOs(os, undefined, '123')).toBe(true);
      expect(correspondeABuscaOs(os, undefined, 'padaria')).toBe(false);
    });
  });
});
