import { Component, computed, inject, output, signal, viewChild } from '@angular/core';
import { dataBr, linhasDeTotais, quantidadeBr } from '../../core/pdf/formatos-pdf';
import { PdfService } from '../../core/pdf/pdf-service';
import { ErroCampo } from '../../core/util/erro-campo';
import { formatarDocumento } from '../../core/util/formatos';
import { Toasts } from '../../shared/ui/toasts';
import { VisorPdf } from '../../shared/ui/visor-pdf';
import { deMilesimos } from './calculo';
import { Passo } from './edicao-wizard';
import { moedaCentavos, rotuloTipo } from './formatos-proposta';
import { PropostasRepo } from './propostas-repo';
import { EstadoWizard } from './wizard-estado';

/**
 * Passo 4 (§13): revisão. Resumo com os totais como no PDF (P4a-R6: Subtotal = bruto, Descontos e Total) e "Ver
 * prévia": a mesma montagem do PDF oficial (`entradaPrevia`), com a marca d'água, em iframe ou aba (`VisorPdf`).
 * Os botões Salvar rascunho e Enviar são da página.
 */
@Component({
  selector: 'app-passo-revisao',
  imports: [VisorPdf],
  template: `
    <section class="space-y-4 rounded-xl bg-white p-4" aria-labelledby="titulo-passo">
      <h2 id="titulo-passo" tabindex="-1" class="font-semibold outline-none">Revisão</h2>

      <dl class="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt class="text-slate-500">Tipo</dt>
        <dd>{{ tipo() }}</dd>
        <dt class="text-slate-500">Cliente</dt>
        <dd data-testid="revisao-cliente">
          @if (e.cliente(); as c) { {{ c.nome }} · {{ documento(c.documento) }} } @else { — }
        </dd>
        <dt class="text-slate-500">Template</dt>
        <dd>{{ e.template()?.nome ?? '—' }}</dd>
        <dt class="text-slate-500">Validade</dt>
        <dd>{{ validade() }}</dd>
        @if (tecnico(); as t) {
          <dt class="text-slate-500">Técnico</dt>
          <dd>{{ t }}</dd>
        }
      </dl>

      <ul class="divide-y divide-slate-200 rounded-lg border border-slate-200" aria-label="Itens">
        @for (l of itens(); track l.id) {
          <li class="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
            <span class="min-w-0">
              <span class="block font-medium">{{ l.nome }}</span>
              <span class="block text-slate-500">{{ l.detalhe }}</span>
            </span>
            <span class="shrink-0 font-medium">{{ l.subtotal }}</span>
          </li>
        } @empty {
          <li class="px-3 py-3 text-sm text-slate-500">Nenhum item.</li>
        }
      </ul>

      <table class="ml-auto text-sm" aria-label="Totais">
        <tbody>
          @for (t of totais(); track t.rotulo) {
            <tr [class.font-semibold]="t.total" [class.text-base]="t.total">
              <th scope="row" class="py-1 pr-6 text-left font-[inherit]">{{ t.rotulo }}</th>
              <td class="py-1 text-right" [attr.data-testid]="'total-' + t.rotulo.toLowerCase()">{{ t.valor }}</td>
            </tr>
          }
        </tbody>
      </table>

      @if (faltas().length > 0) {
        <div data-testid="faltas" class="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" [attr.role]="mostrarFaltas() ? 'alert' : null">
          <p class="font-medium">Para enviar, falta:</p>
          <ul class="space-y-1">
            @for (f of faltas(); track f.passo) {
              <li class="flex items-center justify-between gap-2">
                <span>{{ f.mensagem }}</span>
                <button type="button" (click)="irPara.emit(f.passo)" class="min-h-12 px-2 font-semibold text-blue-700 underline">Corrigir</button>
              </li>
            }
          </ul>
        </div>
      }

      <div class="space-y-3 border-t border-slate-200 pt-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p id="previa-ajuda" class="text-sm text-slate-500">PDF com a marca "PRÉVIA". Não precisa de internet.</p>
          <button type="button" (click)="verPrevia()" [disabled]="gerandoPrevia()" aria-describedby="previa-ajuda"
                  class="h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold disabled:opacity-60">
            {{ gerandoPrevia() ? 'Gerando prévia…' : 'Ver prévia' }}
          </button>
        </div>
        <app-visor-pdf [nomeArquivo]="'previa-' + (e.codigo() ?? 'proposta') + '.pdf'" />
      </div>
    </section>
  `,
})
export class PassoRevisao {
  /** "Corrigir" numa falta: a página vai para o passo. */
  readonly irPara = output<Passo>();

  protected readonly e = inject(EstadoWizard);
  private readonly repo = inject(PropostasRepo);
  private readonly pdf = inject(PdfService);
  private readonly toasts = inject(Toasts);
  private readonly visor = viewChild.required(VisorPdf);
  protected readonly documento = formatarDocumento;
  protected readonly gerandoPrevia = signal(false);
  /** Depois de um Enviar barrado, as faltas são anunciadas. */
  readonly mostrarFaltas = signal(false);
  protected readonly faltas = this.e.faltasParaEnviar;

  protected readonly tipo = computed(() => rotuloTipo(this.e.tipo()));
  protected readonly validade = computed(() => dataBr(this.e.validadeAte()) || '—');
  protected readonly tecnico = computed(() => {
    const id = this.e.tecnicoId();
    return id ? (this.e.usuarios().find((u) => u.id === id)?.nome ?? null) : null;
  });

  protected readonly itens = computed(() => {
    const leituras = this.e.leituras();
    const subtotais = this.e.totais()?.subtotaisCentavos;
    return this.e.linhas().map((l, i) => {
      const lida = leituras[i]?.linha;
      const qtd = lida ? quantidadeBr(Number(deMilesimos(BigInt(lida.quantidadeMilesimos)))) : l.quantidade;
      const preco = lida ? moedaCentavos(lida.precoUnitarioCentavos ?? 0) : l.preco;
      const meses = lida?.meses ? ` × ${lida.meses} ${lida.meses === 1 ? 'mês' : 'meses'}` : '';
      return {
        id: l.id,
        nome: l.nome ?? '',
        detalhe: `${qtd} ${l.unidade ?? ''} × ${preco}${meses}`,
        subtotal: subtotais?.[i] !== undefined ? moedaCentavos(Number(subtotais[i])) : '—',
      };
    });
  });

  /** As linhas do bloco TOTAIS do PDF, com os descontos. */
  protected readonly totais = computed(() => {
    const t = this.e.totais();
    if (!t) return [{ rotulo: 'Total', valor: '—', total: true }];
    return linhasDeTotais(Number(t.totalCentavos), Number(t.totalDescontosCentavos), true).map((l) => ({
      rotulo: l.rotulo,
      valor: moedaCentavos(l.centavos),
      total: l.total,
    }));
  });

  /** Direto do clique: o `VisorPdf` abre a aba do celular antes de qualquer `await`. */
  protected async verPrevia(): Promise<void> {
    const id = this.e.id();
    if (this.gerandoPrevia() || !id) return;
    this.gerandoPrevia.set(true);
    try {
      await this.visor().abrir(async () => this.pdf.gerarBlob(await this.repo.entradaPrevia(id)));
    } catch (e) {
      this.toasts.erro(e instanceof ErroCampo && e.message.trim() ? e.message : 'Não foi possível gerar a prévia.');
    } finally {
      this.gerandoPrevia.set(false);
    }
  }
}
