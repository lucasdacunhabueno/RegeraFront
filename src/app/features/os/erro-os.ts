import type { ErroMutacao } from '../../core/sync/sync-models';
import { ErroCampo } from '../../core/util/erro-campo';

/**
 * Recusa local da OS, como o `ErroProposta`: `codigo` é o que o servidor daria (`VALIDACAO`, `ACESSO_NEGADO`...) ou um
 * só do aparelho (`FOTO_TIPO`, `FOTO_ILEGIVEL`, `FOTO_GRANDE`, `SEM_ESPACO`, `ASSINATURA_GRANDE`...). `campo` é o
 * primeiro campo com erro (nomes do servidor) ou `os`/`foto`/`assinatura` quando não é de um campo; `campos` traz
 * todos, na validação. A mensagem já é a do usuário, em pt-BR.
 */
export class ErroOs extends ErroCampo {
  constructor(
    readonly codigo: string,
    campo: string,
    mensagem: string,
    readonly campos?: Record<string, string>,
  ) {
    super(campo, mensagem);
  }

  static de(e: ErroMutacao): ErroOs {
    const [primeiro] = Object.entries(e.campos ?? {});
    return primeiro ? new ErroOs(e.codigo, primeiro[0], primeiro[1], { ...e.campos }) : new ErroOs(e.codigo, 'os', e.mensagem);
  }
}
