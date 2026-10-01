import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { abrirJanelaEmBranco, previaNoIframe, revogarUrl } from '../../core/pdf/abrir-pdf';

type ModoVisor = 'iframe' | 'aba' | 'bloqueada';

/**
 * Mostra um PDF gerado no aparelho (P4a-R1, P4c-R3): no desktop com mouse, num iframe aqui; no celular, numa aba
 * aberta ainda dentro do gesto; com o popup bloqueado, um link para abrir. Fora do iframe, também "Baixar PDF" (o
 * celular pode não mostrar o PDF na aba: baixar sempre funciona). Cuida dos URLs de blob (revoga ao trocar e no
 * destroy). Quem usa chama `abrir` direto do clique, sem `await` antes.
 */
@Component({
  selector: 'app-visor-pdf',
  host: { class: 'block space-y-3 empty:hidden' },
  template: `
    @if (iframeUrl(); as url) {
      <iframe [title]="titulo()" [src]="url" class="h-[80vh] w-full rounded-lg border border-slate-200"></iframe>
    } @else if (linkBloqueado(); as url) {
      <p class="text-sm" role="status">
        O navegador bloqueou a nova aba.
        <a [href]="url" target="_blank" rel="noopener" class="font-semibold text-blue-700 underline">{{ rotuloAbrir() }}</a>
      </p>
    } @else if (abertoEmAba()) {
      <p class="text-sm text-slate-600">{{ textoAba() }}</p>
    }
    @if (urlBaixar(); as url) {
      <a [href]="url" [attr.download]="nomeArquivo()"
         class="inline-flex min-h-12 items-center text-sm font-semibold text-blue-700 underline">Baixar PDF</a>
    }
  `,
})
export class VisorPdf {
  /** Nome do arquivo no "Baixar PDF". */
  readonly nomeArquivo = input.required<string>();
  /** Título do iframe e da aba. */
  readonly titulo = input('Prévia do PDF');
  readonly rotuloAbrir = input('Abrir prévia');
  readonly textoAba = input('A prévia foi aberta em uma nova aba.');
  /** O que a aba mostra enquanto o PDF é gerado. */
  readonly textoGerando = input('Gerando prévia…');

  private readonly sanitizer = inject(DomSanitizer);
  private readonly url = signal<string | null>(null);
  private readonly modo = signal<ModoVisor | null>(null);
  private destruido = false;

  protected readonly iframeUrl = computed((): SafeResourceUrl | null => {
    const url = this.url();
    // blob: criado aqui mesmo, a partir do PDF gerado no aparelho
    return url && this.modo() === 'iframe' ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });
  protected readonly linkBloqueado = computed(() => (this.modo() === 'bloqueada' ? this.url() : null));
  protected readonly abertoEmAba = computed(() => this.modo() === 'aba');
  protected readonly urlBaixar = computed(() => {
    const modo = this.modo();
    return modo === 'aba' || modo === 'bloqueada' ? this.url() : null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destruido = true;
      this.descartar();
    });
  }

  /**
   * Gera o PDF com `gerar` e o mostra. No celular, a aba é aberta aqui, de forma síncrona (ainda no gesto de quem
   * chamou), e só recebe o blob quando ele fica pronto. Se `gerar` falhar, a aba fecha e o erro segue para quem chamou.
   * `titulo`: o da aba, quando quem chama acabou de mudar o input no mesmo clique (o input só muda na próxima detecção).
   */
  async abrir(gerar: () => Promise<Blob>, titulo?: string): Promise<void> {
    const desktop = previaNoIframe();
    const janela = desktop ? null : abrirJanelaEmBranco(titulo ?? this.titulo(), this.textoGerando());
    let blob: Blob;
    try {
      blob = await gerar();
    } catch (e) {
      janela?.close();
      throw e;
    }
    if (this.destruido) {
      // saiu da página durante a geração: só a aba já aberta ainda quer o PDF; nada de URL sem dono
      if (janela) {
        const url = URL.createObjectURL(blob);
        janela.location.href = url;
        revogarUrl(url, true);
      }
      return;
    }
    this.descartar();
    const url = URL.createObjectURL(blob);
    this.url.set(url);
    if (desktop) {
      this.modo.set('iframe');
    } else if (janela) {
      janela.location.href = url;
      this.modo.set('aba');
    } else {
      // popup bloqueado: fica o link
      this.modo.set('bloqueada');
    }
  }

  /** Tira o PDF atual. No iframe, revoga já; em outra aba (ou no link), só depois de um tempo. */
  descartar(): void {
    const url = this.url();
    const modo = this.modo();
    this.url.set(null);
    this.modo.set(null);
    if (url) revogarUrl(url, modo !== 'iframe');
  }
}
