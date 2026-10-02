import type { Perfil } from '../../core/auth/auth-models';
import type { ErroMutacao } from '../../core/sync/sync-models';
import type { NaturezaItem } from '../catalogo/item-models';
import { deMilesimos, paraMilesimos } from '../propostas/calculo';
import { stripJava } from '../propostas/proposta-models';

export type StatusOs = 'ABERTA' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';
export type TipoOs = 'INSTALACAO' | 'MANUTENCAO' | 'CORRETIVA' | 'PREVENTIVA' | 'ENTREGA' | 'RETIRADA' | 'SERVICO';
export type TipoAnexoOs = 'FOTO' | 'ASSINATURA' | 'DOCUMENTO';
export type MomentoFoto = 'ANTES' | 'DURANTE' | 'DEPOIS';

/** Decimal do JSON: número (BigDecimal do Jackson); texto também é aceito na leitura. */
type Decimal = number | string;

// --- formato do sync (`OsDados` do servidor, campo a campo) ---

/**
 * Formato da OS no sync (`OsDados` do servidor). O servidor não serializa nulos: chave ausente = null. A OS **não tem
 * preço nem custo** em lugar nenhum, então todos os perfis recebem o mesmo agregado.
 * - **[srv]** (ignorados na entrada, sempre o valor do servidor): `numero`, `revisao`, `propostaNumero` e
 *   `propostaCodigoExibido` (da proposta, para o PDF da OS offline, M2P1-R25: `000277`, `000277-R2` ou o `PROV-…`;
 *   ausentes na avulsa), `iniciadaEm`, `concluidaEm`, a assinatura aceita (`assinaturaAnexoId`, `assinanteNome`,
 *   `assinantePapel`, `assinadaEm`), `anexos`, `historico`, `atualizadoEm`; nas linhas, `ordem`; nas notas, `autorId` e
 *   `criadaEm`.
 * - `responsavelId`: derivado na criação; ausente ou null na entrada mantém o atual. Na OS de proposta segue o da
 *   proposta (M2P1-R16/R18): o front manda null.
 * - `propostaId`, `clienteId` e `codigoProvisorio`: só na criação. Na edição, `clienteId` null mantém (M2P1-R17).
 * - Comandos de entrada, que nunca chegam no pull: `motivoReabertura` e `aceitarTrabalho` (só ADMIN, M2-R4).
 *   `motivoCancelamento` só é lido na transição para CANCELADA.
 * - `concluiProposta` (Q17): obrigatório no push (padrão true). Em ABERTA pelo ADMIN e pelo COMERCIAL responsável; em
 *   EM_ANDAMENTO pelo ADMIN e pelo TECNICO atribuído (Q21, "Precisa voltar"); sem efeito na OS avulsa.
 * - `notas`: só de acréscimo (M2-R1), união por id; no máximo 200 novas por envio.
 */
export interface OsDados {
  codigoProvisorio: string;
  numero?: number | null;
  revisao?: number | null;
  propostaId?: string | null;
  /** [srv] Número da proposta, para o cabeçalho do PDF da OS; ausente na avulsa e na proposta sem número. */
  propostaNumero?: number | null;
  /** [srv] Código da proposta como no PDF dela (`000277`, `000277-R2` ou `PROV-…`); ausente na avulsa. */
  propostaCodigoExibido?: string | null;
  clienteId?: string | null;
  tipo: TipoOs;
  status: StatusOs;
  responsavelId?: string | null;
  tecnicoId?: string | null;
  /** `aaaa-mm-dd`. */
  dataPrevista?: string | null;
  urgente: boolean;
  /** Q17: concluir esta OS pode finalizar a proposta. Obrigatório no push. */
  concluiProposta: boolean;
  descricao?: string | null;
  enderecoCep?: string | null;
  enderecoLogradouro?: string | null;
  enderecoNumero?: string | null;
  enderecoComplemento?: string | null;
  enderecoBairro?: string | null;
  enderecoCidade?: string | null;
  enderecoUf?: string | null;
  iniciadaEm?: string | null;
  concluidaEm?: string | null;
  resumoExecucao?: string | null;
  motivoCancelamento?: string | null;
  /** Comando: só na reabertura (vai para a observação do histórico). */
  motivoReabertura?: string | null;
  assinaturaAnexoId?: string | null;
  assinanteNome?: string | null;
  assinantePapel?: string | null;
  assinadaEm?: string | null;
  assinaturaRecusada: boolean;
  motivoRecusa?: string | null;
  /** Comando do M2-R4, só do ADMIN: conta quando vem true. */
  aceitarTrabalho?: boolean | null;
  itens: ItemOsDados[];
  notas: NotaOsDados[];
  anexos?: AnexoOsDados[];
  historico?: HistoricoOsDados[];
  atualizadoEm?: string | null;
}

/** Linha da OS: o *snapshot* da proposta (ou digitado, na avulsa), sem preço nem custo. `ordem` é [srv]. */
export interface ItemOsDados {
  id: string;
  itemCatalogoId?: string | null;
  codigo: string;
  nome: string;
  unidade: string;
  natureza: NaturezaItem;
  quantidadePrevista: Decimal;
  ordem?: number | null;
}

/** Nota do diário da execução, só de acréscimo. `autorId` e `criadaEm` são [srv]. */
export interface NotaOsDados {
  id: string;
  texto: string;
  autorId?: string | null;
  criadaEm?: string | null;
}

/**
 * Anexo [srv]: chega só pelo upload (M2-R2). `momento` só em FOTO; `assinanteNome`/`assinantePapel` só em ASSINATURA
 * (com `tiradaEm` = quando foi assinada); `revisaoOs` e `codigoExibido` só em DOCUMENTO. O `snapshot` não vem no sync.
 */
export interface AnexoOsDados {
  id: string;
  tipo: TipoAnexoOs;
  arquivoId: string;
  sha256: string;
  legenda?: string | null;
  momento?: MomentoFoto | null;
  tiradaEm?: string | null;
  assinanteNome?: string | null;
  assinantePapel?: string | null;
  revisaoOs?: number | null;
  codigoExibido?: string | null;
  autorId: string;
  criadoEm: string;
}

/** Histórico [srv]. `statusDe` ausente = criação; `statusDe === statusPara` = registro sem transição (M2-R3). */
export interface HistoricoOsDados {
  statusDe?: StatusOs | null;
  statusPara: StatusOs;
  usuarioId: string;
  em: string;
  observacao?: string | null;
}

/** Comandos de entrada (nunca guardados no registro local): vão só na mutação que os usa. */
export interface ComandosOs {
  motivoReabertura?: string | null;
  aceitarTrabalho?: boolean;
}

// --- registro local (Dexie) ---

/** Linha guardada. A quantidade em milésimos inteiros (exata), como a da proposta. */
export interface ItemOsLocal {
  id: string;
  itemCatalogoId: string | null;
  codigo: string;
  nome: string;
  unidade: string;
  natureza: NaturezaItem;
  quantidadePrevistaMilesimos: number;
  ordem: number | null;
}

/**
 * `autorId` e `criadaEm` são do servidor: null até a nota ser aceita, e nunca preenchidos no aparelho. Para a tela
 * mostrar a nota pendente com quem a escreveu e quando, o aparelho guarda `autorLocalId` e `criadaLocalEm`, que só
 * existem no Dexie: nunca vão para a rede (`dadosDaOs`) e somem quando o estado do servidor substitui o registro.
 */
export interface NotaOsLocal {
  id: string;
  texto: string;
  autorId: string | null;
  criadaEm: string | null;
  autorLocalId?: string | null;
  criadaLocalEm?: string | null;
}

export interface HistoricoOsLocal {
  statusDe: StatusOs | null;
  statusPara: StatusOs;
  usuarioId: string;
  em: string;
  observacao: string | null;
}

/** Um anexo que o servidor já aceitou (`OsLocal.anexos`), com as chaves ausentes como null. */
export interface AnexoOsServidor {
  id: string;
  tipo: TipoAnexoOs;
  arquivoId: string;
  sha256: string;
  legenda: string | null;
  momento: MomentoFoto | null;
  tiradaEm: string | null;
  assinanteNome: string | null;
  assinantePapel: string | null;
  revisaoOs: number | null;
  codigoExibido: string | null;
  autorId: string;
  criadoEm: string;
}

/**
 * Anexo guardado no aparelho (tabela `anexosOs`): os metadados e a miniatura, do momento da captura até depois do
 * upload. M2P2-R16: os bytes completos e o snapshot ficam em `anexosOsBytes` (`BytesAnexoOs`, pela mesma id), para a
 * galeria (`observarAnexos`) e as pendências não carregarem o arquivo inteiro a cada leitura. Depois do upload aceito
 * ficam só a miniatura e os metadados (P4b-R26); no DOCUMENTO, os bytes da revisão atual. Na ASSINATURA, `tiradaEm` é
 * o `assinadaEm` do upload. Um anexo só do servidor pode ter aqui uma linha `enviado` só com a miniatura (M2P2-R14).
 */
export interface AnexoOsLocal {
  id: string;
  osId: string;
  tipo: TipoAnexoOs;
  sha256: string;
  legenda: string | null;
  momento: MomentoFoto | null;
  tiradaEm: string | null;
  assinanteNome: string | null;
  assinantePapel: string | null;
  revisaoOs: number | null;
  codigoExibido: string | null;
  /**
   * JPEG de 320 px gerado na captura (FOTO) ou o próprio PNG (ASSINATURA, até 512 KB); fica depois do upload. Fica
   * nesta tabela: é pequena e é o que a galeria mostra.
   */
  miniatura: ArrayBuffer | null;
  /** O upload já foi aceito. */
  enviado: boolean;
  /** Id do `arquivo` no servidor, depois do upload. */
  arquivoId: string | null;
}

/**
 * Os bytes completos de um anexo da OS (tabela `anexosOsBytes`, pela id do anexo): JPEG, PNG ou PDF, do momento da
 * captura até a poda depois do upload. Sem a linha, os bytes não estão no aparelho.
 */
export interface BytesAnexoOs {
  id: string;
  bytes: ArrayBuffer;
  /** DOCUMENTO: a entrada do PDF (objeto JSON, ≤ 512 KB), enviada nos metadados do upload. */
  snapshot?: Record<string, unknown> | null;
}

export interface OsLocal {
  id: string;
  /** Última versão conhecida do servidor; null = ainda não existe lá. */
  version: number | null;
  codigoProvisorio: string;
  numero: number | null;
  revisao: number | null;
  propostaId: string | null;
  /** [srv] null na avulsa. */
  propostaNumero: number | null;
  /** [srv] null na avulsa. */
  propostaCodigoExibido: string | null;
  clienteId: string | null;
  tipo: TipoOs;
  status: StatusOs;
  responsavelId: string | null;
  tecnicoId: string | null;
  dataPrevista: string | null;
  urgente: boolean;
  concluiProposta: boolean;
  descricao: string | null;
  enderecoCep: string | null;
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  enderecoComplemento: string | null;
  enderecoBairro: string | null;
  enderecoCidade: string | null;
  enderecoUf: string | null;
  iniciadaEm: string | null;
  /**
   * Só no aparelho: quando o `iniciar` foi feito aqui, para o PDF da conclusão offline mostrar o início enquanto o
   * `iniciadaEm` [srv] não chega. Nunca vai para a rede (`dadosDaOs`) e some quando o estado do servidor substitui o
   * registro.
   */
  iniciadaLocalEm?: string | null;
  concluidaEm: string | null;
  resumoExecucao: string | null;
  motivoCancelamento: string | null;
  assinaturaAnexoId: string | null;
  assinanteNome: string | null;
  assinantePapel: string | null;
  assinadaEm: string | null;
  assinaturaRecusada: boolean;
  motivoRecusa: string | null;
  itens: ItemOsLocal[];
  notas: NotaOsLocal[];
  anexos: AnexoOsServidor[];
  historico: HistoricoOsLocal[];
  /** ISO-8601. Uma escrita local marca o agora (otimista); o servidor sobrescreve no retorno. */
  atualizadoEm: string | null;
}

// --- dados <-> local ---

/** O anexo do pull ou da resposta do upload (o mesmo `AnexoOsDados`), lido campo a campo, com as chaves ausentes como null. */
export function paraAnexoOsServidor(a: AnexoOsDados): AnexoOsServidor {
  return {
    id: a.id,
    tipo: a.tipo,
    arquivoId: a.arquivoId,
    sha256: a.sha256,
    legenda: a.legenda ?? null,
    momento: a.momento ?? null,
    tiradaEm: a.tiradaEm ?? null,
    assinanteNome: a.assinanteNome ?? null,
    assinantePapel: a.assinantePapel ?? null,
    revisaoOs: a.revisaoOs ?? null,
    codigoExibido: a.codigoExibido ?? null,
    autorId: a.autorId,
    criadoEm: a.criadoEm,
  };
}

export function paraOsLocal(id: string, version: number | null, d: OsDados): OsLocal {
  return {
    id,
    version,
    codigoProvisorio: d.codigoProvisorio,
    numero: d.numero ?? null,
    revisao: d.revisao ?? null,
    propostaId: d.propostaId ?? null,
    propostaNumero: d.propostaNumero ?? null,
    propostaCodigoExibido: d.propostaCodigoExibido ?? null,
    clienteId: d.clienteId ?? null,
    tipo: d.tipo,
    status: d.status,
    responsavelId: d.responsavelId ?? null,
    tecnicoId: d.tecnicoId ?? null,
    dataPrevista: d.dataPrevista ?? null,
    urgente: d.urgente,
    // o servidor sempre manda (boolean primitivo); ausente só num servidor anterior ao Q17, com o padrão dele
    concluiProposta: d.concluiProposta ?? true,
    descricao: d.descricao ?? null,
    enderecoCep: d.enderecoCep ?? null,
    enderecoLogradouro: d.enderecoLogradouro ?? null,
    enderecoNumero: d.enderecoNumero ?? null,
    enderecoComplemento: d.enderecoComplemento ?? null,
    enderecoBairro: d.enderecoBairro ?? null,
    enderecoCidade: d.enderecoCidade ?? null,
    enderecoUf: d.enderecoUf ?? null,
    iniciadaEm: d.iniciadaEm ?? null,
    concluidaEm: d.concluidaEm ?? null,
    resumoExecucao: d.resumoExecucao ?? null,
    motivoCancelamento: d.motivoCancelamento ?? null,
    assinaturaAnexoId: d.assinaturaAnexoId ?? null,
    assinanteNome: d.assinanteNome ?? null,
    assinantePapel: d.assinantePapel ?? null,
    assinadaEm: d.assinadaEm ?? null,
    assinaturaRecusada: d.assinaturaRecusada,
    motivoRecusa: d.motivoRecusa ?? null,
    // campos lidos um a um: o que não é do contrato (ex.: um valor por engano) não entra no registro
    itens: (d.itens ?? []).map((i) => ({
      id: i.id,
      itemCatalogoId: i.itemCatalogoId ?? null,
      codigo: i.codigo,
      nome: i.nome,
      unidade: i.unidade,
      natureza: i.natureza,
      quantidadePrevistaMilesimos: Number(paraMilesimos(i.quantidadePrevista)),
      ordem: i.ordem ?? null,
    })),
    notas: (d.notas ?? []).map((n) => ({ id: n.id, texto: n.texto, autorId: n.autorId ?? null, criadaEm: n.criadaEm ?? null })),
    anexos: (d.anexos ?? []).map(paraAnexoOsServidor),
    historico: (d.historico ?? []).map((h) => ({
      statusDe: h.statusDe ?? null,
      statusPara: h.statusPara,
      usuarioId: h.usuarioId,
      em: h.em,
      observacao: h.observacao ?? null,
    })),
    atualizadoEm: d.atualizadoEm ?? null,
  };
}

/**
 * Para a rede. Os [srv] vão com o valor guardado (o do servidor; o servidor os ignora). Os comandos só saem quando
 * passados em `comandos` (a mutação da reabertura, o aceite do ADMIN).
 */
export function dadosDaOs(os: OsLocal, comandos: ComandosOs = {}): OsDados {
  const d: OsDados = {
    codigoProvisorio: os.codigoProvisorio,
    numero: os.numero,
    revisao: os.revisao,
    propostaId: os.propostaId,
    propostaNumero: os.propostaNumero,
    propostaCodigoExibido: os.propostaCodigoExibido,
    clienteId: os.clienteId,
    tipo: os.tipo,
    status: os.status,
    responsavelId: os.responsavelId,
    tecnicoId: os.tecnicoId,
    dataPrevista: os.dataPrevista,
    urgente: os.urgente,
    concluiProposta: os.concluiProposta,
    descricao: os.descricao,
    enderecoCep: os.enderecoCep,
    enderecoLogradouro: os.enderecoLogradouro,
    enderecoNumero: os.enderecoNumero,
    enderecoComplemento: os.enderecoComplemento,
    enderecoBairro: os.enderecoBairro,
    enderecoCidade: os.enderecoCidade,
    enderecoUf: os.enderecoUf,
    iniciadaEm: os.iniciadaEm,
    concluidaEm: os.concluidaEm,
    resumoExecucao: os.resumoExecucao,
    motivoCancelamento: os.motivoCancelamento,
    assinaturaAnexoId: os.assinaturaAnexoId,
    assinanteNome: os.assinanteNome,
    assinantePapel: os.assinantePapel,
    assinadaEm: os.assinadaEm,
    assinaturaRecusada: os.assinaturaRecusada,
    motivoRecusa: os.motivoRecusa,
    itens: os.itens.map((i) => ({
      id: i.id,
      itemCatalogoId: i.itemCatalogoId,
      codigo: i.codigo,
      nome: i.nome,
      unidade: i.unidade,
      natureza: i.natureza,
      // exato na rede: o texto mais curto do double é o próprio decimal
      quantidadePrevista: Number(deMilesimos(BigInt(i.quantidadePrevistaMilesimos))),
      ordem: i.ordem,
    })),
    // só os campos do contrato: o autor e a data locais da nota pendente ficam no aparelho
    notas: os.notas.map((n) => ({ id: n.id, texto: n.texto, autorId: n.autorId, criadaEm: n.criadaEm })),
    anexos: os.anexos.map((a) => ({ ...a })),
    historico: os.historico.map((h) => ({ ...h })),
    atualizadoEm: os.atualizadoEm,
  };
  if (comandos.motivoReabertura !== undefined) d.motivoReabertura = comandos.motivoReabertura;
  if (comandos.aceitarTrabalho !== undefined) d.aceitarTrabalho = comandos.aceitarTrabalho;
  return d;
}

// --- exibição ---

export const STATUS_OS: Readonly<Record<StatusOs, { rotulo: string; cor: string }>> = {
  ABERTA: { rotulo: 'Aberta', cor: 'bg-sky-100 text-sky-800' },
  EM_ANDAMENTO: { rotulo: 'Em andamento', cor: 'bg-amber-100 text-amber-800' },
  CONCLUIDA: { rotulo: 'Concluída', cor: 'bg-emerald-100 text-emerald-800' },
  CANCELADA: { rotulo: 'Cancelada', cor: 'bg-zinc-200 text-zinc-700' },
};

export function rotuloStatusOs(status: StatusOs): string {
  return STATUS_OS[status].rotulo;
}

export function corStatusOs(status: StatusOs): string {
  return STATUS_OS[status].cor;
}

/** Na ordem do enum do servidor. */
export const TIPOS_OS: readonly TipoOs[] = ['INSTALACAO', 'MANUTENCAO', 'CORRETIVA', 'PREVENTIVA', 'ENTREGA', 'RETIRADA', 'SERVICO'];

const ROTULO_TIPO_OS: Readonly<Record<TipoOs, string>> = {
  INSTALACAO: 'Instalação',
  MANUTENCAO: 'Manutenção',
  CORRETIVA: 'Corretiva',
  PREVENTIVA: 'Preventiva',
  ENTREGA: 'Entrega',
  RETIRADA: 'Retirada',
  SERVICO: 'Serviço',
};

export function rotuloTipoOs(tipo: TipoOs): string {
  return ROTULO_TIPO_OS[tipo];
}

/** `OS-000123` (o `Os.codigoExibicao()` do servidor) ou, sem número, o `OSP-…`. Sem a revisão. */
export function codigoOsBase(os: Pick<OsLocal, 'numero' | 'codigoProvisorio'>): string {
  return os.numero === null ? os.codigoProvisorio : `OS-${String(os.numero).padStart(6, '0')}`;
}

/**
 * A base com `-R<n>` quando a revisão passa de 1, também no `OSP-…`: o que o `AnexoOsService.codigosExibidos` do
 * servidor aceita como `codigoExibido` do PDF.
 */
export function codigoOsExibido(os: Pick<OsLocal, 'numero' | 'revisao' | 'codigoProvisorio'>): string {
  const base = codigoOsBase(os);
  return os.revisao !== null && os.revisao > 1 ? `${base}-R${os.revisao}` : base;
}

// --- textos (M2P1-R7) ---

/** Tamanho em code points depois do `String.strip()` do Java, como o servidor (`char_length` do Postgres); null = 0. */
export function tamanhoTextoOs(texto: string | null): number {
  return texto === null ? 0 : [...stripJava(texto)].length;
}

/** null nunca é válido; o tamanho é o de `tamanhoTextoOs`. */
export function textoOsValido(texto: string | null, minimo: number, maximo: number): boolean {
  if (texto === null) return false;
  const n = tamanhoTextoOs(texto);
  return n >= minimo && n <= maximo;
}

// --- ciclo de vida (spec M2 §5/§6): espelho de TransicoesOs (casos-transicoes-os.json) ---

/** O que importa da mutação para a transição (`TransicoesOs.Contexto`). */
export interface ContextoTransicaoOs {
  /** A OS, como fica depois da mutação, tem técnico. */
  temTecnico: boolean;
  resumoExecucao: string | null;
  /** Já há assinatura aceita no servidor (anexo ASSINATURA gravado pelo upload). */
  temAssinatura: boolean;
  assinaturaRecusada: boolean;
  motivoRecusa: string | null;
  /** O motivo do cancelamento ou da reabertura, conforme a transição. */
  motivo: string | null;
}

export const RESUMO_MIN_OS = 3;
export const RESUMO_MAX_OS = 4000;
export const MOTIVO_MIN_OS = 3;
export const MOTIVO_MAX_OS = 500;
/**
 * Os limites da nota, da foto e da assinatura (os do servidor: `NotaOsDados`, `AnexoOsService`), em code points: um
 * lugar só, para o repositório e as telas recusarem o mesmo texto.
 */
export const NOTA_MAX_OS = 2000;
export const LEGENDA_MAX_OS = 200;
export const ASSINANTE_NOME_MIN_OS = 2;
export const ASSINANTE_NOME_MAX_OS = 120;
export const ASSINANTE_PAPEL_MAX_OS = 60;
/** No máximo 20 fotos por OS (o `LIMITE_FOTOS` do servidor). */
export const FOTOS_MAX_OS = 20;

const ADMIN_E_COMERCIAL: readonly Perfil[] = ['ADMIN', 'COMERCIAL'];
const ADMIN_E_TECNICO: readonly Perfil[] = ['ADMIN', 'TECNICO'];
const TODOS: readonly Perfil[] = ['ADMIN', 'COMERCIAL', 'TECNICO'];
const SO_ADMIN: readonly Perfil[] = ['ADMIN'];
const SO_TECNICO: readonly Perfil[] = ['TECNICO'];

interface RegraOs {
  /** null = criação. */
  de: StatusOs | null;
  para: StatusOs;
  quem: readonly Perfil[];
  /** A mensagem para os outros perfis. */
  negado: string;
}

/** Na ordem em que os destinos aparecem para o usuário. */
const TABELA_OS: readonly RegraOs[] = [
  { de: null, para: 'ABERTA', quem: ADMIN_E_COMERCIAL, negado: 'O técnico não cria OS.' },
  { de: 'ABERTA', para: 'EM_ANDAMENTO', quem: ADMIN_E_TECNICO, negado: 'Só o técnico atribuído ou o administrador inicia a OS.' },
  { de: 'ABERTA', para: 'CANCELADA', quem: ADMIN_E_COMERCIAL, negado: 'O técnico não cancela a OS.' },
  { de: 'EM_ANDAMENTO', para: 'CONCLUIDA', quem: ADMIN_E_TECNICO, negado: 'Só o técnico atribuído ou o administrador conclui a OS.' },
  { de: 'EM_ANDAMENTO', para: 'CANCELADA', quem: SO_ADMIN, negado: 'Só o administrador cancela uma OS em andamento.' },
  { de: 'CONCLUIDA', para: 'EM_ANDAMENTO', quem: SO_ADMIN, negado: 'Só o administrador reabre uma OS concluída.' },
];

const ROTULO_MINUSCULO: Readonly<Record<StatusOs, string>> = {
  ABERTA: 'aberta', EM_ANDAMENTO: 'em andamento', CONCLUIDA: 'concluída', CANCELADA: 'cancelada',
};

function erro(codigo: string, mensagem: string): ErroMutacao {
  return { codigo, mensagem };
}

/** Regra 1 do `TransicoesOs` e do `EdicaoOs`: `ehResponsavel` só conta para o COMERCIAL, `ehTecnicoAtribuido` só para o TECNICO. */
function semPosse(perfil: Perfil, ehResponsavel: boolean, ehTecnicoAtribuido: boolean): ErroMutacao | null {
  if (perfil === 'COMERCIAL' && !ehResponsavel) return erro('ACESSO_NEGADO', 'Você só altera as OS em que é o responsável.');
  if (perfil === 'TECNICO' && !ehTecnicoAtribuido) return erro('ACESSO_NEGADO', 'Você só altera as OS atribuídas a você.');
  return null;
}

/**
 * Mesma ordem de regras do `TransicoesOs`: posse → mesmo status (edição: OK aqui) → fora da tabela
 * (`TRANSICAO_INVALIDA`) → perfil da transição (`ACESSO_NEGADO`) → requisitos (`VALIDACAO`, campos na ordem do
 * servidor). `de` null = criação.
 */
export function validarTransicaoOs(
  de: StatusOs | null,
  para: StatusOs,
  perfil: Perfil,
  ehResponsavel: boolean,
  ehTecnicoAtribuido: boolean,
  ctx: ContextoTransicaoOs,
): ErroMutacao | null {
  const posse = semPosse(perfil, ehResponsavel, ehTecnicoAtribuido);
  if (posse) return posse;
  if (de === para) return null;
  const regra = TABELA_OS.find((r) => r.de === de && r.para === para);
  if (!regra) {
    return de === null
      ? erro('TRANSICAO_INVALIDA', 'Uma OS nova começa como aberta.')
      : erro('TRANSICAO_INVALIDA', `Não é possível passar de ${ROTULO_MINUSCULO[de]} para ${ROTULO_MINUSCULO[para]}.`);
  }
  if (!regra.quem.includes(perfil)) return erro('ACESSO_NEGADO', regra.negado);
  const campos: Record<string, string> = {};
  if (de === 'ABERTA' && para === 'EM_ANDAMENTO' && !ctx.temTecnico) campos['tecnicoId'] = 'Atribua um técnico antes de iniciar.';
  if (para === 'CONCLUIDA') {
    if (!textoOsValido(ctx.resumoExecucao, RESUMO_MIN_OS, RESUMO_MAX_OS)) {
      campos['resumoExecucao'] = `Informe o resumo da execução (de ${RESUMO_MIN_OS} a ${RESUMO_MAX_OS} caracteres).`;
    }
    // com assinatura aceita, a recusa não é consultada
    if (!ctx.temAssinatura) {
      if (!ctx.assinaturaRecusada) {
        campos['assinatura'] = 'Colete a assinatura ou registre a recusa com o motivo.';
      } else if (!textoOsValido(ctx.motivoRecusa, MOTIVO_MIN_OS, MOTIVO_MAX_OS)) {
        campos['motivoRecusa'] = `Informe o motivo da recusa (de ${MOTIVO_MIN_OS} a ${MOTIVO_MAX_OS} caracteres).`;
      }
    }
  }
  if (para === 'CANCELADA' && !textoOsValido(ctx.motivo, MOTIVO_MIN_OS, MOTIVO_MAX_OS)) {
    campos['motivoCancelamento'] = `Informe o motivo do cancelamento (de ${MOTIVO_MIN_OS} a ${MOTIVO_MAX_OS} caracteres).`;
  }
  if (de === 'CONCLUIDA' && para === 'EM_ANDAMENTO' && !textoOsValido(ctx.motivo, MOTIVO_MIN_OS, MOTIVO_MAX_OS)) {
    campos['motivoReabertura'] = `Informe o motivo da reabertura (de ${MOTIVO_MIN_OS} a ${MOTIVO_MAX_OS} caracteres).`;
  }
  return Object.keys(campos).length === 0 ? null : { codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos };
}

/** Destinos que o usuário pode escolher a partir de `de` (null = criação), na ordem da tabela; os requisitos são da validação. */
export function transicoesPermitidasOs(
  de: StatusOs | null,
  perfil: Perfil,
  ehResponsavel: boolean,
  ehTecnicoAtribuido: boolean,
): StatusOs[] {
  if (semPosse(perfil, ehResponsavel, ehTecnicoAtribuido)) return [];
  return TABELA_OS.filter((r) => r.de === de && r.quem.includes(perfil)).map((r) => r.para);
}

// --- quem altera cada campo (M2P1-R11): espelho de EdicaoOs (casos-edicao-os.json) ---

/**
 * Os campos do `EdicaoOs.CAMPOS`, na ordem fixa em que os erros saem. Nomes do DTO, mais os especiais: `endereco` é o
 * snapshot inteiro (qualquer `endereco*` alterado conta), `notas` é "acrescentou nota nova" e `aceitarTrabalho` conta
 * quando vem true.
 */
export const CAMPOS_EDICAO_OS = [
  'propostaId', 'clienteId', 'tipo', 'descricao', 'dataPrevista', 'urgente', 'tecnicoId', 'endereco', 'itens',
  'concluiProposta', 'resumoExecucao', 'assinaturaRecusada', 'motivoRecusa', 'notas', 'responsavelId', 'aceitarTrabalho',
] as const;

export type CampoEdicaoOs = (typeof CAMPOS_EDICAO_OS)[number];

type QuemPorStatus = Partial<Record<StatusOs, readonly Perfil[]>>;

function em(quem: readonly Perfil[], ...status: StatusOs[]): QuemPorStatus {
  return Object.fromEntries(status.map((s) => [s, quem]));
}

/** Campo → status → perfis que podem alterá-lo. `{}` = não muda depois da criação, para ninguém (M2P1-R12). */
const MATRIZ: Readonly<Record<CampoEdicaoOs, QuemPorStatus>> = {
  propostaId: {},
  clienteId: {},
  tipo: em(ADMIN_E_COMERCIAL, 'ABERTA'),
  descricao: em(ADMIN_E_COMERCIAL, 'ABERTA'),
  dataPrevista: em(ADMIN_E_COMERCIAL, 'ABERTA', 'EM_ANDAMENTO'),
  urgente: em(ADMIN_E_COMERCIAL, 'ABERTA', 'EM_ANDAMENTO'),
  tecnicoId: em(ADMIN_E_COMERCIAL, 'ABERTA', 'EM_ANDAMENTO'),
  endereco: em(ADMIN_E_COMERCIAL, 'ABERTA'),
  itens: em(ADMIN_E_COMERCIAL, 'ABERTA'),
  // Q17: em ABERTA pelo escritório; Q21 ("Precisa voltar", marcado na conclusão): em EM_ANDAMENTO pelo ADMIN e o técnico
  concluiProposta: { ...em(ADMIN_E_COMERCIAL, 'ABERTA'), EM_ANDAMENTO: ADMIN_E_TECNICO },
  resumoExecucao: em(ADMIN_E_TECNICO, 'EM_ANDAMENTO'),
  assinaturaRecusada: em(ADMIN_E_TECNICO, 'EM_ANDAMENTO'),
  motivoRecusa: em(ADMIN_E_TECNICO, 'EM_ANDAMENTO'),
  // M2P1-R26: o técnico atribuído registra a evidência do campo também depois do encerramento
  notas: { ...em(TODOS, 'ABERTA', 'EM_ANDAMENTO'), CONCLUIDA: ADMIN_E_TECNICO, CANCELADA: SO_TECNICO },
  responsavelId: em(SO_ADMIN, 'ABERTA', 'EM_ANDAMENTO'),
  aceitarTrabalho: em(SO_ADMIN, 'ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'),
};

/** Imutáveis depois da criação, mas livres nela (M2P1-R12). */
const LIVRES_NA_CRIACAO: ReadonlySet<CampoEdicaoOs> = new Set(['propostaId', 'clienteId']);

const CONHECIDOS: ReadonlySet<string> = new Set(CAMPOS_EDICAO_OS);

function podeAlterar(campo: CampoEdicaoOs, status: StatusOs, perfil: Perfil): boolean {
  return MATRIZ[campo][status]?.includes(perfil) ?? false;
}

function mensagemNaoEditavel(campo: CampoEdicaoOs, perfil: Perfil, status: StatusOs): string {
  const quem = Object.values(MATRIZ[campo]);
  if (quem.length === 0) return 'Não muda depois da criação da OS.';
  return quem.some((perfis) => perfis.includes(perfil))
    ? `Não pode ser alterado com a OS ${ROTULO_MINUSCULO[status]}.`
    : 'Você não altera este campo.';
}

/**
 * Mesma ordem de regras do `EdicaoOs`: posse (`ACESSO_NEGADO`, mesmo sem campo alterado) → campos alterados que o
 * perfil não muda no status (`OS_NAO_EDITAVEL`, na ordem de `CAMPOS_EDICAO_OS`). Avaliado no status do servidor; na
 * criação (`statusServidor` null), no de destino. `camposAlterados`: os que diferem da versão do servidor (ou vêm
 * preenchidos na criação); um nome desconhecido é erro de programação.
 */
export function validarEdicaoOs(
  statusServidor: StatusOs | null,
  statusDestino: StatusOs,
  perfil: Perfil,
  ehResponsavel: boolean,
  ehTecnicoAtribuido: boolean,
  camposAlterados: Iterable<CampoEdicaoOs>,
): ErroMutacao | null {
  const alterados = new Set<string>(camposAlterados);
  for (const campo of alterados) {
    if (!CONHECIDOS.has(campo)) throw new Error(`Campo de OS desconhecido: ${campo}`);
  }
  const posse = semPosse(perfil, ehResponsavel, ehTecnicoAtribuido);
  if (posse) return posse;
  const status = statusServidor ?? statusDestino;
  const campos: Record<string, string> = {};
  for (const campo of CAMPOS_EDICAO_OS) {
    const livre = statusServidor === null && LIVRES_NA_CRIACAO.has(campo);
    if (alterados.has(campo) && !livre && !podeAlterar(campo, status, perfil)) {
      campos[campo] = mensagemNaoEditavel(campo, perfil, status);
    }
  }
  return Object.keys(campos).length === 0
    ? null
    : { codigo: 'OS_NAO_EDITAVEL', mensagem: 'Alguns campos não podem ser alterados nesta OS.', campos };
}

/**
 * M2P1-R13 (vinculante): em todo UPSERT, inclusive a criação, a transição vem primeiro e a edição só é avaliada se ela
 * aceitar. Assim uma transição recusada sai sempre com o erro dela, como no servidor. `de` = status do servidor
 * (null = criação), `para` = o status enviado.
 */
export function validarMutacaoOs(
  de: StatusOs | null,
  para: StatusOs,
  perfil: Perfil,
  ehResponsavel: boolean,
  ehTecnicoAtribuido: boolean,
  ctx: ContextoTransicaoOs,
  camposAlterados: Iterable<CampoEdicaoOs>,
): ErroMutacao | null {
  return (
    validarTransicaoOs(de, para, perfil, ehResponsavel, ehTecnicoAtribuido, ctx) ??
    validarEdicaoOs(de, para, perfil, ehResponsavel, ehTecnicoAtribuido, camposAlterados)
  );
}

/**
 * Os campos que o perfil altera numa OS existente em `status`, na ordem fixa (os que o `validarEdicaoOs` aceita).
 * Base do "manter a minha" (M2P1-R19): os que não estão aqui voltam ao valor do servidor.
 */
export function camposEditaveisOs(
  status: StatusOs,
  perfil: Perfil,
  ehResponsavel: boolean,
  ehTecnicoAtribuido: boolean,
): CampoEdicaoOs[] {
  if (semPosse(perfil, ehResponsavel, ehTecnicoAtribuido)) return [];
  return CAMPOS_EDICAO_OS.filter((campo) => podeAlterar(campo, status, perfil));
}

const CABECALHO: readonly CampoEdicaoOs[] = ['tipo', 'descricao', 'dataPrevista', 'urgente', 'tecnicoId', 'endereco', 'itens'];

/**
 * Algum campo do cabeçalho (tipo, descrição, data, urgência, técnico, endereço, itens) é editável: ADMIN ou COMERCIAL
 * responsável, em ABERTA e EM_ANDAMENTO (em andamento, só data, urgência e técnico; ver `camposEditaveisOs`).
 */
export function podeEditarCabecalho(status: StatusOs, perfil: Perfil, ehResponsavel: boolean): boolean {
  return camposEditaveisOs(status, perfil, ehResponsavel, false).some((c) => CABECALHO.includes(c));
}

/**
 * Executar (resumo, fotos, assinatura ou recusa, concluir): ADMIN ou TECNICO atribuído, com a OS em andamento. Iniciar
 * é uma transição (`transicoesPermitidasOs`).
 */
export function podeExecutar(status: StatusOs, perfil: Perfil, ehTecnicoAtribuido: boolean): boolean {
  return camposEditaveisOs(status, perfil, false, ehTecnicoAtribuido).includes('resumoExecucao');
}
