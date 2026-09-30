import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth-service';

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
      <li><a routerLink="/pendencias" class="block px-4 py-4">Pendências de sync</a></li>
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
  protected readonly admin = computed(() => this.auth.usuario()?.perfil === 'ADMIN');

  protected async sair(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
