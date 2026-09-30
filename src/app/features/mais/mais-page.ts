import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { SyncService } from '../../core/sync/sync-service';

@Component({
  selector: 'app-mais-page',
  imports: [RouterLink],
  template: `
    <h1 class="mb-4 text-xl font-semibold">Mais</h1>
    <ul class="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white">
      @if (admin()) {
        <li><a routerLink="/usuarios" class="block px-4 py-4">Usuários</a></li>
        <li><a routerLink="/empresa" class="block px-4 py-4">Empresa</a></li>
      }
      <li>
        <a routerLink="/pendencias" class="flex items-center justify-between px-4 py-4">
          Pendências de sync
          @if (pendentes() > 0) {
            <span data-testid="contador-pendencias" class="rounded-full bg-amber-500 px-2 text-xs font-semibold text-white">
              {{ pendentes() }}
            </span>
          }
        </a>
      </li>
      <li><a routerLink="/perfil/senha" class="block px-4 py-4">Trocar senha</a></li>
      <li>
        <button type="button" data-testid="sair" (click)="sair()" class="block w-full px-4 py-4 text-left text-red-600">
          Sair
        </button>
      </li>
    </ul>
  `,
})
export class MaisPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly sync = inject(SyncService);
  private readonly online = inject(ConectividadeService).online;
  protected readonly admin = computed(() => this.auth.usuario()?.perfil === 'ADMIN');
  protected readonly pendentes = computed(() => this.sync.naoSincronizados() + this.sync.problemas());

  private readonly saindo = signal(false);

  protected async sair(): Promise<void> {
    if (this.saindo()) return;
    this.saindo.set(true);
    try {
      await this.executarSaida();
    } finally {
      this.saindo.set(false);
    }
  }

  private async executarSaida(): Promise<void> {
    let pendentes = await this.sync.contarNaoSincronizados();
    if (pendentes > 0 && this.online()) {
      await this.sync.sincronizar();
      pendentes = await this.sync.contarNaoSincronizados();
    }
    if (
      pendentes > 0 &&
      !window.confirm(
        `Há ${pendentes} alteração(ões) não sincronizada(s) neste aparelho. Se sair agora, elas serão perdidas. Sair mesmo assim?`,
      )
    ) {
      return;
    }
    await this.sync.aguardarOciosa();
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
