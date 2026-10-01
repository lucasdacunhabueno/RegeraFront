import { afterNextRender, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { baixarArquivo } from '../../core/pdf/abrir-pdf';
import { compartilharArquivo, ResultadoCompartilhar } from './compartilhar';

/**
 * "PDF pronto" (P4c-R8): quando o navegador recusa o compartilhamento por falta de gesto (`precisa-toque`), o PDF já
 * gerado espera aqui um toque. "Compartilhar" chama `navigator.share` como primeira coisa do clique, com o `File` já
 * montado; "Baixar PDF" é a saída secundária. O painel recebe o foco, tem rótulo e fecha com Esc. Reusado pelo
 * detalhe da proposta (Compartilhar, Gerar PDF novamente).
 */
@Component({
  selector: 'app-pdf-pronto',
  template: `
    <section #painel role="dialog" aria-labelledby="pdf-pronto-titulo" aria-describedby="pdf-pronto-texto" tabindex="-1"
             (keydown.escape)="fechar()"
             class="space-y-3 rounded-xl border border-blue-200 bg-white p-4 shadow-lg outline-none">
      <h2 id="pdf-pronto-titulo" class="font-semibold">PDF pronto</h2>
      <p id="pdf-pronto-texto" class="text-sm text-slate-600">
        {{ arquivo().name }} foi gerado. Toque em Compartilhar para enviar pelo WhatsApp ou outro app.
      </p>
      @if (aviso(); as texto) { <p role="alert" class="text-sm text-amber-800">{{ texto }}</p> }
      <div class="flex flex-col gap-2 sm:flex-row">
        <button type="button" (click)="compartilhar()" [disabled]="ocupado()"
                class="h-12 flex-1 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-60">Compartilhar</button>
        <button type="button" (click)="baixar()" [disabled]="ocupado()"
                class="h-12 flex-1 rounded-lg border border-blue-600 px-4 font-semibold text-blue-700 disabled:opacity-60">Baixar PDF</button>
        <button type="button" (click)="fechar()" class="h-12 rounded-lg px-4 font-semibold text-slate-700">Fechar</button>
      </div>
    </section>
  `,
})
export class PdfPronto {
  readonly arquivo = input.required<File>();
  /** O que o usuário fez: compartilhou, cancelou a folha, baixou ou fechou o painel. */
  readonly concluido = output<Exclude<ResultadoCompartilhar, 'precisa-toque'> | 'fechado'>();

  private readonly painel = viewChild.required<ElementRef<HTMLElement>>('painel');
  protected readonly ocupado = signal(false);
  protected readonly aviso = signal<string | null>(null);

  constructor() {
    afterNextRender(() => this.painel().nativeElement.focus());
  }

  protected compartilhar(): void {
    // primeira coisa do clique: o gesto do usuário ainda vale
    const resultado = compartilharArquivo(this.arquivo());
    this.ocupado.set(true);
    this.aviso.set(null);
    void resultado.then((r) => {
      this.ocupado.set(false);
      if (r === 'precisa-toque') {
        this.aviso.set('O navegador não abriu o compartilhamento. Toque em Compartilhar de novo ou baixe o PDF.');
        return;
      }
      this.concluido.emit(r);
    });
  }

  protected baixar(): void {
    const arquivo = this.arquivo();
    baixarArquivo(arquivo, arquivo.name);
    this.concluido.emit('baixado');
  }

  protected fechar(): void {
    this.concluido.emit('fechado');
  }
}
