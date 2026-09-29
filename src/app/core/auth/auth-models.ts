export type Perfil = 'ADMIN' | 'COMERCIAL' | 'TECNICO';

export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
}

export interface RespostaSessao {
  accessToken: string;
  expiresIn: number;
  usuario: UsuarioSessao;
}
