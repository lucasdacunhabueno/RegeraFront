import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { paraBytes } from '../../core/arquivos/arquivos-service';
import type { Perfil, UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { observar } from '../../core/db/observar';
import { RegeraDb } from '../../core/db/regera-db';
import type { ClientePdf, EmpresaPdf, EntradaPdf, ItemPdf } from '../../core/pdf/pdf-models';
import { PdfService } from '../../core/pdf/pdf-service';
import { observarNaoSincronizados } from '../../core/sync/nao-sincronizados';
import { DadosUpload, ErroMutacao, Pendencia, TIPO_UPLOAD_DOCUMENTO, UsuarioResumo } from '../../core/sync/sync-models';
import { SyncService } from '../../core/sync/sync-service';
import { ErroCampo } from '../../core/util/erro-campo';
import { formatarCep } from '../../core/util/formatos';
import { sha256Hex } from '../../core/util/sha256';
import { uuidv7 } from '../../core/util/uuid';
import type { ItemLocal } from '../catalogo/item-models';
import type { ClienteLocal } from '../clientes/cliente-models';
import { EmpresaLocal, ID_EMPRESA, VALIDADE_PADRAO_DIAS } from '../empresa/empresa-models';
import type { TemplateLocal, TipoProposta } from '../templates/template-models';
import { TemplatesRepo } from '../templates/templates-repo';
import { calcular, deCentesimos, deMilesimos, paraCentavos } from './calculo';
import { gerarCodigoProvisorio } from './codigo-provisorio';
import {
  codigoBase,
  codigoExibido,
  ContextoTransicao,
  dadosDaProposta,
  DocumentoLocal,
  exigeMotivo,
  ItemPropostaLocal,
  ordenarPorAtualizacao,
  paraPropostaLocal,
  podeAlterarResponsavel,
  podeAlterarTecnico,
  PropostaDados,
  PropostaLocal,
  StatusProposta,
  stripJava,
  transicoesPermitidas,
  validarTransicao,
} from './proposta-models';

// --- datas (§13: emissão = hoje; validade = hoje + empresa.validadePadraoDias) ---

const FORMATO_SAO_PAULO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** A data civil (`aaaa-mm-dd`) de São Paulo no instante `agora`, independente do fuso do aparelho. */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  const partes = new Map(FORMATO_SAO_PAULO.formatToParts(agora).map((p) => [p.type, p.value]));
  return `${partes.get('year')}-${partes.get('month')}-${partes.get('day')}`;
}

const RELOGIO_SAO_PAULO = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Milissegundos de `agora` até a próxima meia-noite de São Paulo (quando `hojeEmSaoPaulo` muda). Conta pela hora de
 * parede: num dia com mudança de fuso erra por até uma hora, e quem agenda confere de novo ao disparar.
 */
export function msAteAmanhaEmSaoPaulo(agora: Date = new Date()): number {
  const partes = new Map(RELOGIO_SAO_PAULO.formatToParts(agora).map((p) => [p.type, Number(p.value)]));
  const segundos = ((partes.get('hour') ?? 0) * 60 + (partes.get('minute') ?? 0)) * 60 + (partes.get('second') ?? 0);
  return 86_400_000 - (segundos * 1000 + agora.getUTCMilliseconds());
}

/** Aritmética de calendário sobre `aaaa-mm-dd` (em UTC, só como contador de dias: sem fuso nem horário de verão). */
export function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

// --- erros ---

/**
 * Recusa local, com o mesmo `codigo` que o servidor daria (`ACESSO_NEGADO`, `PROPOSTA_NAO_EDITAVEL`,
 * `TRANSICAO_INVALIDA`, `VALIDACAO`, `PROPOSTA_NUMERADA`...) ou um só do aparelho (`NAO_ENCONTRADA`, `USE_ENVIAR`,
 * `PROPOSTA_ALTERADA`, `PROPOSTA_JA_ENVIADA`, `SNAPSHOT_GRANDE`, `PDF_GRANDE`, `PROPOSTA_SINCRONIZANDO`,
 * `RESOLVA_A_PENDENCIA`). `campo` é o
 * primeiro campo com erro (nomes do servidor, ex.: `itens[0].quantidade`) ou `proposta` quando o erro não é de um
 * campo; `campos` traz todos, na validação.
 */
export class ErroProposta extends ErroCampo {
  constructor(
    readonly codigo: string,
    campo: string,
    mensagem: string,
    readonly campos?: Record<string, string>,
  ) {
    super(campo, mensagem);
  }

  static de(e: ErroMutacao): ErroProposta {
    const [primeiro] = Object.entries(e.campos ?? {});
    return primeiro
      ? new ErroProposta(e.codigo, primeiro[0], primeiro[1], { ...e.campos })
      : new ErroProposta(e.codigo, 'proposta', e.mensagem);
  }
}

function validacao(campos: Record<string, string>): void {
  if (Object.keys(campos).length > 0) throw ErroProposta.de({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos });
}

// --- edição ---

/**
 * Linha como a tela a edita. Unidades: quantidade em milésimos (1,5 → 1500), preço em centavos, desconto em
 * centésimos de ponto percentual (12,5% → 1250) — a tela converte o que se digita com `lerDecimalEstrito`.
 * `subtotalCentavos` e `ordem` são recalculados aqui (a ordem é a da lista).
 */
export type LinhaRascunho = Omit<ItemPropostaLocal, 'subtotalCentavos' | 'ordem'> &
  Partial<Pick<ItemPropostaLocal, 'subtotalCentavos' | 'ordem'>>;

/** Campos editáveis do rascunho (o que faltar fica como está). Responsável muda só por `atribuir`. */
export interface EdicaoRascunho {
  tipo: TipoProposta;
  clienteId: string | null;
  templateId: string | null;
  tecnicoId: string | null;
  dataEmissao: string;
  validadeAte: string | null;
  condicoesPagamento: string | null;
  prazoExecucao: string | null;
  observacoes: string | null;
  /** Centésimos de ponto percentual (12,5% → 1250). */
  descontoGeralCentesimos: number;
  itens: readonly LinhaRascunho[];
}

const MAX_ITENS = 200;
const QUANTIDADE_MAX_MILESIMOS = 999_999_999; // 999.999,999
const PRECO_MAX_CENTAVOS = 99_999_999_999_999; // 999.999.999.999,99
const PERCENTUAL_MAX_CENTESIMOS = 10_000; // 100%
const TOTAL_MAX_CENTAVOS = 9_999_999_999_999_999n; // 99.999.999.999.999,99 (limite do servidor)
const SNAPSHOT_MAX_BYTES = 512 * 1024;
/** `ArquivoService.MAX_BYTES` do servidor (e o `max-file-size: 10MB` do multipart): acima disso o upload volta 413. */
const PDF_MAX_BYTES = 10 * 1024 * 1024;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const TAMANHO_TEXTO: readonly ['condicoesPagamento' | 'prazoExecucao' | 'observacoes', number][] = [
  ['condicoesPagamento', 1000], ['prazoExecucao', 200], ['observacoes', 4000],
];

const inteiroEntre = (v: unknown, min: number, max: number): boolean =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;

/** `aaaa-mm-dd` de um dia que existe (2026-02-30 não): o `LocalDate` do servidor recusaria sem dizer o campo. */
function dataValida(d: string): boolean {
  return DATA.test(d) && somarDias(d, 0) === d;
}

/** Como o `texto()` do servidor (`isBlank` → null, senão `strip()`), com o mesmo critério de espaço do Java. */
function texto(v: string | null | undefined): string | null {
  const t = stripJava(v ?? '');
  return t === '' ? null : t;
}

/** `meses` é obrigatório só em LOCACAO com item locável, e proibido nos outros casos (regra do servidor). */
function exigeMeses(tipo: TipoProposta, catalogo: ItemLocal): boolean {
  return tipo === 'LOCACAO' && catalogo.locavel;
}

/** Tentativas de `enviar` quando a proposta muda enquanto o PDF é gerado (P4b-R21). */
const TENTATIVAS_ENVIO = 3;

const jaEnviada = (): ErroProposta => new ErroProposta('PROPOSTA_JA_ENVIADA', 'proposta', 'Esta proposta já foi enviada.');

/** Totais e subtotais para exibição imediata (`calcular`, em `bigint`); o servidor recalcula e prevalece no retorno. */
// P4b-R10: os totais voltam a `number` (centavos); acima de 2^53 centavos perdem precisão, o que está aceito
function comTotais(p: PropostaLocal): PropostaLocal {
  const r = calcular(
    p.itens.map((l) => ({
      quantidadeMilesimos: BigInt(l.quantidadeMilesimos),
      precoUnitarioCentavos: BigInt(l.precoUnitarioCentavos ?? 0),
      descontoCentesimos: BigInt(l.descontoCentesimos ?? 0),
      meses: l.meses,
    })),
    BigInt(p.descontoGeralCentesimos ?? 0),
    p.tipo === 'LOCACAO',
  );
  // como `Totais.excedeLimite` do servidor: o total dos itens ou o dos descontos (100% de desconto zera o subtotal)
  if (r.totalItensCentavos > TOTAL_MAX_CENTAVOS || r.totalDescontosCentavos > TOTAL_MAX_CENTAVOS) {
    validacao({ itens: 'O valor total da proposta excede o limite de 99.999.999.999.999,99.' });
  }
  return {
    ...p,
    itens: p.itens.map((l, i) => ({ ...l, ordem: i, subtotalCentavos: Number(r.subtotaisCentavos[i]) })),
    totalItensCentavos: Number(r.totalItensCentavos),
    totalDescontosCentavos: Number(r.totalDescontosCentavos),
    totalCentavos: Number(r.totalCentavos),
  };
}

/** A edição sobre a proposta (o que faltar fica como está), sem conferir nada; subtotais e ordem ficam para `comTotais`. */
function aplicarEdicao(p: PropostaLocal, edicao: Partial<EdicaoRascunho>): PropostaLocal {
  return {
    ...p,
    ...(edicao.tipo !== undefined ? { tipo: edicao.tipo } : {}),
    ...(edicao.clienteId !== undefined ? { clienteId: edicao.clienteId } : {}),
    ...(edicao.templateId !== undefined ? { templateId: edicao.templateId } : {}),
    ...(edicao.tecnicoId !== undefined ? { tecnicoId: edicao.tecnicoId } : {}),
    ...(edicao.dataEmissao !== undefined ? { dataEmissao: edicao.dataEmissao } : {}),
    ...(edicao.validadeAte !== undefined ? { validadeAte: edicao.validadeAte } : {}),
    ...(edicao.condicoesPagamento !== undefined ? { condicoesPagamento: texto(edicao.condicoesPagamento) } : {}),
    ...(edicao.prazoExecucao !== undefined ? { prazoExecucao: texto(edicao.prazoExecucao) } : {}),
    ...(edicao.observacoes !== undefined ? { observacoes: texto(edicao.observacoes) } : {}),
    ...(edicao.descontoGeralCentesimos !== undefined ? { descontoGeralCentesimos: edicao.descontoGeralCentesimos } : {}),
    ...(edicao.itens !== undefined
      ? { itens: edicao.itens.map((l) => ({ ...l, ordem: null, subtotalCentavos: null })) }
      : {}),
  };
}

/**
 * P4b-R23: a mesma edição sobre os `dados` de uma mutação `proposta` da fila (a rejeitada ou uma retida atrás dela),
 * com os totais recalculados. O resto dos dados da mutação (status, motivo, atribuição, revisão) fica como estava.
 * Só depois de `conferirCorrecao`, que confere a edição.
 */
function corrigirDadosDaProposta(id: string, dados: PropostaDados, edicao: Partial<EdicaoRascunho>): PropostaDados {
  return dadosDaProposta(comTotais(aplicarEdicao(paraPropostaLocal(id, null, dados), edicao)));
}

/**
 * P4b-R28: só a recusa de dados (VALIDACAO, com os campos) de uma mutação de rascunho tem conserto editando campos.
 * Outras (TRANSICAO_INVALIDA, ACESSO_NEGADO, PROPOSTA_NAO_EDITAVEL...) ou a de uma transição voltariam recusadas —
 * inclusive a "Nova revisão" (`separada`, status RASCUNHO): campos editados nela o servidor vê saindo de ENVIADA.
 */
export function pendenciaCorrigivel(p: Pendencia): boolean {
  const dados = p.mutacao.dados as PropostaDados | null;
  return p.entidade === 'proposta' && p.tipo === 'REJEITADO' && p.erro?.codigo === 'VALIDACAO'
    && p.mutacao.op === 'UPSERT' && dados?.status === 'RASCUNHO' && !p.mutacao.separada;
}

/** P4b-R29: ids das linhas da mutação recusada citadas nos campos da recusa (`itens[i].…`). */
function linhasRecusadas(p: Pendencia): Set<string> {
  const itens = (p.mutacao.dados as PropostaDados | null)?.itens ?? [];
  const ids = Object.keys(p.erro?.campos ?? {}).map((campo) => {
    const i = /^itens\[(\d+)\]\./.exec(campo);
    return i ? itens[Number(i[1])]?.id : undefined;
  });
  return new Set(ids.filter((id): id is string => !!id));
}

/** Um PDF da proposta, do servidor ou só do aparelho (P4b-R25), para a lista de documentos do detalhe. */
export interface DocumentoDaProposta {
  id: string;
  revisao: number;
  codigoExibido: string;
  geradoEm: string;
  /** O upload foi aceito: está no servidor (`arquivoId`). */
  enviado: boolean;
  /** Os bytes estão neste aparelho: abre offline por `blobDoDocumento`; senão, só online pelo `arquivoId`. */
  temBytes: boolean;
  arquivoId: string | null;
}

/** Ids com mutação na outbox, com pendência e com CONFLITO (`observarEstadoSync`). */
export interface EstadoSync {
  naOutbox: ReadonlySet<string>;
  comPendencia: ReadonlySet<string>;
  comConflito: ReadonlySet<string>;
}

/** `duplicar`: o rascunho novo e quantas linhas ficaram de fora (item do catálogo inativo ou fora do aparelho). */
export interface Duplicada {
  id: string;
  linhasDescartadas: number;
}

/**
 * A linha nova de `adicionarItem` (e da correção, que a monta sem gravar): o snapshot do catálogo (código, nome,
 * descrição, unidade, natureza e custo, se o perfil o vê), quantidade 1, sem desconto; preço de venda, ou o mensal em
 * LOCACAO com item locável (aí `meses = 1`). Recusa item inativo e a 201ª linha (`quantasLinhas` = as que já existem).
 */
export function linhaDoCatalogo(tipo: TipoProposta, quantasLinhas: number, itemCatalogo: ItemLocal): ItemPropostaLocal {
  if (!itemCatalogo.ativo) validacao({ itens: 'Este item do catálogo está inativo.' });
  if (quantasLinhas >= MAX_ITENS) validacao({ itens: `Máximo de ${MAX_ITENS} itens.` });
  const mensal = tipo === 'LOCACAO' && itemCatalogo.locavel;
  const preco = mensal ? itemCatalogo.precoLocacaoMensal : itemCatalogo.precoVenda;
  return {
    id: uuidv7(),
    itemCatalogoId: itemCatalogo.id,
    codigo: itemCatalogo.codigo,
    nome: itemCatalogo.nome,
    descricao: itemCatalogo.descricao,
    unidade: itemCatalogo.unidade,
    natureza: itemCatalogo.natureza,
    precoCustoCentavos: itemCatalogo.precoCusto == null ? null : Number(paraCentavos(itemCatalogo.precoCusto)),
    quantidadeMilesimos: 1000,
    precoUnitarioCentavos: preco == null ? 0 : Number(paraCentavos(preco)),
    descontoCentesimos: 0,
    meses: mensal ? 1 : null,
    subtotalCentavos: null,
    ordem: null,
  };
}

const CODIGO_INVALIDO = 'CODIGO_EXIBIDO_INVALIDO';

/** Por que "Gerar PDF novamente" vale (P4b-R13), ou null. */
export type MotivoRegerar = 'CODIGO_EXIBIDO_INVALIDO' | 'SEM_DOCUMENTO';

/**
 * "Gerar PDF novamente" (P4b-R13) vale fora do rascunho (o servidor só recebe documento de proposta enviada ou
 * posterior, e da revisão dela) quando:
 * - o upload de um PDF dela voltou `CODIGO_EXIBIDO_INVALIDO` (o PROV mudou depois de o PDF ser gerado offline); ou
 * - ela já foi enviada e não há documento da revisão atual, nem do servidor nem do aparelho (ex.: o upload recusado
 *   foi descartado em Pendências).
 * `documentos`: os do aparelho (ou `observarDocumentos`); `pendencias`: as da proposta. A tela e `regerarDocumento`
 * decidem por aqui.
 */
export function motivoParaRegerar(
  p: Pick<PropostaLocal, 'status' | 'revisao' | 'documentos' | 'historico'>,
  documentos: readonly { revisao: number }[],
  pendencias: readonly Pendencia[],
): MotivoRegerar | null {
  if (p.status === 'RASCUNHO') return null;
  if (pendencias.some((x) => x.entidade === TIPO_UPLOAD_DOCUMENTO && x.erro?.codigo === CODIGO_INVALIDO)) return CODIGO_INVALIDO;
  if (!jaFoiEnviada(p)) return null;
  const revisao = p.revisao ?? 1;
  return [...p.documentos, ...documentos].some((d) => d.revisao === revisao) ? null : 'SEM_DOCUMENTO';
}

const sincronizando = (): ErroProposta =>
  new ErroProposta('PROPOSTA_SINCRONIZANDO', 'proposta', 'A proposta está sendo sincronizada. Tente de novo em instantes.');

/** P4c-R15: o que fica travado com um CONFLITO da proposta, e o texto da recusa de cada um. */
const ANTES_DE = {
  enviar: 'enviá-la',
  transicionar: 'mudar o status',
  atribuir: 'mudar a atribuição',
  regerar: 'gerar o PDF novamente',
} as const;

/**
 * P4c-R15: com um CONFLITO da proposta, enviar, mudar o status, a atribuição ou gerar o PDF de novo poria na fila, atrás
 * da mutação em conflito, o que "Usar a do servidor" apagaria (o envio e o PDF que o cliente já recebeu). A edição do
 * rascunho continua (P4b-R27): ela não gera nada fora do aparelho.
 */
function exigirSemConflito(pendencias: readonly Pendencia[], acao: keyof typeof ANTES_DE): void {
  if (pendencias.some((x) => x.tipo === 'CONFLITO')) {
    throw new ErroProposta('RESOLVA_A_PENDENCIA', 'proposta', `Resolva a pendência desta proposta antes de ${ANTES_DE[acao]}.`);
  }
}

/** Status que só existem depois de um envio (CANCELADA pode vir direto do rascunho: aí vale o documento). */
const DEPOIS_DO_ENVIO: readonly StatusProposta[] = ['ENVIADA', 'APROVADA', 'EM_EXECUCAO', 'FINALIZADA', 'RECUSADA'];

/** Fora do rascunho, a proposta já passou por um envio (e não é só uma transição que não existe). */
function jaFoiEnviada(p: Pick<PropostaLocal, 'status' | 'documentos' | 'historico'>): boolean {
  return DEPOIS_DO_ENVIO.includes(p.status) || p.documentos.length > 0 || p.historico.some((h) => h.statusPara === 'ENVIADA');
}

function contexto(p: PropostaLocal, c: Partial<ContextoTransicao> = {}): ContextoTransicao {
  return {
    temCliente: p.clienteId !== null,
    temTemplate: p.templateId !== null,
    itens: p.itens.length,
    motivo: null,
    alteraCampos: false,
    alteraAtribuicao: false,
    ...c,
  };
}

const CONTEXTO_CRIACAO: ContextoTransicao = {
  temCliente: false, temTemplate: false, itens: 0, motivo: null, alteraCampos: false, alteraAtribuicao: false,
};

// --- PDF ---

const EMPRESA_VAZIA: EmpresaPdf = {
  razaoSocial: '', nomeFantasia: null, cnpj: null, endereco: null, telefone: null, email: null, site: null,
  corPrimaria: '#1d4ed8',
};

/** Só na prévia: rascunho ainda sem cliente (o envio exige cliente). */
const CLIENTE_VAZIO: ClientePdf = { nome: '', documento: '', endereco: null, contato: null, telefone: null, email: null };

/** Endereço principal (ou o primeiro) em uma linha: `Logradouro, nº - compl. - bairro - Cidade/UF - CEP 00000-000`. */
export function enderecoDoCliente(c: ClienteLocal): string | null {
  const e = c.enderecos.find((x) => x.tipo === 'PRINCIPAL') ?? c.enderecos[0];
  if (!e) return null;
  const local = [e.cidade, e.uf].map(texto).filter((x) => x !== null).join('/');
  const partes = [
    [e.logradouro, e.numero].map(texto).filter((x) => x !== null).join(', '),
    texto(e.complemento),
    texto(e.bairro),
    local,
    texto(e.cep) ? `CEP ${formatarCep(e.cep)}` : null,
  ].filter((x): x is string => x !== null && x !== '');
  return partes.length > 0 ? partes.join(' - ') : null;
}

function clienteDoPdf(c: ClienteLocal): ClientePdf {
  return {
    nome: c.nome,
    documento: c.documento,
    endereco: enderecoDoCliente(c),
    contato: c.contatoNome,
    telefone: c.telefone,
    email: c.email,
  };
}

function itemDoPdf(l: ItemPropostaLocal): ItemPdf {
  return {
    codigo: l.codigo ?? '',
    nome: l.nome ?? '',
    descricao: l.descricao,
    unidade: l.unidade ?? '',
    natureza: l.natureza ?? 'PRODUTO',
    quantidade: Number(deMilesimos(BigInt(l.quantidadeMilesimos))),
    precoUnitarioCentavos: l.precoUnitarioCentavos ?? 0,
    descontoPercentual: Number(deCentesimos(BigInt(l.descontoCentesimos ?? 0))),
    meses: l.meses,
    subtotalCentavos: l.subtotalCentavos ?? 0,
  };
}

/** O documento de uma mutação de UPLOAD na fila (ou na pendência); null se ela não é um upload. */
function documentoDoUpload(m: { entidade: string; dados: unknown }): string | null {
  return m.entidade === TIPO_UPLOAD_DOCUMENTO ? ((m.dados as DadosUpload | null)?.documentoId ?? null) : null;
}

/**
 * Propostas no aparelho (offline-first): cada escrita grava o local e enfileira a mutação `proposta` na outbox, na
 * mesma transação. As regras de perfil e de ciclo de vida (§8, §10) são conferidas aqui com as mesmas funções que
 * espelham o servidor (`validarTransicao`, `transicoesPermitidas`), para a tela recusar na hora; o servidor confere
 * de novo e prevalece. Recusas lançam `ErroProposta` (um `ErroCampo`).
 *
 * Decisão (PDF): o repo não conhece o pdfmake. `enviar` recebe a função que gera o Blob (a tela passa
 * `PdfService.gerarBlob`) e usa o `PdfService` só para a logo (`logoDataUrl`, que não carrega o pdfmake).
 */
@Injectable({ providedIn: 'root' })
export class PropostasRepo {
  private readonly db = inject(RegeraDb);
  private readonly sync = inject(SyncService);
  private readonly auth = inject(AuthService);
  private readonly templates = inject(TemplatesRepo);
  private readonly pdf = inject(PdfService);

  /** Todas as visíveis neste aparelho, por `atualizadoEm` desc (§13, kanban). */
  observarTodas(): Observable<PropostaLocal[]> {
    return observar(async () => ordenarPorAtualizacao(await this.db.propostas.toArray()));
  }

  observarDoCliente(clienteId: string): Observable<PropostaLocal[]> {
    return observar(async () => ordenarPorAtualizacao(await this.db.propostas.where('clienteId').equals(clienteId).toArray()));
  }

  /** As atribuídas ao técnico (a lista dele no P4c). */
  observarDoTecnico(usuarioId: string): Observable<PropostaLocal[]> {
    return observar(async () => ordenarPorAtualizacao(await this.db.propostas.where('tecnicoId').equals(usuarioId).toArray()));
  }

  observarNaoSincronizados(): Observable<Set<string>> {
    return observarNaoSincronizados(this.db);
  }

  /**
   * Os dois selos de sync do P4c, separados: `naOutbox` = agregados com mutação esperando envio (inclusive o upload do
   * PDF, que leva o id da proposta); `comPendencia` = agregados com conflito ou rejeição; `comConflito` = só os com
   * CONFLITO (o kanban trava o card, como o detalhe trava as transições).
   */
  observarEstadoSync(): Observable<EstadoSync> {
    return observar(async () => {
      const pendencias = await this.db.pendencias.toArray();
      return {
        naOutbox: new Set((await this.db.outbox.toArray()).map((m) => m.agregadoId)),
        comPendencia: new Set(pendencias.map((p) => p.agregadoId)),
        comConflito: new Set(pendencias.filter((p) => p.tipo === 'CONFLITO').map((p) => p.agregadoId)),
      };
    });
  }

  /** Os usuários que vieram no sync (nome do responsável e do técnico nas telas). */
  observarUsuarios(): Observable<UsuarioResumo[]> {
    return observar(() => this.db.usuarios.toArray());
  }

  /** A proposta, reemitida a cada escrita (local ou do pull); undefined se ela sai do aparelho. */
  observarProposta(id: string): Observable<PropostaLocal | undefined> {
    return observar(() => this.db.propostas.get(id));
  }

  buscar(id: string): Promise<PropostaLocal | undefined> {
    return this.db.propostas.get(id);
  }

  async temPendencia(id: string): Promise<boolean> {
    return (await this.db.pendencias.where('agregadoId').equals(id).count()) > 0;
  }

  /** As pendências da proposta (as dos dados e as do upload do PDF, que leva o id dela), das mais antigas às novas. */
  observarPendencias(id: string): Observable<Pendencia[]> {
    return observar(async () =>
      (await this.db.pendencias.where('agregadoId').equals(id).toArray()).sort((a, b) => a.criadaEm.localeCompare(b.criadaEm)),
    );
  }

  /** A recusa da proposta que "Corrigir e reenviar" conserta (`pendenciaCorrigivel`, P4b-R28), se houver. */
  async recusaCorrigivel(id: string): Promise<Pendencia | undefined> {
    return (await this.db.pendencias.where('agregadoId').equals(id).toArray()).find(pendenciaCorrigivel);
  }

  /**
   * Novo RASCUNHO com os padrões (§13): o usuário atual é o responsável (obrigatório para o COMERCIAL); emissão hoje
   * em São Paulo; validade = hoje + `validadePadraoDias` da empresa (15 sem ela, ou sem a validade, como a do TECNICO);
   * condições de pagamento da empresa; template padrão do tipo.
   */
  async criar(tipo: TipoProposta, clienteId?: string | null): Promise<string> {
    const u = this.usuario();
    this.checar(validarTransicao(null, 'RASCUNHO', u.perfil, true, CONTEXTO_CRIACAO));
    const empresa = await this.empresa();
    const template = await this.templates.padraoPorTipo(tipo);
    const hoje = hojeEmSaoPaulo();
    const p = comTotais({
      id: uuidv7(),
      version: null,
      codigoProvisorio: gerarCodigoProvisorio(),
      numero: null,
      revisao: 1,
      tipo,
      status: 'RASCUNHO',
      clienteId: clienteId ?? null,
      templateId: template?.id ?? null,
      responsavelId: u.id,
      tecnicoId: null,
      dataEmissao: hoje,
      validadeAte: somarDias(hoje, empresa?.validadePadraoDias ?? VALIDADE_PADRAO_DIAS),
      condicoesPagamento: texto(empresa?.condicoesPagamentoPadrao),
      prazoExecucao: null,
      observacoes: null,
      descontoGeralCentesimos: 0,
      totalItensCentavos: 0,
      totalDescontosCentavos: 0,
      totalCentavos: 0,
      motivoEncerramento: null,
      itens: [],
      historico: [],
      documentos: [],
      atualizadoEm: null,
    });
    await this.gravar(p, null);
    return p.id;
  }

  /**
   * Edição do rascunho (só em RASCUNHO, pelo ADMIN ou pelo responsável). Recalcula subtotais e totais para a tela;
   * o servidor recalcula e o valor dele volta no retorno. versaoCarregada: versão que a tela carregou (base para o
   * servidor detectar conflito).
   */
  async salvarRascunho(id: string, edicao: Partial<EdicaoRascunho>, versaoCarregada?: number | null): Promise<void> {
    const u = this.usuario();
    const atual = await this.carregar(id);
    this.exigirEdicao(atual, u);
    if (edicao.tecnicoId !== undefined && edicao.tecnicoId !== atual.tecnicoId) {
      await this.conferirTecnico(atual, u, edicao.tecnicoId);
    }
    const novo = aplicarEdicao(atual, edicao);
    validacao(await this.validarEdicao(atual, novo));
    const version = versaoCarregada !== undefined ? versaoCarregada : atual.version;
    await this.gravarEdicao(comTotais({ ...novo, version }), edicao, version);
  }

  /**
   * Inclui o item do catálogo no rascunho, com o snapshot copiado dele (`linhaDoCatalogo`: código, nome, descrição,
   * unidade, natureza e custo, se o perfil o vê). Preço: o de venda, ou o mensal em LOCACAO com item locável (aí
   * `meses = 1`). Quantidade 1, sem desconto. Devolve o id da linha.
   */
  async adicionarItem(id: string, itemCatalogo: ItemLocal): Promise<string> {
    const u = this.usuario();
    const atual = await this.carregar(id);
    this.exigirEdicao(atual, u);
    const linha = linhaDoCatalogo(atual.tipo, atual.itens.length, itemCatalogo);
    const itens = [...atual.itens, linha];
    await this.gravarEdicao(comTotais({ ...atual, itens }), { itens }, atual.version);
    return linha.id;
  }

  /**
   * Muda o status (§8), como mutação separada (nunca coalesce). Confere a tabela de transições para o perfil
   * (`transicoesPermitidas`) e os requisitos (`validarTransicao`, ex.: motivo de 3 a 500 caracteres em RECUSADA e
   * CANCELADA). RASCUNHO → ENVIADA só por `enviar`, que gera o PDF oficial. ENVIADA → RASCUNHO abre a revisão seguinte
   * já no aparelho (o PDF de um novo envio offline sai com a revisão certa); o servidor confirma. Com um CONFLITO da
   * proposta, recusa (`RESOLVA_A_PENDENCIA`, P4c-R15).
   */
  async transicionar(id: string, para: StatusProposta, motivo?: string | null): Promise<void> {
    const u = this.usuario();
    const atual = await this.carregar(id);
    if (atual.status === 'RASCUNHO' && para === 'ENVIADA') {
      throw new ErroProposta('USE_ENVIAR', 'proposta', 'Para enviar, gere o PDF oficial da proposta.');
    }
    const motivoLimpo = texto(motivo);
    this.exigirTransicao(atual, para, u, contexto(atual, { motivo: motivoLimpo }));
    const novo: PropostaLocal = {
      ...atual,
      status: para,
      motivoEncerramento: exigeMotivo(para) ? motivoLimpo : atual.motivoEncerramento,
      revisao: atual.status === 'ENVIADA' && para === 'RASCUNHO' ? (atual.revisao ?? 1) + 1 : atual.revisao,
    };
    await this.gravar(novo, atual.version, { separada: true, semConflito: 'transicionar' });
  }

  /**
   * Atribuição (P4b-R3), em qualquer status não terminal: o responsável só o ADMIN troca (por um ADMIN ou COMERCIAL);
   * o técnico, o ADMIN ou o responsável (por um TECNICO, ou nenhum). versaoCarregada: como em `salvarRascunho`, a
   * versão que a tela carregou (P4c-R9: o "Manter as minhas" do wizard grava com ela, e o servidor dá CONFLITO).
   * Com um CONFLITO da proposta já em Pendências, recusa (`RESOLVA_A_PENDENCIA`, P4c-R15).
   */
  async atribuir(
    id: string,
    mudanca: { responsavelId?: string; tecnicoId?: string | null },
    versaoCarregada?: number | null,
  ): Promise<void> {
    const conferida = await this.atribuicaoConferida(id, mudanca);
    if (!conferida) return;
    const { atual, responsavelId, tecnicoId } = conferida;
    const version = versaoCarregada !== undefined ? versaoCarregada : atual.version;
    await this.gravar({ ...atual, responsavelId, tecnicoId, version }, version, { semConflito: 'atribuir' });
  }

  /**
   * As regras do `atribuir`, sem gravar (P4c-R10): a correção confere a troca do responsável antes de corrigir a fila,
   * para uma recusa não deixar a correção feita pela metade. Recusa com os mesmos erros.
   */
  async conferirAtribuicao(id: string, mudanca: { responsavelId?: string; tecnicoId?: string | null }): Promise<void> {
    await this.atribuicaoConferida(id, mudanca);
  }

  /**
   * Novo RASCUNHO a partir de qualquer proposta (o caminho para refazer uma encerrada): mesmo tipo, cliente,
   * template, técnico, condições e itens (com ids novos; preço e desconto mantidos), mesmo responsável, novo código
   * provisório, emissão e validade de hoje. Sem número, histórico, documentos nem motivo.
   * As linhas são novas para o servidor, então valem as regras de hoje: sai a linha cujo item do catálogo está
   * inativo ou não está no aparelho; `meses` some se o item deixou de ser locável (e vira 1 se passou a ser); sai o
   * técnico inativo; responsável inativo dá lugar ao usuário atual (só o ADMIN chega aqui com outro responsável).
   * Devolve também quantas linhas saíram, para a tela avisar ("N itens inativos não foram copiados").
   */
  async duplicar(id: string): Promise<Duplicada> {
    const u = this.usuario();
    const original = await this.carregar(id);
    this.checar(validarTransicao(null, 'RASCUNHO', u.perfil, original.responsavelId === u.id, contexto(original)));
    const empresa = await this.empresa();
    const hoje = hojeEmSaoPaulo();
    const itens: ItemPropostaLocal[] = [];
    let linhasDescartadas = 0;
    for (const l of original.itens) {
      const catalogo = await this.db.itens.get(l.itemCatalogoId);
      if (!catalogo?.ativo) {
        linhasDescartadas++;
        continue;
      }
      const meses = exigeMeses(original.tipo, catalogo) ? (l.meses ?? 1) : null;
      itens.push({ ...l, id: uuidv7(), meses });
    }
    const tecnicoId = original.tecnicoId !== null && (await this.usuarioAtivo(original.tecnicoId, ['TECNICO']))
      ? original.tecnicoId
      : null;
    const responsavelId = (await this.usuarioAtivo(original.responsavelId, ['ADMIN', 'COMERCIAL'])) ? original.responsavelId : u.id;
    const p = comTotais({
      ...original,
      responsavelId,
      tecnicoId,
      id: uuidv7(),
      version: null,
      codigoProvisorio: gerarCodigoProvisorio(),
      numero: null,
      revisao: 1,
      status: 'RASCUNHO',
      dataEmissao: hoje,
      validadeAte: somarDias(hoje, empresa?.validadePadraoDias ?? VALIDADE_PADRAO_DIAS),
      motivoEncerramento: null,
      itens,
      historico: [],
      documentos: [],
      atualizadoEm: null,
    });
    // última barreira: as mesmas regras da edição, com todas as linhas como novas
    validacao(await this.validarEdicao({ ...p, itens: [] }, p));
    await this.gravar(p, null);
    return { id: p.id, linhasDescartadas };
  }

  /**
   * Envio (RASCUNHO → ENVIADA, §9.3), nesta ordem:
   * 1. confere permissão e requisitos (cliente, template e ≥ 1 item), e que cliente e template estão no aparelho;
   * 2. monta a entrada do PDF com os dados locais e gera o PDF oficial com `gerarPdf`;
   * 3. calcula o SHA-256 dos bytes no aparelho;
   * 4. numa transação só: grava o documento local (bytes, revisão, código exibido e o snapshot da entrada), passa a
   *    proposta a ENVIADA (mutação separada) e enfileira o UPLOAD, que por isso sai depois da transição;
   * 5. dispara a sincronização e devolve o Blob para compartilhar.
   * P4b-R21: se a proposta mudou durante a geração (tipicamente o retorno do push da criação, que traz `version` e
   * `numero`), recarrega e gera de novo com os dados novos, até 3 tentativas; se ela já não é rascunho (outro toque
   * no botão, outra aba), `PROPOSTA_JA_ENVIADA`; se ainda muda na 3ª, `PROPOSTA_ALTERADA`. Já na 1ª tentativa, uma
   * proposta que já foi enviada (status depois de ENVIADA, ou cancelada com documento) dá `PROPOSTA_JA_ENVIADA` para
   * quem pode enviá-la, em vez de `TRANSICAO_INVALIDA` (ex.: enviar de novo depois de um envio completo).
   * O PDF acima de 10 MB (limite do upload no servidor) é recusado com `PDF_GRANDE`, sem gravar nada.
   * Código exibido: o número (`000277`, com `-R<n>` na revisão > 1), se já existe; senão, o PROV (com o mesmo sufixo).
   * Com número e um documento PROV anterior, o PDF leva `(ref. PROV-xxxxxx)`.
   * P4c-R15: com um CONFLITO da proposta, `RESOLVA_A_PENDENCIA` antes de gerar o PDF, e de novo na transação (o
   * conflito que chega durante a geração também trava).
   */
  async enviar(id: string, gerarPdf: (entrada: EntradaPdf) => Promise<Blob>): Promise<Blob> {
    const u = this.usuario();
    for (let tentativa = 1; ; tentativa++) {
      const p = comTotais(await this.carregar(id));
      if (p.status !== 'RASCUNHO') {
        // o perfil primeiro: quem não pode enviar recebe ACESSO_NEGADO, como antes
        this.checar(validarTransicao(p.status, p.status, u.perfil, p.responsavelId === u.id, contexto(p)));
        if (tentativa > 1 || jaFoiEnviada(p)) throw jaEnviada();
      }
      const blob = await this.tentarEnviar(p, u, gerarPdf);
      if (blob) {
        void this.sync.sincronizar();
        return blob;
      }
      if (tentativa >= TENTATIVAS_ENVIO) {
        throw new ErroProposta('PROPOSTA_ALTERADA', 'proposta', 'A proposta mudou enquanto o PDF era gerado. Envie de novo.');
      }
    }
  }

  /** Uma tentativa de `enviar` com a proposta `p` lida agora; null = ela mudou durante a geração (nada foi gravado). */
  private async tentarEnviar(
    p: PropostaLocal,
    u: UsuarioSessao,
    gerarPdf: (entrada: EntradaPdf) => Promise<Blob>,
  ): Promise<Blob | null> {
    const id = p.id;
    this.exigirTransicao(p, 'ENVIADA', u, contexto(p));
    exigirSemConflito(await this.pendenciasDa(id), 'enviar');
    const { blob, documento } = await this.gerarDocumento(p, u, gerarPdf);
    const enviada: PropostaLocal = { ...p, status: 'ENVIADA', atualizadoEm: new Date().toISOString() };
    const tabelas = [this.db.propostas, this.db.documentos, this.db.outbox, this.db.pendencias];
    const gravou = await this.db.transaction('rw', tabelas, async () => {
      // o PDF foi gerado fora da transação: se a proposta mudou nesse meio-tempo, ele não a representa mais
      const agora = await this.db.propostas.get(id);
      if (agora && agora.status !== 'RASCUNHO') throw jaEnviada();
      // P4c-R15: e um CONFLITO que chegou nesse meio-tempo trava o envio
      exigirSemConflito(await this.pendenciasDa(id), 'enviar');
      if (!agora || JSON.stringify(comTotais(agora)) !== JSON.stringify(p)) return false;
      await this.db.documentos.add(documento);
      await this.db.propostas.put(enviada);
      await this.sync.registrar('proposta', id, 'UPSERT', dadosDaProposta(enviada), p.version, { separada: true });
      await this.sync.registrarUpload(id, documento.id);
      return true;
    });
    return gravou ? blob : null;
  }

  /**
   * "Gerar PDF novamente" (P4b-R13), quando `motivoParaRegerar` diz que vale: gera o PDF oficial da revisão atual com o
   * código de agora (a mesma montagem e os mesmos limites do `enviar`: snapshot de 512 KB, PDF de 10 MB, SHA-256 no
   * aparelho) e, numa transação só:
   * 1. apaga os documentos não enviados da revisão atual e os das recusas `CODIGO_EXIBIDO_INVALIDO`, com os UPLOADs
   *    deles na fila e nas pendências (a pendência sai e a proposta volta a sincronizar);
   * 2. grava o documento novo e enfileira o UPLOAD dele, atrás do que já está na fila da proposta.
   * A proposta não muda. Se ela mudou durante a geração (o ack traz o número), gera de novo, até 3 vezes, como o
   * `enviar` (P4b-R21). Com o upload antigo em voo, recusa (`PROPOSTA_SINCRONIZANDO`). Devolve o Blob para compartilhar
   * e o código impresso nele (o nome do arquivo; o número pode chegar logo depois, num ack). Com um CONFLITO da
   * proposta, recusa (`RESOLVA_A_PENDENCIA`, P4c-R15), antes de gerar e na transação.
   */
  async regerarDocumento(
    id: string,
    gerarPdf: (entrada: EntradaPdf) => Promise<Blob>,
  ): Promise<{ blob: Blob; codigoExibido: string }> {
    const u = this.usuario();
    for (let tentativa = 1; ; tentativa++) {
      const p = comTotais(await this.carregar(id));
      // o perfil primeiro (técnico, comercial de outra proposta): ACESSO_NEGADO
      this.checar(validarTransicao(p.status, p.status, u.perfil, p.responsavelId === u.id, contexto(p)));
      await this.exigirMotivoParaRegerar(p);
      const { blob, documento } = await this.gerarDocumento(p, u, gerarPdf);
      const tabelas = [this.db.propostas, this.db.documentos, this.db.outbox, this.db.pendencias];
      const gravou = await this.db.transaction('rw', tabelas, async () => {
        const agora = await this.db.propostas.get(id);
        if (!agora || JSON.stringify(comTotais(agora)) !== JSON.stringify(p)) return false;
        const pendencias = await this.exigirMotivoParaRegerar(agora);
        const recusas = pendencias.filter((x) => documentoDoUpload(x.mutacao) !== null && x.erro?.codigo === CODIGO_INVALIDO);
        const daRecusa = new Set(recusas.map((x) => documentoDoUpload(x.mutacao)));
        const antigos = new Set(
          (await this.db.documentos.where('propostaId').equals(id).toArray())
            .filter((d) => !d.enviado && (d.revisao === documento.revisao || daRecusa.has(d.id)))
            .map((d) => d.id),
        );
        const doAntigo = (m: { entidade: string; dados: unknown }) => antigos.has(documentoDoUpload(m) ?? '');
        const naFila = (await this.db.outbox.where('agregadoId').equals(id).toArray()).filter(doAntigo);
        if (naFila.some((m) => m.enviando)) throw sincronizando();
        await this.db.outbox.bulkDelete(naFila.map((m) => m.seq!));
        const resolvidas = pendencias.filter((x) => recusas.includes(x) || doAntigo(x.mutacao));
        await this.db.pendencias.bulkDelete(resolvidas.map((x) => x.mutationId));
        await this.db.documentos.bulkDelete([...antigos]);
        await this.db.documentos.add(documento);
        await this.sync.registrarUpload(id, documento.id);
        return true;
      });
      if (gravou) {
        void this.sync.sincronizar();
        return { blob, codigoExibido: documento.codigoExibido };
      }
      if (tentativa >= TENTATIVAS_ENVIO) {
        throw new ErroProposta('PROPOSTA_ALTERADA', 'proposta', 'A proposta mudou enquanto o PDF era gerado. Tente de novo.');
      }
    }
  }

  /**
   * Exclui o rascunho (§13 "Excluir rascunho"; P4b-R25): só RASCUNHO sem número (o numerado se cancela, como no
   * servidor), por quem pode editá-lo. Numa transação: apaga a proposta local e os documentos locais dela (R15: um
   * envio offline seguido de "Nova revisão" deixa PDF no aparelho), tira as pendências dela e enfileira o DELETE —
   * que, se ela nunca chegou ao servidor, só esvazia a fila do agregado (inclusive o UPLOAD). Com uma mutação dela em
   * voo, recusa (`PROPOSTA_SINCRONIZANDO`): a resposta pode trazer o número.
   */
  async excluir(id: string): Promise<void> {
    const u = this.usuario();
    const atual = await this.carregar(id);
    this.exigirEdicao(atual, u);
    if (atual.numero !== null) {
      throw new ErroProposta('PROPOSTA_NUMERADA', 'proposta', 'Uma proposta numerada não pode ser excluída. Cancele-a.');
    }
    await this.db.transaction('rw', [this.db.propostas, this.db.documentos, this.db.outbox, this.db.pendencias], async () => {
      if (await this.db.outbox.where('agregadoId').equals(id).filter((m) => !!m.enviando).count()) throw sincronizando();
      await this.db.documentos.where('propostaId').equals(id).delete();
      await this.db.pendencias.where('agregadoId').equals(id).delete();
      await this.db.propostas.delete(id);
      await this.sync.registrar('proposta', id, 'DELETE', null, atual.version);
    });
    void this.sync.sincronizar();
  }

  /**
   * A entrada da prévia (P4b-R25), em qualquer status: a mesma `montarEntrada` do PDF oficial, com `previa: true` (marca
   * d'água). Sem cliente, o bloco do cliente sai em branco; sem template, recusa (os blocos vêm dele). Não grava nada.
   * O técnico não vê valores (§10), então não tem prévia.
   */
  async entradaPrevia(id: string): Promise<EntradaPdf> {
    const u = this.usuario();
    if (u.perfil === 'TECNICO') {
      throw new ErroProposta('ACESSO_NEGADO', 'proposta', 'O técnico não vê os valores da proposta.');
    }
    const p = comTotais(await this.carregar(id));
    const cliente = p.clienteId === null ? null : await this.db.clientes.get(p.clienteId);
    if (cliente === undefined) validacao({ clienteId: 'O cliente não está neste aparelho. Sincronize e tente de novo.' });
    if (p.templateId === null) validacao({ templateId: 'Escolha o template para ver a prévia.' });
    const template = await this.db.templates.get(p.templateId!);
    if (!template) validacao({ templateId: 'O template não está neste aparelho. Sincronize e tente de novo.' });
    return this.montarEntrada(p, cliente ?? null, template!, await this.empresa(), u, true);
  }

  /**
   * Os PDFs da proposta (P4b-R25): os do servidor (`documentos` da proposta) e os do aparelho (ainda não enviados, ou
   * enviados com os bytes guardados), por revisão desc e data desc. `[]` para o técnico (§10).
   */
  observarDocumentos(propostaId: string): Observable<DocumentoDaProposta[]> {
    return observar(async () => {
      if (!this.veDocumentos()) return [];
      const doServidor = (await this.db.propostas.get(propostaId))?.documentos ?? [];
      const locais = await this.db.documentos.where('propostaId').equals(propostaId).toArray();
      const porId = new Map<string, DocumentoDaProposta>();
      for (const d of doServidor) {
        porId.set(d.id, {
          id: d.id, revisao: d.revisao, codigoExibido: d.codigoExibido, geradoEm: d.geradoEm, enviado: true, temBytes: false,
          arquivoId: d.arquivoId,
        });
      }
      for (const d of locais) {
        const servidor = porId.get(d.id);
        porId.set(d.id, {
          id: d.id, revisao: d.revisao, codigoExibido: d.codigoExibido, geradoEm: servidor?.geradoEm ?? d.geradoEm,
          enviado: d.enviado || !!servidor, temBytes: d.bytes !== null, arquivoId: d.arquivoId ?? servidor?.arquivoId ?? null,
        });
      }
      const instante = (d: DocumentoDaProposta) => Date.parse(d.geradoEm) || 0;
      return [...porId.values()].sort((a, b) => b.revisao - a.revisao || instante(b) - instante(a));
    });
  }

  /** O PDF guardado no aparelho (application/pdf); null se só os metadados estão aqui. null para o técnico (§10). */
  async blobDoDocumento(documentoId: string): Promise<Blob | null> {
    if (!this.veDocumentos()) return null;
    const d = await this.db.documentos.get(documentoId);
    return d?.bytes ? new Blob([d.bytes], { type: 'application/pdf' }) : null;
  }

  /**
   * "Corrigir e reenviar" (§11.5, P4b-R23; `PendenciasService.corrigirProposta` chama aqui). Numa transação só:
   * relê a pendência, que tem de existir (`PENDENCIA_INEXISTENTE`) e ser a recusa VALIDACAO de dados de rascunho de
   * uma proposta (`PENDENCIA_NAO_CORRIGIVEL`, P4b-R28), e corrige a fila com `corrigirNaFila`. Inválida, nada muda.
   */
  async corrigirPendencia(pendenciaId: string, edicao: Partial<EdicaoRascunho>): Promise<void> {
    await this.db.transaction('rw', this.tabelasDaCorrecao(), async () => {
      const p = await this.db.pendencias.get(pendenciaId);
      if (!p) throw new ErroProposta('PENDENCIA_INEXISTENTE', 'proposta', 'Esta pendência já foi resolvida.');
      if (!pendenciaCorrigivel(p)) {
        throw new ErroProposta('PENDENCIA_NAO_CORRIGIVEL', 'proposta', 'Só uma proposta recusada pelo servidor pode ser corrigida aqui.');
      }
      await this.corrigirNaFila(p, edicao);
    });
    void this.sync.sincronizar();
  }

  // --- internos ---

  /** Só ADMIN e COMERCIAL veem os PDFs (têm valores); o técnico e a sessão ausente, não (§10). */
  private veDocumentos(): boolean {
    const perfil = this.auth.usuario()?.perfil;
    return perfil === 'ADMIN' || perfil === 'COMERCIAL';
  }

  private usuario(): UsuarioSessao {
    const u = this.auth.usuario();
    if (!u) throw new ErroProposta('ACESSO_NEGADO', 'proposta', 'Entre de novo para alterar propostas.');
    return u;
  }

  private async carregar(id: string): Promise<PropostaLocal> {
    const p = await this.db.propostas.get(id);
    if (!p) throw new ErroProposta('NAO_ENCONTRADA', 'proposta', 'Proposta não encontrada neste aparelho.');
    return p;
  }

  private empresa(): Promise<EmpresaLocal | undefined> {
    return this.db.empresa.get(ID_EMPRESA);
  }

  private checar(e: ErroMutacao | null): void {
    if (e) throw ErroProposta.de(e);
  }

  /** Edição de campos: perfil (técnico nunca; comercial só se responsável) e status (só RASCUNHO). */
  private exigirEdicao(p: PropostaLocal, u: UsuarioSessao): void {
    this.checar(validarTransicao(p.status, p.status, u.perfil, p.responsavelId === u.id, contexto(p, { alteraCampos: true })));
  }

  /** O destino tem de estar entre os que o usuário pode escolher, e os requisitos dele têm de estar cumpridos. */
  private exigirTransicao(p: PropostaLocal, para: StatusProposta, u: UsuarioSessao, ctx: ContextoTransicao): void {
    const ehResponsavel = p.responsavelId === u.id;
    this.checar(validarTransicao(p.status, para, u.perfil, ehResponsavel, ctx));
    if (!transicoesPermitidas(p.status, u.perfil, ehResponsavel).includes(para)) {
      throw new ErroProposta('TRANSICAO_INVALIDA', 'proposta', 'Esta mudança de status não está disponível.');
    }
  }

  private async conferirTecnico(p: PropostaLocal, u: UsuarioSessao, tecnicoId: string | null): Promise<void> {
    if (!podeAlterarTecnico(p.status, u.perfil, p.responsavelId === u.id)) {
      throw new ErroProposta('ACESSO_NEGADO', 'tecnicoId', 'Só o administrador ou o responsável troca o técnico.');
    }
    if (tecnicoId === null) return;
    if (!(await this.usuarioAtivo(tecnicoId, ['TECNICO']))) validacao({ tecnicoId: 'Escolha um técnico ativo.' });
  }

  /** Está na lista de usuários do aparelho, com um dos perfis e ativo (linha antiga sem `ativo` conta como ativa). */
  private async usuarioAtivo(id: string, perfis: readonly Perfil[]): Promise<boolean> {
    const x = await this.db.usuarios.get(id);
    return !!x && perfis.includes(x.perfil) && x.ativo !== false;
  }

  /** Limites de entrada do servidor (§7.3 e `PropostaDados`), com os mesmos nomes de campo. */
  private async validarEdicao(atual: PropostaLocal, novo: PropostaLocal): Promise<Record<string, string>> {
    const campos: Record<string, string> = {};
    if (!dataValida(novo.dataEmissao)) campos['dataEmissao'] = 'Informe a data de emissão.';
    if (novo.validadeAte !== null && !dataValida(novo.validadeAte)) campos['validadeAte'] = 'Data inválida.';
    for (const [campo, max] of TAMANHO_TEXTO) {
      if ((novo[campo] ?? '').length > max) campos[campo] = `Máximo de ${max} caracteres.`;
    }
    if (!inteiroEntre(novo.descontoGeralCentesimos, 0, PERCENTUAL_MAX_CENTESIMOS)) {
      campos['descontoGeralPercentual'] = 'O desconto vai de 0 a 100%.';
    }
    if (novo.itens.length > MAX_ITENS) campos['itens'] = `Máximo de ${MAX_ITENS} itens.`;
    const anteriores = new Map(atual.itens.map((l) => [l.id, l]));
    const ids = new Set<string>();
    for (const [i, l] of novo.itens.entries()) {
      const pre = `itens[${i}].`;
      if (ids.has(l.id)) {
        campos[pre + 'id'] = 'Linha repetida.';
        continue;
      }
      ids.add(l.id);
      if (!inteiroEntre(l.quantidadeMilesimos, 1, QUANTIDADE_MAX_MILESIMOS)) {
        campos[pre + 'quantidade'] = 'A quantidade vai de 0,001 a 999.999,999.';
      }
      if (!inteiroEntre(l.precoUnitarioCentavos, 0, PRECO_MAX_CENTAVOS)) {
        campos[pre + 'precoUnitario'] = 'O preço vai de 0 a 999.999.999.999,99.';
      }
      if (!inteiroEntre(l.descontoCentesimos, 0, PERCENTUAL_MAX_CENTESIMOS)) {
        campos[pre + 'descontoPercentual'] = 'O desconto vai de 0 a 100%.';
      }
      if (l.meses !== null && !inteiroEntre(l.meses, 1, 120)) {
        campos[pre + 'meses'] = 'De 1 a 120 meses.';
        continue;
      }
      // como no servidor: catálogo e meses conferidos só na linha nova, na que mudou meses ou quando o tipo mudou
      const anterior = anteriores.get(l.id);
      const nova = !anterior || anterior.itemCatalogoId !== l.itemCatalogoId;
      if (!nova && anterior.meses === l.meses && atual.tipo === novo.tipo) continue;
      const catalogo = await this.db.itens.get(l.itemCatalogoId);
      if (!catalogo) continue; // o servidor decide
      if (nova && !catalogo.ativo) {
        campos[pre + 'itemCatalogoId'] = 'Item do catálogo inativo.';
        continue;
      }
      const exige = exigeMeses(novo.tipo, catalogo);
      if (exige && l.meses === null) campos[pre + 'meses'] = 'Informe os meses de locação.';
      else if (!exige && l.meses !== null) campos[pre + 'meses'] = 'Meses só em proposta de locação com item locável.';
    }
    return campos;
  }

  /** As regras do `atribuir` (P4b-R3); null = nada muda. */
  private async atribuicaoConferida(
    id: string,
    mudanca: { responsavelId?: string; tecnicoId?: string | null },
  ): Promise<{ atual: PropostaLocal; responsavelId: string; tecnicoId: string | null } | null> {
    const u = this.usuario();
    const atual = await this.carregar(id);
    const ehResponsavel = atual.responsavelId === u.id;
    const responsavelId = mudanca.responsavelId ?? atual.responsavelId;
    const tecnicoId = mudanca.tecnicoId !== undefined ? mudanca.tecnicoId : atual.tecnicoId;
    if (responsavelId === atual.responsavelId && tecnicoId === atual.tecnicoId) return null;
    this.checar(validarTransicao(atual.status, atual.status, u.perfil, ehResponsavel, contexto(atual, { alteraAtribuicao: true })));
    if (responsavelId !== atual.responsavelId) {
      if (!podeAlterarResponsavel(atual.status, u.perfil)) {
        throw new ErroProposta('ACESSO_NEGADO', 'responsavelId', 'Só o administrador troca o responsável.');
      }
      if (!(await this.usuarioAtivo(responsavelId, ['ADMIN', 'COMERCIAL']))) {
        validacao({ responsavelId: 'O responsável tem de ser um administrador ou comercial ativo.' });
      }
    }
    if (tecnicoId !== atual.tecnicoId) await this.conferirTecnico(atual, u, tecnicoId);
    // P4c-R15 (o `gravar` do atribuir confere de novo, na transação)
    exigirSemConflito(await this.pendenciasDa(id), 'atribuir');
    return { atual, responsavelId, tecnicoId };
  }

  /**
   * Recusa com um CONFLITO da proposta (`RESOLVA_A_PENDENCIA`, P4c-R15) e quando `motivoParaRegerar` não vale para `p`
   * (`DOCUMENTO_EM_DIA`); devolve as pendências dela.
   */
  private async exigirMotivoParaRegerar(p: PropostaLocal): Promise<Pendencia[]> {
    const pendencias = await this.pendenciasDa(p.id);
    exigirSemConflito(pendencias, 'regerar');
    const locais = await this.db.documentos.where('propostaId').equals(p.id).toArray();
    if (!motivoParaRegerar(p, locais, pendencias)) {
      throw new ErroProposta('DOCUMENTO_EM_DIA', 'proposta', 'O PDF desta revisão já está no aparelho ou no servidor.');
    }
    return pendencias;
  }

  /**
   * O PDF oficial de `p` como ela está (`enviar` e `regerarDocumento`), sem gravar nada: confere que o cliente e o
   * template estão no aparelho, monta a entrada (`montarEntrada`, `previa: false`), recusa o snapshot acima de 512 KB
   * antes de gerar e o PDF acima de 10 MB depois (o upload voltaria 413), e calcula o SHA-256 dos bytes. Código
   * exibido: `codigoExibido` da revisão atual.
   */
  private async gerarDocumento(
    p: PropostaLocal,
    u: UsuarioSessao,
    gerarPdf: (entrada: EntradaPdf) => Promise<Blob>,
  ): Promise<{ blob: Blob; documento: DocumentoLocal }> {
    const cliente = p.clienteId === null ? undefined : await this.db.clientes.get(p.clienteId);
    if (!cliente) validacao({ clienteId: 'O cliente não está neste aparelho. Sincronize e tente de novo.' });
    const template = p.templateId === null ? undefined : await this.db.templates.get(p.templateId);
    if (!template) validacao({ templateId: 'O template não está neste aparelho. Sincronize e tente de novo.' });

    const empresa = await this.empresa();
    const entrada = await this.montarEntrada(p, cliente!, template!, empresa, u, false);
    // snapshot: a entrada sem a logo em data URL (pesada; vai a referência do arquivo)
    const snapshot = JSON.parse(JSON.stringify({ ...entrada, logoDataUrl: undefined })) as Record<string, unknown>;
    snapshot['logoArquivoId'] = empresa?.logoArquivoId ?? null;
    if (new TextEncoder().encode(JSON.stringify(snapshot)).length > SNAPSHOT_MAX_BYTES) {
      throw new ErroProposta('SNAPSHOT_GRANDE', 'proposta', 'Os dados desta proposta passam do limite do documento (512 KB).');
    }

    const blob = await gerarPdf(entrada);
    const bytes = await paraBytes(blob);
    if (bytes.byteLength > PDF_MAX_BYTES) {
      // o upload voltaria 413 e a proposta ficaria no servidor sem documento
      throw new ErroProposta('PDF_GRANDE', 'proposta', 'O PDF passou de 10 MB. Reduza imagens do template.');
    }
    const revisao = p.revisao ?? 1;
    const documento: DocumentoLocal = {
      id: uuidv7(),
      propostaId: p.id,
      revisao,
      codigoExibido: codigoExibido({ ...p, revisao }),
      sha256: await sha256Hex(bytes),
      geradoEm: new Date().toISOString(),
      geradoPor: u.id,
      bytes,
      enviado: false,
      arquivoId: null,
      snapshot,
    };
    return { blob, documento };
  }

  /** A entrada do PDF oficial (`enviar`) e da prévia (`entradaPrevia`): uma montagem só, para as duas não divergirem. */
  private async montarEntrada(
    p: PropostaLocal,
    cliente: ClienteLocal | null,
    template: TemplateLocal,
    empresa: EmpresaLocal | undefined,
    u: UsuarioSessao,
    previa: boolean,
  ): Promise<EntradaPdf> {
    const locais = await this.db.documentos.where('propostaId').equals(p.id).toArray();
    const provisorioAnterior =
      p.numero !== null && [...p.documentos, ...locais].some((d) => d.codigoExibido.startsWith(p.codigoProvisorio));
    const responsavel = await this.db.usuarios.get(p.responsavelId);
    const souEu = p.responsavelId === u.id;
    return {
      empresa: empresa
        ? {
            razaoSocial: empresa.razaoSocial,
            nomeFantasia: empresa.nomeFantasia,
            cnpj: empresa.cnpj,
            endereco: empresa.endereco,
            telefone: empresa.telefone,
            email: empresa.email,
            site: empresa.site,
            corPrimaria: empresa.corPrimaria,
          }
        : { ...EMPRESA_VAZIA },
      cliente: cliente ? clienteDoPdf(cliente) : { ...CLIENTE_VAZIO },
      proposta: {
        codigoExibido: codigoBase(p),
        referenciaProvisoria: provisorioAnterior ? p.codigoProvisorio : null,
        revisao: p.revisao ?? 1,
        tipo: p.tipo,
        dataEmissao: p.dataEmissao,
        validadeAte: p.validadeAte,
        condicoesPagamento: p.condicoesPagamento,
        prazoExecucao: p.prazoExecucao,
        observacoes: p.observacoes,
        totalItensCentavos: p.totalItensCentavos ?? 0,
        totalDescontosCentavos: p.totalDescontosCentavos ?? 0,
        totalCentavos: p.totalCentavos ?? 0,
        responsavelNome: responsavel?.nome ?? (souEu ? u.nome : null),
        responsavelEmail: responsavel?.email ?? (souEu ? u.email : null),
      },
      itens: p.itens.map(itemDoPdf),
      blocos: template.blocos,
      logoDataUrl: await this.pdf.logoDataUrl(empresa ?? null),
      previa,
    };
  }

  /** O que a correção lê e escreve: a validação lê `itens` e `usuarios`. */
  private tabelasDaCorrecao() {
    return [this.db.pendencias, this.db.outbox, this.db.propostas, this.db.itens, this.db.usuarios];
  }

  /**
   * Núcleo da correção (P4b-R23, R27), dentro de uma transação com `tabelasDaCorrecao`, para a pendência `p` já
   * conferida com `pendenciaCorrigivel`:
   * 1. confere a edição sobre a proposta local (`conferirCorrecao`);
   * 2. aplica a edição aos `dados` da mutação recusada e de todas as mutações `proposta` retidas atrás dela, como
   *    `remapearCliente` faz com o `clienteId` (cada uma mantém o próprio status; as reescritas ganham outro
   *    `mutationId`);
   * 3. devolve a recusada à fila no `seq` dela (`SyncService.devolverAFila`), na frente das retidas;
   * 4. grava a proposta local corrigida, com o status otimista.
   * UPLOAD e documentos não mudam: o PDF já gerado é o que o cliente recebeu, e o código exibido não muda.
   */
  private async corrigirNaFila(p: Pendencia, edicao: Partial<EdicaoRascunho>): Promise<void> {
    const local = await this.db.propostas.get(p.agregadoId);
    if (!local) throw new ErroProposta('NAO_ENCONTRADA', 'proposta', 'Proposta não encontrada neste aparelho.');
    const corrigida = await this.conferirCorrecao(local, edicao, p);
    const corrigir = (d: unknown) => corrigirDadosDaProposta(p.agregadoId, d as PropostaDados, edicao);
    const retidas = await this.db.outbox.where('agregadoId').equals(p.agregadoId).toArray();
    for (const m of retidas.filter((x) => x.entidade === 'proposta' && x.dados)) {
      await this.db.outbox.update(m.seq!, { dados: corrigir(m.dados), mutationId: crypto.randomUUID(), enviando: false });
    }
    await this.db.pendencias.delete(p.mutationId);
    await this.sync.devolverAFila(p, { dados: corrigir(p.mutacao.dados) });
    await this.db.propostas.put(corrigida);
  }

  /**
   * Confere a correção e devolve a proposta local corrigida, com os totais e o status otimista mantido (ex.:
   * ENVIADA). Mesmas regras de `salvarRascunho` (perfil, técnico, `validarEdicao`), mas sem exigir RASCUNHO no local: o
   * que se corrige são os dados da mutação recusada, que é de rascunho. Linhas "novas" (catálogo conferido) como o
   * servidor as vê: na criação recusada (`baseVersion` null), todas; senão, as que não estão na cópia local e as
   * citadas nos campos da recusa (P4b-R29: a cópia local otimista já as tem, o servidor não).
   */
  private async conferirCorrecao(atual: PropostaLocal, edicao: Partial<EdicaoRascunho>, p: Pendencia): Promise<PropostaLocal> {
    const u = this.usuario();
    this.exigirEdicao({ ...atual, status: 'RASCUNHO' }, u);
    if (edicao.tecnicoId !== undefined && edicao.tecnicoId !== atual.tecnicoId) {
      await this.conferirTecnico(atual, u, edicao.tecnicoId);
    }
    const novo = aplicarEdicao(atual, edicao);
    const recusadas = linhasRecusadas(p);
    const comoNoServidor = p.mutacao.baseVersion === null ? [] : atual.itens.filter((l) => !recusadas.has(l.id));
    validacao(await this.validarEdicao({ ...atual, itens: comoNoServidor }, novo));
    return comTotais({ ...novo, atualizadoEm: new Date().toISOString() });
  }

  /**
   * Grava o local e enfileira o UPSERT, na mesma transação. `separada`: mutação que não coalesce (transição);
   * `semConflito`: recusa, dentro da transação, se a proposta tem um CONFLITO (P4c-R15).
   */
  private async gravar(
    p: PropostaLocal,
    baseVersion: number | null,
    opcoes: { separada?: boolean; semConflito?: keyof typeof ANTES_DE } = {},
  ): Promise<void> {
    // P4b-R19: atualizadoEm otimista (o kanban reordena na hora); o servidor sobrescreve no retorno
    p = { ...p, atualizadoEm: new Date().toISOString() };
    await this.db.transaction('rw', [this.db.propostas, this.db.outbox, this.db.pendencias], async () => {
      if (opcoes.semConflito) exigirSemConflito(await this.pendenciasDa(p.id), opcoes.semConflito);
      await this.db.propostas.put(p);
      await this.sync.registrar('proposta', p.id, 'UPSERT', dadosDaProposta(p), baseVersion, opcoes.separada ? { separada: true } : {});
    });
    void this.sync.sincronizar();
  }

  private pendenciasDa(id: string): Promise<Pendencia[]> {
    return this.db.pendencias.where('agregadoId').equals(id).toArray();
  }

  /**
   * A edição do rascunho (`salvarRascunho`, `adicionarItem`): `p` já conferida, `edicao` o que mudou. Com uma recusa
   * de dados da proposta (pendência REJEITADO):
   * - nada retido atrás dela: a edição substitui a mutação recusada (a pendência sai, como nos outros repos) e vai
   *   como mutação nova; a rejeição de upload continua;
   * - com mutações retidas (P4b-R27, ex.: envio offline, criação recusada e "Nova revisão"): apagar a recusa perderia
   *   a criação, e a transição retida chegaria ao servidor como criação ENVIADA. A edição entra pelo caminho da
   *   correção (`corrigirNaFila`: na recusada e nas retidas, que voltam a sair em ordem); se a recusa não se conserta
   *   editando (`pendenciaCorrigivel`), recusa a edição (`RESOLVA_A_PENDENCIA`) e nada muda.
   */
  private async gravarEdicao(p: PropostaLocal, edicao: Partial<EdicaoRascunho>, baseVersion: number | null): Promise<void> {
    // P4b-R19: atualizadoEm otimista
    p = { ...p, atualizadoEm: new Date().toISOString() };
    await this.db.transaction('rw', this.tabelasDaCorrecao(), async () => {
      // toArray, não first(): o first() limita a Collection no lugar, e um delete() nela depois apagaria só uma
      const recusas = await this.db.pendencias
        .where('agregadoId')
        .equals(p.id)
        .filter((x) => x.tipo === 'REJEITADO' && x.entidade === 'proposta')
        .toArray();
      const recusa = recusas[0];
      if (recusa && (await this.db.outbox.where('agregadoId').equals(p.id).count()) > 0) {
        if (!pendenciaCorrigivel(recusa)) {
          throw new ErroProposta('RESOLVA_A_PENDENCIA', 'proposta', 'Resolva a pendência desta proposta antes de editá-la.');
        }
        await this.corrigirNaFila(recusa, edicao);
        return;
      }
      await this.db.pendencias.bulkDelete(recusas.map((x) => x.mutationId));
      await this.db.propostas.put(p);
      await this.sync.registrar('proposta', p.id, 'UPSERT', dadosDaProposta(p), baseVersion);
    });
    void this.sync.sincronizar();
  }
}
