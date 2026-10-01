import { Perfil } from '../auth/auth-models';

export type Entidade = 'cliente' | 'item_catalogo' | 'empresa' | 'template_proposta' | 'proposta';
export type Operacao = 'UPSERT' | 'DELETE';

export interface MutacaoLocal {
  seq?: number;
  mutationId: string;
  entidade: Entidade;
  agregadoId: string;
  op: Operacao;
  baseVersion: number | null;
  dados: unknown | null;
  /** Já enviada ao servidor e ainda sem resposta; nunca é coalescida. */
  enviando?: boolean;
  criadaEm: string;
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
  perfil: Perfil;
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
  entidade: Entidade;
  agregadoId: string;
  tipo: 'CONFLITO' | 'REJEITADO';
  mutacao: MutacaoLocal;
  dadosServidor?: unknown;
  versionServidor?: number;
  erro?: ErroMutacao;
  criadaEm: string;
}
