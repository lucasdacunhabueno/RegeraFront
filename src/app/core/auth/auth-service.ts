import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { RegeraDb } from '../db/regera-db';
import { RespostaSessao, UsuarioSessao } from './auth-models';

const CHAVE_SESSAO = 'sessao';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly db = inject(RegeraDb);
  private accessToken: string | null = null;
  private renovacaoEmAndamento: Promise<boolean> | null = null;

  readonly usuario = signal<UsuarioSessao | null>(null);
  readonly sessaoExpirada = signal(false);
  readonly autenticado = computed(() => this.usuario() !== null);

  token(): string | null {
    return this.accessToken;
  }

  /** Usuário da última sessão guardada neste aparelho (funciona offline). */
  sessaoLocal(): Promise<UsuarioSessao | undefined> {
    return this.db.lerMeta<UsuarioSessao>(CHAVE_SESSAO);
  }

  /** Restaura a sessão local (funciona offline) e tenta renovar o token em segundo plano. */
  async iniciar(): Promise<void> {
    const sessao = await this.db.lerMeta<UsuarioSessao>(CHAVE_SESSAO);
    if (!sessao) return;
    this.usuario.set(sessao);
    void this.renovar();
  }

  async login(email: string, senha: string): Promise<void> {
    const resp = await firstValueFrom(this.http.post<RespostaSessao>('/api/auth/login', { email, senha }));
    const anterior = await this.db.lerMeta<UsuarioSessao>(CHAVE_SESSAO);
    if (anterior && anterior.id !== resp.usuario.id) {
      await this.db.limparTudo();
    }
    await this.aplicar(resp);
    void navigator.storage?.persist?.();
  }

  renovar(): Promise<boolean> {
    this.renovacaoEmAndamento ??= this.executarRenovacao().finally(() => (this.renovacaoEmAndamento = null));
    return this.renovacaoEmAndamento;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}).pipe(timeout(5000)));
    } catch {
      // sem internet: o refresh expira sozinho no servidor
    }
    this.accessToken = null;
    this.usuario.set(null);
    this.sessaoExpirada.set(false);
    await this.db.limparTudo();
  }

  private async executarRenovacao(): Promise<boolean> {
    const renovar = async (): Promise<boolean> => {
      try {
        const resp = await firstValueFrom(
          this.http.post<RespostaSessao>('/api/auth/refresh', {}).pipe(timeout(5000)),
        );
        await this.aplicar(resp);
        return true;
      } catch (erro) {
        if (erro instanceof HttpErrorResponse && erro.status === 401) {
          this.accessToken = null;
          this.sessaoExpirada.set(true);
        }
        return false;
      }
    };
    const locks = navigator.locks;
    return locks ? locks.request('regera-refresh', renovar) : renovar();
  }

  private async aplicar(resp: RespostaSessao): Promise<void> {
    this.accessToken = resp.accessToken;
    this.sessaoExpirada.set(false);
    this.usuario.set(resp.usuario);
    await this.db.gravarMeta(CHAVE_SESSAO, resp.usuario);
  }
}
