import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LucideDynamicIcon, LucideWifi, LucideWifiOff } from '@lucide/angular';
import { AtualizacaoApp } from '../../core/atualizacao/atualizacao-app';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { itensPara } from './navegacao';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LucideDynamicIcon],
  template: `
    <div class="min-h-dvh lg:flex">
      <aside class="hidden lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white">
        <div class="px-5 py-4 text-lg font-semibold text-blue-700">Regera</div>
        <nav class="flex flex-col gap-1 px-3">
          @for (item of itens(); track item.rota) {
            <a
              [routerLink]="item.rota"
              routerLinkActive="bg-blue-50 text-blue-700"
              class="flex items-center gap-3 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100"
            >
              <svg [lucideIcon]="item.icone" [size]="20"></svg>
              {{ item.rotulo }}
            </a>
          }
        </nav>
      </aside>

      <div class="flex min-h-dvh flex-1 flex-col">
        <header class="sticky top-0 z-10 flex h-14 items-center border-b border-slate-200 bg-white px-4">
          <span class="font-semibold text-blue-700 lg:hidden">Regera</span>
          <div class="ml-auto flex items-center gap-3 text-sm">
            <span
              data-testid="status-conexao"
              class="flex items-center gap-1"
              [class.text-emerald-600]="online()"
              [class.text-amber-600]="!online()"
            >
              <svg [lucideIcon]="online() ? iconeOnline : iconeOffline" [size]="16"></svg>
              {{ online() ? 'Online' : 'Offline' }}
            </span>
            <span class="max-w-40 truncate text-slate-600">{{ usuario()?.nome }}</span>
          </div>
        </header>

        @if (sessaoExpirada()) {
          <div class="bg-amber-100 px-4 py-2 text-sm text-amber-900">
            Sua sessão expirou. Seus dados locais estão guardados.
            <a routerLink="/login" class="font-semibold underline">Entrar novamente</a>
          </div>
        }

        <main class="flex-1 px-4 pb-24 pt-4 lg:pb-6">
          <router-outlet />
        </main>
      </div>

      <nav
        class="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        @for (item of itens(); track item.rota) {
          <a
            [routerLink]="item.rota"
            routerLinkActive="text-blue-700"
            class="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-slate-500"
          >
            <svg [lucideIcon]="item.icone" [size]="20"></svg>
            {{ item.rotulo }}
          </a>
        }
      </nav>
    </div>
  `,
})
export class Shell {
  private readonly auth = inject(AuthService);
  protected readonly online = inject(ConectividadeService).online;
  protected readonly usuario = this.auth.usuario;
  protected readonly sessaoExpirada = this.auth.sessaoExpirada;
  protected readonly itens = computed(() => {
    const u = this.usuario();
    return u ? itensPara(u.perfil) : [];
  });
  protected readonly iconeOnline = LucideWifi;
  protected readonly iconeOffline = LucideWifiOff;

  constructor() {
    inject(AtualizacaoApp).iniciar();
  }
}
