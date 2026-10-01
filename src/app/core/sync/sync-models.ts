import type { DocumentoDados } from '../../features/propostas/proposta-models';
import { Perfil } from '../auth/auth-models';

export type Entidade = 'cliente' | 'item_catalogo' | 'empresa' | 'template_proposta' | 'proposta';
/** Operações do push (`/api/sync/push`). */
export type Operacao = 'UPSERT' | 'DELETE';

/**
 * `entidade` das mutações de upload do PDF da proposta na outbox. Não é um agregado do pull (não tem adaptador): vai
 * por `POST /api/propostas/{id}/documentos`, fora do lote do push, com `agregadoId` = id da proposta (fica na ordem
 * FIFO dela), `op: 'UPLOAD'` e `dados: { documentoId }`. A troca de perfil para TECNICO apaga essas mutações.
 */
export const TIPO_UPLOAD_DOCUMENTO = 'documento_proposta' as const;

/** O que pode estar na outbox: um agregado do sync ou o upload de um documento. */
export type EntidadeOutbox = Entidade | typeof TIPO_UPLOAD_DOCUMENTO;
export type OperacaoOutbox = Operacao | 'UPLOAD';

/** `dados` de uma mutação de upload. */
export interface DadosUpload {
  documentoId: string;
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
