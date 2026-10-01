import type { AnexoOsDados } from '../../features/os/os-models';
import type { DocumentoDados } from '../../features/propostas/proposta-models';
import { Perfil } from '../auth/auth-models';

export type Entidade = 'cliente' | 'item_catalogo' | 'empresa' | 'template_proposta' | 'proposta' | 'os';
/** Operações do push (`/api/sync/push`). */
export type Operacao = 'UPSERT' | 'DELETE';

/**
 * `entidade` das mutações de upload do PDF da proposta na outbox. Não é um agregado do pull (não tem adaptador): vai
 * por `POST /api/propostas/{id}/documentos`, fora do lote do push, com `agregadoId` = id da proposta (fica na ordem
 * FIFO dela), `op: 'UPLOAD'` e `dados: { documentoId }`. A troca de perfil para TECNICO apaga essas mutações.
 */
export const TIPO_UPLOAD_DOCUMENTO = 'documento_proposta' as const;

/**
 * `entidade` das mutações de upload de um anexo da OS (FOTO, ASSINATURA ou o PDF): `POST /api/os/{id}/anexos`, fora
 * do lote do push, com `agregadoId` = id da OS (sai depois da mutação que deixou a OS no status exigido), `op: 'UPLOAD'`
 * e `dados: { anexoId }` (registro da tabela `anexosOs`). A OS não tem valores: o perfil TECNICO não apaga estas.
 */
export const TIPO_UPLOAD_ANEXO_OS = 'anexo_os' as const;

/** As `entidade` de upload (ver `tipos-upload.ts`). */
export type EntidadeUpload = typeof TIPO_UPLOAD_DOCUMENTO | typeof TIPO_UPLOAD_ANEXO_OS;

/** O que pode estar na outbox: um agregado do sync ou um upload. */
export type EntidadeOutbox = Entidade | EntidadeUpload;
export type OperacaoOutbox = Operacao | 'UPLOAD';

/** `dados` de uma mutação de upload do documento da proposta. */
export interface DadosUpload {
  documentoId: string;
}

/** `dados` de uma mutação de upload de anexo da OS. */
export interface DadosUploadAnexoOs {
  anexoId: string;
}

export interface MutacaoLocal {
  seq?: number;
  mutationId: string;
  entidade: EntidadeOutbox;
  agregadoId: string;
  op: OperacaoOutbox;
  baseVersion: number | null;
  dados: unknown | null;
  /** Já enviada ao servidor e ainda sem resposta; nunca é coalescida. */
  enviando?: boolean;
  /** Transição de status ou upload: nunca recebe coalescência (a edição seguinte vira outra mutação). */
  separada?: boolean;
  criadaEm: string;
}

/** Resposta do upload do documento (201 novo, 200 repetição idempotente). P4b-R9. */
export interface RespostaDocumento {
  documento: DocumentoDados;
  /** Versão da proposta depois do upload (que a "toca"): `baseVersion` da próxima mutação dela. */
  versaoProposta: number;
}

/** Resposta do upload do anexo da OS (201 novo, 200 repetição idempotente). P4b-R9. */
export interface RespostaAnexoOs {
  anexo: AnexoOsDados;
  /** Versão da OS depois do upload (que a "toca"): `baseVersion` da próxima mutação dela. */
  versaoOs: number;
}

export interface ErroMutacao {
  codigo: string;
  mensagem: string;
  campos?: Record<string, string>;
  idExistente?: string;
}

export interface ResultadoMutacao {
  mutationId: string;
  status: 'OK' | 'CONFLITO' | 'REJEITADO';
  version?: number;
  dados?: unknown;
  /** Ausente num CONFLITO = excluído no servidor. */
  dadosServidor?: unknown;
  versionServidor?: number;
  erro?: ErroMutacao;
}

export interface Mudanca {
  entidade: Entidade;
  id: string;
  version: number;
  deleted: boolean;
  dados: unknown | null;
}

export interface UsuarioResumo {
  id: string;
  nome: string;
  /** P4b-R20: para `responsavel.email` no PDF. Ausente em linhas gravadas antes do servidor mandá-lo. */
  email?: string | null;
  perfil: Perfil;
  /** false = inativo (não é oferecido nem copiado ao duplicar). Ausente em linhas antigas: tratado como ativo. */
  ativo?: boolean;
}

export interface RespostaPull {
  cursor: number;
  temMais: boolean;
  mudancas: Mudanca[];
  usuarios: UsuarioResumo[];
}

export interface RespostaPush {
  resultados: ResultadoMutacao[];
}

export interface Pendencia {
  mutationId: string;
  entidade: EntidadeOutbox;
  agregadoId: string;
  tipo: 'CONFLITO' | 'REJEITADO';
  mutacao: MutacaoLocal;
  dadosServidor?: unknown;
  versionServidor?: number;
  erro?: ErroMutacao;
  criadaEm: string;
}
