import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ClientesRepo } from '../clientes/clientes-repo';
import { osPorProposta, SeloOsProposta, selosOsDaProposta } from '../os/formatos-os';
import type { OsLocal } from '../os/os-models';
import { OsRepo } from '../os/os-repo';
import { TIPOS_PROPOSTA, TipoProposta } from '../templates/template-models';
import { correspondeABusca, Selo, selosDaProposta } from './formatos-proposta';
import { PropostaCard } from './proposta-card';
import { PropostaLocal, STATUS_PROPOSTA, StatusProposta } from './proposta-models';
import { hojeReativo } from './hoje-reativo';
import { EstadoSync, PropostasRepo } from './propostas-repo';

type FiltroStatus = 'TODAS' | StatusProposta;
type FiltroTipo = 'TODOS' | TipoProposta;

const ABERTAS: readonly StatusProposta[] = ['RASCUNHO', 'ENVIADA', 'APROVADA', 'EM_EXECUCAO', 'FINALIZADA'];
const ENCERRADAS: readonly StatusProposta[] = ['RECUSADA', 'CANCELADA'];
const encerrada = (s: StatusProposta) => ENCERRADAS.includes(s);

interface Linha {
  proposta: PropostaLocal;
  clienteNome: string;
  responsavelNome: string | null;
  selos: Selo[];
  /** M2-P3: os selos das OS da proposta (como no kanban). */
  selosOs: SeloOsProposta[];
}

/**
 * Lista de propostas (§13), do escritório: `observarTodas` (o comercial só recebe as dele no sync), busca, chips de
 * status, tipo e "Nova proposta". M2-P3: a rota é só de ADMIN e COMERCIAL (o técnico vê o trabalho pela OS).
 */
@Component({
  selector: 'app-propostas-page',
  imports: [RouterLink, PropostaCard],
  template: `
    <div class="mb-4 flex items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">Propostas</h1>
      <a routerLink="/propostas/nova" class="inline-flex min-h-12 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white">Nova proposta</a>
    </div>

    <!-- celular: busca e tipo empilhados; desktop (lg): na mesma linha, a busca ocupa o resto -->
    <div data-filtros class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center">
      <label for="busca-propostas" class="sr-only">Buscar propostas</label>
      <input id="busca-propostas" type="search" [value]="busca()" (input)="busca.set($any($event.target).value)"
             placeholder="Número, PROV, cliente ou CPF/CNPJ"
             class="h-12 w-full rounded-lg border border-slate-300 px-3 lg:w-auto lg:min-w-0 lg:flex-1" />

      <div class="flex items-center gap-2 lg:shrink-0">
        <label for="tipo-propostas" class="text-sm text-slate-600">Tipo</label>
        <select id="tipo-propostas" [value]="tipo()" (change)="tipo.set($any($event.target).value)"
                class="h-12 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 lg:w-56 lg:flex-none">
          <option value="TODOS">Todos os tipos</option>
          @for (t of tipos; track t.valor) {
            <option [value]="t.valor">{{ t.rotulo }}</option>
          }
        </select>
      </div>
    </div>

    <div class="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por status">
      @for (f of chips(); track f.valor) {
        <button type="button" (click)="status.set(f.valor)" [attr.aria-pressed]="status() === f.valor"
                class="min-h-12 rounded-full border px-4 py-1.5 text-sm"
                [class.border-blue-600]="status() === f.valor" [class.bg-blue-50]="status() === f.valor"
                [class.border-slate-300]="status() !== f.valor">{{ f.rotulo }}</button>
      }
    </div>
    <button type="button" (click)="alternarEncerradas()" [attr.aria-pressed]="mostrarEncerradas()"
            class="mb-3 inline-flex min-h-12 items-center gap-2 rounded-lg px-2 text-sm text-slate-700">
      <span class="inline-block size-4 rounded border" [class.bg-blue-600]="mostrarEncerradas()"
            [class.border-blue-600]="mostrarEncerradas()" [class.border-slate-400]="!mostrarEncerradas()" aria-hidden="true"></span>
      Mostrar encerradas
    </button>

    <p class="mb-2 text-sm text-slate-500" aria-live="polite">
      @if (!carregando()) {
        {{ linhas().length }} {{ linhas().length === 1 ? 'proposta' : 'propostas' }}
      }
    </p>

    @if (carregando()) {
      <p class="py-8 text-center text-slate-500">Carregando…</p>
    } @else if (propostas()!.length === 0) {
      <p class="py-8 text-center text-slate-500">Nenhuma proposta ainda. Crie a primeira em Nova proposta.</p>
    } @else if (linhas().length === 0) {
      <p class="py-8 text-center text-slate-500">
        Nenhuma proposta encontrada.
        @if (encerradasOcultas()) {
          <span class="block">As recusadas e canceladas estão ocultas.</span>
        }
      </p>
    } @else {
      <ul class="space-y-3">
        @for (l of linhas(); track l.proposta.id) {
          <li>
            <app-proposta-card [proposta]="l.proposta" [clienteNome]="l.clienteNome" [responsavelNome]="l.responsavelNome"
                               [mostrarValores]="true" [selos]="l.selos" [selosOs]="l.selosOs" />
          </li>
        }
      </ul>
    }
  `,
})
export class PropostasPage {
  private readonly repo = inject(PropostasRepo);

  protected readonly busca = signal('');
  protected readonly status = signal<FiltroStatus>('TODAS');
  protected readonly tipo = signal<FiltroTipo>('TODOS');
  protected readonly mostrarEncerradas = signal(false);
  protected readonly tipos = TIPOS_PROPOSTA;

  /** undefined até a primeira leitura do banco (sem isso a tela piscaria o estado vazio). */
  protected readonly propostas = toSignal<PropostaLocal[]>(this.repo.observarTodas());
  private readonly clientes = toSignal(inject(ClientesRepo).observarTodos());
  /** M2-P3: as OS que o perfil vê, pela proposta (os selos da OS nos cards). */
  private readonly osDasPropostas = toSignal(inject(OsRepo).observarTodas(), { initialValue: [] as OsLocal[] });
  private readonly osPorProposta = computed(() => osPorProposta(this.osDasPropostas()));
  private readonly usuarios = toSignal(this.repo.observarUsuarios(), { initialValue: [] });
  private readonly estado = toSignal(this.repo.observarEstadoSync(), {
    initialValue: { naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() } as EstadoSync,
  });
  /** Data civil de São Paulo (selo Expirada), refeita à meia-noite e quando a aba volta a ficar visível. */
  private readonly hoje = hojeReativo();

  protected readonly carregando = computed(() => this.propostas() === undefined || this.clientes() === undefined);

  protected readonly chips = computed(() => [
    { valor: 'TODAS' as FiltroStatus, rotulo: 'Todas' },
    ...(this.mostrarEncerradas() ? [...ABERTAS, ...ENCERRADAS] : ABERTAS).map((s) => ({ valor: s as FiltroStatus, rotulo: STATUS_PROPOSTA[s].rotulo })),
  ]);

  private readonly clientePorId = computed(() => new Map((this.clientes() ?? []).map((c) => [c.id, c])));
  private readonly nomeUsuario = computed(() => new Map(this.usuarios().map((u) => [u.id, u.nome])));

  /** Passam na busca e no tipo; o status (e as encerradas) é o último corte. */
  private readonly buscadas = computed(() => {
    const busca = this.busca();
    const tipo = this.tipo();
    const clientes = this.clientePorId();
    return (this.propostas() ?? []).filter(
      (p) => (tipo === 'TODOS' || p.tipo === tipo) && correspondeABusca(p, p.clienteId ? clientes.get(p.clienteId) : undefined, busca),
    );
  });

  protected readonly encerradasOcultas = computed(() => !this.mostrarEncerradas() && this.buscadas().some((p) => encerrada(p.status)));

  protected readonly linhas = computed<Linha[]>(() => {
    const status = this.status();
    const mostrarEncerradas = this.mostrarEncerradas();
    const clientes = this.clientePorId();
    const nomes = this.nomeUsuario();
    const { naOutbox, comPendencia } = this.estado();
    const oss = this.osPorProposta();
    return this.buscadas()
      .filter((p) => (status === 'TODAS' ? mostrarEncerradas || !encerrada(p.status) : p.status === status))
      .map((p) => ({
        proposta: p,
        clienteNome: p.clienteId ? (clientes.get(p.clienteId)?.nome ?? 'Cliente não encontrado') : 'Sem cliente',
        responsavelNome: nomes.get(p.responsavelId) ?? null,
        selos: selosDaProposta(p, { pendente: comPendencia.has(p.id), naoSincronizada: naOutbox.has(p.id), hoje: this.hoje() }),
        selosOs: selosOsDaProposta(p.status, oss.get(p.id) ?? []),
      }));
  });

  protected alternarEncerradas(): void {
    const mostrar = !this.mostrarEncerradas();
    this.mostrarEncerradas.set(mostrar);
    const s = this.status();
    if (!mostrar && s !== 'TODAS' && encerrada(s)) this.status.set('TODAS');
  }
}
