import { effect, EffectRef, inject, Injectable, Injector, untracked } from '@angular/core';
import { AuthService } from '../auth/auth-service';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { SyncService } from './sync-service';

const INTERVALO_MS = 60_000;
/** Esperas antes de cada nova tentativa da reconexão que parou por falta de rede (somam 31 s; depois, o intervalo). */
const ESPERAS_RECONEXAO_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

@Injectable({ providedIn: 'root' })
export class SyncAgendador {
  private readonly sync = inject(SyncService);
  private readonly auth = inject(AuthService);
  private readonly conectividade = inject(ConectividadeService);
  private readonly injector = inject(Injector);
  private efeito?: EffectRef;
  private timer?: ReturnType<typeof setInterval>;
  /** Muda a cada volta da internet ou da sessão, a cada queda e no `parar`: a reconexão de outra geração não repete. */
  private geracao = 0;

  /** Sincroniza ao abrir/voltar a internet (renovando a sessão antes) e a cada 60 s com a aba visível. */
  iniciar(): void {
    if (this.efeito) return;
    this.efeito = effect(
      () => {
        const conectado = this.conectividade.online() && this.auth.autenticado();
        untracked(() => {
          const geracao = ++this.geracao;
          if (conectado) void this.aoConectar(geracao);
        });
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
    this.geracao++;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Renova a sessão e sincroniza. O evento `online` não garante rede: a interface sobe antes de a rota responder (e,
   * no E2E, o `setOffline(false)` do Playwright devolve a rede à página antes do service worker, por onde os pedidos
   * saem). Se a tentativa para por falta de rede (`sem-rede`), tenta de novo depois de cada espera de
   * `ESPERAS_RECONEXAO_MS`, enquanto a geração for a mesma (sem queda da internet nem saída da sessão no meio).
   */
  private async aoConectar(geracao: number): Promise<void> {
    for (let tentativa = 0; ; tentativa++) {
      if (geracao !== this.geracao || !this.auth.autenticado()) return;
      await this.auth.renovar();
      if (geracao !== this.geracao) return;
      const fim = await this.sync.sincronizar();
      if (fim !== 'sem-rede' || tentativa >= ESPERAS_RECONEXAO_MS.length) return;
      await new Promise((acordar) => setTimeout(acordar, ESPERAS_RECONEXAO_MS[tentativa]));
    }
  }
}
