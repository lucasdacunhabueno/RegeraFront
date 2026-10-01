import { ROTULO_CAMPO_ANEXO } from '../../core/sync/tipos-upload';
import { ErroCampo } from '../../core/util/erro-campo';

/**
 * Exibição dos erros da OS nas telas, no padrão do `mensagemErroProposta`. Funções puras, sem import do `OsRepo`.
 */

/** O texto de cada código: os do `ErroOs` (aparelho e servidor) e os que só o servidor devolve no push e no upload. */
const POR_CODIGO: ReadonlyMap<string, string> = new Map([
  // regras espelhadas do servidor
  ['ACESSO_NEGADO', 'Você não tem permissão para esta ação nesta OS.'],
  ['TRANSICAO_INVALIDA', 'Esta mudança de status não é possível nesta OS.'],
  ['OS_NAO_EDITAVEL', 'Alguns campos não podem ser alterados nesta OS.'],
  ['VALIDACAO', 'Revise os campos destacados.'],
  ['STATUS_INVALIDO', 'A OS não está no status que esta ação exige.'],
  ['LIMITE_FOTOS', 'Esta OS já tem o máximo de 20 fotos.'],
  ['LIMITE_ASSINATURAS', 'Esta OS já tem o máximo de 10 assinaturas.'],
  ['LIMITE_DOCUMENTOS', 'Esta OS já tem o máximo de 20 PDFs.'],
  // só do aparelho
  ['NAO_ENCONTRADA', 'OS não encontrada neste aparelho.'],
  ['RESOLVA_A_PENDENCIA', 'Resolva a pendência desta OS antes de continuar.'],
  ['ASSINATURA_COLHIDA', 'A assinatura já foi colhida: não dá para registrar a recusa.'],
  ['ASSINATURA_GRANDE', 'A assinatura ficou grande demais.'],
  ['ASSINATURA_FALHOU', 'Não foi possível gerar a assinatura.'],
  ['SEM_ESPACO', 'Pouco espaço no aparelho.'],
  ['OS_JA_CONCLUIDA', 'Esta OS já foi concluída.'],
  ['OS_ALTERADA', 'A OS mudou enquanto o PDF era gerado. Conclua de novo.'],
  ['SNAPSHOT_GRANDE', 'Os dados desta OS passam do limite do documento (512 KB).'],
  ['PDF_GRANDE', 'O PDF passou de 10 MB.'],
  ['OS_SINCRONIZANDO', 'A OS está sendo sincronizada. Tente de novo em instantes.'],
  ['PROPOSTA_NAO_CANCELADA', 'Só há trabalho a aceitar quando a proposta desta OS está cancelada.'],
  ['OS_CANCELADA', 'Esta OS está cancelada: não há trabalho a aceitar nela.'],
  ['FOTO_TIPO', 'Escolha uma imagem.'],
  ['FOTO_ILEGIVEL', 'Não foi possível abrir a foto. Escolha outra imagem.'],
  ['FOTO_GRANDE', 'A foto ficou grande demais.'],
  // só do servidor (push e upload de anexo)
  ['OS_CONCLUIDA_POR_OUTRO', 'Esta OS foi concluída pelo escritório.'],
  ['OS_NAO_ENCONTRADA', 'Esta OS não está mais com você.'],
  ['REGISTRO_EXCLUIDO', 'Esta OS foi excluída.'],
  ['REGISTRO_NAO_ENCONTRADO', 'OS não encontrada no servidor.'],
  ['CODIGO_PROVISORIO_DUPLICADO', 'O código provisório desta OS já foi usado.'],
  ['CLIENTE_COM_OS', 'Este cliente tem OS em aberto.'],
  ['ARQUIVO_VAZIO', 'O arquivo do anexo está vazio.'],
  ['ARQUIVO_GRANDE', 'O arquivo do anexo é grande demais.'],
  ['SHA_DIVERGENTE', 'O arquivo chegou diferente do que foi gravado no aparelho.'],
  ['TIPO_NAO_SUPORTADO', 'O tipo do arquivo não é aceito para este anexo.'],
  ['CORPO_INVALIDO', 'O servidor não reconheceu os dados deste anexo.'],
  ['ANEXO_DIVERGENTE', 'Já existe no servidor um anexo com este identificador e outro conteúdo.'],
  ['REVISAO_INVALIDA', 'O PDF é de outra revisão da OS.'],
  ['CODIGO_EXIBIDO_INVALIDO', 'O código impresso no PDF não é o desta OS.'],
]);

/** Os códigos que têm texto (para os testes conferirem que nenhum ficou de fora). */
export const CODIGOS_ERRO_OS: readonly string[] = [...POR_CODIGO.keys()];

const GENERICA = 'Não foi possível concluir. Tente de novo.';

/**
 * Texto do toast para um erro do `OsRepo` (ou de uma ação de pendência da OS). Um `ErroCampo` (e o `ErroOs`, que o
 * estende) já vem com a mensagem em pt-BR, que é usada; sem ela, o texto do `codigo`. Qualquer outro erro (Dexie, PDF,
 * rede) é técnico e vira a mensagem genérica.
 */
export function mensagemErroOs(e: unknown): string {
  if (!(e instanceof ErroCampo)) return GENERICA;
  if (e.message.trim()) return e.message;
  const codigo = (e as ErroCampo & { codigo?: unknown }).codigo;
  return (typeof codigo === 'string' && POR_CODIGO.get(codigo)) || GENERICA;
}

/**
 * O que "Usar a do servidor" ou "Descartar" de uma pendência levaria de uma OS, feito neste aparelho e ainda não enviado
 * (P4c-R15, M2-P2 M1; `PendenciasService.perdaDaOs`).
 */
export type ItemPerdaOs =
  | 'inicio' | 'notas' | 'fotos' | 'assinatura' | 'recusa' | 'precisaVoltar' | 'conclusao' | 'resumo' | 'pdf'
  | 'cancelamento' | 'reabertura';

/** Na ordem do trabalho de campo (a da fila: iniciar, notas, fotos, assinatura, concluir, PDF), e depois o escritório. */
const ROTULO_PERDA: Readonly<Record<ItemPerdaOs, string>> = {
  inicio: 'o início',
  notas: 'as notas',
  fotos: 'as fotos',
  assinatura: 'a assinatura',
  recusa: 'a recusa da assinatura',
  precisaVoltar: 'o "Precisa voltar"',
  conclusao: 'a conclusão',
  resumo: 'o resumo',
  pdf: 'o PDF',
  cancelamento: 'o cancelamento',
  reabertura: 'a reabertura',
};
/** A ordem canônica dos itens (a do `ROTULO_PERDA`). */
export const ORDEM_PERDA_OS: readonly ItemPerdaOs[] = Object.keys(ROTULO_PERDA) as ItemPerdaOs[];

/** "a, b e c". */
function emLista(itens: readonly string[]): string {
  return itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`;
}

/** O aviso da confirmação (P4c-R15), nomeando o que sai, na ordem canônica. Não vazio. */
export function textoPerdaOs(itens: readonly ItemPerdaOs[]): string {
  const presentes = new Set(itens);
  const nomes = ORDEM_PERDA_OS.filter((i) => presentes.has(i)).map((i) => ROTULO_PERDA[i]);
  return `Isto descarta o que esta OS tem neste aparelho e ainda não foi enviado: ${emLista(nomes)}.`;
}

/** Os campos da OS nos `campos` de uma recusa VALIDACAO (do push e do upload de anexo), como o usuário os conhece. */
const ROTULO_CAMPO_OS: Readonly<Record<string, string>> = {
  ...ROTULO_CAMPO_ANEXO,
  os: 'OS',
  propostaId: 'Proposta',
  clienteId: 'Cliente',
  codigoProvisorio: 'Código provisório',
  tipo: 'Tipo',
  status: 'Status',
  descricao: 'Descrição',
  dataPrevista: 'Data prevista',
  urgente: 'Urgente',
  tecnicoId: 'Técnico',
  responsavelId: 'Responsável',
  endereco: 'Endereço',
  enderecoId: 'Endereço',
  enderecoCep: 'CEP',
  enderecoLogradouro: 'Logradouro',
  enderecoNumero: 'Número',
  enderecoComplemento: 'Complemento',
  enderecoBairro: 'Bairro',
  enderecoCidade: 'Cidade',
  enderecoUf: 'UF',
  itens: 'Itens',
  notas: 'Notas',
  concluiProposta: 'Conclui a proposta',
  resumoExecucao: 'Resumo da execução',
  assinatura: 'Assinatura',
  assinaturaRecusada: 'Recusa da assinatura',
  motivoRecusa: 'Motivo da recusa',
  motivoCancelamento: 'Motivo do cancelamento',
  motivoReabertura: 'Motivo da reabertura',
  aceitarTrabalho: 'Aceite do trabalho',
  foto: 'Foto',
};
/** Os campos de uma linha (`itens[i].campo`). */
const ROTULO_CAMPO_ITEM: Readonly<Record<string, string>> = {
  id: 'linha',
  itemCatalogoId: 'item do catálogo',
  codigo: 'código',
  nome: 'nome',
  unidade: 'unidade',
  natureza: 'natureza',
  quantidadePrevista: 'quantidade prevista',
  ordem: 'ordem',
};
const CAMINHO_NOTA = /^notas\[\d+\](?:\.\w+)?$/;
const CAMINHO_ITEM = /^itens\[(\d+)\](?:\.(\w+))?$/;

/**
 * N1: o rótulo de um campo da OS numa recusa (`notas[i].texto` → "Nota", `itens[i].quantidadePrevista` → "Item N
 * (quantidade prevista)", `resumoExecucao` → "Resumo da execução"); o caminho cru quando não é conhecido.
 */
export function rotuloCampoOs(campo: string): string {
  if (CAMINHO_NOTA.test(campo)) return 'Nota';
  const item = CAMINHO_ITEM.exec(campo);
  if (item) {
    const n = Number(item[1]) + 1;
    const sub = item[2];
    if (sub === undefined) return `Item ${n}`;
    return `Item ${n} (${Object.hasOwn(ROTULO_CAMPO_ITEM, sub) ? ROTULO_CAMPO_ITEM[sub] : sub})`;
  }
  return Object.hasOwn(ROTULO_CAMPO_OS, campo) ? ROTULO_CAMPO_OS[campo] : campo;
}
