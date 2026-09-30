/** Erro de validação local associado a um campo do formulário. */
export class ErroCampo extends Error {
  constructor(
    readonly campo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}
