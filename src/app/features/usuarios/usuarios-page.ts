import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { mensagemDeErro } from '../../core/http/erro-api';
import { ROTULO_PERFIL, Usuario, UsuariosApi } from './usuarios-api';

@Component({
  selector: 'app-usuarios-page',
  imports: [RouterLink],
  template: `
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-semibold">Usuários</h1>
      <a routerLink="/usuarios/novo" class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Novo usuário</a>
    </div>

    @if (!online()) {
      <p class="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">A gestão de usuários precisa de internet.</p>
    }
    @if (erro()) {
      <p class="text-sm text-red-600" role="alert">{{ erro() }}</p>
    }
    @if (carregando()) {
      <p class="text-slate-500">Carregando…</p>
    }

    <ul class="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white">
      @for (u of usuarios(); track u.id) {
        <li>
          <a [routerLink]="['/usuarios', u.id]" class="flex items-center gap-3 px-4 py-3">
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ u.nome }}</p>
              <p class="truncate text-sm text-slate-500">{{ u.email }}</p>
            </div>
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{{ rotulo[u.perfil] }}</span>
            @if (!u.ativo) {
              <span class="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">Inativo</span>
            }
          </a>
        </li>
      }
    </ul>
  `,
})
export class UsuariosPage {
  private readonly api = inject(UsuariosApi);
  protected readonly online = inject(ConectividadeService).online;
  protected readonly usuarios = signal<Usuario[]>([]);
  protected readonly carregando = signal(true);
  protected readonly erro = signal<string | null>(null);
  protected readonly rotulo = ROTULO_PERFIL;

  constructor() {
    void this.carregar();
  }

  private async carregar(): Promise<void> {
    try {
      this.usuarios.set(await firstValueFrom(this.api.listar()));
    } catch (e) {
      this.erro.set(mensagemDeErro(e));
    } finally {
      this.carregando.set(false);
    }
  }
}
