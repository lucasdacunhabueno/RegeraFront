import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth-service';
import { Selo, selosDaProposta } from '../propostas/formatos-proposta';
import { hojeReativo } from '../propostas/hoje-reativo';
import { PropostaCard } from '../propostas/proposta-card';
import { PropostaLocal } from '../propostas/proposta-models';
import { EstadoSync, PropostasRepo } from '../propostas/propostas-repo';

interface Linha {
  proposta: PropostaLocal;
  responsavelNome: string | null;
  selos: Selo[];
}

/**
 * "Propostas do cliente" (tela de edição do cliente): as propostas dele, do mais recente ao mais antigo, com os
 * mesmos selos da lista, e o atalho "Nova proposta" já com o cliente (`?clienteId=`, passo 1 do wizard). Fica fora do
 * `<form>` do cliente: não entra no aviso de alterações não salvas. Só ADMIN e COMERCIAL criam proposta e veem valores.
 */
@Component({
  selector: 'app-propostas-do-cliente',
  imports: [RouterLink, PropostaCard],
  template: `
    <section data-testid="propostas-do-cliente" aria-labelledby="propostas-cliente-titulo" class="mt-4 space-y-3 rounded-xl bg-white p-4">
      <div class="flex items-center justify-between gap-3">
        <h2 id="propostas-cliente-titulo" class="font-semibold">Propostas do cliente</h2>
        @if (podeCriar()) {
          <a data-testid="nova-proposta" routerLink="/propostas/nova" [queryParams]="{ clienteId: clienteId() }"
             class="inline-flex min-h-12 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white">Nova proposta</a>
        }
      </div>
      @if (propostas() === undefined) {
        <p class="text-sm text-slate-500">Carregando…</p>
      } @else if (linhas().length === 0) {
        <p class="text-sm text-slate-500">Nenhuma proposta para este cliente.</p>
      } @else {
        <ul class="space-y-3">
          @for (l of linhas(); track l.proposta.id) {
            <li class="rounded-xl border border-slate-200">
              <app-proposta-card [proposta]="l.proposta" [clienteNome]="clienteNome()" [responsavelNome]="l.responsavelNome"
                                 [mostrarValores]="podeCriar()" [selos]="l.selos" />
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class PropostasDoCliente {
  readonly clienteId = input.required<string>();
  /** O nome que o card mostra (o do cliente aberto). */
  readonly clienteNome = input('');

  private readonly repo = inject(PropostasRepo);
  private readonly perfil = inject(AuthService).usuario;
  protected readonly podeCriar = computed(() => {
    const p = this.perfil()?.perfil;
    return p === 'ADMIN' || p === 'COMERCIAL';
  });

  protected readonly propostas = signal<PropostaLocal[] | undefined>(undefined);
  private readonly usuarios = toSignal(this.repo.observarUsuarios(), { initialValue: [] });
  private readonly estado = toSignal(this.repo.observarEstadoSync(), {
    initialValue: { naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() } as EstadoSync,
  });
  private readonly hoje = hojeReativo();

  protected readonly linhas = computed<Linha[]>(() => {
    const nomes = new Map(this.usuarios().map((u) => [u.id, u.nome]));
    const { naOutbox, comPendencia } = this.estado();
    return (this.propostas() ?? []).map((p) => ({
      proposta: p,
      responsavelNome: nomes.get(p.responsavelId) ?? null,
      selos: selosDaProposta(p, { pendente: comPendencia.has(p.id), naoSincronizada: naOutbox.has(p.id), hoje: this.hoje() }),
    }));
  });

  constructor() {
    effect((aoLimpar) => {
      this.propostas.set(undefined);
      const assinatura = this.repo.observarDoCliente(this.clienteId()).subscribe((l) => this.propostas.set(l));
      aoLimpar(() => assinatura.unsubscribe());
    });
  }
}
