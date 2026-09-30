import { effect, EffectRef, inject, Injectable, Injector, untracked } from '@angular/core';
import { AuthService } from '../auth/auth-service';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { SyncService } from './sync-service';

const INTERVALO_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class SyncAgendador {
  private readonly sync = inject(SyncService);
  private readonly auth = inject(AuthService);
  private readonly conectividade = inject(ConectividadeService);
  private readonly injector = inject(Injector);
  private efeito?: EffectRef;
  private timer?: ReturnType<typeof setInterval>;

  /** Sincroniza ao abrir/voltar a internet (renovando a sessão antes) e a cada 60 s com a aba visível. */
  iniciar(): void {
    if (this.efeito) return;
    this.efeito = effect(
      () => {
        if (this.conectividade.online() && this.auth.autenticado()) {
          untracked(() => void this.aoConectar());
        }
      },
      { injector: this.injector },
    );
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible' && this.auth.autenticado()) {
        void this.sync.sincronizar();
      }
    }, INTERVALO_MS);
  }

  parar(): void {
    this.efeito?.destroy();
    this.efeito = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async aoConectar(): Promise<void> {
    if (!this.auth.autenticado()) return;
    await this.auth.renovar();
    await this.sync.sincronizar();
  }
}
