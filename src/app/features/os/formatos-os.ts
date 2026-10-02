import { ROTULO_CAMPO_ANEXO } from '../../core/sync/tipos-upload';
import { normalizarDocumento } from '../../core/util/documentos';
import { ErroCampo } from '../../core/util/erro-campo';
import { normalizarBusca } from '../../core/util/formatos';
import type { ClienteLocal } from '../clientes/cliente-models';
import type { StatusProposta } from '../propostas/proposta-models';
import { hojeEmSaoPaulo, somarDias } from '../propostas/propostas-repo';
import { codigoOsExibido, OsLocal, StatusOs } from './os-models';

/**
 * Exibição da OS nas telas: erros (no padrão do `mensagemErroProposta`), selos, local e busca. Funções puras, sem
 * import do `OsRepo`.
 */

// --- lista e card ---

/** Concluída ou cancelada: fora da lista até "Mostrar encerradas". */
export function osEncerrada(status: StatusOs): boolean {
  return status === 'CONCLUIDA' || status === 'CANCELADA';
}

export interface SeloOs {
  tipo: 'proposta-cancelada' | 'urgente' | 'atrasada' | 'nao-sincronizada';
  rotulo: string;
}

/** Q10: o prazo da OS, em dias corridos desde a criação. */
export const PRAZO_DIAS_URGENTE = 7;
export const PRAZO_DIAS_NORMAL = 20;

const UUID_V7 = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A data (`aaaa-mm-dd`, em America/Sao_Paulo) em que a OS foi criada. O `OsLocal` não traz o `criadoEm`. M2P3-R7: vale
 * o mais cedo entre o instante do UUIDv7 do id (gerado no aparelho na criação) e a entrada de criação do histórico
 * (`statusDe` null, gravada pelo servidor quando a OS chega lá): a OS criada offline não reinicia o prazo no sync.
 * Sem nenhum dos dois (id de outra versão e sem o histórico), null.
 */
export function criacaoOs(os: Pick<OsLocal, 'id' | 'historico'>): string | null {
  const criacao = os.historico.find((h) => h.statusDe === null);
  const instantes = [instanteDoUuidV7(os.id), criacao ? Date.parse(criacao.em) : null].filter(
    (i): i is number => i !== null && !Number.isNaN(i),
  );
  return instantes.length === 0 ? null : hojeEmSaoPaulo(new Date(Math.min(...instantes)));
}

function instanteDoUuidV7(id: string): number | null {
  const m = UUID_V7.exec(id);
  return m ? parseInt(m[1] + m[2], 16) : null;
}

/**
 * Q10: a OS aberta ou em andamento está atrasada quando a data prevista já passou (antes de `hoje`, `aaaa-mm-dd` em
 * São Paulo) ou cai depois do prazo (criação + 7 dias na urgente, + 20 na normal). Sem data prevista, o prazo vencido
 * até hoje também conta. Sem a data de criação, só a data prevista passada.
 */
export function atrasadaOs(
  os: Pick<OsLocal, 'id' | 'historico' | 'status' | 'urgente' | 'dataPrevista'>,
  hoje: string,
): boolean {
  if (osEncerrada(os.status)) return false;
  const prevista = os.dataPrevista ? os.dataPrevista.slice(0, 10) : null;
  if (prevista !== null && prevista < hoje) return true;
  const criada = criacaoOs(os);
  if (criada === null) return false;
  return (prevista ?? hoje) > somarDias(criada, os.urgente ? PRAZO_DIAS_URGENTE : PRAZO_DIAS_NORMAL);
}

/**
 * Selos do card, sempre nesta ordem: "Trabalho em proposta cancelada" (M7, M2-R4: com `propostaCancelada`, que só a
 * tela do ADMIN passa, e a OS em andamento ou concluída, como o selo do card da proposta), "Urgente" (só com a OS
 * aberta ou em andamento), "Atrasada" (`atrasadaOs`) e "Não sincronizada" (há mutação ou upload da OS na outbox).
 */
export function selosDaOs(
  os: Pick<OsLocal, 'id' | 'historico' | 'status' | 'urgente' | 'dataPrevista'>,
  estado: { naoSincronizada: boolean; hoje: string; propostaCancelada?: boolean },
): SeloOs[] {
  const selos: SeloOs[] = [];
  if (estado.propostaCancelada && (os.status === 'EM_ANDAMENTO' || os.status === 'CONCLUIDA')) {
    selos.push({ tipo: 'proposta-cancelada', rotulo: 'Trabalho em proposta cancelada' });
  }
  if (os.urgente && !osEncerrada(os.status)) selos.push({ tipo: 'urgente', rotulo: 'Urgente' });
  if (atrasadaOs(os, estado.hoje)) selos.push({ tipo: 'atrasada', rotulo: 'Atrasada' });
  if (estado.naoSincronizada) selos.push({ tipo: 'nao-sincronizada', rotulo: 'Não sincronizada' });
  return selos;
}

// --- selos da OS no card da proposta e no kanban ---

export interface SeloOsProposta {
  tipo: 'trabalho-proposta-cancelada' | 'os-em-andamento' | 'os-concluida' | 'retorno-pendente' | 'os-cancelada';
  rotulo: string;
}

/**
 * Os selos que as OS da proposta (as do aparelho) dão ao card dela, um de cada tipo, nesta ordem:
 * - "Trabalho em proposta cancelada" (M2-R4): a proposta foi cancelada e uma OS dela está em andamento ou concluída.
 *   Só o ADMIN aceita o trabalho, na tela da OS. A recusada não entra: o servidor só reabre a cancelada;
 * - "OS em andamento" e "OS concluída": alguma OS nesse status;
 * - "Retorno pendente" (Q21): com a proposta aprovada ou em execução, uma OS concluída que não conclui a proposta,
 *   nenhuma outra aberta ou em andamento, e nenhuma concluída que a conclua (essa finalizaria a proposta, Q17);
 * - "OS cancelada" (Q11): com a proposta aprovada ou em execução, uma OS cancelada e nenhuma aberta ou em andamento.
 *   A proposta não se move sozinha e o comercial decide; com outra OS em curso, ele já decidiu.
 * A OS só aberta não dá selo: o trabalho ainda não começou.
 */
export function selosOsDaProposta(
  status: StatusProposta,
  oss: readonly Pick<OsLocal, 'status' | 'concluiProposta'>[],
): SeloOsProposta[] {
  const tem = (s: StatusOs) => oss.some((o) => o.status === s);
  const emCurso = tem('ABERTA') || tem('EM_ANDAMENTO');
  const emExecucao = status === 'APROVADA' || status === 'EM_EXECUCAO';
  const selos: SeloOsProposta[] = [];
  if (status === 'CANCELADA' && (tem('EM_ANDAMENTO') || tem('CONCLUIDA'))) {
    selos.push({ tipo: 'trabalho-proposta-cancelada', rotulo: 'Trabalho em proposta cancelada' });
  }
  if (tem('EM_ANDAMENTO')) selos.push({ tipo: 'os-em-andamento', rotulo: 'OS em andamento' });
  if (tem('CONCLUIDA')) selos.push({ tipo: 'os-concluida', rotulo: 'OS concluída' });
  const concluidas = oss.filter((o) => o.status === 'CONCLUIDA');
  if (emExecucao && !emCurso && concluidas.some((o) => !o.concluiProposta) && !concluidas.some((o) => o.concluiProposta)) {
    selos.push({ tipo: 'retorno-pendente', rotulo: 'Retorno pendente' });
  }
  if (emExecucao && !emCurso && tem('CANCELADA')) selos.push({ tipo: 'os-cancelada', rotulo: 'OS cancelada' });
  return selos;
}

/** As OS de proposta agrupadas pela proposta (a avulsa fica de fora), para os selos dos cards (`selosOsDaProposta`). */
export function osPorProposta<T extends Pick<OsLocal, 'propostaId'>>(oss: readonly T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const o of oss) {
    if (o.propostaId === null) continue;
    const lista = mapa.get(o.propostaId);
    if (lista) lista.push(o);
    else mapa.set(o.propostaId, [o]);
  }
  return mapa;
}

/** M2P3-R6 (Q15): o escritório vê por padrão as concluídas dos últimos 7 dias (hoje e os 6 anteriores). */
export const DIAS_CONCLUIDA_RECENTE = 7;

/**
 * CONCLUIDA com o `concluidaEm` (data de São Paulo) nos últimos `DIAS_CONCLUIDA_RECENTE` dias até `hoje`. Sem o
 * `concluidaEm` (concluída neste aparelho, à espera do servidor), é recente.
 */
export function concluidaRecente(os: Pick<OsLocal, 'status' | 'concluidaEm'>, hoje: string): boolean {
  if (os.status !== 'CONCLUIDA') return false;
  if (os.concluidaEm === null) return true;
  const instante = Date.parse(os.concluidaEm);
  if (Number.isNaN(instante)) return true;
  return hojeEmSaoPaulo(new Date(instante)) >= somarDias(hoje, 1 - DIAS_CONCLUIDA_RECENTE);
}

/** Bairro e cidade do endereço *snapshot* da OS, o que houver ("Bela Vista · São Paulo"); sem nenhum, ''. */
export function localDaOs(os: Pick<OsLocal, 'enderecoBairro' | 'enderecoCidade'>): string {
  return [os.enderecoBairro, os.enderecoCidade].filter((p) => p !== null && p.trim() !== '').join(' · ');
}

/**
 * Busca da lista do escritório: o código da OS (com ou sem os zeros, com a revisão), o `OSP-…` (também depois de
 * numerada), o código da proposta, o bairro e a cidade do snapshot (`localDaOs`, o que o card mostra), o nome ou nome
 * fantasia do cliente (sem acento nem caixa) e o documento do cliente (com ou sem máscara, a partir de 3 caracteres;
 * null no aparelho que não o recebe). Só a busca usa o documento; a tela não o mostra.
 */
export function correspondeABuscaOs(os: OsLocal, cliente: ClienteLocal | undefined, busca: string): boolean {
  const q = normalizarBusca(busca);
  if (!q) return true;
  const textos = [codigoOsExibido(os), os.codigoProvisorio, os.propostaCodigoExibido ?? '', localDaOs(os)];
  if (textos.some((t) => normalizarBusca(t).includes(q))) return true;
  if (!cliente) return false;
  if (cliente.nomeBusca.includes(q)) return true;
  const doc = normalizarDocumento(busca);
  return doc.length >= 3 && cliente.documento !== null && cliente.documento.includes(doc);
}

// --- erros ---

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
  | 'criacao' | 'inicio' | 'notas' | 'fotos' | 'assinatura' | 'recusa' | 'precisaVoltar' | 'conclusao' | 'resumo' | 'pdf'
  | 'cancelamento' | 'reabertura' | 'cabecalho' | 'atribuicao';

/**
 * A criação primeiro (ela leva a OS inteira); depois a ordem do trabalho de campo (a da fila: iniciar, notas, fotos,
 * assinatura, concluir, PDF) e, no fim, o escritório (cancelar, reabrir, o cabeçalho e o técnico).
 */
const ROTULO_PERDA: Readonly<Record<ItemPerdaOs, string>> = {
  criacao: 'a OS criada neste aparelho',
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
  cabecalho: 'as alterações do cabeçalho',
  atribuicao: 'a troca de técnico',
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
