import type { Perfil } from '../../core/auth/auth-models';
import type { ErroMutacao } from '../../core/sync/sync-models';
import type { NaturezaItem } from '../catalogo/item-models';
import type { TipoProposta } from '../templates/template-models';
import { deCentavos, deCentesimos, deMilesimos, paraCentavos, paraCentesimos, paraMilesimos } from './calculo';

export type StatusProposta = 'RASCUNHO' | 'ENVIADA' | 'APROVADA' | 'EM_EXECUCAO' | 'FINALIZADA' | 'RECUSADA' | 'CANCELADA';

/** Decimal do JSON: número (BigDecimal do Jackson); texto também é aceito na leitura. */
type Decimal = number | string;

/**
 * Formato da proposta no sync (`PropostaDados` do servidor). O servidor não serializa nulos: chave ausente = null.
 * É assim que somem o custo (COMERCIAL) e todos os valores (TECNICO, que também não recebe `documentos`).
 * Os campos [srv] (`numero`, `revisao`, totais, `historico`, `documentos`, snapshot e `subtotal` das linhas) são
 * ignorados pelo servidor na entrada.
 */
export interface PropostaDados {
  codigoProvisorio: string;
  numero?: number | null;
  revisao?: number | null;
  tipo: TipoProposta;
  status: StatusProposta;
  clienteId?: string | null;
  templateId?: string | null;
  responsavelId: string;
  tecnicoId?: string | null;
  dataEmissao: string;
  validadeAte?: string | null;
  condicoesPagamento?: string | null;
  prazoExecucao?: string | null;
  observacoes?: string | null;
  descontoGeralPercentual?: Decimal | null;
  totalItens?: Decimal | null;
  totalDescontos?: Decimal | null;
  total?: Decimal | null;
  motivoEncerramento?: string | null;
  itens: ItemPropostaDados[];
  historico?: HistoricoDados[];
  documentos?: DocumentoDados[];
  /** [srv] Última escrita no servidor (ISO-8601, P4b-R19): ordena o kanban. */
  atualizadoEm?: string | null;
  /** [srv] `SIGEM` só na proposta importada do SIGEM (sem PDF nem prévia); ausente na nativa. */
  origem?: 'SIGEM' | null;
}

export interface ItemPropostaDados {
  id: string;
  itemCatalogoId: string;
  codigo?: string | null;
  nome?: string | null;
  descricao?: string | null;
  unidade?: string | null;
  natureza?: NaturezaItem | null;
  precoCusto?: Decimal | null;
  quantidade: Decimal;
  precoUnitario?: Decimal | null;
  descontoPercentual?: Decimal | null;
  meses?: number | null;
  subtotal?: Decimal | null;
  ordem?: number | null;
}

export interface HistoricoDados {
  statusDe?: StatusProposta | null;
  statusPara: StatusProposta;
  usuarioId: string;
  em: string;
  observacao?: string | null;
}

export interface DocumentoDados {
  id: string;
  revisao: number;
  codigoExibido: string;
  arquivoId: string;
  sha256: string;
  geradoEm: string;
  geradoPor: string;
}

/**
 * Linha guardada no Dexie. Valores em inteiros `number` (centavos, milésimos, centésimos): exatos até 2^53, o que
 * cobre os limites de entrada; o cálculo converte para `bigint`. `null` = o perfil não vê o valor.
 * Totais acima de 2^53 centavos perdem precisão aqui (ruling P4b-R10, ver `inteiro`).
 */
export interface ItemPropostaLocal {
  id: string;
  itemCatalogoId: string;
  codigo: string | null;
  nome: string | null;
  descricao: string | null;
  unidade: string | null;
  natureza: NaturezaItem | null;
  precoCustoCentavos: number | null;
  quantidadeMilesimos: number;
  precoUnitarioCentavos: number | null;
  descontoCentesimos: number | null;
  meses: number | null;
  subtotalCentavos: number | null;
  ordem: number | null;
}

export interface PropostaLocal {
  id: string;
  version: number | null;
  codigoProvisorio: string;
  numero: number | null;
  revisao: number | null;
  tipo: TipoProposta;
  status: StatusProposta;
  clienteId: string | null;
  templateId: string | null;
  responsavelId: string;
  tecnicoId: string | null;
  dataEmissao: string;
  validadeAte: string | null;
  condicoesPagamento: string | null;
  prazoExecucao: string | null;
  observacoes: string | null;
  descontoGeralCentesimos: number | null;
  totalItensCentavos: number | null;
  totalDescontosCentavos: number | null;
  totalCentavos: number | null;
  motivoEncerramento: string | null;
  itens: ItemPropostaLocal[];
  historico: HistoricoDados[];
  documentos: DocumentoDados[];
  /** ISO-8601. Uma escrita local marca o agora (otimista); o servidor sobrescreve no retorno. */
  atualizadoEm: string | null;
  /**
   * [srv] `SIGEM` na proposta importada do SIGEM; null na nativa. Não é indexado (sem versão nova do Dexie): a linha
   * gravada antes deste campo não o tem, e `importadaDoSigem` lê a ausência como nativa.
   */
  origem: 'SIGEM' | null;
}

/** PDF de um envio, guardado no aparelho (tabela `documentos`). `enviado` = o upload já foi aceito. */
export interface DocumentoLocal {
  id: string;
  propostaId: string;
  revisao: number;
  codigoExibido: string;
  sha256: string;
  geradoEm: string;
  geradoPor: string | null;
  /**
   * Bytes do PDF (application/pdf); null quando só os metadados são conhecidos. ArrayBuffer e não Blob, como em
   * `ArquivoLocal`: clona em qualquer IndexedDB (inclusive o fake-indexeddb dos testes, onde o Blob vira `{}`).
   */
  bytes: ArrayBuffer | null;
  enviado: boolean;
  /** Id do `arquivo` no servidor, depois do upload. */
  arquivoId: string | null;
  /** Entrada do PDF (objeto JSON, ≤ 512 KB), enviada nos metadados do upload; ausente = `{}`. */
  snapshot?: Record<string, unknown> | null;
}

// --- dados <-> local ---

/**
 * Ruling P4b-R10: o servidor manda decimais como número JSON, e `JSON.parse` já os lê como double. Acima de ~9×10^13
 * reais (2^53 centavos) o valor lido perde precisão, e o inteiro em `number` aqui também. Aceito: está muito além
 * de qualquer proposta real (as entradas de item cabem com folga). `calcular` é exato em `bigint`; quando a
 * exatidão importa, use o resultado dele direto, sem passá-lo por estes campos `number` de `PropostaLocal`.
 */
function inteiro(v: Decimal | null | undefined, para: (x: Decimal) => bigint): number | null {
  return v === null || v === undefined ? null : Number(para(v));
}

function decimal(v: number | null, de: (x: bigint) => string): number | null {
  return v === null ? null : Number(de(BigInt(v)));
}

export function paraPropostaLocal(id: string, version: number | null, d: PropostaDados): PropostaLocal {
  return {
    id,
    version,
    codigoProvisorio: d.codigoProvisorio,
    numero: d.numero ?? null,
    revisao: d.revisao ?? null,
    tipo: d.tipo,
    status: d.status,
    clienteId: d.clienteId ?? null,
    templateId: d.templateId ?? null,
    responsavelId: d.responsavelId,
    tecnicoId: d.tecnicoId ?? null,
    dataEmissao: d.dataEmissao,
    validadeAte: d.validadeAte ?? null,
    condicoesPagamento: d.condicoesPagamento ?? null,
    prazoExecucao: d.prazoExecucao ?? null,
    observacoes: d.observacoes ?? null,
    descontoGeralCentesimos: inteiro(d.descontoGeralPercentual, paraCentesimos),
    totalItensCentavos: inteiro(d.totalItens, paraCentavos),
    totalDescontosCentavos: inteiro(d.totalDescontos, paraCentavos),
    totalCentavos: inteiro(d.total, paraCentavos),
    motivoEncerramento: d.motivoEncerramento ?? null,
    itens: (d.itens ?? []).map((i) => ({
      id: i.id,
      itemCatalogoId: i.itemCatalogoId,
      codigo: i.codigo ?? null,
      nome: i.nome ?? null,
      descricao: i.descricao ?? null,
      unidade: i.unidade ?? null,
      natureza: i.natureza ?? null,
      precoCustoCentavos: inteiro(i.precoCusto, paraCentavos),
      quantidadeMilesimos: Number(paraMilesimos(i.quantidade)),
      precoUnitarioCentavos: inteiro(i.precoUnitario, paraCentavos),
      descontoCentesimos: inteiro(i.descontoPercentual, paraCentesimos),
      meses: i.meses ?? null,
      subtotalCentavos: inteiro(i.subtotal, paraCentavos),
      ordem: i.ordem ?? null,
    })),
    historico: (d.historico ?? []).map((h) => ({ ...h, statusDe: h.statusDe ?? null, observacao: h.observacao ?? null })),
    documentos: [...(d.documentos ?? [])],
    atualizadoEm: d.atualizadoEm ?? null,
    origem: d.origem ?? null,
  };
}

/**
 * Para a rede: decimais como `number` exatos (o texto mais curto do double é o próprio decimal). Sem `origem` ([srv]);
 * o adaptador da proposta a acrescenta na regravação local do "Manter a minha".
 */
export function dadosDaProposta(p: PropostaLocal): PropostaDados {
  return {
    codigoProvisorio: p.codigoProvisorio,
    numero: p.numero,
    revisao: p.revisao,
    tipo: p.tipo,
    status: p.status,
    clienteId: p.clienteId,
    templateId: p.templateId,
    responsavelId: p.responsavelId,
    tecnicoId: p.tecnicoId,
    dataEmissao: p.dataEmissao,
    validadeAte: p.validadeAte,
    condicoesPagamento: p.condicoesPagamento,
    prazoExecucao: p.prazoExecucao,
    observacoes: p.observacoes,
    descontoGeralPercentual: decimal(p.descontoGeralCentesimos, deCentesimos),
    totalItens: decimal(p.totalItensCentavos, deCentavos),
    totalDescontos: decimal(p.totalDescontosCentavos, deCentavos),
    total: decimal(p.totalCentavos, deCentavos),
    motivoEncerramento: p.motivoEncerramento,
    itens: p.itens.map((i) => ({
      id: i.id,
      itemCatalogoId: i.itemCatalogoId,
      codigo: i.codigo,
      nome: i.nome,
      descricao: i.descricao,
      unidade: i.unidade,
      natureza: i.natureza,
      precoCusto: decimal(i.precoCustoCentavos, deCentavos),
      quantidade: Number(deMilesimos(BigInt(i.quantidadeMilesimos))),
      precoUnitario: decimal(i.precoUnitarioCentavos, deCentavos),
      descontoPercentual: decimal(i.descontoCentesimos, deCentesimos),
      meses: i.meses,
      subtotal: decimal(i.subtotalCentavos, deCentavos),
      ordem: i.ordem,
    })),
    historico: p.historico.map((h) => ({ ...h })),
    documentos: p.documentos.map((d) => ({ ...d })),
    atualizadoEm: p.atualizadoEm,
  };
}

// --- exibição ---

/**
 * A proposta veio do SIGEM (`origem`): não tem PDF nem prévia. A linha do Dexie gravada antes do campo existir não
 * tem a chave, e conta como nativa.
 */
export function importadaDoSigem(p: Pick<PropostaLocal, 'origem'>): boolean {
  return p.origem != null;
}

export const STATUS_PROPOSTA: Readonly<Record<StatusProposta, { rotulo: string; cor: string }>> = {
  RASCUNHO: { rotulo: 'Rascunho', cor: 'bg-slate-100 text-slate-700' },
  ENVIADA: { rotulo: 'Enviada', cor: 'bg-sky-100 text-sky-800' },
  APROVADA: { rotulo: 'Aprovada', cor: 'bg-emerald-100 text-emerald-800' },
  EM_EXECUCAO: { rotulo: 'Em execução', cor: 'bg-amber-100 text-amber-800' },
  FINALIZADA: { rotulo: 'Finalizada', cor: 'bg-teal-100 text-teal-800' },
  RECUSADA: { rotulo: 'Recusada', cor: 'bg-rose-100 text-rose-800' },
  CANCELADA: { rotulo: 'Cancelada', cor: 'bg-zinc-200 text-zinc-700' },
};

/** `000277`; com `-R<n>` quando a revisão passa de 1. */
export function numeroExibido(numero: number, revisao: number | null): string {
  const base = String(numero).padStart(6, '0');
  return revisao !== null && revisao > 1 ? `${base}-R${revisao}` : base;
}

/** O número com 6 dígitos, se já existe; senão, o código provisório. Sem a revisão (o motor de PDF a acrescenta). */
export function codigoBase(p: Pick<PropostaLocal, 'numero' | 'codigoProvisorio'>): string {
  return p.numero === null ? p.codigoProvisorio : String(p.numero).padStart(6, '0');
}

/**
 * A base (número ou PROV) com `-R<n>` quando a revisão passa de 1, para o PROV também (P4b-R18): é o que o
 * `DocumentoPropostaService.codigosExibidos` do servidor aceita como código do documento.
 */
export function codigoExibido(p: Pick<PropostaLocal, 'numero' | 'revisao' | 'codigoProvisorio'>): string {
  const base = codigoBase(p);
  return p.revisao !== null && p.revisao > 1 ? `${base}-R${p.revisao}` : base;
}

/**
 * Ordena no lugar por `atualizadoEm` desc pelo instante (o texto ISO tem frações de tamanho variável); sem data por
 * último; empate: id desc. A ordem das listas e das colunas do kanban (§13).
 */
export function ordenarPorAtualizacao<T extends Pick<PropostaLocal, 'id' | 'atualizadoEm'>>(lista: T[]): T[] {
  const instante = (p: T) => (p.atualizadoEm ? Date.parse(p.atualizadoEm) : Number.NEGATIVE_INFINITY);
  return lista.sort((a, b) => instante(b) - instante(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

// --- ciclo de vida (§8) e permissões (§10): espelho de TransicoesProposta (casos-transicoes.json) ---

/** O que importa da mutação para validar a transição (`TransicoesProposta.Contexto`). */
export interface ContextoTransicao {
  temCliente: boolean;
  temTemplate: boolean;
  itens: number;
  motivo: string | null;
  /** Algum campo editável, fora a atribuição, difere da versão do servidor. */
  alteraCampos: boolean;
  /** `responsavelId` ou `tecnicoId` difere. */
  alteraAtribuicao: boolean;
}

const MOTIVO_MIN = 3;
const MOTIVO_MAX = 500;

const ADMIN_E_COMERCIAL: readonly Perfil[] = ['ADMIN', 'COMERCIAL'];
const SO_ADMIN: readonly Perfil[] = ['ADMIN'];

/** Destinos de cada origem, na ordem em que aparecem para o usuário, e quem pode. */
const TABELA: Partial<Record<StatusProposta, readonly (readonly [StatusProposta, readonly Perfil[]])[]>> = {
  RASCUNHO: [['ENVIADA', ADMIN_E_COMERCIAL], ['CANCELADA', ADMIN_E_COMERCIAL]],
  ENVIADA: [['RASCUNHO', ADMIN_E_COMERCIAL], ['APROVADA', ADMIN_E_COMERCIAL], ['RECUSADA', ADMIN_E_COMERCIAL], ['CANCELADA', ADMIN_E_COMERCIAL]],
  APROVADA: [['EM_EXECUCAO', ADMIN_E_COMERCIAL], ['CANCELADA', ADMIN_E_COMERCIAL]],
  EM_EXECUCAO: [['FINALIZADA', ADMIN_E_COMERCIAL], ['CANCELADA', SO_ADMIN]],
};

/** Só o rascunho aceita edição de campos. */
export function podeEditar(status: StatusProposta): boolean {
  return status === 'RASCUNHO';
}

/** FINALIZADA, RECUSADA e CANCELADA: nada muda (nem a atribuição). */
export function terminal(status: StatusProposta): boolean {
  return status === 'FINALIZADA' || status === 'RECUSADA' || status === 'CANCELADA';
}

/** RECUSADA e CANCELADA guardam o motivo. */
export function exigeMotivo(para: StatusProposta): boolean {
  return para === 'RECUSADA' || para === 'CANCELADA';
}

/** P4b-R3: só o ADMIN troca o responsável, e só fora dos status terminais. */
export function podeAlterarResponsavel(status: StatusProposta, perfil: Perfil): boolean {
  return perfil === 'ADMIN' && !terminal(status);
}

/** P4b-R3: o técnico é trocado pelo ADMIN ou pelo responsável, fora dos status terminais. */
export function podeAlterarTecnico(status: StatusProposta, perfil: Perfil, ehResponsavel: boolean): boolean {
  return (perfil === 'ADMIN' || (perfil === 'COMERCIAL' && ehResponsavel)) && !terminal(status);
}

/** Destinos que o usuário pode escolher a partir de `status` (os requisitos de cada um são da validação). */
export function transicoesPermitidas(status: StatusProposta, perfil: Perfil, ehResponsavel: boolean): StatusProposta[] {
  if (perfil === 'TECNICO' || (perfil === 'COMERCIAL' && !ehResponsavel)) return [];
  return (TABELA[status] ?? []).filter(([, quem]) => quem.includes(perfil)).map(([para]) => para);
}

const ROTULO_MINUSCULO: Record<StatusProposta, string> = {
  RASCUNHO: 'rascunho', ENVIADA: 'enviada', APROVADA: 'aprovada', EM_EXECUCAO: 'em execução',
  FINALIZADA: 'finalizada', RECUSADA: 'recusada', CANCELADA: 'cancelada',
};

function erro(codigo: string, mensagem: string): ErroMutacao {
  return { codigo, mensagem };
}

/** `Character.isWhitespace` do Java: o que `String.strip()` tira das pontas (o espaço não separável fica). */
function espacoJava(c: number): boolean {
  return (c >= 0x09 && c <= 0x0d) || (c >= 0x1c && c <= 0x20) || c === 0x1680 || (c >= 0x2000 && c <= 0x200a && c !== 0x2007)
    || c === 0x2028 || c === 0x2029 || c === 0x205f || c === 0x3000;
}

/** `String.strip()` do Java: tira das pontas o que `Character.isWhitespace` aceita (o espaço não separável fica). */
export function stripJava(texto: string): string {
  let inicio = 0;
  let fim = texto.length;
  while (inicio < fim && espacoJava(texto.charCodeAt(inicio))) inicio++;
  while (fim > inicio && espacoJava(texto.charCodeAt(fim - 1))) fim--;
  return texto.slice(inicio, fim);
}

/** Tamanho sem os espaços das pontas, como `motivo.strip().length()` no servidor (unidades UTF-16 nos dois). */
export function motivoValido(motivo: string | null): boolean {
  if (motivo === null) return false;
  const tamanho = stripJava(motivo).length;
  return tamanho >= MOTIVO_MIN && tamanho <= MOTIVO_MAX;
}

function naoEditavel(de: StatusProposta | null, ctx: ContextoTransicao): ErroMutacao | null {
  if (de === null) return null;
  if (ctx.alteraCampos && de !== 'RASCUNHO') return erro('PROPOSTA_NAO_EDITAVEL', 'Só um rascunho pode ser editado.');
  if (ctx.alteraAtribuicao && terminal(de)) {
    return erro('PROPOSTA_NAO_EDITAVEL', 'Uma proposta encerrada não muda de responsável nem de técnico.');
  }
  return null;
}

/**
 * Mesma ordem de regras do servidor: perfil → edição no mesmo status → criação/tabela → perfil da transição →
 * edição junto com a transição → requisitos (`VALIDACAO`, com os campos na ordem do servidor). `de` null = criação.
 */
export function validarTransicao(
  de: StatusProposta | null,
  para: StatusProposta,
  perfil: Perfil,
  ehResponsavel: boolean,
  ctx: ContextoTransicao,
): ErroMutacao | null {
  if (perfil === 'TECNICO') return erro('ACESSO_NEGADO', 'O técnico não altera propostas.');
  if (perfil === 'COMERCIAL' && !ehResponsavel) {
    return erro('ACESSO_NEGADO', 'Você só altera as propostas em que é o responsável.');
  }
  if (de === para) return naoEditavel(de, ctx);
  if (de === null) {
    return para === 'RASCUNHO' ? null : erro('TRANSICAO_INVALIDA', 'Uma proposta nova começa como rascunho.');
  }
  const quem = TABELA[de]?.find(([destino]) => destino === para)?.[1];
  if (!quem) {
    return erro('TRANSICAO_INVALIDA', `Não é possível passar de ${ROTULO_MINUSCULO[de]} para ${ROTULO_MINUSCULO[para]}.`);
  }
  if (!quem.includes(perfil)) return erro('ACESSO_NEGADO', 'Só o administrador cancela uma proposta em execução.');
  const edicao = naoEditavel(de, ctx);
  if (edicao) return edicao;
  const campos: Record<string, string> = {};
  if (de === 'RASCUNHO' && para === 'ENVIADA') {
    if (!ctx.temCliente) campos['clienteId'] = 'Informe o cliente.';
    if (!ctx.temTemplate) campos['templateId'] = 'Informe o template.';
    if (ctx.itens < 1) campos['itens'] = 'Inclua pelo menos um item.';
  }
  if (exigeMotivo(para) && !motivoValido(ctx.motivo)) {
    campos['motivoEncerramento'] = `Informe o motivo (de ${MOTIVO_MIN} a ${MOTIVO_MAX} caracteres).`;
  }
  return Object.keys(campos).length === 0 ? null : { codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos };
}
