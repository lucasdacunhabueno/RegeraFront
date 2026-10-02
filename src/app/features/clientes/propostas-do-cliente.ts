import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth-service';
import { osPorProposta, SeloOsProposta, selosOsDaProposta } from '../os/formatos-os';
import type { OsLocal } from '../os/os-models';
import { OsRepo } from '../os/os-repo';
import { Selo, selosDaProposta } from '../propostas/formatos-proposta';
import { hojeReativo } from '../propostas/hoje-reativo';
import { PropostaCard } from '../propostas/proposta-card';
import { PropostaLocal } from '../propostas/proposta-models';
import { EstadoSync, PropostasRepo } from '../propostas/propostas-repo';

interface Linha {
  proposta: PropostaLocal;
  responsavelNome: string | null;
  selos: Selo[];
  /** M2-P3: os selos das OS da proposta (como no kanban). */
  selosOs: SeloOsProposta[];
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
      <!-- N4: a região de status fica sempre na tela (o leitor de tela só anuncia a região que já existia) -->
      <div role="status" class="text-sm text-slate-500">
        @if (propostas() === undefined) {
          <p>Carregando…</p>
        } @else if (linhas().length === 0) {
          <p>Nenhuma proposta para este cliente.</p>
        }
      </div>
      @if (linhas().length > 0) {
        <ul class="space-y-3">
          @for (l of linhas(); track l.proposta.id) {
            <li class="rounded-xl border border-slate-200">
              <app-proposta-card [proposta]="l.proposta" [clienteNome]="clienteNome()" [responsavelNome]="l.responsavelNome"
                                 [mostrarValores]="podeCriar()" [selos]="l.selos" [selosOs]="l.selosOs" />
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
  private readonly osRepo = inject(OsRepo);
  private readonly perfil = inject(AuthService).usuario;
  protected readonly podeCriar = computed(() => {
    const p = this.perfil()?.perfil;
    return p === 'ADMIN' || p === 'COMERCIAL';
  });

  protected readonly propostas = signal<PropostaLocal[] | undefined>(undefined);
  /** M2-P3: as OS do cliente que o perfil vê (`observarDoCliente`), para os selos da OS nos cards. */
  private readonly oss = signal<OsLocal[]>([]);
  private readonly usuarios = toSignal(this.repo.observarUsuarios(), { initialValue: [] });
  private readonly estado = toSignal(this.repo.observarEstadoSync(), {
    initialValue: { naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() } as EstadoSync,
  });
  private readonly hoje = hojeReativo();

  protected readonly linhas = computed<Linha[]>(() => {
    const nomes = new Map(this.usuarios().map((u) => [u.id, u.nome]));
    const { naOutbox, comPendencia } = this.estado();
    const oss = osPorProposta(this.oss());
    return (this.propostas() ?? []).map((p) => ({
      proposta: p,
      responsavelNome: nomes.get(p.responsavelId) ?? null,
      selos: selosDaProposta(p, { pendente: comPendencia.has(p.id), naoSincronizada: naOutbox.has(p.id), hoje: this.hoje() }),
      selosOs: selosOsDaProposta(p.status, oss.get(p.id) ?? []),
    }));
  });

  constructor() {
    effect((aoLimpar) => {
      const clienteId = this.clienteId();
      this.propostas.set(undefined);
      this.oss.set([]);
      const assinaturas = [
        this.repo.observarDoCliente(clienteId).subscribe((l) => this.propostas.set(l)),
        this.osRepo.observarDoCliente(clienteId).subscribe((l) => this.oss.set(l)),
      ];
      aoLimpar(() => assinaturas.forEach((a) => a.unsubscribe()));
    });
  }
}
