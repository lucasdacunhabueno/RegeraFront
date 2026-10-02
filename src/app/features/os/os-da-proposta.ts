import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth-service';
import { Toasts } from '../../shared/ui/toasts';
import { hojeReativo } from '../propostas/hoje-reativo';
import type { PropostaLocal } from '../propostas/proposta-models';
import { PropostasRepo } from '../propostas/propostas-repo';
import { DialogoGerarOs, TecnicoOpcao } from './dialogo-gerar-os';
import { mensagemErroOs, SeloOs, selosDaOs } from './formatos-os';
import { OsCard } from './os-card';
import { OsLocal } from './os-models';
import { EstadoSync, OpcoesGerarOs, OsRepo } from './os-repo';

interface Linha {
  os: OsLocal;
  tecnicoNome: string | null;
  selos: SeloOs[];
}

/**
 * "Ordens de serviço" do detalhe da proposta (spec M2 §9, Q1/Q17): as OS dela (`observarDaProposta`, com o filtro do
 * perfil: o COMERCIAL só as em que é o responsável), da mais recente à mais antiga, com o card da lista de OS. "Gerar
 * OS" com a proposta APROVADA ou EM_EXECUCAO, para o ADMIN e o COMERCIAL responsável: o `DialogoGerarOs` (com a
 * descrição para revisar, M2P2-R17), `gerarDaProposta` e a navegação para a OS nova. A recusa fica num toast pelo
 * `mensagemErroOs`, com o diálogo aberto.
 */
@Component({
  selector: 'app-os-da-proposta',
  imports: [OsCard, DialogoGerarOs],
  template: `
    <section data-testid="os-da-proposta" aria-labelledby="os-proposta-titulo" class="space-y-3 rounded-xl bg-white p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="os-proposta-titulo" class="font-semibold">Ordens de serviço</h2>
        @if (podeGerar()) {
          <button type="button" (click)="abrir($any($event.currentTarget))" [disabled]="gerando()"
                  class="h-12 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-60">Gerar OS</button>
        }
      </div>
      @if (lista() === undefined) {
        <p class="text-sm text-slate-500">Carregando…</p>
      } @else if (linhas().length === 0) {
        <p class="text-sm text-slate-500">Nenhuma OS para esta proposta.</p>
      } @else {
        <ul class="space-y-3">
          @for (l of linhas(); track l.os.id) {
            <li class="rounded-xl border border-slate-200">
              <app-os-card [os]="l.os" [clienteNome]="clienteNome()" [tecnicoNome]="l.tecnicoNome" [mostrarTecnico]="true" [selos]="l.selos" />
            </li>
          }
        </ul>
      }
    </section>

    @if (dialogo()) {
      <app-dialogo-gerar-os [proposta]="proposta()" [tecnicos]="tecnicos()" [emCurso]="emCurso()" [ocupado]="gerando()"
                            [gatilho]="gatilho()" (confirmado)="gerar($event)" (cancelado)="dialogo.set(false)" />
    }
  `,
})
export class OsDaProposta {
  readonly proposta = input.required<PropostaLocal>();
  /** O nome que o card mostra (o cliente da proposta). */
  readonly clienteNome = input('');

  private readonly repo = inject(OsRepo);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly usuario = inject(AuthService).usuario;
  private readonly usuarios = toSignal(inject(PropostasRepo).observarUsuarios(), { initialValue: [] });
  private readonly estado = toSignal(this.repo.observarEstadoSync(), {
    initialValue: { naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() } as EstadoSync,
  });
  /** Data civil de São Paulo (selo Atrasada). */
  private readonly hoje = hojeReativo();

  /** undefined até a primeira leitura (sem isso a seção piscaria o estado vazio). */
  protected readonly lista = signal<OsLocal[] | undefined>(undefined);
  protected readonly dialogo = signal(false);
  protected readonly gerando = signal(false);
  protected readonly gatilho = signal<HTMLElement | null>(null);

  /** As que o perfil vê: o ADMIN todas, o COMERCIAL as dele (o `observarTodas` do repositório). */
  private readonly visiveis = computed(() => {
    const u = this.usuario();
    return (this.lista() ?? []).filter((o) => u?.perfil === 'ADMIN' || (u?.perfil === 'COMERCIAL' && o.responsavelId === u.id));
  });
  protected readonly linhas = computed<Linha[]>(() => {
    const nomes = new Map(this.usuarios().map((u) => [u.id, u.nome]));
    const { naOutbox } = this.estado();
    const hoje = this.hoje();
    return this.visiveis().map((o) => ({
      os: o,
      tecnicoNome: o.tecnicoId ? (nomes.get(o.tecnicoId) ?? 'não identificado') : null,
      selos: selosDaOs(o, { naoSincronizada: naOutbox.has(o.id), hoje }),
    }));
  });
  protected readonly emCurso = computed(() => this.visiveis().filter((o) => o.status === 'ABERTA' || o.status === 'EM_ANDAMENTO').length);
  /** Spec M2 §5: criar a OS é do ADMIN e do COMERCIAL responsável, com a proposta aprovada ou em execução. */
  protected readonly podeGerar = computed(() => {
    const p = this.proposta();
    const u = this.usuario();
    const quem = u?.perfil === 'ADMIN' || (u?.perfil === 'COMERCIAL' && p.responsavelId === u.id);
    return quem && (p.status === 'APROVADA' || p.status === 'EM_EXECUCAO');
  });
  protected readonly tecnicos = computed<TecnicoOpcao[]>(() =>
    this.usuarios()
      .filter((u) => u.perfil === 'TECNICO' && u.ativo !== false)
      .map((u) => ({ id: u.id, nome: u.nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  );

  /** Só o id: a proposta é reemitida a cada escrita, e a lista não precisa ser assinada de novo. */
  private readonly propostaId = computed(() => this.proposta().id);

  constructor() {
    effect((aoLimpar) => {
      this.lista.set(undefined);
      const assinatura = this.repo.observarDaProposta(this.propostaId()).subscribe((l) => this.lista.set(l));
      aoLimpar(() => assinatura.unsubscribe());
    });
  }

  protected abrir(gatilho: HTMLElement | null): void {
    this.gatilho.set(gatilho);
    this.dialogo.set(true);
  }

  protected async gerar(opcoes: OpcoesGerarOs): Promise<void> {
    if (this.gerando()) return;
    const propostaId = this.proposta().id;
    this.gerando.set(true);
    try {
      const id = await this.repo.gerarDaProposta(propostaId, opcoes);
      this.dialogo.set(false);
      this.toasts.mostrar('OS gerada.');
      // a tela trocou de proposta enquanto gravava: a OS foi gerada, mas a navegação não é mais desta tela
      if (this.proposta().id === propostaId) await this.router.navigate(['/os', id]);
    } catch (e) {
      // o diálogo fica aberto, com o que foi escolhido
      this.toasts.erro(mensagemErroOs(e));
    } finally {
      this.gerando.set(false);
    }
  }
}
