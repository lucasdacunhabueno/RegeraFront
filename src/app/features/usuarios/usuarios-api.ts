import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Perfil } from '../../core/auth/auth-models';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
}

export interface NovoUsuario {
  nome: string;
  email: string;
  perfil: Perfil;
  senha: string;
}

export interface AlteracaoUsuario {
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
}

export const ROTULO_PERFIL: Record<Perfil, string> = {
  ADMIN: 'Admin',
  COMERCIAL: 'Comercial',
  TECNICO: 'Técnico',
};

@Injectable({ providedIn: 'root' })
export class UsuariosApi {
  private readonly http = inject(HttpClient);

  listar(): Observable<Usuario[]> {
    return this.http.get<Usuario[]>('/api/usuarios');
  }

  buscar(id: string): Observable<Usuario> {
    return this.http.get<Usuario>(`/api/usuarios/${id}`);
  }

  criar(dados: NovoUsuario): Observable<Usuario> {
    return this.http.post<Usuario>('/api/usuarios', dados);
  }

  alterar(id: string, dados: AlteracaoUsuario): Observable<Usuario> {
    return this.http.put<Usuario>(`/api/usuarios/${id}`, dados);
  }

  redefinirSenha(id: string, novaSenha: string): Observable<void> {
    return this.http.put<void>(`/api/usuarios/${id}/senha`, { novaSenha });
  }

  trocarMinhaSenha(senhaAtual: string, novaSenha: string): Observable<void> {
    return this.http.put<void>('/api/me/senha', { senhaAtual, novaSenha });
  }
}
