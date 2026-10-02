import { ErroCampo } from '../../core/util/erro-campo';
import { ErroOs } from './erro-os';
import { ClienteLocal, paraClienteLocal } from '../clientes/cliente-models';
import {
  atrasadaOs, CODIGOS_ERRO_OS, concluidaRecente, correspondeABuscaOs, criacaoOs, localDaOs, mensagemErroOs, osEncerrada, rotuloCampoOs,
  osPorProposta, selosDaOs, selosOsDaProposta, textoPerdaOs,
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

    it('T4 fix (I1 da T5): a OS criada aqui, as alterações do cabeçalho e a troca de técnico (as do escritório, no fim)', () => {
      expect(textoPerdaOs(['trocaTecnico', 'cabecalho', 'notas', 'criacao'])).toBe(
        'Isto descarta o que esta OS tem neste aparelho e ainda não foi enviado: a OS criada neste aparelho, as notas, '
        + 'as alterações do cabeçalho e a troca de técnico.');
    });

    it('R2: a troca de responsável tem o nome dela, depois da de técnico', () => {
      expect(textoPerdaOs(['trocaResponsavel'])).toBe(
        'Isto descarta o que esta OS tem neste aparelho e ainda não foi enviado: a troca de responsável.');
      expect(textoPerdaOs(['trocaResponsavel', 'trocaTecnico'])).toBe(
        'Isto descarta o que esta OS tem neste aparelho e ainda não foi enviado: a troca de técnico e a troca de responsável.');
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

    it('M2P3-R7 criacaoOs: o mais cedo entre o instante do UUIDv7 do id e a criação no histórico, em data de São Paulo', () => {
      // só o histórico (id que não é v7): 01:30 UTC de 10-02 ainda é 10-01 em São Paulo; 03:00 UTC já é 10-02
      expect(criacaoOs(os('ABERTA', criada('2026-10-02T01:30:00Z'), ID_V5))).toBe('2026-10-01');
      expect(criacaoOs(os('ABERTA', criada('2026-10-02T03:00:00Z'), ID_V5))).toBe('2026-10-02');
      // os dois: vale o mais cedo
      expect(criacaoOs(os('ABERTA', criada('2026-09-20T12:00:00Z')))).toBe('2026-09-20');
      expect(criacaoOs(os('ABERTA', criada('2026-10-04T12:00:00Z')))).toBe('2026-10-01');
      // só o id: a OS criada aqui e ainda não enviada
      expect(criacaoOs(os('ABERTA'))).toBe('2026-10-01');
      // criada offline às 23:30 de São Paulo (02:30 UTC do dia seguinte)
      expect(criacaoOs(os('ABERTA', {}, idV7('2026-10-02T02:30:00Z')))).toBe('2026-10-01');
      // as transições não são a criação
      expect(criacaoOs(os('ABERTA', { historico: [{ statusDe: 'ABERTA', statusPara: 'EM_ANDAMENTO', usuarioId: 'u', em: '2026-09-01T12:00:00Z' }] })))
        .toBe('2026-10-01');
      // sem v7 e sem a criação no histórico: sem data
      expect(criacaoOs(os('ABERTA', {}, ID_V5))).toBeNull();
    });

    it('M2P3-R7: criada offline e sincronizada 3 dias depois, o prazo continua contando da criação no aparelho', () => {
      // o aparelho criou em 10-01 (o id); o servidor só gravou a criação no sync, em 10-04
      const sincronizadaDepois = criada('2026-10-04T15:00:00Z');
      expect(criacaoOs(os('ABERTA', sincronizadaDepois))).toBe('2026-10-01');
      // urgente: o limite é 10-08 (10-01 + 7), não 10-11 (10-04 + 7)
      expect(atrasadaOs(os('ABERTA', { ...sincronizadaDepois, urgente: true, dataPrevista: '2026-10-08' }), '2026-10-04')).toBe(false);
      expect(atrasadaOs(os('ABERTA', { ...sincronizadaDepois, urgente: true, dataPrevista: '2026-10-09' }), '2026-10-04')).toBe(true);
      // sem data prevista: atrasada a partir de 10-09
      expect(atrasadaOs(os('ABERTA', { ...sincronizadaDepois, urgente: true }), '2026-10-08')).toBe(false);
      expect(atrasadaOs(os('ABERTA', { ...sincronizadaDepois, urgente: true }), '2026-10-09')).toBe(true);
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
      expect(atrasadaOs(os('ABERTA', { ...noite, urgente: true, dataPrevista: '2026-10-08' }, ID_V5), '2026-10-01')).toBe(false);
      expect(atrasadaOs(os('ABERTA', { ...noite, urgente: true, dataPrevista: '2026-10-09' }, ID_V5), '2026-10-01')).toBe(true);
      // o mesmo instante no id v7
      const id = idV7('2026-10-02T01:30:00Z');
      expect(atrasadaOs(os('ABERTA', { urgente: true, dataPrevista: '2026-10-08' }, id), '2026-10-01')).toBe(false);
      expect(atrasadaOs(os('ABERTA', { urgente: true, dataPrevista: '2026-10-09' }, id), '2026-10-01')).toBe(true);
    });

    it('o prazo atravessa o fim do mês e do ano', () => {
      const dezembro = idV7('2026-12-28T15:00:00Z');
      expect(atrasadaOs(os('ABERTA', { urgente: true, dataPrevista: '2027-01-04' }, dezembro), '2026-12-28')).toBe(false);
      expect(atrasadaOs(os('ABERTA', { urgente: true, dataPrevista: '2027-01-05' }, dezembro), '2026-12-28')).toBe(true);
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

    it('M7: "Trabalho em proposta cancelada" primeiro, com a proposta cancelada e a OS em andamento ou concluída', () => {
      const hoje = '2026-10-01';
      const tipos = (o: OsLocal, propostaCancelada: boolean) =>
        selosDaOs(o, { naoSincronizada: true, hoje, propostaCancelada }).map((s) => s.tipo);
      expect(tipos(os('EM_ANDAMENTO', { urgente: true, dataPrevista: '2026-10-05' }), true))
        .toEqual(['proposta-cancelada', 'urgente', 'nao-sincronizada']);
      expect(selosDaOs(os('CONCLUIDA'), { naoSincronizada: false, hoje, propostaCancelada: true }))
        .toEqual([{ tipo: 'proposta-cancelada', rotulo: 'Trabalho em proposta cancelada' }]);
      // sem trabalho (aberta) ou já cancelada: nada a aceitar ali
      expect(tipos(os('ABERTA', { dataPrevista: '2026-10-05' }), true)).toEqual(['nao-sincronizada']);
      expect(tipos(os('CANCELADA'), true)).toEqual(['nao-sincronizada']);
      expect(tipos(os('EM_ANDAMENTO', { dataPrevista: '2026-10-05' }), false)).toEqual(['nao-sincronizada']);
    });

    it('osEncerrada: concluída e cancelada', () => {
      expect((['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'] as const).map(osEncerrada)).toEqual([false, false, true, true]);
    });

    it('M2P3-R6 concluidaRecente: CONCLUIDA com concluidaEm nos últimos 7 dias de São Paulo (hoje e os 6 anteriores)', () => {
      const hoje = '2026-10-10';
      const concluida = (concluidaEm: string | null) => os('CONCLUIDA', { concluidaEm });
      expect(concluidaRecente(concluida('2026-10-10T12:00:00Z'), hoje)).toBe(true);
      expect(concluidaRecente(concluida('2026-10-04T12:00:00Z'), hoje)).toBe(true);
      expect(concluidaRecente(concluida('2026-10-03T12:00:00Z'), hoje)).toBe(false);
      // 02:30 UTC de 10-04 ainda é 10-03 em São Paulo: fora; 03:30 UTC já é 10-04: dentro
      expect(concluidaRecente(concluida('2026-10-04T02:30:00Z'), hoje)).toBe(false);
      expect(concluidaRecente(concluida('2026-10-04T03:30:00Z'), hoje)).toBe(true);
      // concluída aqui e ainda sem o concluidaEm do servidor: é recente
      expect(concluidaRecente(concluida(null), hoje)).toBe(true);
      // só CONCLUIDA
      for (const s of ['ABERTA', 'EM_ANDAMENTO', 'CANCELADA'] as const) {
        expect(concluidaRecente(os(s, { concluidaEm: '2026-10-10T12:00:00Z' }), hoje)).toBe(false);
      }
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
      notas: [], anexos: [], historico: [], enderecoBairro: 'Bela Vista', enderecoCidade: 'São Paulo',
    });
    const cliente = paraClienteLocal('c1', 1, {
      tipo: 'PJ', documento: '11444777000161', nome: 'Padaria São João', nomeFantasia: 'Pão Quente', inscricaoEstadual: null,
      inscricaoMunicipal: null, email: null, telefone: null, whatsapp: null, contatoNome: null, observacoes: null, enderecos: [],
    });

    it.each([
      ['', true], ['  ', true], ['OS-000123', true], ['123', true], ['os-000123-r2', true], ['osp-k7q', true],
      ['000277', true], ['sao joao', true], ['PÃO QUENTE', true], ['11.444.777/0001', true], ['nada', false], ['11', false],
      // M2: bairro e cidade do snapshot (o que o card mostra)
      ['bela vista', true], ['SAO PAULO', true], ['vista · sao', true],
    ])('"%s" → %s', (busca, esperado) => {
      expect(correspondeABuscaOs(os, cliente, busca)).toBe(esperado);
    });

    it('sem o cliente no aparelho: os códigos e o local', () => {
      expect(correspondeABuscaOs(os, undefined, '123')).toBe(true);
      expect(correspondeABuscaOs(os, undefined, 'bela vista')).toBe(true);
      expect(correspondeABuscaOs(os, undefined, 'padaria')).toBe(false);
    });

    it('M2: cliente sem documento no aparelho (documento null): a busca por números não quebra nem casa por documento', () => {
      const semDocumento: ClienteLocal = { ...cliente, documento: null };
      expect(correspondeABuscaOs(os, semDocumento, '11.444.777/0001')).toBe(false);
      expect(correspondeABuscaOs(os, semDocumento, '114447')).toBe(false);
      expect(correspondeABuscaOs(os, semDocumento, 'padaria')).toBe(true);
      expect(correspondeABuscaOs(os, semDocumento, '123')).toBe(true);
    });
  });

  describe('selosOsDaProposta (card da proposta e kanban)', () => {
    let seq = 0;
    const os = (status: StatusOs, extra: Partial<OsLocal> = {}): OsLocal => ({
      ...paraOsLocal(`o${++seq}`, 1, {
        codigoProvisorio: 'OSP-AAAAAA', propostaId: 'p1', clienteId: 'c1', tipo: 'SERVICO', status, urgente: false,
        concluiProposta: true, assinaturaRecusada: false, itens: [], notas: [],
      } as OsDados),
      ...extra,
    });
    const tipos = (status: Parameters<typeof selosOsDaProposta>[0], lista: OsLocal[]) =>
      selosOsDaProposta(status, lista).map((s) => s.tipo);

    it('sem OS, nenhum selo', () => {
      expect(selosOsDaProposta('APROVADA', [])).toEqual([]);
    });

    it('OS aberta: nenhum selo (o trabalho ainda não começou)', () => {
      expect(tipos('APROVADA', [os('ABERTA')])).toEqual([]);
    });

    it('"OS em andamento", "OS concluída", com os rótulos', () => {
      expect(selosOsDaProposta('EM_EXECUCAO', [os('EM_ANDAMENTO')])).toEqual([{ tipo: 'os-em-andamento', rotulo: 'OS em andamento' }]);
      expect(selosOsDaProposta('FINALIZADA', [os('CONCLUIDA')])).toEqual([{ tipo: 'os-concluida', rotulo: 'OS concluída' }]);
    });

    it('"OS cancelada" (Q11): a proposta não se move e o comercial decide; some quando outra OS está em curso', () => {
      expect(selosOsDaProposta('APROVADA', [os('CANCELADA')])).toEqual([{ tipo: 'os-cancelada', rotulo: 'OS cancelada' }]);
      expect(tipos('EM_EXECUCAO', [os('CANCELADA')])).toEqual(['os-cancelada']);
      // o comercial já decidiu: gerou outra OS
      expect(tipos('APROVADA', [os('CANCELADA'), os('ABERTA')])).toEqual([]);
      expect(tipos('EM_EXECUCAO', [os('CANCELADA'), os('EM_ANDAMENTO')])).toEqual(['os-em-andamento']);
      // proposta encerrada: não há o que decidir
      expect(tipos('FINALIZADA', [os('CANCELADA'), os('CONCLUIDA')])).toEqual(['os-concluida']);
      expect(tipos('CANCELADA', [os('CANCELADA')])).toEqual([]);
    });

    it('"Retorno pendente" (Q21): concluída sem concluir a proposta e nenhuma outra aberta ou em andamento', () => {
      expect(selosOsDaProposta('EM_EXECUCAO', [os('CONCLUIDA', { concluiProposta: false })])).toEqual([
        { tipo: 'os-concluida', rotulo: 'OS concluída' },
        { tipo: 'retorno-pendente', rotulo: 'Retorno pendente' },
      ]);
      // o retorno já foi gerado (aberta) ou está em curso
      expect(tipos('EM_EXECUCAO', [os('CONCLUIDA', { concluiProposta: false }), os('ABERTA')])).toEqual(['os-concluida']);
      expect(tipos('EM_EXECUCAO', [os('CONCLUIDA', { concluiProposta: false }), os('EM_ANDAMENTO')]))
        .toEqual(['os-em-andamento', 'os-concluida']);
      // a OS de retorno cancelada não resolve o retorno
      expect(tipos('EM_EXECUCAO', [os('CONCLUIDA', { concluiProposta: false }), os('CANCELADA')]))
        .toEqual(['os-concluida', 'retorno-pendente', 'os-cancelada']);
    });

    it('"Retorno pendente" some quando uma OS que conclui a proposta já concluiu, ou a proposta saiu da execução', () => {
      // a OS marcada concluiu: o servidor finaliza a proposta (Q17), não há retorno
      expect(tipos('EM_EXECUCAO', [os('CONCLUIDA', { concluiProposta: false }), os('CONCLUIDA')])).toEqual(['os-concluida']);
      expect(tipos('FINALIZADA', [os('CONCLUIDA', { concluiProposta: false })])).toEqual(['os-concluida']);
      expect(tipos('CANCELADA', [os('CONCLUIDA', { concluiProposta: false })])).not.toContain('retorno-pendente');
    });

    it('"Trabalho em proposta cancelada" (M2-R4): proposta cancelada com OS em andamento ou concluída', () => {
      expect(selosOsDaProposta('CANCELADA', [os('EM_ANDAMENTO')])).toEqual([
        { tipo: 'trabalho-proposta-cancelada', rotulo: 'Trabalho em proposta cancelada' },
        { tipo: 'os-em-andamento', rotulo: 'OS em andamento' },
      ]);
      expect(tipos('CANCELADA', [os('CONCLUIDA')])).toEqual(['trabalho-proposta-cancelada', 'os-concluida']);
      // sem trabalho: a OS só aberta ou cancelada
      expect(tipos('CANCELADA', [os('ABERTA')])).toEqual([]);
      expect(tipos('CANCELADA', [os('CANCELADA')])).toEqual([]);
      // a recusada não tem aceite (o servidor só reabre a cancelada)
      expect(tipos('RECUSADA', [os('EM_ANDAMENTO')])).toEqual(['os-em-andamento']);
    });

    it('osPorProposta agrupa pela proposta, na ordem recebida, e deixa a avulsa de fora', () => {
      const a = os('ABERTA', { propostaId: 'p1' });
      const b = os('CONCLUIDA', { propostaId: 'p2' });
      const c = os('CANCELADA', { propostaId: 'p1' });
      const avulsa = os('ABERTA', { propostaId: null });
      expect([...osPorProposta([a, b, avulsa, c])]).toEqual([['p1', [a, c]], ['p2', [b]]]);
    });

    it('um selo de cada tipo, mesmo com várias OS no mesmo status', () => {
      expect(tipos('EM_EXECUCAO', [os('EM_ANDAMENTO'), os('EM_ANDAMENTO'), os('CONCLUIDA'), os('CONCLUIDA')]))
        .toEqual(['os-em-andamento', 'os-concluida']);
    });
  });
});
