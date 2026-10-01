import type { HttpErrorResponse } from '@angular/common/http';
import type { Table } from 'dexie';
import { AnexoOsLocal, concluidaPorOutro, OsLocal, paraAnexoOsServidor } from '../../features/os/os-models';
import type { DocumentoLocal, PropostaLocal } from '../../features/propostas/proposta-models';
import type { RegeraDb } from '../db/regera-db';
import type { RegistroLocal } from './adaptadores';
import {
  DadosUpload, DadosUploadAnexoOs, Entidade, EntidadeUpload, ErroMutacao, RespostaAnexoOs, RespostaDocumento,
  TIPO_UPLOAD_ANEXO_OS, TIPO_UPLOAD_DOCUMENTO,
} from './sync-models';

/** O que todo registro local com os bytes de um upload tem (`DocumentoLocal`, `AnexoOsLocal`). */
export interface RegistroUpload {
  id: string;
  /** null depois que os bytes foram podados (ou quando nunca vieram para o aparelho). */
  bytes: ArrayBuffer | null;
  enviado: boolean;
  arquivoId: string | null;
}

/** O que o aparelho sabe na hora da recusa: o agregado local (o pull não o sobrescreve com o upload na fila) e quem envia. */
export interface ContextoRecusa {
  agregado: RegistroLocal | undefined;
  usuarioId: string | null;
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
  /** A tabela com os bytes e o estado do envio. */
  tabela(db: RegeraDb): Table<R, string>;
  /** Os `dados` da mutação na outbox para o registro `id`. */
  dados(id: string): unknown;
  /** O id do registro a partir dos `dados` da mutação. */
  idDe(dados: unknown): string | undefined;
  url(agregadoId: string): string;
  /** O que vai no multipart. Só é chamado com `bytes` presentes. */
  montar(r: R): EnvioUpload;
  /** Os bytes não estão mais no aparelho: vira pendência sem chamar o servidor. */
  readonly ausente: ErroMutacao;
  /** Recusa definitiva (4xx) como erro da pendência, com mensagem em pt-BR. */
  erro(e: HttpErrorResponse, r: R, ctx: ContextoRecusa): ErroMutacao;
  /** A versão do agregado depois do upload (que o "toca"). */
  versao(resp: S): number;
  /** O registro depois do upload aceito. */
  enviado(r: R, resp: S): R;
  /** Depois do aceite, tira os bytes que não precisam mais ficar (P4b-R26). Roda na transação de `aplicarUpload`. */
  podar(tabela: Table<R, string>, agregadoId: string, resp: S): Promise<void>;
  /** As mudanças no registro local do agregado: a versão e o que o servidor passou a ter. */
  noAgregado(local: RegistroLocal, resp: S, versao: number): Record<string, unknown>;
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
  dados: (documentoId): DadosUpload => ({ documentoId }),
  idDe: (dados) => (dados as DadosUpload | null)?.documentoId,
  url: (propostaId) => `/api/propostas/${encodeURIComponent(propostaId)}/documentos`,
  montar: (doc) => ({
    arquivo: new Blob([doc.bytes!], { type: 'application/pdf' }),
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
  podar: async (tabela, propostaId, resp) => {
    await tabela
      .where('propostaId')
      .equals(propostaId)
      .filter((d) => d.enviado && d.revisao < resp.documento.revisao && d.bytes !== null)
      .modify({ bytes: null });
  },
  noAgregado: (local, resp, versao) => {
    const documentos = [...(local as PropostaLocal).documentos.filter((d) => d.id !== resp.documento.id), resp.documento];
    return { version: versao, documentos };
  },
};

// --- anexo da OS (M2) ---

/** 403 e 404 do upload: a OS não é mais deste usuário (técnico desatribuído, M2-R3/R22) ou não existe mais. */
export const MENSAGEM_OS_NAO_ESTA_COM_VOCE = 'Esta OS não está mais com você.';
/** 403 do PDF do técnico atribuído quando outro usuário concluiu a OS (M2P1-R28): o PDF do aparelho não vale. */
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

/**
 * 403/404 do anexo: o único caminho é descartar. O servidor responde `ACESSO_NEGADO` igual ao PDF do técnico que perdeu
 * a atribuição e ao do técnico atribuído quando o escritório concluiu a OS (M2P1-R28); só o `detail` muda, e texto do
 * servidor não é contrato. Quem distingue é o estado local: o push do `concluir` que vem antes do PDF na fila volta OK
 * com o estado do servidor (R26), que o aparelho grava porque só o upload vem atrás. Se a OS segue com este técnico e a
 * última conclusão do histórico é de outro usuário, foi o escritório; senão, ela não está mais com ele.
 */
function mensagemSemAcesso(e: HttpErrorResponse, a: AnexoOsLocal, ctx: ContextoRecusa): string {
  const os = ctx.agregado as OsLocal | undefined;
  const doEscritorio = e.status === 403 && a.tipo === 'DOCUMENTO' && os !== undefined && ctx.usuarioId !== null
    && os.tecnicoId === ctx.usuarioId && concluidaPorOutro(os, ctx.usuarioId);
  return doEscritorio ? MENSAGEM_OS_CONCLUIDA_PELO_ESCRITORIO : MENSAGEM_OS_NAO_ESTA_COM_VOCE;
}

/** O tipo do arquivo, a extensão e os metadados de cada tipo de anexo (os campos de outro tipo não vão). */
function envioDoAnexo(a: AnexoOsLocal): EnvioUpload {
  const base = { anexoId: a.id, tipo: a.tipo, sha256: a.sha256 };
  switch (a.tipo) {
    case 'FOTO':
      return {
        arquivo: new Blob([a.bytes!], { type: 'image/jpeg' }),
        nomeArquivo: `${a.id}.jpg`,
        metadados: { ...base, legenda: a.legenda, momento: a.momento, tiradaEm: a.tiradaEm },
      };
    case 'ASSINATURA':
      return {
        arquivo: new Blob([a.bytes!], { type: 'image/png' }),
        nomeArquivo: `${a.id}.png`,
        // no anexo local, `tiradaEm` é o `assinadaEm` do upload
        metadados: { ...base, assinanteNome: a.assinanteNome, assinantePapel: a.assinantePapel, assinadaEm: a.tiradaEm },
      };
    case 'DOCUMENTO':
      return {
        arquivo: new Blob([a.bytes!], { type: 'application/pdf' }),
        nomeArquivo: `${a.codigoExibido ?? a.id}.pdf`,
        metadados: { ...base, revisaoOs: a.revisaoOs, codigoExibido: a.codigoExibido, snapshot: a.snapshot ?? {} },
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
  dados: (anexoId): DadosUploadAnexoOs => ({ anexoId }),
  idDe: (dados) => (dados as DadosUploadAnexoOs | null)?.anexoId,
  url: (osId) => `/api/os/${encodeURIComponent(osId)}/anexos`,
  montar: envioDoAnexo,
  ausente: { codigo: 'ANEXO_AUSENTE', mensagem: `O arquivo deste anexo não está mais neste aparelho. ${DESCARTE_UPLOAD_OS}` },
  erro: (e, a, ctx) => comProblema(e, (codigo, campos) =>
    // M2-R3/R22: o técnico que perdeu a atribuição (o PDF dele, ou tudo depois de 7 dias, inclusive a repetição de
    // um upload já aceito), a OS que sumiu e o PDF da OS concluída pelo escritório (R28)
    e.status === 403 || e.status === 404
      ? mensagemSemAcesso(e, a, ctx)
      : `${motivoDoAnexo(a, codigo, e.status, campos)} ${DESCARTE_UPLOAD_OS}`),
  versao: (resp) => resp.versaoOs,
  // P4b-R26: depois do aceite fica só a miniatura (e os metadados); o PDF guarda os bytes da revisão atual
  enviado: (a, resp) => ({ ...a, enviado: true, arquivoId: resp.anexo.arquivoId, bytes: a.tipo === 'DOCUMENTO' ? a.bytes : null }),
  podar: async (tabela, osId, resp) => {
    const revisao = resp.anexo.revisaoOs;
    if (resp.anexo.tipo !== 'DOCUMENTO' || revisao == null) return;
    await tabela
      .where('osId')
      .equals(osId)
      .filter((a) => a.tipo === 'DOCUMENTO' && a.enviado && a.revisaoOs !== null && a.revisaoOs < revisao && a.bytes !== null)
      .modify({ bytes: null });
  },
  noAgregado: (local, resp, versao) => {
    const anexo = paraAnexoOsServidor(resp.anexo);
    const mudancas: Partial<OsLocal> = {
      version: versao,
      anexos: [...(local as OsLocal).anexos.filter((x) => x.id !== anexo.id), anexo],
    };
    if (anexo.tipo === 'ASSINATURA') {
      // como o servidor (M2P1-R10): a assinatura aceita passa a ser esta, e a recusa sai
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

/** As tabelas de bytes de todos os tipos (para as transações que mexem nelas). */
export function tabelasDeUpload(db: RegeraDb): Table<RegistroUpload, string>[] {
  return LISTA.map((t) => t.tabela(db));
}
