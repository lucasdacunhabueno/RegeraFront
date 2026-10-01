import { ErroCampo } from '../../core/util/erro-campo';
import { paraClienteLocal } from '../clientes/cliente-models';
import {
  correspondeABusca,
  dataHoraBr,
  expirada,
  rotuloDoCampo,
  mensagemErroProposta,
  moedaCentavos,
  rotuloCodigo,
  rotuloTipo,
  selosDaProposta,
} from './formatos-proposta';
import { PropostaLocal, StatusProposta } from './proposta-models';
import { ErroProposta } from './propostas-repo';

const HOJE = '2026-10-01';

function proposta(p: Partial<PropostaLocal> = {}): PropostaLocal {
  return {
    id: 'p1', version: 1, codigoProvisorio: 'PROV-7K3M9Q', numero: null, revisao: null, tipo: 'VENDA', status: 'RASCUNHO',
    clienteId: 'c1', templateId: null, responsavelId: 'u1', tecnicoId: null, dataEmissao: '2026-09-20',
    validadeAte: '2026-09-30', condicoesPagamento: null, prazoExecucao: null, observacoes: null, descontoGeralCentesimos: null,
    totalItensCentavos: null, totalDescontosCentavos: null, totalCentavos: null, motivoEncerramento: null, itens: [],
    historico: [], documentos: [], atualizadoEm: null, ...p,
  };
}

describe('formatos-proposta', () => {
  describe('expirada', () => {
    it('só ENVIADA com validade antes de hoje (São Paulo)', () => {
      expect(expirada(proposta({ status: 'ENVIADA', validadeAte: '2026-09-30' }), HOJE)).toBe(true);
      expect(expirada(proposta({ status: 'ENVIADA', validadeAte: HOJE }), HOJE)).toBe(false);
      expect(expirada(proposta({ status: 'ENVIADA', validadeAte: '2026-10-02' }), HOJE)).toBe(false);
      expect(expirada(proposta({ status: 'ENVIADA', validadeAte: null }), HOJE)).toBe(false);
    });

    it.each<StatusProposta>(['RASCUNHO', 'APROVADA', 'EM_EXECUCAO', 'FINALIZADA', 'RECUSADA', 'CANCELADA'])(
      '%s vencida não é expirada',
      (status) => {
        expect(expirada(proposta({ status, validadeAte: '2026-01-01' }), HOJE)).toBe(false);
      },
    );

    it('compara pela data, mesmo com hora na validade', () => {
      expect(expirada(proposta({ status: 'ENVIADA', validadeAte: '2026-10-01T23:59:00' }), HOJE)).toBe(false);
      expect(expirada(proposta({ status: 'ENVIADA', validadeAte: '2026-09-30T23:59:00' }), HOJE)).toBe(true);
    });
  });

  it('rotuloCodigo: PROV, número com 6 dígitos e -R<n> a partir da revisão 2', () => {
    expect(rotuloCodigo(proposta())).toBe('PROV-7K3M9Q');
    expect(rotuloCodigo(proposta({ numero: 277, revisao: 1 }))).toBe('000277');
    expect(rotuloCodigo(proposta({ numero: 277, revisao: 2 }))).toBe('000277-R2');
  });

  it('moedaCentavos: R$ 1.234,56', () => {
    expect(moedaCentavos(123456)).toBe('R$ 1.234,56');
    expect(moedaCentavos(0)).toBe('R$ 0,00');
  });

  it('rotuloTipo', () => {
    expect(rotuloTipo('SERVICO')).toBe('Serviço');
    expect(rotuloTipo('LOCACAO')).toBe('Locação');
  });

  describe('selosDaProposta', () => {
    it('os três, na ordem Expirada, Não sincronizada, Pendência', () => {
      const selos = selosDaProposta(proposta({ status: 'ENVIADA', validadeAte: '2026-09-15' }), {
        pendente: true, naoSincronizada: true, hoje: HOJE,
      });
      expect(selos).toEqual([
        { tipo: 'expirada', rotulo: 'Expirada' },
        { tipo: 'nao-sincronizada', rotulo: 'Não sincronizada' },
        { tipo: 'pendencia', rotulo: 'Pendência' },
      ]);
    });

    it('nenhum quando está em dia', () => {
      expect(selosDaProposta(proposta({ status: 'ENVIADA', validadeAte: HOJE }), { pendente: false, naoSincronizada: false, hoje: HOJE }))
        .toEqual([]);
    });

    it('cada selo sozinho', () => {
      const p = proposta();
      expect(selosDaProposta(p, { pendente: true, naoSincronizada: false, hoje: HOJE }).map((s) => s.tipo)).toEqual(['pendencia']);
      expect(selosDaProposta(p, { pendente: false, naoSincronizada: true, hoje: HOJE }).map((s) => s.tipo)).toEqual(['nao-sincronizada']);
    });
  });

  describe('correspondeABusca', () => {
    const cliente = paraClienteLocal('c1', 1, {
      tipo: 'PJ', documento: '11444777000161', nome: 'Padaria São João', nomeFantasia: 'Pão Quente', inscricaoEstadual: null,
      inscricaoMunicipal: null, email: null, telefone: null, whatsapp: null, contatoNome: null, observacoes: null, enderecos: [],
    });
    const numerada = proposta({ numero: 277, revisao: 2 });

    it('busca vazia aceita tudo', () => {
      expect(correspondeABusca(numerada, undefined, '  ')).toBe(true);
    });

    it('pelo número, com ou sem zeros e revisão', () => {
      expect(correspondeABusca(numerada, undefined, '277')).toBe(true);
      expect(correspondeABusca(numerada, undefined, '000277-r2')).toBe(true);
      expect(correspondeABusca(numerada, undefined, '278')).toBe(false);
    });

    it('pelo PROV, também depois de numerada (o PDF offline saiu com ele)', () => {
      expect(correspondeABusca(proposta(), undefined, 'prov-7k3')).toBe(true);
      expect(correspondeABusca(numerada, undefined, '7K3M9Q')).toBe(true);
    });

    it('pelo nome do cliente (sem acento e sem caixa) e pelo nome fantasia', () => {
      expect(correspondeABusca(proposta(), cliente, 'sao joao')).toBe(true);
      expect(correspondeABusca(proposta(), cliente, 'PÃO')).toBe(true);
      expect(correspondeABusca(proposta(), cliente, 'mercado')).toBe(false);
    });

    it('pelo documento do cliente, com ou sem máscara', () => {
      expect(correspondeABusca(proposta(), cliente, '11.444.777')).toBe(true);
      expect(correspondeABusca(proposta(), cliente, '0001-61')).toBe(true);
    });

    it('sem cliente, só o código conta', () => {
      expect(correspondeABusca(proposta({ clienteId: null }), undefined, 'padaria')).toBe(false);
    });
  });

  describe('mensagemErroProposta', () => {
    it('usa a mensagem pt-BR que o repositório já pôs no erro', () => {
      const e = new ErroProposta('PDF_GRANDE', 'proposta', 'O PDF passou de 10 MB. Reduza imagens do template.');
      expect(mensagemErroProposta(e)).toBe('O PDF passou de 10 MB. Reduza imagens do template.');
      expect(mensagemErroProposta(new ErroCampo('nome', 'Informe o nome.'))).toBe('Informe o nome.');
    });

    it.each([
      ['PROPOSTA_JA_ENVIADA', 'Esta proposta já foi enviada.'],
      ['PDF_GRANDE', 'O PDF passou de 10 MB. Reduza imagens do template.'],
      ['SNAPSHOT_GRANDE', 'Os dados desta proposta passam do limite do documento (512 KB).'],
      ['PROPOSTA_ALTERADA', 'A proposta mudou enquanto o PDF era gerado. Envie de novo.'],
      ['USE_ENVIAR', 'Para enviar, gere o PDF oficial da proposta.'],
      ['RESOLVA_A_PENDENCIA', 'Resolva a pendência desta proposta antes de editá-la.'],
      ['VALIDACAO', 'Revise os campos destacados.'],
      ['ACESSO_NEGADO', 'Você não tem permissão para esta ação.'],
    ])('%s sem mensagem cai no texto do código', (codigo, texto) => {
      expect(mensagemErroProposta(new ErroProposta(codigo, 'proposta', ''))).toBe(texto);
    });

    it('código desconhecido sem mensagem e erro qualquer: texto genérico', () => {
      const generico = 'Não foi possível concluir. Tente de novo.';
      expect(mensagemErroProposta(new ErroProposta('OUTRO', 'proposta', ''))).toBe(generico);
      expect(mensagemErroProposta(new ErroProposta('toString', 'proposta', ''))).toBe(generico);
      expect(mensagemErroProposta(new Error('QuotaExceededError: internal'))).toBe(generico);
      expect(mensagemErroProposta('x')).toBe(generico);
      expect(mensagemErroProposta(undefined)).toBe(generico);
    });
  });

  describe('dataHoraBr', () => {
    it('instante ISO → dd/mm/aaaa hh:mm na hora de São Paulo (não a do aparelho nem a do UTC)', () => {
      expect(dataHoraBr('2026-10-02T01:30:00Z')).toBe('01/10/2026 22:30');
      expect(dataHoraBr('2026-09-20T13:05:09.123456Z')).toBe('20/09/2026 10:05');
      expect(dataHoraBr('2026-09-20T00:00:00-03:00')).toBe('20/09/2026 00:00');
    });

    it('ausente ou inválido → texto vazio', () => {
      expect(dataHoraBr(null)).toBe('');
      expect(dataHoraBr('')).toBe('');
      expect(dataHoraBr('ontem')).toBe('');
    });
  });

  describe('rotuloDoCampo', () => {
    it('os campos da proposta pelos nomes do servidor; as linhas como "Item N" (1 em diante), com o campo', () => {
      expect(rotuloDoCampo('prazoExecucao')).toBe('Prazo de execução');
      expect(rotuloDoCampo('descontoGeralPercentual')).toBe('Desconto geral');
      expect(rotuloDoCampo('clienteId')).toBe('Cliente');
      expect(rotuloDoCampo('itens')).toBe('Itens');
      expect(rotuloDoCampo('itens[0].quantidade')).toBe('Item 1, quantidade');
      expect(rotuloDoCampo('itens[11].itemCatalogoId')).toBe('Item 12, item do catálogo');
      expect(rotuloDoCampo('itens[2].outro')).toBe('Item 3');
      // propriedades herdadas do Object não viram rótulo
      expect(rotuloDoCampo('itens[0].constructor')).toBe('Item 1');
      expect(rotuloDoCampo('toString')).toBeNull();
      expect(rotuloDoCampo('desconhecido')).toBeNull();
    });
  });
});
