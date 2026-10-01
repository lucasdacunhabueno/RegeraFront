import type { HttpErrorResponse } from '@angular/common/http';
import type { Table } from 'dexie';
import { AnexoOsLocal, BytesAnexoOs, OsLocal, paraAnexoOsServidor } from '../../features/os/os-models';
import type { DocumentoLocal, PropostaLocal } from '../../features/propostas/proposta-models';
import type { RegeraDb } from '../db/regera-db';
import type { RegistroLocal } from './adaptadores';
import {
  DadosUpload, DadosUploadAnexoOs, Entidade, EntidadeUpload, ErroMutacao, RespostaAnexoOs, RespostaDocumento,
  TIPO_UPLOAD_ANEXO_OS, TIPO_UPLOAD_DOCUMENTO,
} from './sync-models';

/**
 * O que todo registro local de um upload tem (`DocumentoLocal`, `AnexoOsLocal`). Os bytes ficam no próprio registro
 * (`documentos`) ou numa tabela à parte (`anexosOsBytes`, M2P2-R16): só o tipo sabe (`envio`, `podar`, `apagar`).
 */
export interface RegistroUpload {
  id: string;
  enviado: boolean;
  arquivoId: string | null;
}

/** Quem envia o upload (o usuário da sessão deste aparelho). */
export interface QuemEnvia {
  id: string;
  perfil: string;
}

/** As duas partes do multipart: `arquivo` e `metadados` (JSON). */
export interface EnvioUpload {
  arquivo: Blob;
  nomeArquivo: string;
  metadados: unknown;
}

/**
 * Um tipo de upload da outbox. O `SyncService` faz o resto igual para todos: a ordem (FIFO do agregado, fora do lote
 * do push), o multipart, os transitórios (5xx, 408, 429), a pendência REJEITADO, a saída da fila e o rebase da próxima
 * mutação pela versão devolvida (P4b-R9/R24), a poda, o tombstone e a troca de dono do cursor.
 */
export interface TipoUpload<R extends RegistroUpload = RegistroUpload, S = unknown> {
  readonly entidade: EntidadeUpload;
  /** O agregado do sync dono do upload (o `agregadoId` da mutação é o id dele). */
  readonly agregado: Entidade;
  /** O campo do registro com o id do agregado (índice da tabela). */
  readonly campoAgregado: string;
  /** Os bytes têm valores (§10): o perfil TECNICO não guarda nem envia (`purgarDocumentosDoTecnico`). */
  readonly temValores: boolean;
  /** A tabela do registro (o estado do envio e o id do agregado). */
  tabela(db: RegeraDb): Table<R, string>;
  /** Todas as tabelas do tipo (a do registro e, se os bytes ficam à parte, a deles), para as transações. */
  tabelas(db: RegeraDb): Table[];
  /** Os `dados` da mutação na outbox para o registro `id`. */
  dados(id: string): unknown;
  /** O id do registro a partir dos `dados` da mutação. */
  idDe(dados: unknown): string | undefined;
  url(agregadoId: string): string;
  /** O que vai no multipart; null se os bytes não estão mais no aparelho. */
  envio(db: RegeraDb, r: R): Promise<EnvioUpload | null>;
  /** Os bytes não estão mais no aparelho: vira pendência sem chamar o servidor. */
  readonly ausente: ErroMutacao;
  /** Recusa definitiva (4xx) como erro da pendência, com mensagem em pt-BR. */
  erro(e: HttpErrorResponse, r: R): ErroMutacao;
  /** A versão do agregado depois do upload (que o "toca"). */
  versao(resp: S): number;
  /** O registro depois do upload aceito. */
  enviado(r: R, resp: S): R;
  /**
   * Depois do aceite (com o registro `id` já gravado como enviado), tira os bytes que não precisam mais ficar
   * (P4b-R26). Roda na transação de `aplicarUpload`, que tem as `tabelas`.
   */
  podar(db: RegeraDb, id: string, agregadoId: string, resp: S): Promise<void>;
  /** Apaga os registros e os bytes deles. Precisa das `tabelas` na transação de quem chama. */
  apagar(db: RegeraDb, ids: readonly string[]): Promise<void>;
  /** As mudanças no registro local do agregado: a versão e o que o servidor passou a ter. `quem`: quem enviou. */
  noAgregado(local: RegistroLocal, resp: S, versao: number, quem: QuemEnvia | undefined): Record<string, unknown>;
}

/** O `codigo` e os `campos` do ProblemDetail, se houver. */
function lerProblema(e: HttpErrorResponse): { codigo: string | null; campos?: Record<string, string> } {
  const corpo = (typeof e.error === 'object' ? e.error : null) as { codigo?: unknown; campos?: Record<string, string> } | null;
  return { codigo: typeof corpo?.codigo === 'string' ? corpo.codigo : null, ...(corpo?.campos ? { campos: corpo.campos } : {}) };
}

/** `Object.hasOwn`: um código como "constructor" não pode cair no protótipo. */
function porCodigo(mapa: Readonly<Record<string, string>>, codigo: string | null): string | undefined {
  return codigo !== null && Object.hasOwn(mapa, codigo) ? mapa[codigo] : undefined;
}

function comProblema(
  e: HttpErrorResponse,
  mensagem: (codigo: string | null, campos: Record<string, string> | undefined) => string,
): ErroMutacao {
  const { codigo, campos } = lerProblema(e);
  return { codigo: codigo ?? `HTTP_${e.status}`, mensagem: mensagem(codigo, campos), ...(campos ? { campos } : {}) };
}

// --- documento da proposta (P4b) ---

const DESCARTE_UPLOAD = 'Descarte este envio para liberar a sincronização da proposta.';
/** Por `codigo` do ProblemDetail do upload; completa "O PDF <código exibido> …". */
const MOTIVO_UPLOAD_POR_CODIGO: Readonly<Record<string, string>> = {
  STATUS_INVALIDO: 'não foi aceito: no servidor, a proposta está em rascunho.',
  REVISAO_INVALIDA: 'é de outra revisão da proposta e não foi aceito.',
  DOCUMENTO_DIVERGENTE: 'não foi aceito: já existe no servidor um documento com este identificador e outro conteúdo.',
  SHA_DIVERGENTE: 'chegou diferente do que foi gerado (falha de integridade) e não foi aceito.',
  // P4b-R13: típico de PROV trocado por colisão depois de o PDF ter sido gerado offline
  CODIGO_EXIBIDO_INVALIDO: 'não foi aceito. O código da proposta mudou. Gere o PDF de novo e reenvie.',
  PROPOSTA_NAO_ENCONTRADA: 'não foi aceito: a proposta não foi encontrada no servidor ou você não tem mais acesso a ela.',
};
/** Por status HTTP, quando o `codigo` não diz mais (ex.: 413/415 do limite de upload). */
const MOTIVO_UPLOAD_POR_STATUS: Readonly<Record<number, string>> = {
  403: 'não foi aceito: você não tem permissão para enviar documentos desta proposta.',
  413: 'não foi aceito: passa do limite de 10 MB.',
  415: 'não foi aceito: o arquivo não é um PDF válido.',
};

/** O PDF da proposta (`POST /api/propostas/{id}/documentos`, P4b): tabela `documentos`. */
const DOCUMENTO_PROPOSTA: TipoUpload<DocumentoLocal, RespostaDocumento> = {
  entidade: TIPO_UPLOAD_DOCUMENTO,
  agregado: 'proposta',
  campoAgregado: 'propostaId',
  temValores: true,
  tabela: (db) => db.documentos,
  tabelas: (db) => [db.documentos],
  dados: (documentoId): DadosUpload => ({ documentoId }),
  idDe: (dados) => (dados as DadosUpload | null)?.documentoId,
  url: (propostaId) => `/api/propostas/${encodeURIComponent(propostaId)}/documentos`,
  envio: async (_db, doc) => (doc.bytes === null ? null : {
    arquivo: new Blob([doc.bytes], { type: 'application/pdf' }),
    nomeArquivo: `${doc.codigoExibido}.pdf`,
    metadados: { id: doc.id, revisao: doc.revisao, codigoExibido: doc.codigoExibido, sha256: doc.sha256, snapshot: doc.snapshot ?? {} },
  }),
  ausente: { codigo: 'DOCUMENTO_AUSENTE', mensagem: `O PDF deste envio não está mais neste aparelho. ${DESCARTE_UPLOAD}` },
  erro: (e, doc) => comProblema(e, (codigo) => {
    const motivo = porCodigo(MOTIVO_UPLOAD_POR_CODIGO, codigo) ?? MOTIVO_UPLOAD_POR_STATUS[e.status] ?? 'foi recusado pelo servidor.';
    return `O PDF ${doc.codigoExibido} ${motivo} ${DESCARTE_UPLOAD}`;
  }),
  versao: (resp) => resp.versaoProposta,
  enviado: (doc, resp) => ({ ...doc, enviado: true, arquivoId: resp.documento.arquivoId }),
  // P4b-R26: os PDFs já enviados das revisões anteriores perdem os bytes (abrem online pelo `arquivoId`); os da
  // revisão deste upload ficam
  podar: async (db, _id, propostaId, resp) => {
    await db.documentos
      .where('propostaId')
      .equals(propostaId)
      .filter((d) => d.enviado && d.revisao < resp.documento.revisao && d.bytes !== null)
      .modify({ bytes: null });
  },
  apagar: (db, ids) => db.documentos.bulkDelete([...ids]),
  noAgregado: (local, resp, versao) => {
    const documentos = [...(local as PropostaLocal).documentos.filter((d) => d.id !== resp.documento.id), resp.documento];
    return { version: versao, documentos };
  },
};

// --- anexo da OS (M2) ---

/** 403 e 404 do upload: a OS não é mais deste usuário (técnico desatribuído, M2-R3/R22) ou não existe mais. */
export const MENSAGEM_OS_NAO_ESTA_COM_VOCE = 'Esta OS não está mais com você.';
/**
 * 403 `OS_CONCLUIDA_POR_OUTRO` (M2P1-R28/R29, M2P2-R6): o PDF do técnico atribuído quando outro usuário concluiu a OS;
 * o PDF do aparelho não vale.
 */
export const MENSAGEM_OS_CONCLUIDA_PELO_ESCRITORIO = 'Esta OS foi concluída pelo escritório.';
const DESCARTE_UPLOAD_OS = 'Descarte este envio para liberar a sincronização da OS.';
const MOTIVO_ANEXO_POR_CODIGO: Readonly<Record<string, string>> = {
  LIMITE_FOTOS: 'Esta OS já tem o máximo de 20 fotos no servidor.',
  LIMITE_ASSINATURAS: 'Esta OS já tem o máximo de 10 assinaturas no servidor.',
  LIMITE_DOCUMENTOS: 'Esta OS já tem o máximo de 20 PDFs no servidor.',
  ARQUIVO_VAZIO: 'O arquivo do anexo está vazio.',
  SHA_DIVERGENTE: 'O arquivo chegou diferente do que foi gravado no aparelho (falha de integridade) e não foi aceito.',
  TIPO_NAO_SUPORTADO: 'O tipo do arquivo não é aceito para este anexo.',
  CORPO_INVALIDO: 'O servidor não reconheceu os dados deste anexo (o tipo, por exemplo).',
  ANEXO_DIVERGENTE: 'Já existe no servidor um anexo com este identificador e outro conteúdo.',
  REVISAO_INVALIDA: 'O PDF é de outra revisão da OS e não foi aceito.',
  CODIGO_EXIBIDO_INVALIDO: 'O código impresso no PDF não é o desta OS. Gere o PDF de novo.',
  ARQUIVO_GRANDE: 'Arquivo grande demais.',
};
const MOTIVO_ANEXO_POR_STATUS: Readonly<Record<number, string>> = {
  413: 'Arquivo grande demais.',
  415: 'O tipo do arquivo não é aceito para este anexo.',
};

/** Os campos dos metadados do upload (`campos` do 400 VALIDACAO), como o usuário os conhece. */
const ROTULO_CAMPO_ANEXO: Readonly<Record<string, string>> = {
  metadados: 'Metadados do anexo',
  anexoId: 'Identificador do anexo',
  tipo: 'Tipo do anexo',
  sha256: 'SHA-256 do arquivo',
  legenda: 'Legenda',
  momento: 'Momento da foto',
  tiradaEm: 'Quando a foto foi tirada',
  assinanteNome: 'Nome de quem assina',
  assinantePapel: 'Papel de quem assina',
  assinadaEm: 'Data da assinatura',
  revisaoOs: 'Revisão da OS',
  codigoExibido: 'Código exibido no PDF',
  snapshot: 'Dados do PDF',
};

/** "Dados do anexo inválidos: Nome de quem assina (mensagem); …." — o nome cru quando o campo não é conhecido. */
function motivoDosCampos(campos: Record<string, string>): string {
  const itens = Object.entries(campos).map(([campo, msg]) =>
    `${Object.hasOwn(ROTULO_CAMPO_ANEXO, campo) ? ROTULO_CAMPO_ANEXO[campo] : campo} (${msg})`);
  return `Dados do anexo inválidos: ${itens.join('; ')}.`;
}

function motivoDoAnexo(a: AnexoOsLocal, codigo: string | null, status: number, campos?: Record<string, string>): string {
  if (codigo === 'VALIDACAO' && campos && Object.keys(campos).length > 0) return motivoDosCampos(campos);
  if (codigo === 'STATUS_INVALIDO') {
    return a.tipo === 'DOCUMENTO'
      ? 'No servidor, a OS não está concluída, e o PDF não foi aceito.'
      : 'No servidor, a OS não está em andamento, e o anexo não foi aceito.';
  }
  return porCodigo(MOTIVO_ANEXO_POR_CODIGO, codigo) ?? MOTIVO_ANEXO_POR_STATUS[status] ?? 'O servidor recusou este anexo.';
}

/** O tipo do arquivo, a extensão e os metadados de cada tipo de anexo (os campos de outro tipo não vão). */
function envioDoAnexo(a: AnexoOsLocal, b: BytesAnexoOs): EnvioUpload {
  const base = { anexoId: a.id, tipo: a.tipo, sha256: a.sha256 };
  switch (a.tipo) {
    case 'FOTO':
      return {
        arquivo: new Blob([b.bytes], { type: 'image/jpeg' }),
        nomeArquivo: `${a.id}.jpg`,
        metadados: { ...base, legenda: a.legenda, momento: a.momento, tiradaEm: a.tiradaEm },
      };
    case 'ASSINATURA':
      return {
        arquivo: new Blob([b.bytes], { type: 'image/png' }),
        nomeArquivo: `${a.id}.png`,
        // no anexo local, `tiradaEm` é o `assinadaEm` do upload
        metadados: { ...base, assinanteNome: a.assinanteNome, assinantePapel: a.assinantePapel, assinadaEm: a.tiradaEm },
      };
    case 'DOCUMENTO':
      return {
        arquivo: new Blob([b.bytes], { type: 'application/pdf' }),
        nomeArquivo: `${a.codigoExibido ?? a.id}.pdf`,
        metadados: { ...base, revisaoOs: a.revisaoOs, codigoExibido: a.codigoExibido, snapshot: b.snapshot ?? {} },
      };
  }
}

/** Foto, assinatura e PDF da OS (`POST /api/os/{id}/anexos`, resposta `{anexo, versaoOs}`): tabela `anexosOs`. */
const ANEXO_OS: TipoUpload<AnexoOsLocal, RespostaAnexoOs> = {
  entidade: TIPO_UPLOAD_ANEXO_OS,
  agregado: 'os',
  campoAgregado: 'osId',
  temValores: false,
  tabela: (db) => db.anexosOs,
  tabelas: (db) => [db.anexosOs, db.anexosOsBytes],
  dados: (anexoId): DadosUploadAnexoOs => ({ anexoId }),
  idDe: (dados) => (dados as DadosUploadAnexoOs | null)?.anexoId,
  url: (osId) => `/api/os/${encodeURIComponent(osId)}/anexos`,
  envio: async (db, a) => {
    const b = await db.anexosOsBytes.get(a.id);
    return b ? envioDoAnexo(a, b) : null;
  },
  ausente: { codigo: 'ANEXO_AUSENTE', mensagem: `O arquivo deste anexo não está mais neste aparelho. ${DESCARTE_UPLOAD_OS}` },
  erro: (e, a) => comProblema(e, (codigo, campos) => {
    // M2-R3/R22: o técnico que perdeu a atribuição (o PDF dele, ou tudo depois de 7 dias, inclusive a repetição de
    // um upload já aceito) e a OS que sumiu; R28/R29: o PDF da OS concluída por outro usuário. O único caminho é descartar
    if (e.status === 403 && codigo === 'OS_CONCLUIDA_POR_OUTRO') return MENSAGEM_OS_CONCLUIDA_PELO_ESCRITORIO;
    // N2: todo outro 403 vira "não está mais com você". Hoje é exato: o servidor só devolve 403 (`ACESSO_NEGADO`) ao PDF
    // do técnico desatribuído e à FOTO ou ASSINATURA do COMERCIAL, que o aparelho nunca oferece (o `OsRepo` recusa
    // antes). Uma tela que passe a oferecer ao COMERCIAL um upload que ele não pode fazer não pode contar com este
    // texto: ele diria que a OS saiu dele
    if (e.status === 403 || e.status === 404) return MENSAGEM_OS_NAO_ESTA_COM_VOCE;
    return `${motivoDoAnexo(a, codigo, e.status, campos)} ${DESCARTE_UPLOAD_OS}`;
  }),
  versao: (resp) => resp.versaoOs,
  enviado: (a, resp) => ({ ...a, enviado: true, arquivoId: resp.anexo.arquivoId }),
  // P4b-R26: depois do aceite ficam só a miniatura e os metadados; o PDF guarda os bytes da revisão atual, e os já
  // enviados das revisões anteriores perdem os deles
  podar: async (db, id, osId, resp) => {
    if (resp.anexo.tipo !== 'DOCUMENTO') {
      await db.anexosOsBytes.delete(id);
      return;
    }
    const revisao = resp.anexo.revisaoOs;
    if (revisao == null) return;
    const antigos = await db.anexosOs
      .where('osId')
      .equals(osId)
      .filter((a) => a.tipo === 'DOCUMENTO' && a.enviado && a.revisaoOs !== null && a.revisaoOs < revisao)
      .primaryKeys();
    await db.anexosOsBytes.bulkDelete(antigos);
  },
  apagar: async (db, ids) => {
    await db.anexosOs.bulkDelete([...ids]);
    await db.anexosOsBytes.bulkDelete([...ids]);
  },
  noAgregado: (local, resp, versao, quem) => {
    const os = local as OsLocal;
    const anexo = paraAnexoOsServidor(resp.anexo);
    const mudancas: Partial<OsLocal> = {
      version: versao,
      anexos: [...os.anexos.filter((x) => x.id !== anexo.id), anexo],
    };
    // como o servidor (M2P1-R10): a assinatura aceita passa a ser esta, e a recusa sai. M2P1-R26 (M6): a do técnico com a
    // OS encerrada é só evidência, e o servidor não muda a aceita; o aparelho não a espelha. Com a OS concluída no
    // aparelho e o concluir ainda na fila, também não espelha: o OK do concluir traz o estado do servidor.
    // M4: só quem a torna a aceita no servidor, o técnico atribuído ou o ADMIN. O técnico que perdeu a OS (M2-R3: o OK
    // anterior trouxe outro técnico) envia a dele como evidência, e a OS não é mais dele
    const tornaAceita = !!quem && (quem.perfil === 'ADMIN' || os.tecnicoId === quem.id);
    if (anexo.tipo === 'ASSINATURA' && os.status === 'EM_ANDAMENTO' && tornaAceita) {
      Object.assign(mudancas, {
        assinaturaAnexoId: anexo.id, assinanteNome: anexo.assinanteNome, assinantePapel: anexo.assinantePapel,
        assinadaEm: anexo.tiradaEm, assinaturaRecusada: false, motivoRecusa: null,
      });
    }
    return mudancas;
  },
};

/** Os tipos de upload da outbox, pela `entidade` da mutação. */
export const TIPOS_UPLOAD: Readonly<Record<EntidadeUpload, TipoUpload>> = {
  [TIPO_UPLOAD_DOCUMENTO]: DOCUMENTO_PROPOSTA as unknown as TipoUpload,
  [TIPO_UPLOAD_ANEXO_OS]: ANEXO_OS as unknown as TipoUpload,
};

const LISTA: readonly TipoUpload[] = Object.values(TIPOS_UPLOAD);

/** O tipo de upload da `entidade`, ou undefined se ela é um agregado do sync. */
export function tipoUploadDe(entidade: string): TipoUpload | undefined {
  return Object.hasOwn(TIPOS_UPLOAD, entidade) ? TIPOS_UPLOAD[entidade as EntidadeUpload] : undefined;
}

export const ehUpload = (m: { entidade: string }): boolean => tipoUploadDe(m.entidade) !== undefined;

/** Todos os tipos, ou só os do agregado `entidade`. */
export function tiposUpload(entidade?: string): readonly TipoUpload[] {
  return entidade === undefined ? LISTA : LISTA.filter((t) => t.agregado === entidade);
}

/** As tabelas de todos os tipos, com as dos bytes (para as transações que mexem nelas). */
export function tabelasDeUpload(db: RegeraDb): Table[] {
  return LISTA.flatMap((t) => t.tabelas(db));
}

/**
 * Apaga os registros de upload do agregado `entidade`/`agregadoId` (e os bytes deles) que passam no `filtro`; sem
 * filtro, todos. Precisa de `tabelasDeUpload` na transação de quem chama.
 */
export async function apagarUploadsDoAgregado(
  db: RegeraDb,
  entidade: string,
  agregadoId: string,
  filtro: (r: RegistroUpload) => boolean = () => true,
): Promise<void> {
  for (const t of tiposUpload(entidade)) {
    const ids = await t.tabela(db).where(t.campoAgregado).equals(agregadoId).filter(filtro).primaryKeys();
    if (ids.length > 0) await t.apagar(db, ids);
  }
}

/**
 * Apaga, de todos os tipos, os registros de upload (e os bytes deles) com as ids de `mutacoes` (as de upload) que
 * passam no `filtro`. Precisa de `tabelasDeUpload` na transação de quem chama.
 */
export async function apagarUploadsDasMutacoes(
  db: RegeraDb,
  mutacoes: readonly { entidade: string; dados: unknown }[],
  filtro: (r: RegistroUpload) => boolean = () => true,
): Promise<void> {
  for (const t of LISTA) {
    const ids = mutacoes.filter((m) => m.entidade === t.entidade).map((m) => t.idDe(m.dados)).filter((id): id is string => !!id);
    if (ids.length === 0) continue;
    const apagar = (await t.tabela(db).bulkGet(ids)).filter((r): r is RegistroUpload => !!r && filtro(r)).map((r) => r.id);
    if (apagar.length > 0) await t.apagar(db, apagar);
  }
}
