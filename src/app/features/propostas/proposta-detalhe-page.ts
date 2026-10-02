import { afterNextRender, Component, computed, effect, ElementRef, inject, Injector, input, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { LucideDynamicIcon } from '@lucide/angular';
import { ArquivosService, ErroDownload } from '../../core/arquivos/arquivos-service';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { dataBr, linhasDeTotais, percentualBr, quantidadeBr } from '../../core/pdf/formatos-pdf';
import { PdfService } from '../../core/pdf/pdf-service';
import { Pendencia, TIPO_UPLOAD_DOCUMENTO } from '../../core/sync/sync-models';
import { formatarDocumento, formatarTelefone } from '../../core/util/formatos';
import { Toasts } from '../../shared/ui/toasts';
import { VisorPdf } from '../../shared/ui/visor-pdf';
import { ClientesRepo } from '../clientes/clientes-repo';
import { OsDaProposta } from '../os/os-da-proposta';
import { deCentesimos, deMilesimos } from './calculo';
import { arquivoPdf, compartilharArquivo, ResultadoCompartilhar } from './compartilhar';
import { DialogoMotivo } from './dialogo-motivo';
import {
  dataHoraBr, mensagemErroProposta, moedaCentavos, rotuloCodigo, rotuloDoCampo, rotuloTipo, Selo, selosDaProposta,
} from './formatos-proposta';
import { hojeReativo } from './hoje-reativo';
import { PdfPronto } from './pdf-pronto';
import { regerarPdf } from './regerar-pdf';
import { ESTILO_SELO } from './proposta-card';
import {
  importadaDoSigem, ItemPropostaLocal, podeAlterarTecnico, podeEditar, PropostaLocal, STATUS_PROPOSTA, StatusProposta,
  transicoesPermitidas,
} from './proposta-models';
import {
  DocumentoDaProposta, enderecoDoCliente, EstadoSync, motivoParaRegerar, pendenciaCorrigivel, PropostasRepo,
} from './propostas-repo';

type Acao = 'editar' | 'enviar' | 'aprovar' | 'iniciar' | 'finalizar' | 'recusar' | 'nova-revisao' | 'cancelar' | 'previa'
  | 'duplicar' | 'excluir';

interface BotaoAcao {
  acao: Acao;
  rotulo: string;
  /**
   * Fica desabilitada com CONFLITO: muda o status (ou a atribuição), ou leva a um envio (Editar e Enviar, P4c-R15: o
   * envio atrás do conflito some no "Usar a do servidor").
   */
  transicao: boolean;
  /** Destaque: a ação principal do status. */
  principal?: boolean;
  perigo?: boolean;
}

/** O diálogo aberto: as transições com motivo (§8) ou a confirmação do "Excluir rascunho". */
type Dialogo = 'RECUSADA' | 'CANCELADA' | 'excluir';

const AVISO_TRANSICAO: Readonly<Record<StatusProposta, string>> = {
  RASCUNHO: 'Nova revisão aberta.',
  ENVIADA: 'Proposta enviada.',
  APROVADA: 'Proposta aprovada.',
  EM_EXECUCAO: 'Execução iniciada.',
  FINALIZADA: 'Proposta finalizada.',
  RECUSADA: 'Proposta recusada.',
  CANCELADA: 'Proposta cancelada.',
};

const SEM_INTERNET = 'Sem internet: este PDF não está no aparelho.';
const FALHA_DOWNLOAD = 'Não foi possível baixar o PDF. Tente de novo.';

interface LinhaItem {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  quantidade: string;
  unidade: string;
  meses: number | null;
  /** Só para ADMIN e COMERCIAL (null para o técnico). */
  preco: string | null;
  desconto: string | null;
  subtotal: string | null;
  /** Só para o ADMIN. */
  custo: string | null;
}

/**
 * Detalhe da proposta (`/propostas/:id`, §13): o hub para onde a lista, o kanban e o wizard levam.
 * - Cabeçalho: código (e `(ref. PROV-…)` quando numerada com um PDF provisório), status, tipo, selos, cliente,
 *   responsável e técnico ("Atribuir/Trocar técnico" quando P4b-R3 deixa).
 * - Itens (cards no celular, tabela a partir do lg), totais, condições, histórico e documentos (`observarDocumentos`;
 *   "Abrir" pelo PDF do aparelho ou baixado na hora sem cache, P4b-R6; "Compartilhar").
 * - Importada do SIGEM (`origem`): selo "SIGEM", sem "Ver prévia" nem "Gerar PDF novamente", e Documentos diz que não
 *   tem PDF.
 * - Ações: só as de `transicoesPermitidas` (e Editar, Enviar, Ver prévia, Duplicar, Excluir rascunho); RECUSADA e
 *   CANCELADA pedem o motivo (`DialogoMotivo`); com CONFLITO, as transições, Editar, Enviar e "Gerar PDF novamente"
 *   ficam desabilitados (P4c-R15).
 * - M2-P3: "Ordens de serviço" (`OsDaProposta`): as OS da proposta e o "Gerar OS" (APROVADA ou EM_EXECUCAO, ADMIN ou
 *   COMERCIAL responsável).
 * - Pendências (§11.5): faixa com o link para Pendências; "Corrigir e reenviar" na recusa corrigível (P4c-R4) e
 *   "Gerar PDF novamente" no `CODIGO_EXIBIDO_INVALIDO` ou sem o PDF da revisão (P4b-R13).
 * Desde o M2P3-R1 a rota barra o técnico (`/propostas/:id` é só de ADMIN e COMERCIAL; ele vê o trabalho pela OS). A
 * visão restrita (`restrito()`) é só a segunda trava: qualquer perfil fora de ADMIN e COMERCIAL que chegasse aqui veria
 * só código, cliente (nome, endereço, telefone), tipo, status, técnico, validade, prazo e os itens sem valores: nada de
 * dinheiro, pagamento, documentos, histórico nem ações.
 */
@Component({
  selector: 'app-proposta-detalhe-page',
  imports: [RouterLink, LucideDynamicIcon, VisorPdf, PdfPronto, DialogoMotivo, OsDaProposta],
  template: `
    <a routerLink="/propostas" class="inline-flex min-h-12 items-center text-sm text-blue-700">← Propostas</a>
    <p role="status" aria-live="polite" class="sr-only">{{ anuncio() }}</p>

    @if (carregando()) {
      <p data-testid="carregando" class="py-8 text-center text-slate-500">Carregando…</p>
    } @else if (!proposta()) {
      <div class="py-8 text-center text-slate-600">
        <p>Proposta não encontrada neste aparelho.</p>
        <a routerLink="/propostas" class="mt-2 inline-flex min-h-12 items-center font-semibold text-blue-700 underline">Ver propostas</a>
      </div>
    } @else {
      @let p = proposta()!;
      <!-- com a folha "PDF pronto" fixa no rodapé do celular, o fim da página continua alcançável -->
      <div class="space-y-4 sm:pb-0" [class.pb-72]="!!pdfPronto()">
        <header class="space-y-2">
          <h1 #titulo tabindex="-1" class="font-mono text-xl font-semibold outline-none">
            {{ referencia() ? codigo() + ' ' : codigo() }}@if (referencia(); as r) {<span class="text-base font-normal text-slate-500">(ref. {{ r }})</span>}
          </h1>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span data-status [attr.class]="'rounded-full px-2 py-0.5 text-xs font-medium ' + status().cor">{{ status().rotulo }}</span>
            <span class="text-slate-600">{{ tipo() }}</span>
          </div>
        </header>

        @if (!restrito() && pendencias().length > 0) {
          <section data-testid="pendencia" aria-labelledby="pendencia-titulo"
                   class="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <h2 id="pendencia-titulo" class="font-semibold">Pendência de sincronização</h2>
            <ul class="space-y-3 text-sm">
              @for (x of pendencias(); track x.mutationId) {
                <li class="space-y-2">
                  @if (x.tipo === 'CONFLITO') {
                    <p>Conflito: esta proposta mudou em outro lugar depois que você a alterou aqui.</p>
                  } @else if (x.entidade === uploadDocumento) {
                    <p>{{ x.erro?.mensagem }}</p>
                    @if (x.erro?.codigo === 'CODIGO_EXIBIDO_INVALIDO' && p.status === 'RASCUNHO') {
                      <!-- o PDF é da revisão que a "Nova revisão" já deixou para trás: não há o que gerar de novo -->
                      <a data-testid="descartar-pendencia" routerLink="/pendencias"
                         class="inline-flex min-h-12 items-center font-semibold text-amber-900 underline">Descarte esta pendência em Pendências.</a>
                    }
                  } @else {
                    <p>O servidor recusou: {{ x.erro?.mensagem }}</p>
                    @if (camposDa(x).length > 0) {
                      <ul class="list-disc pl-5">
                        @for (m of camposDa(x); track $index) { <li>{{ m }}</li> }
                      </ul>
                    }
                    @if (corrigivel(x) && pode()) {
                      <button type="button" (click)="corrigir()" [disabled]="ocupado()"
                              class="h-12 w-full rounded-lg bg-amber-700 px-4 font-semibold text-white disabled:opacity-60 sm:w-auto">
                        Corrigir e reenviar
                      </button>
                    }
                  }
                </li>
              }
            </ul>
            <a routerLink="/pendencias" class="inline-flex min-h-12 items-center font-semibold text-amber-900 underline">Ver em Pendências</a>
          </section>
        }

        @if (motivoRegerar(); as motivo) {
          <section data-testid="regerar" class="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p>
              {{ motivo === 'SEM_DOCUMENTO'
                ? 'O PDF desta revisão não está no aparelho nem no servidor. Se ele foi gerado em outro aparelho, sincronize esse aparelho antes.'
                : 'Gere o PDF de novo com o código atual: ele substitui o que foi recusado e vai na próxima sincronização.' }}
            </p>
            @if (conflito()) {
              <p id="dica-pendencia-regerar" class="font-semibold">Resolva a pendência primeiro.</p>
            }
            <button type="button" (click)="regerar()" [disabled]="ocupado() || conflito()"
                    [attr.aria-describedby]="conflito() ? 'dica-pendencia-regerar' : null"
                    class="h-12 w-full rounded-lg bg-amber-700 px-4 font-semibold text-white disabled:opacity-60 sm:w-auto">
              {{ regerando() ? 'Gerando PDF…' : 'Gerar PDF novamente' }}
            </button>
          </section>
        }

        <!-- v1: o resumo primeiro (cliente, total, validade, selos); as ações logo abaixo -->
        <section data-testid="resumo" aria-label="Resumo" class="space-y-2 rounded-xl bg-white p-4">
          <p class="text-lg font-semibold">
            @if (cliente(); as c) {
              @if (restrito()) {
                {{ c.nome }}
              } @else {
                <a data-testid="cliente" [routerLink]="['/clientes', c.id]"
                   class="inline-flex min-h-12 items-center text-blue-700 underline lg:min-h-0">{{ c.nome }}</a>
              }
            } @else {
              {{ p.clienteId ? 'Cliente não encontrado neste aparelho.' : 'Sem cliente' }}
            }
          </p>
          <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-slate-600">
            @if (totalResumo(); as t) {
              <p>Total <strong data-testid="total-resumo" class="text-lg text-slate-900">{{ t }}</strong></p>
            }
            <p>Validade: {{ data(p.validadeAte) || '—' }}</p>
          </div>
          @if (selos().length > 0) {
            <ul class="flex flex-wrap gap-1.5" aria-label="Avisos">
              @for (s of selos(); track s.tipo) {
                <li [attr.data-selo]="s.tipo" [attr.class]="'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ' + estilo(s).cor">
                  <svg [lucideIcon]="estilo(s).icone" [size]="12" aria-hidden="true"></svg>
                  @if (s.tipo === 'sigem') {<span class="sr-only">Importada do </span>}{{ s.rotulo }}
                </li>
              }
            </ul>
          }
        </section>

        @if (!restrito()) {
          <section aria-labelledby="acoes-titulo" class="space-y-3 rounded-xl bg-white p-4">
            <h2 id="acoes-titulo" class="sr-only">Ações</h2>
            @if (conflito() && temTransicao()) {
              <p id="dica-pendencia" class="text-sm text-amber-800">Resolva a pendência primeiro.</p>
            }
            <!-- celular: a principal em largura total, as outras em duas colunas; desktop: todas numa linha -->
            <div data-testid="acoes" class="space-y-2 lg:flex lg:flex-wrap lg:gap-2 lg:space-y-0">
              @for (a of principais(); track a.acao) {
                <button type="button" data-principal (click)="executar(a.acao, $any($event.currentTarget))"
                        [disabled]="ocupado() || (a.transicao && conflito())"
                        [attr.aria-describedby]="a.transicao && conflito() ? 'dica-pendencia' : null"
                        class="h-12 w-full rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-60 lg:w-auto">
                  {{ a.rotulo }}
                </button>
              }
              <div data-testid="acoes-secundarias" class="grid grid-cols-2 gap-2 lg:contents">
                @for (a of secundarias(); track a.acao) {
                  <button type="button" (click)="executar(a.acao, $any($event.currentTarget))"
                          [disabled]="ocupado() || (a.transicao && conflito())"
                          [attr.aria-describedby]="a.transicao && conflito() ? 'dica-pendencia' : null"
                          class="min-h-12 rounded-lg border px-3 text-sm font-semibold disabled:opacity-60 lg:px-4"
                          [class.border-slate-300]="!a.perigo" [class.border-red-300]="a.perigo" [class.text-red-700]="a.perigo">
                    {{ a.acao === 'previa' && gerandoPrevia() ? 'Gerando prévia…' : a.rotulo }}
                  </button>
                }
              </div>
            </div>
            <app-visor-pdf #visorPrevia [nomeArquivo]="'previa-' + codigo() + '.pdf'" />
          </section>
        }

        <section aria-labelledby="dados-titulo" class="space-y-3 rounded-xl bg-white p-4">
          <h2 id="dados-titulo" class="font-semibold">Dados</h2>
          <dl class="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt class="text-slate-500">Cliente</dt>
            <dd class="space-y-0.5">
              @if (cliente(); as c) {
                <span class="block font-medium">{{ c.nome }}</span>
                @if (!restrito()) { <span class="block text-slate-600">{{ documento(c.documento) }}</span> }
                @if (endereco(); as e) { <span class="block text-slate-600">{{ e }}</span> }
                @if (c.telefone) { <span class="block text-slate-600">{{ telefone(c.telefone) }}</span> }
              } @else {
                {{ p.clienteId ? 'Cliente não encontrado neste aparelho.' : 'Sem cliente' }}
              }
            </dd>
            <dt class="text-slate-500">Tipo</dt>
            <dd>{{ tipo() }}</dd>
            @if (!restrito()) {
              <dt class="text-slate-500">Emissão</dt>
              <dd>{{ data(p.dataEmissao) }}</dd>
              <dt class="text-slate-500">Responsável</dt>
              <dd data-testid="responsavel">{{ nome(p.responsavelId) ?? '—' }}</dd>
            }
            <dt class="text-slate-500">Técnico</dt>
            <dd data-testid="tecnico" class="space-y-2">
              <span class="block">{{ p.tecnicoId ? (nome(p.tecnicoId) ?? 'Técnico não encontrado') : 'Nenhum' }}</span>
              @if (podeAtribuir()) {
                @if (editandoTecnico()) {
                  <div class="space-y-2">
                    <label for="tecnico-atribuir" class="block text-sm font-medium">Técnico da proposta</label>
                    <select id="tecnico-atribuir" (change)="tecnicoEscolhido.set($any($event.target).value)"
                            class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 sm:w-72">
                      <option value="" [selected]="!tecnicoEscolhido()">Nenhum</option>
                      @for (t of tecnicos(); track t.id) {
                        <option [value]="t.id" [selected]="t.id === tecnicoEscolhido()">{{ t.rotulo }}</option>
                      }
                    </select>
                    <div class="flex gap-2">
                      <button type="button" (click)="salvarTecnico()" [disabled]="ocupado() || conflito()"
                              class="h-12 flex-1 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-60 sm:flex-none">Salvar técnico</button>
                      <button type="button" (click)="editandoTecnico.set(false)"
                              class="h-12 flex-1 rounded-lg border border-slate-300 px-4 font-semibold sm:flex-none">Cancelar</button>
                    </div>
                  </div>
                } @else {
                  <button type="button" (click)="abrirTecnico()" [disabled]="ocupado() || conflito()"
                          [attr.aria-describedby]="conflito() ? 'dica-pendencia' : null"
                          class="h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold disabled:opacity-60">
                    {{ p.tecnicoId ? 'Trocar técnico' : 'Atribuir técnico' }}
                  </button>
                }
              }
            </dd>
          </dl>
        </section>

        @if (!restrito()) {
          <app-os-da-proposta class="block" [proposta]="p" [clienteNome]="cliente()?.nome ?? ''" [bloqueado]="conflito()" />
        }

        <section aria-labelledby="itens-titulo" class="space-y-3 rounded-xl bg-white p-4">
          <h2 id="itens-titulo" class="font-semibold">Itens</h2>
          @if (itens().length === 0) {
            <p class="text-sm text-slate-500">Nenhum item.</p>
          }
          <ul data-testid="itens-cards" class="space-y-3 lg:hidden">
            @for (l of itens(); track l.id) {
              <li class="space-y-1 rounded-lg border border-slate-200 p-3 text-sm">
                <p class="font-medium">{{ l.nome }}</p>
                <p class="font-mono text-xs text-slate-500">{{ l.codigo }}</p>
                @if (l.descricao) { <p class="text-slate-600">{{ l.descricao }}</p> }
                <p>Quantidade: {{ l.quantidade }} {{ l.unidade }}</p>
                @if (l.meses !== null) { <p>Meses: {{ l.meses }}</p> }
                @if (l.preco !== null) {
                  <p>Preço unitário: {{ l.preco }} · Desconto: {{ l.desconto }}</p>
                  <p class="font-semibold">Subtotal: {{ l.subtotal }}</p>
                }
                @if (l.custo !== null) { <p class="text-slate-600">Custo: {{ l.custo }}</p> }
              </li>
            }
          </ul>
          @if (itens().length > 0) {
            <table data-testid="itens-tabela" class="hidden w-full text-left text-sm lg:table">
              <thead class="border-b border-slate-200 text-slate-500">
                <tr>
                  <th scope="col" class="py-2 pr-3 font-medium">Código</th>
                  <th scope="col" class="py-2 pr-3 font-medium">Item</th>
                  <th scope="col" class="py-2 pr-3 text-right font-medium">Qtd.</th>
                  <th scope="col" class="py-2 pr-3 font-medium">Un.</th>
                  @if (comMeses()) { <th scope="col" class="py-2 pr-3 text-right font-medium">Meses</th> }
                  @if (mostrarCusto()) { <th scope="col" class="py-2 pr-3 text-right font-medium">Custo</th> }
                  @if (!restrito()) {
                    <th scope="col" class="py-2 pr-3 text-right font-medium">Preço unit.</th>
                    <th scope="col" class="py-2 pr-3 text-right font-medium">Desc.</th>
                    <th scope="col" class="py-2 text-right font-medium">Subtotal</th>
                  }
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (l of itens(); track l.id) {
                  <tr>
                    <td class="py-2 pr-3 font-mono text-xs">{{ l.codigo }}</td>
                    <td class="py-2 pr-3">
                      <span class="block font-medium">{{ l.nome }}</span>
                      @if (l.descricao) { <span class="block text-slate-500">{{ l.descricao }}</span> }
                    </td>
                    <td class="py-2 pr-3 text-right">{{ l.quantidade }}</td>
                    <td class="py-2 pr-3">{{ l.unidade }}</td>
                    @if (comMeses()) { <td class="py-2 pr-3 text-right">{{ l.meses ?? '—' }}</td> }
                    @if (mostrarCusto()) { <td class="py-2 pr-3 text-right">{{ l.custo ?? '—' }}</td> }
                    @if (!restrito()) {
                      <td class="py-2 pr-3 text-right">{{ l.preco }}</td>
                      <td class="py-2 pr-3 text-right">{{ l.desconto }}</td>
                      <td class="py-2 text-right font-semibold">{{ l.subtotal }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          }
          @if (!restrito()) {
            <table data-testid="totais" class="ml-auto text-sm" aria-label="Totais">
              <tbody>
                @for (t of totais(); track t.rotulo) {
                  <tr [class.font-semibold]="t.total" [class.text-base]="t.total">
                    <th scope="row" class="py-1 pr-6 text-left font-[inherit]">{{ t.rotulo }}</th>
                    <td class="py-1 text-right">{{ t.valor }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>

        <section aria-labelledby="condicoes-titulo" class="space-y-3 rounded-xl bg-white p-4">
          <h2 id="condicoes-titulo" class="font-semibold">Condições</h2>
          <dl data-testid="condicoes" class="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt class="text-slate-500">Validade</dt>
            <dd>{{ data(p.validadeAte) || '—' }}</dd>
            <dt class="text-slate-500">Prazo de execução</dt>
            <dd>{{ p.prazoExecucao ?? '—' }}</dd>
            @if (!restrito()) {
              <dt class="text-slate-500">Condições de pagamento</dt>
              <dd class="whitespace-pre-line">{{ p.condicoesPagamento ?? '—' }}</dd>
              @if (descontoGeral(); as d) {
                <dt class="text-slate-500">Desconto geral</dt>
                <dd>{{ d }}</dd>
              }
              <dt class="text-slate-500">Observações</dt>
              <dd class="whitespace-pre-line">{{ p.observacoes ?? '—' }}</dd>
              @if (p.motivoEncerramento) {
                <dt class="text-slate-500">Motivo do encerramento</dt>
                <dd class="whitespace-pre-line">{{ p.motivoEncerramento }}</dd>
              }
            }
          </dl>
        </section>

        @if (!restrito()) {
          <section data-testid="documentos" aria-labelledby="documentos-titulo" class="space-y-3 rounded-xl bg-white p-4">
            <h2 id="documentos-titulo" class="font-semibold">Documentos</h2>
            <ul class="divide-y divide-slate-100">
              @for (d of documentos(); track d.id) {
                <li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span class="min-w-0">
                    <span class="block font-mono font-semibold">{{ d.codigoExibido }}</span>
                    <span class="block text-slate-500">Revisão {{ d.revisao }} · {{ dataHora(d.geradoEm) }} · {{ d.enviado ? 'Enviado' : 'Aguardando envio' }}</span>
                  </span>
                  <span class="flex gap-2">
                    <button type="button" (click)="abrirDocumento(d)" [attr.aria-label]="'Abrir ' + d.codigoExibido"
                            class="h-12 rounded-lg border border-slate-300 px-4 font-semibold">Abrir</button>
                    <button type="button" (click)="compartilharDocumento(d)" [disabled]="ocupado()" [attr.aria-label]="'Compartilhar ' + d.codigoExibido"
                            class="h-12 rounded-lg border border-blue-600 px-4 font-semibold text-blue-700 disabled:opacity-60">Compartilhar</button>
                  </span>
                </li>
              } @empty {
                <li class="py-2 text-sm text-slate-500">
                  {{ sigem() ? 'Importada do SIGEM: sem PDF.' : 'Nenhum PDF ainda. O PDF é gerado no envio.' }}
                </li>
              }
            </ul>
            <app-visor-pdf #visorDocumento [titulo]="'PDF ' + (documentoAberto()?.codigoExibido ?? '')" rotuloAbrir="Abrir PDF"
                           textoAba="O PDF foi aberto em uma nova aba." textoGerando="Abrindo PDF…"
                           [nomeArquivo]="'Proposta-' + (documentoAberto()?.codigoExibido ?? codigo()) + '.pdf'" />
          </section>

          <section data-testid="historico" aria-labelledby="historico-titulo" class="space-y-3 rounded-xl bg-white p-4">
            <h2 id="historico-titulo" class="font-semibold">Histórico</h2>
            <ol class="space-y-2 text-sm">
              @for (h of p.historico; track $index) {
                <li class="border-l-2 border-slate-200 pl-3">
                  <span class="block font-medium">
                    @if (h.statusDe) {
                      {{ rotuloStatus(h.statusDe) }} → {{ rotuloStatus(h.statusPara) }}
                    } @else {
                      Criada como {{ rotuloStatus(h.statusPara) }}
                    }
                  </span>
                  <span class="block text-slate-500">{{ nome(h.usuarioId) ?? 'Usuário' }} · {{ dataHora(h.em) }}</span>
                  @if (h.observacao) { <span class="block whitespace-pre-line text-slate-600">{{ h.observacao }}</span> }
                </li>
              } @empty {
                <li class="text-slate-500">Sem mudanças de status ainda.</li>
              }
            </ol>
          </section>
        }

        @if (pdfPronto(); as arquivo) {
          <div class="fixed inset-x-0 bottom-0 z-40 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:static sm:p-0">
            <app-pdf-pronto [arquivo]="arquivo" (concluido)="aposCompartilhar($event, arquivo)" />
          </div>
        }
      </div>

      @switch (dialogo()) {
        @case ('RECUSADA') {
          <app-dialogo-motivo [gatilho]="gatilho()" titulo="Recusar proposta" texto="O motivo fica no histórico da proposta." rotuloConfirmar="Recusar"
                              [perigo]="true" [ocupado]="ocupado()" (confirmado)="transicionar('RECUSADA', $event)"
                              (cancelado)="dialogo.set(null)" />
        }
        @case ('CANCELADA') {
          <app-dialogo-motivo [gatilho]="gatilho()" titulo="Cancelar proposta"
                              texto="Uma proposta cancelada não volta atrás. Para refazê-la, use Duplicar."
                              rotuloConfirmar="Cancelar proposta" rotuloCancelar="Voltar" [perigo]="true" [ocupado]="ocupado()"
                              (confirmado)="transicionar('CANCELADA', $event)" (cancelado)="dialogo.set(null)" />
        }
        @case ('excluir') {
          <app-dialogo-motivo [gatilho]="gatilho()" titulo="Excluir rascunho" texto="O rascunho sai deste aparelho e do servidor. Não dá para desfazer."
                              rotuloConfirmar="Excluir" [pedirMotivo]="false" [perigo]="true" [ocupado]="ocupado()"
                              (confirmado)="excluir()" (cancelado)="dialogo.set(null)" />
        }
      }
    }
  `,
})
export class PropostaDetalhePage {
  /** `:id` da rota. */
  readonly id = input.required<string>();

  private readonly repo = inject(PropostasRepo);
  private readonly pdf = inject(PdfService);
  private readonly arquivos = inject(ArquivosService);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly online = inject(ConectividadeService).online;
  private readonly usuario = inject(AuthService).usuario;
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly visorPrevia = viewChild('visorPrevia', { read: VisorPdf });
  private readonly visorDocumento = viewChild('visorDocumento', { read: VisorPdf });
  private readonly titulo = viewChild<ElementRef<HTMLElement>>('titulo');

  /** A visão do técnico (§10): sem valores, documentos, histórico nem ações (também sem sessão ou perfil desconhecido). */
  protected readonly restrito = computed(() => {
    const perfil = this.usuario()?.perfil;
    return perfil !== 'ADMIN' && perfil !== 'COMERCIAL';
  });

  protected readonly proposta = signal<PropostaLocal | undefined>(undefined);
  private readonly carregou = signal(false);
  protected readonly documentos = signal<DocumentoDaProposta[]>([]);
  protected readonly pendencias = signal<Pendencia[]>([]);
  private readonly clientes = toSignal(inject(ClientesRepo).observarTodos());
  private readonly usuarios = toSignal(this.repo.observarUsuarios(), { initialValue: [] });
  private readonly estado = toSignal(this.repo.observarEstadoSync(), {
    initialValue: { naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() } as EstadoSync,
  });
  private readonly hoje = hojeReativo();

  protected readonly carregando = computed(() => !this.carregou() || this.clientes() === undefined);
  protected readonly ocupado = signal(false);
  protected readonly gerandoPrevia = signal(false);
  protected readonly regerando = signal(false);
  protected readonly anuncio = signal('');
  protected readonly dialogo = signal<Dialogo | null>(null);
  protected readonly editandoTecnico = signal(false);
  protected readonly tecnicoEscolhido = signal('');
  protected readonly documentoAberto = signal<DocumentoDaProposta | null>(null);
  /** O botão que abriu o diálogo: recebe o foco de volta (o Safari não foca o botão no clique). */
  protected readonly gatilho = signal<HTMLElement | null>(null);
  /** P4c-R8: o PDF esperando um toque para o compartilhamento (o navegador recusou sem gesto). */
  protected readonly pdfPronto = signal<File | null>(null);

  protected readonly uploadDocumento = TIPO_UPLOAD_DOCUMENTO;
  protected readonly documento = formatarDocumento;
  protected readonly telefone = formatarTelefone;
  protected readonly data = dataBr;
  protected readonly dataHora = dataHoraBr;
  protected readonly corrigivel = pendenciaCorrigivel;

  private readonly ehResponsavel = computed(() => {
    const p = this.proposta();
    return !!p && p.responsavelId === this.usuario()?.id;
  });
  /** Pode mexer na proposta (editar, duplicar, excluir, corrigir, gerar o PDF): o ADMIN ou o comercial responsável. */
  protected readonly pode = computed(() => {
    const perfil = this.usuario()?.perfil;
    return perfil === 'ADMIN' || (perfil === 'COMERCIAL' && this.ehResponsavel());
  });

  protected readonly codigo = computed(() => {
    const p = this.proposta();
    return p ? rotuloCodigo(p) : '';
  });
  /** `(ref. PROV-…)`: numerada, com um PDF que saiu com o código provisório (do servidor ou do aparelho). */
  protected readonly referencia = computed(() => {
    const p = this.proposta();
    if (!p || p.numero === null) return null;
    const provisorio = [...p.documentos, ...this.documentos()].some((d) => d.codigoExibido.startsWith(p.codigoProvisorio));
    return provisorio ? p.codigoProvisorio : null;
  });
  protected readonly status = computed(() => STATUS_PROPOSTA[this.proposta()?.status ?? 'RASCUNHO']);
  protected readonly tipo = computed(() => rotuloTipo(this.proposta()?.tipo ?? 'VENDA'));
  protected readonly selos = computed<Selo[]>(() => {
    const p = this.proposta();
    if (!p || this.restrito()) return [];
    return selosDaProposta(p, {
      pendente: this.pendencias().length > 0 || this.estado().comPendencia.has(p.id),
      naoSincronizada: this.estado().naOutbox.has(p.id),
      hoje: this.hoje(),
    });
  });

  protected readonly cliente = computed(() => {
    const id = this.proposta()?.clienteId;
    return id ? (this.clientes() ?? []).find((c) => c.id === id) : undefined;
  });
  protected readonly endereco = computed(() => {
    const c = this.cliente();
    return c ? enderecoDoCliente(c) : null;
  });
  private readonly nomes = computed(() => new Map(this.usuarios().map((u) => [u.id, u.nome])));
  protected readonly tecnicos = computed(() => {
    const atual = this.proposta()?.tecnicoId ?? null;
    return this.usuarios()
      .filter((u) => u.perfil === 'TECNICO' && (u.ativo !== false || u.id === atual))
      .map((u) => ({ id: u.id, rotulo: u.ativo === false ? `${u.nome} (inativo)` : u.nome }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  });
  protected readonly podeAtribuir = computed(() => {
    const p = this.proposta();
    const u = this.usuario();
    return !!p && !!u && !this.restrito() && podeAlterarTecnico(p.status, u.perfil, this.ehResponsavel());
  });

  protected readonly mostrarCusto = computed(() => this.usuario()?.perfil === 'ADMIN');
  protected readonly comMeses = computed(() => (this.proposta()?.itens ?? []).some((l) => l.meses !== null));
  protected readonly itens = computed<LinhaItem[]>(() => {
    const valores = !this.restrito();
    const custo = this.mostrarCusto();
    return (this.proposta()?.itens ?? []).map((l) => linhaItem(l, valores, custo));
  });
  protected readonly totais = computed(() => {
    const p = this.proposta();
    if (!p || this.restrito()) return [];
    return linhasDeTotais(p.totalCentavos ?? 0, p.totalDescontosCentavos ?? 0, true).map((t) => ({
      rotulo: t.rotulo, valor: moedaCentavos(t.centavos), total: t.total,
    }));
  });
  protected readonly descontoGeral = computed(() => {
    const d = this.proposta()?.descontoGeralCentesimos ?? 0;
    return d > 0 ? percentualBr(Number(deCentesimos(BigInt(d)))) : null;
  });

  protected readonly conflito = computed(() => this.pendencias().some((x) => x.tipo === 'CONFLITO'));
  /** A proposta veio do SIGEM: sem prévia, sem PDF (e `motivoParaRegerar` já é nulo para ela). */
  protected readonly sigem = computed(() => {
    const p = this.proposta();
    return !!p && importadaDoSigem(p);
  });
  protected readonly motivoRegerar = computed(() => {
    const p = this.proposta();
    return p && this.pode() ? motivoParaRegerar(p, this.documentos(), this.pendencias()) : null;
  });

  /** As ações do status para o perfil, na ordem da tela (§8, §10). */
  protected readonly acoes = computed<BotaoAcao[]>(() => {
    const p = this.proposta();
    const u = this.usuario();
    if (!p || !u || this.restrito()) return [];
    const destinos = transicoesPermitidas(p.status, u.perfil, this.ehResponsavel());
    const pode = this.pode();
    const lista: BotaoAcao[] = [];
    const enviar = p.status === 'RASCUNHO' && destinos.includes('ENVIADA');
    if (enviar) lista.push({ acao: 'enviar', rotulo: 'Enviar', transicao: true, principal: true });
    if (pode && podeEditar(p.status)) lista.push({ acao: 'editar', rotulo: 'Editar', transicao: true, principal: !enviar });
    if (destinos.includes('APROVADA')) lista.push({ acao: 'aprovar', rotulo: 'Aprovar', transicao: true, principal: true });
    if (destinos.includes('EM_EXECUCAO')) lista.push({ acao: 'iniciar', rotulo: 'Iniciar execução', transicao: true, principal: true });
    if (destinos.includes('FINALIZADA')) lista.push({ acao: 'finalizar', rotulo: 'Finalizar', transicao: true, principal: true });
    if (destinos.includes('RECUSADA')) lista.push({ acao: 'recusar', rotulo: 'Recusar', transicao: true, perigo: true });
    if (p.status === 'ENVIADA' && destinos.includes('RASCUNHO')) lista.push({ acao: 'nova-revisao', rotulo: 'Nova revisão', transicao: true });
    if (destinos.includes('CANCELADA')) lista.push({ acao: 'cancelar', rotulo: 'Cancelar proposta', transicao: true, perigo: true });
    // a importada do SIGEM não tem PDF: nem a prévia
    if (!importadaDoSigem(p)) lista.push({ acao: 'previa', rotulo: 'Ver prévia', transicao: false });
    if (pode) lista.push({ acao: 'duplicar', rotulo: 'Duplicar', transicao: false });
    if (pode && p.status === 'RASCUNHO' && p.numero === null) {
      lista.push({ acao: 'excluir', rotulo: 'Excluir rascunho', transicao: false, perigo: true });
    }
    return lista;
  });
  /** v1: a ação principal do status (largura total no celular) e as outras (grade de duas colunas). */
  protected readonly principais = computed(() => this.acoes().filter((a) => a.principal));
  protected readonly secundarias = computed(() => this.acoes().filter((a) => !a.principal));
  protected readonly totalResumo = computed(() => {
    const p = this.proposta();
    return p && !this.restrito() ? moedaCentavos(p.totalCentavos ?? 0) : null;
  });
  protected readonly temTransicao = computed(() => this.acoes().some((a) => a.transicao) || this.podeAtribuir());

  constructor() {
    // um effect e não toObservable + switchMap (o bundle inicial); a fonte troca com o id e com o perfil
    effect((aoLimpar) => {
      const id = this.id();
      const restrito = this.restrito();
      this.carregou.set(false);
      this.proposta.set(undefined);
      this.documentos.set([]);
      this.pendencias.set([]);
      const assinaturas = [
        this.repo.observarProposta(id).subscribe((p) => {
          this.proposta.set(p);
          this.carregou.set(true);
        }),
      ];
      // o técnico não vê documentos (§10) nem resolve pendências (não grava propostas)
      if (!restrito) {
        assinaturas.push(this.repo.observarDocumentos(id).subscribe((d) => this.documentos.set(d)));
        assinaturas.push(this.repo.observarPendencias(id).subscribe((x) => this.pendencias.set(x)));
      }
      aoLimpar(() => assinaturas.forEach((a) => a.unsubscribe()));
    });
  }

  protected estilo(s: Selo) {
    return ESTILO_SELO[s.tipo];
  }

  protected nome(usuarioId: string): string | null {
    return this.nomes().get(usuarioId) ?? null;
  }

  protected rotuloStatus(s: StatusProposta): string {
    return STATUS_PROPOSTA[s].rotulo;
  }

  /** As mensagens dos campos recusados (a lista da faixa), com o rótulo do campo: "Prazo de execução: …". */
  protected camposDa(x: Pendencia): string[] {
    return Object.entries(x.erro?.campos ?? {}).map(([campo, mensagem]) => {
      const rotulo = rotuloDoCampo(campo);
      return rotulo ? `${rotulo}: ${mensagem}` : mensagem;
    });
  }

  // ---- ações ----

  protected executar(acao: Acao, gatilho: HTMLElement | null = null): void {
    const id = this.id();
    this.gatilho.set(gatilho);
    switch (acao) {
      case 'editar':
        void this.router.navigate(['/propostas', id, 'editar']);
        return;
      case 'enviar':
        // P4c-R5: o wizard abre direto na revisão, onde o Enviar gera o PDF oficial
        void this.router.navigate(['/propostas', id, 'editar'], { queryParams: { passo: 4 } });
        return;
      case 'aprovar':
        void this.transicionar('APROVADA');
        return;
      case 'iniciar':
        void this.transicionar('EM_EXECUCAO');
        return;
      case 'finalizar':
        void this.transicionar('FINALIZADA');
        return;
      case 'nova-revisao':
        void this.transicionar('RASCUNHO');
        return;
      case 'recusar':
        this.dialogo.set('RECUSADA');
        return;
      case 'cancelar':
        this.dialogo.set('CANCELADA');
        return;
      case 'excluir':
        this.dialogo.set('excluir');
        return;
      case 'previa':
        void this.verPrevia();
        return;
      case 'duplicar':
        void this.duplicar();
        return;
    }
  }

  /** Muda o status (§8); RECUSADA e CANCELADA vêm do diálogo, com o motivo. Nova revisão abre o editar. */
  protected async transicionar(para: StatusProposta, motivo?: string | null): Promise<void> {
    const id = this.id();
    if (this.ocupado()) return;
    this.ocupado.set(true);
    try {
      if (motivo === undefined) await this.repo.transicionar(id, para);
      else await this.repo.transicionar(id, para, motivo);
      this.dialogo.set(null);
      this.avisar(AVISO_TRANSICAO[para]);
      if (para === 'RASCUNHO') await this.router.navigate(['/propostas', id, 'editar']);
      else this.focarTitulo();
    } catch (e) {
      // o diálogo fica aberto, com o motivo digitado
      this.toasts.erro(mensagemErroProposta(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  protected corrigir(): void {
    void this.router.navigate(['/propostas', this.id(), 'corrigir']);
  }

  protected abrirTecnico(): void {
    this.tecnicoEscolhido.set(this.proposta()?.tecnicoId ?? '');
    this.editandoTecnico.set(true);
  }

  /** P4b-R3: o técnico, pelo ADMIN ou pelo responsável, fora dos status terminais. */
  protected async salvarTecnico(): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    try {
      await this.repo.atribuir(this.id(), { tecnicoId: this.tecnicoEscolhido() || null });
      this.editandoTecnico.set(false);
      this.avisar('Técnico atualizado.');
    } catch (e) {
      this.toasts.erro(mensagemErroProposta(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  /** "Duplicar": o rascunho novo já no wizard; avisa das linhas que ficaram de fora (item inativo ou fora do aparelho). */
  private async duplicar(): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    try {
      const { id, linhasDescartadas } = await this.repo.duplicar(this.id());
      if (linhasDescartadas === 1) this.toasts.mostrar('1 item inativo não foi copiado.');
      else if (linhasDescartadas > 1) this.toasts.mostrar(`${linhasDescartadas} itens inativos não foram copiados.`);
      else this.toasts.mostrar('Proposta duplicada.');
      await this.router.navigate(['/propostas', id, 'editar']);
    } catch (e) {
      this.toasts.erro(mensagemErroProposta(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  protected async excluir(): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    try {
      await this.repo.excluir(this.id());
      this.dialogo.set(null);
      this.toasts.mostrar('Rascunho excluído.');
      await this.router.navigate(['/propostas']);
    } catch (e) {
      this.toasts.erro(mensagemErroProposta(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  /** "Ver prévia" em qualquer status (`entradaPrevia`); o visor abre a aba do celular antes de qualquer `await`. */
  private async verPrevia(): Promise<void> {
    const visor = this.visorPrevia();
    if (this.gerandoPrevia() || !visor) return;
    this.gerandoPrevia.set(true);
    try {
      await visor.abrir(async () => this.pdf.gerarBlob(await this.repo.entradaPrevia(this.id())));
    } catch (e) {
      this.toasts.erro(mensagemErroProposta(e));
    } finally {
      this.gerandoPrevia.set(false);
    }
  }

  // ---- documentos ----

  /**
   * "Abrir": o PDF do aparelho; sem os bytes, baixado na hora (online), sem cache (P4b-R6). Sem internet (ou com
   * falha), avisa sem abrir aba. Chamado direto do clique: o visor abre a aba do celular antes de qualquer `await`.
   */
  protected abrirDocumento(d: DocumentoDaProposta): void {
    if (!this.alcancavel(d)) {
      this.toasts.erro(SEM_INTERNET);
      return;
    }
    const visor = this.visorDocumento();
    if (!visor) return;
    this.documentoAberto.set(d);
    // o título vai no abrir: o input do visor só muda na próxima detecção, depois que a aba já abriu (M8)
    visor.abrir(() => this.bytesDe(d), `PDF ${d.codigoExibido}`).catch((e: unknown) => this.toasts.erro(this.erroDoDownload(e)));
  }

  protected async compartilharDocumento(d: DocumentoDaProposta): Promise<void> {
    if (!this.alcancavel(d)) {
      this.toasts.erro(SEM_INTERNET);
      return;
    }
    if (this.ocupado()) return;
    this.ocupado.set(true);
    try {
      const blob = await this.bytesDe(d);
      await this.compartilhar(arquivoPdf(blob, `Proposta-${d.codigoExibido}.pdf`), blob);
    } catch (e) {
      this.toasts.erro(this.erroDoDownload(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  /**
   * "Gerar PDF novamente" (P4b-R13): o PDF oficial com o código atual (`regerarDocumento`, que troca o documento e
   * reenfileira o upload), depois o compartilhamento (ou o painel "PDF pronto", P4c-R8).
   */
  protected async regerar(): Promise<void> {
    const id = this.id();
    if (this.ocupado()) return;
    this.ocupado.set(true);
    this.regerando.set(true);
    this.anuncio.set('Gerando o PDF da proposta…');
    try {
      // o nome leva o código impresso no PDF (o número pode chegar logo depois, num ack)
      const { arquivo, blob } = await regerarPdf(this.repo, this.pdf, id);
      this.avisar('PDF gerado de novo. Ele vai para o servidor na próxima sincronização.');
      await this.compartilhar(arquivo, blob);
    } catch (e) {
      this.toasts.erro(mensagemErroProposta(e));
    } finally {
      this.regerando.set(false);
      this.ocupado.set(false);
    }
  }

  /** Depois do compartilhamento (direto ou pelo painel): o aviso do download. */
  protected aposCompartilhar(r: Exclude<ResultadoCompartilhar, 'precisa-toque'> | 'fechado', arquivo: File): void {
    this.pdfPronto.set(null);
    if (r === 'baixado') this.toasts.mostrar(`PDF baixado: ${arquivo.name}`);
  }

  private async compartilhar(arquivo: File, blob: Blob): Promise<void> {
    const r = await compartilharArquivo(arquivo, blob);
    if (r === 'precisa-toque') this.pdfPronto.set(arquivo);
    else this.aposCompartilhar(r, arquivo);
  }

  /** M1: "Sem internet" só sem internet; a sessão vencida diz para entrar de novo; o resto, tentar de novo. */
  private erroDoDownload(e: unknown): string {
    if (!this.online()) return SEM_INTERNET;
    if (e instanceof ErroDownload && e.motivo === 'SEM_SESSAO') return e.message;
    return FALHA_DOWNLOAD;
  }

  /** Os bytes estão aqui, ou dá para baixá-los agora. */
  private alcancavel(d: DocumentoDaProposta): boolean {
    return d.temBytes || (!!d.arquivoId && this.online());
  }

  private async bytesDe(d: DocumentoDaProposta): Promise<Blob> {
    const local = d.temBytes ? await this.repo.blobDoDocumento(d.id) : null;
    if (local) return local;
    if (!d.arquivoId) throw new Error('PDF sem arquivo no servidor');
    const remoto = await this.arquivos.baixarSemCache(d.arquivoId);
    return remoto.type === 'application/pdf' ? remoto : new Blob([remoto], { type: 'application/pdf' });
  }

  private avisar(mensagem: string): void {
    this.toasts.mostrar(mensagem);
    this.anuncio.set(mensagem);
  }

  /** Depois de uma transição o botão dela pode sumir: o foco vai ao título, não ao body. */
  private focarTitulo(): void {
    afterNextRender(
      () => {
        const ativo = this.host.nativeElement.ownerDocument.activeElement;
        if (!ativo || ativo === this.host.nativeElement.ownerDocument.body) this.titulo()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }
}

function linhaItem(l: ItemPropostaLocal, valores: boolean, custo: boolean): LinhaItem {
  return {
    id: l.id,
    codigo: l.codigo ?? '',
    nome: l.nome ?? '',
    descricao: l.descricao,
    quantidade: quantidadeBr(Number(deMilesimos(BigInt(l.quantidadeMilesimos)))),
    unidade: l.unidade ?? '',
    meses: l.meses,
    preco: valores ? moedaCentavos(l.precoUnitarioCentavos ?? 0) : null,
    desconto: valores ? percentualBr(Number(deCentesimos(BigInt(l.descontoCentesimos ?? 0)))) : null,
    subtotal: valores ? moedaCentavos(l.subtotalCentavos ?? 0) : null,
    custo: custo && l.precoCustoCentavos !== null ? moedaCentavos(l.precoCustoCentavos) : null,
  };
}
