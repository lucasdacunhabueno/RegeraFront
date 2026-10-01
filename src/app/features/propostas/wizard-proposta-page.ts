import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { avisarAoSairDaPagina, ComAlteracoes } from '../../core/navegacao/alteracoes-guard';
import { PdfService } from '../../core/pdf/pdf-service';
import { Toasts } from '../../shared/ui/toasts';
import type { ItemLocal } from '../catalogo/item-models';
import { TIPOS_PROPOSTA, TipoProposta } from '../templates/template-models';
import { compartilharPdf } from './compartilhar';
import { Passo, ROTULO_PASSO } from './edicao-wizard';
import { mensagemErroProposta } from './formatos-proposta';
import { PassoCliente } from './passo-cliente';
import { PassoCondicoes } from './passo-condicoes';
import { PassoItens } from './passo-itens';
import { PassoRevisao } from './passo-revisao';
import { codigoExibido, ItemPropostaLocal, PropostaLocal } from './proposta-models';
import { ErroProposta, PropostasRepo } from './propostas-repo';
import { EdicaoWizard, EstadoWizard } from './wizard-estado';

/**
 * Como o wizard grava (P4c-R4): a rota escolhe o modo por `data.modo`. O `rascunho` (`/propostas/nova` e
 * `/propostas/:id/editar`) tem os 4 passos e grava pelo `PropostasRepo`; a Task 4 acrescenta a `correcao`
 * (`/propostas/:id/corrigir`, passos 1–3, gravando por `PendenciasService.corrigirProposta`).
 */
export interface ModoWizard {
  /** Os passos visíveis, em ordem. */
  passos: readonly Passo[];
  /** O texto do botão que grava e sai. */
  rotuloSalvar: string;
  /** null = a proposta pode ser aberta neste modo; senão, o toast (e a tela volta para o detalhe). */
  recusar(p: PropostaLocal): string | null;
  /** Grava a edição de um passo e devolve a proposta como ficou no aparelho. */
  salvar(injector: Injector, id: string, edicao: EdicaoWizard): Promise<PropostaLocal>;
  /** Acrescenta o item do catálogo e devolve a linha nova e a proposta como ficou. */
  adicionarItem(injector: Injector, id: string, item: ItemLocal): Promise<{ linha: ItemPropostaLocal; proposta: PropostaLocal }>;
}

async function recarregar(repo: PropostasRepo, id: string): Promise<PropostaLocal> {
  const p = await repo.buscar(id);
  if (!p) throw new ErroProposta('NAO_ENCONTRADA', 'proposta', 'Proposta não encontrada neste aparelho.');
  return p;
}

export const MODOS_WIZARD: Readonly<Record<string, ModoWizard>> = {
  rascunho: {
    passos: [1, 2, 3, 4],
    rotuloSalvar: 'Salvar rascunho',
    recusar: (p) => (p.status === 'RASCUNHO' ? null : 'Só rascunhos podem ser editados.'),
    async salvar(injector, id, edicao) {
      const repo = injector.get(PropostasRepo);
      const { responsavelId, ...resto } = edicao;
      // a versão: a que está no aparelho (o retorno do push da criação muda a local enquanto o wizard está aberto)
      if (Object.keys(resto).length > 0) await repo.salvarRascunho(id, resto);
      // o responsável não é campo do rascunho: só o ADMIN troca, por `atribuir` (P4b-R3)
      if (responsavelId !== undefined) await repo.atribuir(id, { responsavelId });
      return recarregar(repo, id);
    },
    async adicionarItem(injector, id, item) {
      const repo = injector.get(PropostasRepo);
      const linhaId = await repo.adicionarItem(id, item);
      const proposta = await recarregar(repo, id);
      const linha = proposta.itens.find((l) => l.id === linhaId);
      if (!linha) throw new ErroProposta('NAO_ENCONTRADA', 'itens', 'O item não foi incluído. Tente de novo.');
      return { linha, proposta };
    },
  },
};

const TIPOS = new Set<string>(TIPOS_PROPOSTA.map((t) => t.valor));
const tipoDaUrl = (v: string | undefined): TipoProposta | null => (v && TIPOS.has(v) ? (v as TipoProposta) : null);

const ENVIADA_SEM_NUMERO = 'Proposta enviada. O número chega quando sincronizar.';

/**
 * Wizard da proposta (§13), 4 passos: tipo e cliente, itens, condições e revisão. Em `/propostas/nova` o rascunho só é
 * criado ao sair do passo 1 com tipo e cliente (nada de lixo); a URL passa a `/propostas/:id/editar?passo=2` (recarregar
 * retoma). Cada "Continuar" valida e grava o passo; "Salvar rascunho" grava o que mudou e vai ao detalhe. `?passo=4`
 * abre direto na revisão (P4c-R5). Enviar gera o PDF oficial, compartilha e vai ao detalhe. Sair com alterações não
 * gravadas pede confirmação (P4a-R12).
 */
@Component({
  selector: 'app-wizard-proposta-page',
  imports: [RouterLink, PassoCliente, PassoItens, PassoCondicoes, PassoRevisao],
  providers: [EstadoWizard],
  template: `
    <a [routerLink]="e.id() ? ['/propostas', e.id()] : '/propostas'" class="text-sm text-blue-700">
      {{ e.id() ? '← Proposta' : '← Propostas' }}
    </a>
    <div class="mb-4 mt-2 flex flex-wrap items-baseline gap-x-3">
      <h1 class="text-xl font-semibold">{{ e.id() ? 'Editar proposta' : 'Nova proposta' }}</h1>
      @if (e.codigo(); as codigo) { <span class="font-mono text-sm text-slate-500">{{ codigo }}</span> }
    </div>

    <nav aria-label="Passos da proposta" class="mb-4">
      <p class="mb-2 text-sm text-slate-600">Passo {{ indice() + 1 }} de {{ passos().length }}: {{ rotulo(atual()) }}</p>
      <ol class="flex gap-1">
        @for (n of passos(); track n; let i = $index) {
          <li class="min-w-0 flex-1" [attr.aria-current]="n === atual() ? 'step' : null">
            <span class="block h-2 rounded-full" [class.bg-blue-600]="i <= indice()" [class.bg-slate-200]="i > indice()"></span>
            <span class="mt-1 hidden truncate text-xs sm:block" [class.font-semibold]="n === atual()">{{ rotulo(n) }}</span>
          </li>
        }
      </ol>
    </nav>

    <p role="status" aria-live="polite" class="sr-only">{{ anuncio() }}</p>

    @if (carregando()) {
      <p class="py-8 text-center text-slate-500">Carregando…</p>
    } @else {
      @switch (atual()) {
        @case (1) { <app-passo-cliente (cadastrar)="cadastrarCliente()" /> }
        @case (2) { <app-passo-itens [adicionando]="adicionando()" (adicionar)="adicionarItem($event)" (anunciar)="anuncio.set($event)" /> }
        @case (3) { <app-passo-condicoes /> }
        @case (4) { <app-passo-revisao (irPara)="irPara($event)" /> }
      }

      <div class="mt-4 space-y-3">
        <div class="flex gap-3">
          @if (indice() > 0) {
            <button type="button" (click)="voltar()" [disabled]="ocupado()"
                    class="h-12 flex-1 rounded-lg border border-slate-300 bg-white font-semibold disabled:opacity-60">Voltar</button>
          }
          @if (!ultimo()) {
            <button type="button" data-testid="continuar" (click)="continuar()" [disabled]="ocupado()"
                    class="h-12 flex-1 rounded-lg bg-blue-600 font-semibold text-white disabled:opacity-60">
              {{ salvando() ? 'Salvando…' : 'Continuar' }}
            </button>
          } @else if (atual() === 4) {
            <button type="button" data-testid="enviar" (click)="enviar()" [disabled]="ocupado()"
                    class="h-12 flex-1 rounded-lg bg-blue-600 font-semibold text-white disabled:opacity-60">
              {{ enviando() ? 'Gerando PDF…' : 'Enviar' }}
            </button>
          }
        </div>
        <button type="button" data-testid="salvar-rascunho" (click)="salvarRascunho()" [disabled]="ocupado()"
                class="h-12 w-full rounded-lg border border-blue-600 bg-white font-semibold text-blue-700 disabled:opacity-60">
          {{ config().rotuloSalvar }}
        </button>
      </div>
    }
  `,
})
export class WizardPropostaPage implements ComAlteracoes {
  /** `:id` da rota; ausente em `/propostas/nova`. */
  readonly id = input<string>();
  /** `?passo=` (P4c-R5: `4` abre na revisão). */
  readonly passo = input<string>();
  /** `?tipo=` e `?clienteId=`: a volta do "Cadastrar cliente", ainda não gravados. */
  readonly tipo = input<string>();
  readonly clienteId = input<string>();
  /** `data.modo` da rota (P4c-R4). */
  readonly modo = input<string>();

  protected readonly e = inject(EstadoWizard);
  private readonly repo = inject(PropostasRepo);
  private readonly pdf = inject(PdfService);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly online = inject(ConectividadeService).online;
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly passoItens = viewChild(PassoItens);
  private readonly passoRevisao = viewChild(PassoRevisao);

  protected readonly config = computed(() => MODOS_WIZARD[this.modo() ?? 'rascunho'] ?? MODOS_WIZARD['rascunho']);
  protected readonly passos = computed(() => this.config().passos);
  protected readonly atual = signal<Passo>(1);
  protected readonly indice = computed(() => Math.max(0, this.passos().indexOf(this.atual())));
  protected readonly ultimo = computed(() => this.indice() === this.passos().length - 1);
  protected readonly rotulo = (n: Passo) => ROTULO_PASSO[n];

  protected readonly carregando = signal(true);
  protected readonly salvando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly adicionando = signal(false);
  protected readonly ocupado = computed(() => this.salvando() || this.enviando() || this.adicionando());
  protected readonly anuncio = signal('');

  /** Depois de gravar e sair (ou de recusar a abertura), sair não pergunta nada. */
  private readonly liberado = signal(false);
  /** "Cadastrar cliente" leva o passo 1 na URL de volta: só os outros passos contam como não salvos. */
  private saindoParaCliente = false;
  private readonly alterado = computed(
    () => !this.liberado() && !this.carregando() && ([1, 2, 3] as const).some((n) => this.e.sujo(n)),
  );

  constructor() {
    avisarAoSairDaPagina(this.alterado);
    effect(() => {
      const id = this.id();
      untracked(() => void this.iniciar(id));
    });
  }

  temAlteracoes(): boolean {
    if (this.liberado() || this.carregando()) return false;
    const passos = this.saindoParaCliente ? ([2, 3] as const) : ([1, 2, 3] as const);
    this.saindoParaCliente = false;
    return passos.some((n) => this.e.sujo(n));
  }

  // ---- navegação entre passos ----

  protected async continuar(): Promise<void> {
    if (this.ocupado()) return;
    const n = this.atual();
    if (!this.validar(n, true)) return;
    if (!this.e.id()) {
      await this.criar(false);
      return;
    }
    if (await this.gravar(n)) this.ir(this.passos()[this.indice() + 1]);
  }

  protected voltar(): void {
    if (this.ocupado() || this.indice() === 0) return;
    this.ir(this.passos()[this.indice() - 1]);
  }

  /** "Corrigir" na revisão: volta ao passo (nada a gravar no caminho, a revisão só mostra o gravado). */
  protected irPara(n: Passo): void {
    if (!this.ocupado() && this.passos().includes(n)) this.ir(n);
  }

  /** "Salvar rascunho": grava os passos alterados (sem exigir o que só o avanço exige) e vai ao detalhe. */
  protected async salvarRascunho(): Promise<void> {
    if (this.ocupado()) return;
    if (!this.e.id()) {
      if (this.validar(1, true)) await this.criar(true);
      return;
    }
    if (!(await this.gravarAlterados())) return;
    this.liberado.set(true);
    this.toasts.mostrar('Rascunho salvo.');
    await this.router.navigate(['/propostas', this.e.id()]);
  }

  protected cadastrarCliente(): void {
    const id = this.e.id();
    const params = new URLSearchParams({ ...(id ? { passo: '1' } : {}), tipo: this.e.tipo() });
    const cliente = this.e.clienteId();
    if (cliente) params.set('clienteId', cliente);
    const voltar = `${id ? `/propostas/${id}/editar` : '/propostas/nova'}?${params}`;
    this.saindoParaCliente = true;
    void this.router.navigate(['/clientes/novo'], { queryParams: { voltar } }).finally(() => (this.saindoParaCliente = false));
  }

  // ---- itens ----

  protected async adicionarItem(item: ItemLocal): Promise<void> {
    const id = this.e.id();
    if (!id || this.ocupado()) return;
    this.adicionando.set(true);
    try {
      const { linha, proposta } = await this.config().adicionarItem(this.injector, id, item);
      this.e.anexarLinha(linha, proposta);
      this.anuncio.set(`${linha.nome ?? 'Item'} adicionado.`);
      this.passoItens()?.focarLinha(linha.id);
    } catch (err) {
      this.toasts.erro(mensagemErroProposta(err));
    } finally {
      this.adicionando.set(false);
    }
  }

  // ---- envio ----

  /**
   * Enviar (§9.3): exige item, cliente e template; `repo.enviar` gera o PDF oficial (PROV offline) e grava tudo no
   * aparelho; depois o compartilhamento (ou o download) e o detalhe.
   */
  protected async enviar(): Promise<void> {
    const id = this.e.id();
    if (!id || this.ocupado()) return;
    if (this.e.faltasParaEnviar().length > 0) {
      this.passoRevisao()?.mostrarFaltas.set(true);
      this.anuncio.set('Ainda falta preencher o que a proposta precisa para ser enviada.');
      return;
    }
    if (!(await this.gravarAlterados())) return;
    this.enviando.set(true);
    try {
      const blob = await this.repo.enviar(id, (entrada) => this.pdf.gerarBlob(entrada));
      this.liberado.set(true);
      const p = await this.repo.buscar(id);
      await compartilharPdf(blob, `Proposta-${p ? codigoExibido(p) : (this.e.codigo() ?? id)}.pdf`);
      this.toasts.mostrar(!this.online() || !p || p.numero === null ? ENVIADA_SEM_NUMERO : 'Proposta enviada.');
      await this.router.navigate(['/propostas', id]);
    } catch (err) {
      if (err instanceof ErroProposta && err.codigo === 'PROPOSTA_JA_ENVIADA') {
        this.liberado.set(true);
        this.toasts.erro(mensagemErroProposta(err));
        await this.router.navigate(['/propostas', id]);
        return;
      }
      this.falhou(err);
    } finally {
      this.enviando.set(false);
    }
  }

  // ---- internos ----

  private async iniciar(id: string | undefined): Promise<void> {
    this.carregando.set(true);
    this.liberado.set(false);
    this.e.tentou.set(new Set());
    this.e.errosServidor.set({});
    if (!id) {
      this.e.iniciarNovo(tipoDaUrl(this.tipo()), this.clienteId() || null);
      this.atual.set(this.passos()[0]);
      this.carregando.set(false);
      return;
    }
    let p: PropostaLocal | undefined;
    try {
      p = await this.repo.buscar(id);
    } catch {
      if (this.id() !== id) return;
      this.liberado.set(true);
      this.toasts.erro('Não foi possível carregar a proposta.');
      await this.router.navigate(['/propostas'], { replaceUrl: true });
      return;
    }
    // o id mudou durante a leitura: a carga do id novo é que preenche a tela
    if (this.id() !== id) return;
    const recusa = p ? this.config().recusar(p) : 'Proposta não encontrada neste aparelho.';
    if (!p || recusa) {
      this.liberado.set(true);
      this.toasts.erro(recusa!);
      await this.router.navigate(p ? ['/propostas', id] : ['/propostas'], { replaceUrl: true });
      return;
    }
    this.e.carregar(p);
    // a volta do "Cadastrar cliente" traz o passo 1 que ainda não foi gravado
    const tipo = tipoDaUrl(this.tipo());
    if (tipo) this.e.tipo.set(tipo);
    if (this.clienteId()) this.e.clienteId.set(this.clienteId()!);
    const pedido = Number(this.passo()) as Passo;
    this.atual.set(this.passos().includes(pedido) ? pedido : this.passos()[0]);
    this.preparar(this.atual());
    this.carregando.set(false);
  }

  /** Cria o rascunho com o passo 1 (só aqui: sair do passo 1 com tipo e cliente). */
  private async criar(eSair: boolean): Promise<void> {
    this.salvando.set(true);
    try {
      const id = await this.repo.criar(this.e.tipo(), this.e.clienteId());
      this.liberado.set(true);
      if (eSair) {
        this.toasts.mostrar('Rascunho salvo.');
        await this.router.navigate(['/propostas', id]);
      } else {
        // recarregar a página retoma do passo 2
        await this.router.navigate(['/propostas', id, 'editar'], { queryParams: { passo: 2 }, replaceUrl: true });
      }
    } catch (err) {
      this.falhou(err);
    } finally {
      this.salvando.set(false);
    }
  }

  /** Grava o passo `n` se ele mudou; false se a gravação foi recusada (os erros ficam nos campos). */
  private async gravar(n: Passo): Promise<boolean> {
    const id = this.e.id();
    if (!id || !this.e.sujo(n)) return true;
    this.salvando.set(true);
    try {
      const edicao = this.e.edicaoDoPasso(n, await this.repo.buscar(id));
      if (!edicao) return false;
      this.e.errosServidor.set({});
      const p = await this.config().salvar(this.injector, id, edicao);
      this.e.aposSalvar(n, p);
      return true;
    } catch (err) {
      this.falhou(err);
      return false;
    } finally {
      this.salvando.set(false);
    }
  }

  /** Grava, em ordem, os passos com alteração; no primeiro com erro, vai até ele e para. */
  private async gravarAlterados(): Promise<boolean> {
    for (const n of this.passos()) {
      if (!this.e.sujo(n)) continue;
      if (!this.validar(n, false) || !(await this.gravar(n))) return false;
    }
    return true;
  }

  /**
   * Valida o passo `n`; `paraAvancar` exige também o que o avanço pede (cliente, ≥ 1 item, template). Com erro, vai ao
   * passo e foca o primeiro campo com erro.
   */
  private validar(n: Passo, paraAvancar: boolean): boolean {
    if (paraAvancar) this.e.marcarTentativa(n);
    if (this.e.valido(n, paraAvancar)) return true;
    if (this.atual() !== n) this.ir(n, false);
    this.anuncio.set('Corrija os campos destacados.');
    this.focar('[aria-invalid="true"], [role="alert"]');
    return false;
  }

  /** Recusa do repositório: os erros vão para os campos (e para o passo deles) e a mensagem para o toast. */
  private falhou(err: unknown): void {
    const passo = this.e.registrarErro(err);
    this.toasts.erro(mensagemErroProposta(err));
    if (passo !== null && passo !== this.atual() && this.passos().includes(passo)) this.ir(passo, false);
  }

  private ir(n: Passo, focarTitulo = true): void {
    this.atual.set(n);
    this.preparar(n);
    const i = this.passos().indexOf(n);
    this.anuncio.set(`Passo ${i + 1} de ${this.passos().length}: ${ROTULO_PASSO[n]}.`);
    if (focarTitulo) this.focar('#titulo-passo');
  }

  /** Ao chegar nas condições sem template: o padrão do tipo já vem escolhido (o usuário vê e grava no Continuar). */
  private preparar(n: Passo): void {
    if (n !== 3 || this.e.templateId()) return;
    const padrao = this.e.padroes().get(this.e.tipo());
    if (padrao) this.e.templateId.set(padrao);
  }

  private focar(seletor: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(seletor)?.focus(), { injector: this.injector });
  }
}
