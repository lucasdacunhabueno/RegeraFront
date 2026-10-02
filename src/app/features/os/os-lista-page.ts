import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth-service';
import { ClientesRepo } from '../clientes/clientes-repo';
import { hojeReativo } from '../propostas/hoje-reativo';
import { PropostasRepo } from '../propostas/propostas-repo';
import { concluidaRecente, correspondeABuscaOs, osEncerrada, SeloOs, selosDaOs } from './formatos-os';
import { OsCard } from './os-card';
import { OsLocal, rotuloTipoOs, STATUS_OS, StatusOs, TIPOS_OS, TipoOs } from './os-models';
import { EstadoSync, ordenarParaTecnico, OsRepo } from './os-repo';

type FiltroStatus = 'TODAS' | StatusOs;
type FiltroTipo = 'TODOS' | TipoOs;
/** 'TODOS', 'SEM' (sem técnico atribuído) ou o id do técnico. */
type FiltroTecnico = string;

/** Os chips do escritório sem "Mostrar encerradas": a Concluída fica (as dos últimos 7 dias, M2P3-R6). */
const CHIPS_PADRAO: readonly StatusOs[] = ['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA'];
const CHIPS_TODOS: readonly StatusOs[] = ['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'];

interface Linha {
  os: OsLocal;
  clienteNome: string;
  tecnicoNome: string | null;
  selos: SeloOs[];
}

const instante = (o: OsLocal) => (o.atualizadoEm ? Date.parse(o.atualizadoEm) : Number.NEGATIVE_INFINITY);

/**
 * Lista de OS (`/os`, spec M2 §9).
 * - TECNICO: "Minhas OS" (`observarDoTecnico`), na ordem do `ordenarParaTecnico` (data prevista, urgentes primeiro no
 *   mesmo dia; a urgente sem data conta como de hoje, M2P3-R8, e a normal sem data vai para o fim). As encerradas ficam ocultas até "Mostrar encerradas" e então vêm depois das abertas,
 *   as mais recentes primeiro: as concluídas, de datas passadas, não empurram o trabalho do dia para baixo.
 * - ADMIN e COMERCIAL: `observarTodas` (o repositório já filtra o que o perfil vê), busca, chips de status, tipo, o
 *   técnico (só o ADMIN) e "Nova OS avulsa". M2P3-R6 (Q15): as concluídas dos últimos 7 dias aparecem por padrão, com
 *   o status "Concluída"; as mais antigas e as canceladas, só com "Mostrar encerradas".
 * Qualquer perfil fora de ADMIN e COMERCIAL cai na visão do técnico. A OS não tem valores, e nenhuma linha leva o
 * CPF/CNPJ: o card recebe só o nome do cliente.
 */
@Component({
  selector: 'app-os-lista-page',
  imports: [RouterLink, OsCard],
  template: `
    <div class="mb-4 flex items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">{{ restrito() ? 'Minhas OS' : 'Ordens de serviço' }}</h1>
      @if (!restrito()) {
        <a routerLink="/os/nova" class="inline-flex min-h-12 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white">Nova OS avulsa</a>
      }
    </div>

    @if (!restrito()) {
      <!-- celular: busca e selects empilhados; desktop (lg): na mesma linha, a busca ocupa o resto -->
      <div data-filtros class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label for="busca-os" class="sr-only">Buscar OS</label>
        <input id="busca-os" type="search" [value]="busca()" (input)="busca.set($any($event.target).value)"
               placeholder="Código da OS ou da proposta, cliente ou CPF/CNPJ"
               class="h-12 w-full rounded-lg border border-slate-300 px-3 lg:w-auto lg:min-w-0 lg:flex-1" />

        <div class="flex items-center gap-2 lg:shrink-0">
          <label for="tipo-os" class="text-sm text-slate-600">Tipo</label>
          <select id="tipo-os" [value]="tipo()" (change)="tipo.set($any($event.target).value)"
                  class="h-12 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 lg:w-56 lg:flex-none">
            <option value="TODOS">Todos os tipos</option>
            @for (t of tipos; track t.valor) {
              <option [value]="t.valor">{{ t.rotulo }}</option>
            }
          </select>
        </div>

        @if (admin()) {
          <div class="flex items-center gap-2 lg:shrink-0">
            <label for="tecnico-os" class="text-sm text-slate-600">Técnico</label>
            <select id="tecnico-os" [value]="tecnico()" (change)="tecnico.set($any($event.target).value)"
                    class="h-12 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 lg:w-56 lg:flex-none">
              <option value="TODOS">Todos os técnicos</option>
              <option value="SEM">Sem técnico</option>
              @for (t of tecnicos(); track t.id) {
                <option [value]="t.id">{{ t.rotulo }}</option>
              }
            </select>
          </div>
        }
      </div>

      <div class="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por status">
        @for (f of chips(); track f.valor) {
          <button type="button" (click)="status.set(f.valor)" [attr.aria-pressed]="status() === f.valor"
                  class="min-h-12 rounded-full border px-4 py-1.5 text-sm"
                  [class.border-blue-600]="status() === f.valor" [class.bg-blue-50]="status() === f.valor"
                  [class.border-slate-300]="status() !== f.valor">{{ f.rotulo }}</button>
        }
      </div>
    }

    <button type="button" (click)="alternarEncerradas()" [attr.aria-pressed]="mostrarEncerradas()"
            class="mb-3 inline-flex min-h-12 items-center gap-2 rounded-lg px-2 text-sm text-slate-700">
      <span class="inline-block size-4 rounded border" [class.bg-blue-600]="mostrarEncerradas()"
            [class.border-blue-600]="mostrarEncerradas()" [class.border-slate-400]="!mostrarEncerradas()" aria-hidden="true"></span>
      Mostrar encerradas
    </button>

    <p class="mb-2 text-sm text-slate-500" aria-live="polite">
      @if (!carregando()) {
        {{ linhas().length }} OS
      }
    </p>

    @if (carregando()) {
      <p class="py-8 text-center text-slate-500">Carregando…</p>
    } @else if (lista()!.length === 0) {
      <p class="py-8 text-center text-slate-500">{{ restrito() ? 'Nenhuma OS atribuída a você.' : 'Nenhuma OS ainda.' }}</p>
    } @else if (linhas().length === 0) {
      <p class="py-8 text-center text-slate-500">
        {{ restrito() ? 'Nenhuma OS em aberto.' : 'Nenhuma OS encontrada.' }}
        @if (encerradasOcultas()) {
          <span class="block">{{ restrito() ? 'As concluídas e canceladas estão ocultas.' : 'As canceladas e as concluídas há mais de 7 dias estão ocultas.' }}</span>
        }
      </p>
    } @else {
      <ul class="space-y-3">
        @for (l of linhas(); track l.os.id) {
          <li>
            <app-os-card [os]="l.os" [clienteNome]="l.clienteNome" [tecnicoNome]="l.tecnicoNome" [mostrarTecnico]="!restrito()"
                         [selos]="l.selos" />
          </li>
        }
      </ul>
    }
  `,
})
export class OsListaPage {
  private readonly repo = inject(OsRepo);
  private readonly usuario = inject(AuthService).usuario;
  /** A visão do técnico: só as dele, sem filtros do escritório (também sem sessão ou com perfil desconhecido). */
  protected readonly restrito = computed(() => {
    const perfil = this.usuario()?.perfil;
    return perfil !== 'ADMIN' && perfil !== 'COMERCIAL';
  });
  protected readonly admin = computed(() => this.usuario()?.perfil === 'ADMIN');

  protected readonly busca = signal('');
  protected readonly status = signal<FiltroStatus>('TODAS');
  protected readonly tipo = signal<FiltroTipo>('TODOS');
  protected readonly tecnico = signal<FiltroTecnico>('TODOS');
  protected readonly mostrarEncerradas = signal(false);
  protected readonly tipos = TIPOS_OS.map((t) => ({ valor: t, rotulo: rotuloTipoOs(t) }));

  /** undefined até a primeira leitura do banco (sem isso a tela piscaria o estado vazio); preenchido pelo effect. */
  protected readonly lista = signal<OsLocal[] | undefined>(undefined);
  private readonly clientes = toSignal(inject(ClientesRepo).observarTodos());
  private readonly propostasRepo = inject(PropostasRepo);
  private readonly usuarios = toSignal(this.propostasRepo.observarUsuarios(), { initialValue: [] });
  /** M7: as propostas canceladas do aparelho, só para o ADMIN (o único que aceita o trabalho, M2-R4). */
  private readonly propostasCanceladas = signal<ReadonlySet<string>>(new Set());
  private readonly estado = toSignal(this.repo.observarEstadoSync(), {
    initialValue: { naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() } as EstadoSync,
  });
  /** Data civil de São Paulo (selo Atrasada), refeita à meia-noite e quando a aba volta a ficar visível. */
  private readonly hoje = hojeReativo();

  protected readonly carregando = computed(() => this.lista() === undefined || this.clientes() === undefined);

  protected readonly chips = computed(() => [
    { valor: 'TODAS' as FiltroStatus, rotulo: 'Todas' },
    ...(this.mostrarEncerradas() ? CHIPS_TODOS : CHIPS_PADRAO).map((s) => ({ valor: s as FiltroStatus, rotulo: STATUS_OS[s].rotulo })),
  ]);

  private readonly clientePorId = computed(() => new Map((this.clientes() ?? []).map((c) => [c.id, c])));
  private readonly nomeUsuario = computed(() => new Map(this.usuarios().map((u) => [u.id, u.nome])));

  /** O filtro de técnico do ADMIN: os técnicos e quem tem OS atribuída, por nome; o inativo vai marcado. */
  protected readonly tecnicos = computed(() => {
    const atribuidos = new Set((this.lista() ?? []).map((o) => o.tecnicoId));
    return this.usuarios()
      .filter((u) => u.perfil === 'TECNICO' || atribuidos.has(u.id))
      .map((u) => ({ id: u.id, rotulo: u.ativo === false ? `${u.nome} (inativo)` : u.nome }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  });

  /** Passam na busca, no tipo e no técnico (só o escritório filtra); o status (e as encerradas) é o último corte. */
  private readonly buscadas = computed(() => {
    const lista = this.lista() ?? [];
    if (this.restrito()) return lista;
    const busca = this.busca();
    const tipo = this.tipo();
    const tecnico = this.admin() ? this.tecnico() : 'TODOS';
    const clientes = this.clientePorId();
    return lista.filter(
      (o) =>
        (tipo === 'TODOS' || o.tipo === tipo) &&
        (tecnico === 'TODOS' || (tecnico === 'SEM' ? o.tecnicoId === null : o.tecnicoId === tecnico)) &&
        correspondeABuscaOs(o, o.clienteId ? clientes.get(o.clienteId) : undefined, busca),
    );
  });

  /**
   * Sem "Mostrar encerradas", a OS fica de fora quando está encerrada; no escritório, menos a concluída dos últimos 7
   * dias (M2P3-R6). O técnico não vê nenhuma encerrada por padrão.
   */
  private readonly oculta = computed(() => {
    if (this.mostrarEncerradas()) return () => false;
    const restrito = this.restrito();
    const hoje = this.hoje();
    return (o: OsLocal) => osEncerrada(o.status) && (restrito || !concluidaRecente(o, hoje));
  });

  protected readonly encerradasOcultas = computed(() => {
    const oculta = this.oculta();
    return this.buscadas().some(oculta);
  });

  /** Na ordem final: a do técnico (abertas pelo `ordenarParaTecnico`, depois as encerradas) ou a do repositório. */
  private readonly visiveis = computed(() => {
    const oculta = this.oculta();
    const buscadas = this.buscadas();
    if (this.restrito()) {
      const abertas = ordenarParaTecnico(buscadas.filter((o) => !osEncerrada(o.status)), this.hoje());
      const encerradas = buscadas.filter((o) => osEncerrada(o.status) && !oculta(o)).sort((a, b) => instante(b) - instante(a));
      return [...abertas, ...encerradas];
    }
    const status = this.status();
    return buscadas.filter((o) => (status === 'TODAS' || o.status === status) && !oculta(o));
  });

  protected readonly linhas = computed<Linha[]>(() => {
    const clientes = this.clientePorId();
    const nomes = this.nomeUsuario();
    const restrito = this.restrito();
    const hoje = this.hoje();
    const { naOutbox } = this.estado();
    const canceladas = this.propostasCanceladas();
    return this.visiveis().map((o) => ({
      os: o,
      clienteNome: o.clienteId ? (clientes.get(o.clienteId)?.nome ?? 'Cliente não encontrado') : 'Sem cliente',
      // null = sem técnico; o atribuído que não está nos usuários do aparelho não vira "Sem técnico"
      tecnicoNome: restrito || !o.tecnicoId ? null : (nomes.get(o.tecnicoId) ?? 'não identificado'),
      selos: selosDaOs(o, {
        naoSincronizada: naOutbox.has(o.id), hoje, propostaCancelada: o.propostaId !== null && canceladas.has(o.propostaId),
      }),
    }));
  });

  constructor() {
    // O técnico (ou a visão restrita) lê só as atribuídas a ele; a fonte troca se o usuário mudar (como em propostas).
    const quem = computed(() => (this.restrito() ? `tecnico:${this.usuario()?.id ?? ''}` : 'todas'));
    effect((aoLimpar) => {
      const q = quem();
      this.lista.set(undefined);
      const fonte = q === 'todas' ? this.repo.observarTodas() : this.repo.observarDoTecnico(q.slice('tecnico:'.length));
      const assinatura = fonte.subscribe((lista) => this.lista.set(lista));
      aoLimpar(() => assinatura.unsubscribe());
    });
    effect((aoLimpar) => {
      this.propostasCanceladas.set(new Set());
      if (!this.admin()) return;
      const assinatura = this.propostasRepo.observarTodas().subscribe((ps) =>
        this.propostasCanceladas.set(new Set(ps.filter((p) => p.status === 'CANCELADA').map((p) => p.id))));
      aoLimpar(() => assinatura.unsubscribe());
    });
  }

  protected alternarEncerradas(): void {
    const mostrar = !this.mostrarEncerradas();
    this.mostrarEncerradas.set(mostrar);
    const s = this.status();
    // a Concluída continua entre os chips (as recentes); a Cancelada some
    if (!mostrar && s === 'CANCELADA') this.status.set('TODAS');
  }
}
