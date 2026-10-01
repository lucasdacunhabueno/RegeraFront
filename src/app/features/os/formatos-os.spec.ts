import { ErroCampo } from '../../core/util/erro-campo';
import { ErroOs } from './erro-os';
import { CODIGOS_ERRO_OS, mensagemErroOs } from './formatos-os';

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
});
