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
  /**
   * Muda a cada volta da internet ou da sessão, a cada queda, quando a sessão expira e no `parar`: a reconexão de outra
   * geração não continua.
   */
  private geracao = 0;
  /** Desagenda a espera da reconexão em curso e a acorda (ela vê a geração nova e para). */
  private cancelarEspera?: () => void;

  /** Sincroniza ao abrir/voltar a internet (renovando a sessão antes) e a cada 60 s com a aba visível. */
  iniciar(): void {
    if (this.efeito) return;
    this.efeito = effect(
      () => {
        // os três lidos sempre (sem curto-circuito): qualquer mudança encerra a reconexão em curso
        const online = this.conectividade.online();
        const autenticado = this.auth.autenticado();
        const expirada = this.auth.sessaoExpirada();
        untracked(() => {
          const geracao = this.novaGeracao();
          // M6: com a sessão expirada não há o que sincronizar; o "Entrar novamente" (expirada → false) recomeça
          if (online && autenticado && !expirada) void this.aoConectar(geracao);
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
    this.novaGeracao();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private novaGeracao(): number {
    this.cancelarEspera?.();
    this.cancelarEspera = undefined;
    return ++this.geracao;
  }

  /**
   * Renova a sessão e sincroniza. O evento `online` não garante rede: a interface sobe antes de a rota responder (e,
   * no E2E, o `setOffline(false)` do Playwright devolve a rede à página antes do service worker, por onde os pedidos
   * saem). Se a tentativa para por falta de rede (`sem-rede`), tenta de novo depois de cada espera de
   * `ESPERAS_RECONEXAO_MS`, enquanto a geração for a mesma (sem queda da internet nem saída da sessão no meio).
   * I1: renova só até uma renovação dar certo. Cada renovação gira o cookie da sessão, e uma resposta perdida no meio
   * deixa o navegador com o cookie revogado; depois da primeira, o token vale 15 min e o interceptor renova no 401.
   */
  private async aoConectar(geracao: number): Promise<void> {
    let renovada = false;
    for (let tentativa = 0; ; tentativa++) {
      if (geracao !== this.geracao || !this.auth.autenticado()) return;
      if (!renovada) renovada = await this.auth.renovar();
      if (geracao !== this.geracao) return;
      const fim = await this.sync.sincronizar();
      if (fim !== 'sem-rede' || tentativa >= ESPERAS_RECONEXAO_MS.length || geracao !== this.geracao) return;
      await this.esperar(ESPERAS_RECONEXAO_MS[tentativa]);
    }
  }

  private esperar(ms: number): Promise<void> {
    return new Promise((acordar) => {
      const espera = setTimeout(acordar, ms);
      this.cancelarEspera = () => {
        clearTimeout(espera);
        acordar();
      };
    });
  }
}
