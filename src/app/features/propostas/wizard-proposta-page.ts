import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { avisarAoSairDaPagina, ComAlteracoes } from '../../core/navegacao/alteracoes-guard';
import { PdfService } from '../../core/pdf/pdf-service';
import { Toasts } from '../../shared/ui/toasts';
import type { ItemLocal } from '../catalogo/item-models';
import { TIPOS_PROPOSTA, TipoProposta } from '../templates/template-models';
import { arquivoPdf, compartilharArquivo, ResultadoCompartilhar } from './compartilhar';
import { Passo, ROTULO_PASSO } from './edicao-wizard';
import { mensagemErroProposta } from './formatos-proposta';
import { PassoCliente } from './passo-cliente';
import { PassoCondicoes } from './passo-condicoes';
import { PassoItens } from './passo-itens';
import { PassoRevisao } from './passo-revisao';
import { PdfPronto } from './pdf-pronto';
import { codigoExibido, ItemPropostaLocal, podeEditar, PropostaLocal } from './proposta-models';
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
  /**
   * Grava a edição de um passo e devolve a proposta como ficou no aparelho. `versao.base`: a versão que a tela
   * representa (P4c-R7), a base para o servidor detectar a edição de outro aparelho; `versao.manter`: depois de
   * "Manter as minhas", toda escrita leva essa base (P4c-R9), inclusive a da atribuição.
   */
  salvar(injector: Injector, id: string, edicao: EdicaoWizard, versao: { base: number | null; manter: boolean }): Promise<PropostaLocal>;
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
    recusar: (p) => (podeEditar(p.status) ? null : 'Só rascunhos podem ser editados.'),
    async salvar(injector, id, edicao, versao) {
      const repo = injector.get(PropostasRepo);
      const { responsavelId, ...resto } = edicao;
      if (Object.keys(resto).length > 0) await repo.salvarRascunho(id, resto, versao.base);
      // o responsável não é campo do rascunho: só o ADMIN troca, por `atribuir` (P4b-R3); fora do "Manter", com a
      // versão da cópia local (o ack da edição acima pode ter chegado no meio)
      if (responsavelId !== undefined) {
        if (versao.manter) await repo.atribuir(id, { responsavelId }, versao.base);
        else await repo.atribuir(id, { responsavelId });
      }
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
 * gravadas pede confirmação (P4a-R12). A proposta é observada ao vivo (P4c-R7): a edição de outro aparelho recarrega
 * os passos limpos e, num passo com alteração daqui, mostra a faixa de colisão.
 */
@Component({
  selector: 'app-wizard-proposta-page',
  imports: [RouterLink, PassoCliente, PassoItens, PassoCondicoes, PassoRevisao, PdfPronto],
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
      <p class="mb-2 text-sm text-slate-600" aria-hidden="true">Passo {{ indice() + 1 }} de {{ passos().length }}: {{ rotulo(atual()) }}</p>
      <ol class="flex gap-1">
        @for (n of passos(); track n; let i = $index) {
          <li class="min-w-0 flex-1" [attr.aria-current]="n === atual() ? 'step' : null">
            <span class="block h-2 rounded-full" aria-hidden="true" [class.bg-blue-600]="i <= indice()" [class.bg-slate-200]="i > indice()"></span>
            <!-- no celular só para o leitor de tela; do sm para cima, visível -->
            <span class="sr-only sm:not-sr-only sm:mt-1 sm:block sm:truncate sm:text-xs" [class.font-semibold]="n === atual()">{{ rotulo(n) }}</span>
          </li>
        }
      </ol>
    </nav>

    <p role="status" aria-live="polite" class="sr-only">{{ anuncio() }}</p>

    @if (e.colisao().size > 0) {
      <div id="aviso-colisao" role="alert" tabindex="-1" aria-labelledby="aviso-colisao-titulo"
           class="mb-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 outline-none">
        <p id="aviso-colisao-titulo" class="font-semibold">Esta proposta foi alterada em outro aparelho.</p>
        <p class="text-sm">
          {{ passosEmColisao() }}: "Recarregar" traz o que foi gravado lá; "Manter as minhas" grava as suas, e a
          diferença vai para Pendências.
        </p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <button type="button" (click)="recarregarColisoes()"
                  class="h-12 flex-1 rounded-lg bg-amber-700 px-4 font-semibold text-white">Recarregar</button>
          <button type="button" (click)="manterMinhas()"
                  class="h-12 flex-1 rounded-lg border border-amber-700 px-4 font-semibold text-amber-900">Manter as minhas</button>
        </div>
      </div>
    }

    @if (carregando()) {
      <p class="py-8 text-center text-slate-500">Carregando…</p>
    } @else {
      <!-- com a folha "PDF pronto" fixa no rodapé do celular, o fim da revisão continua alcançável (N-2) -->
      <!-- [class.x] e não [class]="…": o classMap leva ~2 kB do core para o bundle inicial -->
      <div data-testid="pagina-wizard" class="block sm:pb-0" [class.pb-72]="!!pdfPronto()">
      @switch (atual()) {
        @case (1) { <app-passo-cliente (cadastrar)="cadastrarCliente()" /> }
        @case (2) { <app-passo-itens [adicionando]="adicionando()" (adicionar)="adicionarItem($event)" (anunciar)="anuncio.set($event)" /> }
        @case (3) { <app-passo-condicoes /> }
        @case (4) { <app-passo-revisao (irPara)="irPara($event)" /> }
      }

      @if (pdfPronto(); as arquivo) {
        <div data-testid="folha-pdf-pronto"
             class="fixed inset-x-0 bottom-0 z-40 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:static sm:mt-4 sm:p-0">
          <app-pdf-pronto [arquivo]="arquivo" (concluido)="aposCompartilhar($event, arquivo)" />
        </div>
      } @else {
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
  private readonly rota = inject(ActivatedRoute);
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
  protected readonly passosEmColisao = computed(() => [...this.e.colisao()].sort().map((n) => ROTULO_PASSO[n]).join(', '));

  protected readonly carregando = signal(true);
  protected readonly salvando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly adicionando = signal(false);
  protected readonly ocupado = computed(() => this.salvando() || this.enviando() || this.adicionando());
  protected readonly anuncio = signal('');
  /** P4c-R8: o PDF enviado esperando um toque para o compartilhamento (o navegador recusou sem gesto). */
  protected readonly pdfPronto = signal<File | null>(null);

  /** Depois de gravar e sair (ou de recusar a abertura), sair não pergunta nada. */
  private readonly liberado = signal(false);
  /** "Cadastrar cliente" leva o passo 1 na URL de volta: só os outros passos contam como não salvos. */
  private saindoParaCliente = false;
  private readonly alterado = computed(
    () => !this.liberado() && !this.carregando() && ([1, 2, 3] as const).some((n) => this.e.sujo(n)),
  );

  /** A observação ao vivo da proposta (P4c-R7). */
  private observacao?: Subscription;
  /** Gravações desta tela em andamento: as reemissões no meio delas esperam (a gravação relê no fim). */
  private gravando = 0;
  private reemitiuGravando = false;

  constructor() {
    avisarAoSairDaPagina(this.alterado);
    effect(() => {
      const id = this.id();
      untracked(() => void this.iniciar(id));
    });
    inject(DestroyRef).onDestroy(() => this.observacao?.unsubscribe());
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
    const trocaAntes = this.e.trocaDeTipo()?.seq;
    if (!(await this.gravar(n))) return;
    const troca = this.e.trocaDeTipo();
    let extra = '';
    if (troca && troca.seq !== trocaAntes) {
      extra = troca.templateId
        ? ' O template passou a ser o padrão do novo tipo.'
        : ' O novo tipo não tem template padrão: escolha um nas condições.';
    }
    this.ir(this.passos()[this.indice() + 1], true, extra);
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

  // ---- colisão (P4c-R7) ----

  protected recarregarColisoes(): void {
    this.e.recarregarColisoes();
    this.anuncio.set('Os passos foram recarregados com o que foi gravado no outro aparelho.');
  }

  /**
   * P4c-R9: grava na hora os passos em colisão, com a versão base antiga (a mutação dela fica primeira na fila e o
   * servidor responde CONFLITO, resolvido em Pendências). Com erro num desses passos, nada muda: a faixa fica e o
   * foco vai ao campo.
   */
  protected async manterMinhas(): Promise<void> {
    if (this.ocupado()) return;
    const invalido = [...this.e.colisao()].sort().find((n) => !this.e.valido(n, false));
    if (invalido !== undefined) {
      if (this.atual() !== invalido) this.ir(invalido, false);
      this.anuncio.set('Corrija os campos destacados para manter as suas alterações.');
      this.focarPrimeiroErro();
      return;
    }
    for (const n of this.e.manterMinhas()) {
      if (!(await this.gravar(n))) return;
    }
    this.anuncio.set('Suas alterações foram gravadas; a diferença vai para Pendências.');
  }

  // ---- itens ----

  protected async adicionarItem(item: ItemLocal): Promise<void> {
    const id = this.e.id();
    if (!id || this.ocupado()) return;
    if (this.e.colisao().size > 0) {
      this.focar('#aviso-colisao');
      return;
    }
    this.adicionando.set(true);
    this.gravando++;
    try {
      // P4c-R9: relê e reconcilia antes (uma edição de lá que a observação ainda não trouxe vira colisão aqui)
      const atual = await this.repo.buscar(id);
      if (atual) this.e.reconciliar(atual);
      if (this.e.colisao().size > 0) {
        this.focar('#aviso-colisao');
        return;
      }
      const { linha, proposta } = await this.config().adicionarItem(this.injector, id, item);
      this.e.anexarLinha(linha, proposta);
      this.anuncio.set(`${linha.nome ?? 'Item'} adicionado.`);
      this.passoItens()?.aposAdicionar(linha.id);
      if (this.e.colisao().size > 0) this.focar('#aviso-colisao');
    } catch (err) {
      this.toasts.erro(mensagemErroProposta(err));
    } finally {
      this.adicionando.set(false);
      this.fimDaGravacao(id);
    }
  }

  // ---- envio ----

  /**
   * Enviar (§9.3): exige item, cliente e template; `repo.enviar` gera o PDF oficial (PROV offline) e grava tudo no
   * aparelho; depois o compartilhamento (ou o download) e o detalhe. Se o navegador recusar a folha por falta de gesto
   * (a geração demorou), o painel "PDF pronto" pede um toque (P4c-R8).
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
    this.gravando++;
    this.anuncio.set('Gerando o PDF da proposta…');
    try {
      const blob = await this.repo.enviar(id, (entrada) => this.pdf.gerarBlob(entrada));
      this.liberado.set(true);
      const arquivo = arquivoPdf(blob, `Proposta-${await this.codigoDoDocumento(id)}.pdf`);
      const p = await this.repo.buscar(id);
      this.toasts.mostrar(!this.online() || !p || p.numero === null ? ENVIADA_SEM_NUMERO : 'Proposta enviada.');
      const resultado = await compartilharArquivo(arquivo, blob);
      if (resultado === 'precisa-toque') {
        this.pdfPronto.set(arquivo);
        return;
      }
      await this.aposCompartilhar(resultado, arquivo);
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
      this.fimDaGravacao(id);
    }
  }

  /** Depois do compartilhamento (direto ou pelo painel): o aviso do download e o detalhe da proposta. */
  protected async aposCompartilhar(r: Exclude<ResultadoCompartilhar, 'precisa-toque'> | 'fechado', arquivo: File): Promise<void> {
    this.pdfPronto.set(null);
    if (r === 'baixado') this.toasts.mostrar(`PDF baixado: ${arquivo.name}`);
    await this.router.navigate(['/propostas', this.e.id()]);
  }

  // ---- internos ----

  private async iniciar(id: string | undefined): Promise<void> {
    this.carregando.set(true);
    this.liberado.set(false);
    this.e.tentou.set(new Set());
    this.e.errosServidor.set({});
    this.observacao?.unsubscribe();
    const veioDoCadastro = !!this.tipo() || !!this.clienteId();
    if (!id) {
      this.e.iniciarNovo(tipoDaUrl(this.tipo()), this.clienteId() || null);
      this.atual.set(this.passos()[0]);
      this.carregando.set(false);
      if (veioDoCadastro) this.limparParametrosDoCadastro();
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
    if (await this.recusou(id, p)) return;
    this.e.carregar(p!);
    // a volta do "Cadastrar cliente" traz o passo 1 que ainda não foi gravado
    const tipo = tipoDaUrl(this.tipo());
    if (tipo) this.e.tipo.set(tipo);
    if (this.clienteId()) this.e.clienteId.set(this.clienteId()!);
    const pedido = Number(this.passo()) as Passo;
    const passo = this.passos().includes(pedido) ? pedido : this.passos()[0];
    this.atual.set(passo);
    this.preparar(passo);
    this.carregando.set(false);
    // aberto num passo (a passagem do /nova, o kanban): o leitor de tela sabe onde está
    if (this.passo() !== undefined) this.anunciarPasso(passo, true);
    if (veioDoCadastro) this.limparParametrosDoCadastro();
    this.observar(id);
  }

  /** Sem a proposta, ou num status que o modo não edita: avisa e sai. true = saiu. */
  private async recusou(id: string, p: PropostaLocal | undefined): Promise<boolean> {
    const recusa = p ? this.config().recusar(p) : 'Proposta não encontrada neste aparelho.';
    if (!recusa) return false;
    this.liberado.set(true);
    this.toasts.erro(recusa);
    await this.router.navigate(p ? ['/propostas', id] : ['/propostas'], { replaceUrl: true });
    return true;
  }

  /** P4c-R7: cada escrita na proposta (ack do push, pull de outro aparelho) passa por `reconciliar`. */
  private observar(id: string): void {
    this.observacao = this.repo.observarProposta(id).subscribe((p) => {
      if (this.id() !== id || this.liberado()) return;
      if (this.gravando > 0) {
        this.reemitiuGravando = true;
        return;
      }
      void this.aoMudarNaBase(id, p);
    });
  }

  private async aoMudarNaBase(id: string, p: PropostaLocal | undefined): Promise<void> {
    if (!p || this.config().recusar(p)) {
      // excluída, enviada ou cancelada em outro lugar: nada mais a editar aqui
      await this.recusou(id, p);
      return;
    }
    const tinhaColisao = this.e.colisao().size > 0;
    this.e.reconciliar(p);
    if (!tinhaColisao && this.e.colisao().size > 0) this.focar('#aviso-colisao');
  }

  /** Fim de uma gravação desta tela: uma reemissão que chegou no meio é relida agora (pode ser de outro aparelho). */
  private fimDaGravacao(id: string): void {
    this.gravando--;
    if (this.gravando > 0 || !this.reemitiuGravando) return;
    this.reemitiuGravando = false;
    void this.repo.buscar(id).then((p) => {
      if (this.gravando === 0 && !this.liberado()) return this.aoMudarNaBase(id, p);
      return undefined;
    });
  }

  /** M-2: o tipo e o cliente da volta do cadastro já estão na tela; a URL não os reaplica num recarregamento. */
  private limparParametrosDoCadastro(): void {
    void this.router.navigate([], {
      relativeTo: this.rota,
      queryParams: { tipo: null, clienteId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** O código impresso no PDF que acabou de ser gerado (o número pode ter chegado logo depois, num ack). */
  private async codigoDoDocumento(id: string): Promise<string> {
    const [ultimo] = await firstValueFrom(this.repo.observarDocumentos(id));
    if (ultimo) return ultimo.codigoExibido;
    const p = await this.repo.buscar(id);
    return p ? codigoExibido(p) : (this.e.codigo() ?? id);
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

  /**
   * Grava o passo `n` se ele mudou; false se não gravou. Antes, relê a proposta e reconcilia (um ack ou uma edição de
   * outro aparelho que ainda não chegou pela observação): com colisão, não grava e mostra a faixa.
   */
  private async gravar(n: Passo): Promise<boolean> {
    const id = this.e.id();
    if (!id || !this.e.sujo(n)) return true;
    this.salvando.set(true);
    this.gravando++;
    try {
      const atual = await this.repo.buscar(id);
      if (atual) this.e.reconciliar(atual);
      if (this.e.colisao().size > 0) {
        this.focar('#aviso-colisao');
        return false;
      }
      if (!this.e.sujo(n)) return true;
      const edicao = this.e.edicaoDoPasso(n, atual);
      if (!edicao) return false;
      const tocouOutros = n === 1 && !!atual && atual.tipo !== this.e.tipo();
      this.e.errosServidor.set({});
      const p = await this.config().salvar(this.injector, id, edicao, { base: this.e.versaoBase(), manter: this.e.mantendo() });
      this.e.aposSalvar(n, p, tocouOutros);
      return true;
    } catch (err) {
      this.falhou(err);
      return false;
    } finally {
      this.salvando.set(false);
      this.fimDaGravacao(id);
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
    this.focarPrimeiroErro();
    return false;
  }

  /** Recusa do repositório: os erros vão para os campos (e para o passo deles), o foco para o campo e a mensagem para o toast. */
  private falhou(err: unknown): void {
    const passo = this.e.registrarErro(err);
    this.toasts.erro(mensagemErroProposta(err));
    if (passo !== null && passo !== this.atual() && this.passos().includes(passo)) this.ir(passo, false);
    if (passo !== null) this.focarPrimeiroErro();
  }

  private ir(n: Passo, focarTitulo = true, extra = ''): void {
    this.atual.set(n);
    this.preparar(n);
    this.anunciarPasso(n, focarTitulo, extra);
  }

  private anunciarPasso(n: Passo, focarTitulo: boolean, extra = ''): void {
    const i = this.passos().indexOf(n);
    this.anuncio.set(`Passo ${i + 1} de ${this.passos().length}: ${ROTULO_PASSO[n]}.${extra}`);
    if (focarTitulo) this.focar('#titulo-passo');
  }

  /** Ao chegar nas condições sem template: o padrão do tipo já vem escolhido (o usuário vê e grava no Continuar). */
  private preparar(n: Passo): void {
    if (n !== 3 || this.e.templateId()) return;
    const padrao = this.e.padroes().get(this.e.tipo());
    if (padrao) this.e.templateId.set(padrao);
  }

  /** O primeiro campo com erro; sem campo, a mensagem focável (ex.: "Inclua pelo menos um item."), nunca a faixa. */
  private focarPrimeiroErro(): void {
    afterNextRender(
      () => {
        const raiz = this.host.nativeElement;
        const alvo = raiz.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?? raiz.querySelector<HTMLElement>('[role="alert"][tabindex]:not(#aviso-colisao)');
        alvo?.focus();
      },
      { injector: this.injector },
    );
  }

  private focar(seletor: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(seletor)?.focus(), { injector: this.injector });
  }
}
