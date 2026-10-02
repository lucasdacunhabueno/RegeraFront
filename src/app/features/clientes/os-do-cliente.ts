import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth-service';
import { SeloOs, selosDaOs } from '../os/formatos-os';
import { OsCard } from '../os/os-card';
import { OsLocal } from '../os/os-models';
import { EstadoSync, OsRepo } from '../os/os-repo';
import { hojeReativo } from '../propostas/hoje-reativo';
import { PropostasRepo } from '../propostas/propostas-repo';

interface Linha {
  os: OsLocal;
  tecnicoNome: string | null;
  selos: SeloOs[];
}

/**
 * "Ordens de serviço" (tela de edição do cliente, M2-P3): as OS do cliente que o perfil vê (`observarDoCliente`), da
 * mais recente à mais antiga, inclusive as encerradas (é o histórico dele), com os selos e o técnico como na lista de
 * OS do escritório, e o atalho "Nova OS" já com o cliente (`/os/nova?clienteId=`, a OS avulsa: corretiva, garantia),
 * como o "Nova proposta". A tela do cliente é só de ADMIN e COMERCIAL (rota). Fica fora do `<form>`, como as propostas.
 */
@Component({
  selector: 'app-os-do-cliente',
  imports: [RouterLink, OsCard],
  template: `
    <section data-testid="os-do-cliente" aria-labelledby="os-cliente-titulo" class="mt-4 space-y-3 rounded-xl bg-white p-4">
      <div class="flex items-center justify-between gap-3">
        <h2 id="os-cliente-titulo" class="font-semibold">Ordens de serviço</h2>
        @if (podeCriar()) {
          <a data-testid="nova-os" routerLink="/os/nova" [queryParams]="{ clienteId: clienteId() }"
             class="inline-flex min-h-12 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white">Nova OS</a>
        }
      </div>
      <!-- N4: a região de status fica sempre na tela (o leitor de tela só anuncia a região que já existia) -->
      <div role="status" class="text-sm text-slate-500">
        @if (lista() === undefined) {
          <p>Carregando…</p>
        } @else if (linhas().length === 0) {
          <p>Nenhuma OS para este cliente.</p>
        }
      </div>
      @if (linhas().length > 0) {
        <ul class="space-y-3">
          @for (l of linhas(); track l.os.id) {
            <li class="rounded-xl border border-slate-200">
              <app-os-card [os]="l.os" [clienteNome]="clienteNome()" [tecnicoNome]="l.tecnicoNome" [mostrarTecnico]="true"
                           [selos]="l.selos" />
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class OsDoCliente {
  readonly clienteId = input.required<string>();
  /** O nome que o card mostra (o do cliente aberto). */
  readonly clienteNome = input('');

  private readonly repo = inject(OsRepo);
  private readonly usuario = inject(AuthService).usuario;
  /** Quem cria a OS avulsa (`criarAvulsa`): ADMIN e COMERCIAL. */
  protected readonly podeCriar = computed(() => {
    const p = this.usuario()?.perfil;
    return p === 'ADMIN' || p === 'COMERCIAL';
  });
  /** undefined até a primeira leitura (sem isso a seção piscaria o estado vazio). */
  protected readonly lista = signal<OsLocal[] | undefined>(undefined);
  private readonly usuarios = toSignal(inject(PropostasRepo).observarUsuarios(), { initialValue: [] });
  private readonly estado = toSignal(this.repo.observarEstadoSync(), {
    initialValue: { naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() } as EstadoSync,
  });
  /** Data civil de São Paulo (selo Atrasada), refeita à meia-noite e quando a aba volta a ficar visível. */
  private readonly hoje = hojeReativo();

  protected readonly linhas = computed<Linha[]>(() => {
    const nomes = new Map(this.usuarios().map((u) => [u.id, u.nome]));
    const { naOutbox } = this.estado();
    const hoje = this.hoje();
    return (this.lista() ?? []).map((o) => ({
      os: o,
      // null = sem técnico; o atribuído que não está nos usuários do aparelho não vira "Sem técnico" (como na lista)
      tecnicoNome: o.tecnicoId ? (nomes.get(o.tecnicoId) ?? 'não identificado') : null,
      selos: selosDaOs(o, { naoSincronizada: naOutbox.has(o.id), hoje }),
    }));
  });

  constructor() {
    effect((aoLimpar) => {
      this.lista.set(undefined);
      const assinatura = this.repo.observarDoCliente(this.clienteId()).subscribe((l) => this.lista.set(l));
      aoLimpar(() => assinatura.unsubscribe());
    });
  }
}
