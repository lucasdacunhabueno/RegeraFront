import {
  afterNextRender, Component, computed, effect, ElementRef, inject, Injector, input, signal, untracked, viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { LucideCamera, LucideDynamicIcon, LucideImage, LucideMapPin, LucidePhone } from '@lucide/angular';
import { ArquivosService, ErroDownload } from '../../core/arquivos/arquivos-service';
import type { Perfil } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { abrirJanelaEmBranco, baixarArquivo, revogarUrl } from '../../core/pdf/abrir-pdf';
import { dataBr, dataHoraBr, quantidadeBr } from '../../core/pdf/formatos-pdf';
import { PdfService } from '../../core/pdf/pdf-service';
import { DadosUploadAnexoOs, Pendencia, TIPO_UPLOAD_ANEXO_OS } from '../../core/sync/sync-models';
import { ErroCampo } from '../../core/util/erro-campo';
import { CampoRascunhoOs, gravarRascunhoOs, lerRascunhoOs } from '../../core/util/rascunho-os';
import { formatarTelefone, somenteDigitos } from '../../core/util/formatos';
import { Toasts } from '../../shared/ui/toasts';
import { VisorPdf } from '../../shared/ui/visor-pdf';
import { ClientesRepo } from '../clientes/clientes-repo';
import { deMilesimos } from '../propostas/calculo';
import { arquivoPdf, compartilharArquivo, ResultadoCompartilhar } from '../propostas/compartilhar';
import { DialogoMotivo } from '../propostas/dialogo-motivo';
import { hojeReativo } from '../propostas/hoje-reativo';
import { PdfPronto } from '../propostas/pdf-pronto';
import { stripJava, type StatusProposta } from '../propostas/proposta-models';
import { PropostasRepo } from '../propostas/propostas-repo';
import { AssinaturaTela } from './assinatura-tela';
import { ErroOs } from './erro-os';
import { mensagemErroOs, rotuloCampoOs, SeloOs, selosDaOs } from './formatos-os';
import { GaleriaOs, MOMENTOS, ROTULO_MOMENTO } from './galeria-os';
import { pdfRegeravel, recusaDePdfRegeravel } from './pdf-regeravel';
import { ESTILO_SELO_OS } from './os-card';
import {
  camposEditaveisOs, codigoOsExibido, FOTOS_MAX_OS, LEGENDA_MAX_OS, MomentoFoto, MOTIVO_MAX_OS, MOTIVO_MIN_OS, NOTA_MAX_OS,
  OsLocal, podeEditarCabecalho, podeExecutar, RESUMO_MAX_OS, RESUMO_MIN_OS, rotuloStatusOs, rotuloTipoOs, STATUS_OS, StatusOs,
  tamanhoTextoOs, textoOsValido, transicoesPermitidasOs,
} from './os-models';
import {
  AnexoOsVisivel, AssinaturaColhida, enderecoDaOs, EstadoSync, linhaDoEndereco, OsRepo,
} from './os-repo';

const MAPA = 'https://www.google.com/maps/search/?api=1&query=';
const ERRO_LEGENDA = `A legenda tem no máximo ${LEGENDA_MAX_OS} caracteres.`;
const FALHA_GRAVAR_FOTO = 'Não foi possível gravar a foto. Tente de novo.';
const FOTO_DURANTE_PDF = 'A foto chegou enquanto o PDF da OS era gerado e não foi gravada. Tire de novo.';

const SEM_INTERNET_PDF = 'Sem internet: este PDF não está no aparelho.';
const FALHA_PDF = 'Não foi possível baixar o PDF. Tente de novo.';
const SEM_INTERNET_FOTO = 'Sem internet: esta foto não está no aparelho.';
const FALHA_FOTO = 'Não foi possível baixar a foto. Tente de novo.';

/** O aviso da conclusão (Q21: com "Precisa voltar", ou sem concluir a proposta, ela continua em execução). */
const CONCLUIDA_AVULSA = 'OS concluída.';
const CONCLUIDA_COM_PROPOSTA = 'OS concluída. A proposta será atualizada ao sincronizar.';
const CONCLUIDA_COM_RETORNO = 'OS concluída. A proposta continua em execução para o retorno.';

/**
 * Por que oferecer "Gerar PDF novamente" (M2P2-R18) na OS concluída:
 * - `SEM_DOCUMENTO`: nem o aparelho nem o servidor têm o PDF da revisão atual (perdeu-se, ou a conclusão veio de outro
 *   aparelho que ainda não sincronizou);
 * - `RECUSADO`: o PDF desta revisão foi recusado com o código antigo impresso (`CODIGO_EXIBIDO_INVALIDO`: o `OSP-`
 *   trocado ou a numeração que chegou) ou sem o arquivo no aparelho (`ANEXO_AUSENTE`). Gerar de novo resolve.
 * `REVISAO_INVALIDA` e `STATUS_INVALIDO` (a OS reaberta no servidor) e `OS_CONCLUIDA_POR_OUTRO` não se resolvem assim:
 * só o Descartar das Pendências.
 */
export type MotivoRegerarOs = 'SEM_DOCUMENTO' | 'RECUSADO';

/**
 * Quem e quando, pela regra compartilhada com o repositório e as Pendências (`pdfRegeravel`): o ADMIN ou o técnico
 * atribuído, a OS concluída e, para o técnico, sem outro usuário tê-la concluído (a pendência `OS_CONCLUIDA_POR_OUTRO`
 * ou o histórico; a tela não vê a fila, e a conclusão daqui ainda sem resposta do servidor é a de `concluidaEm` null).
 */
export function motivoParaRegerarOs(
  os: OsLocal,
  anexos: readonly AnexoOsVisivel[],
  pendencias: readonly Pendencia[],
  usuario: { id: string; perfil: Perfil } | null | undefined,
): MotivoRegerarOs | null {
  if (!pdfRegeravel(os, usuario, pendencias, os.concluidaEm === null)) return null;
  const revisao = os.revisao ?? 1;
  const daRevisao = new Set(anexos.filter((a) => a.tipo === 'DOCUMENTO' && (a.revisaoOs ?? 1) === revisao).map((a) => a.id));
  const recusado = pendencias.some((p) => {
    const anexoId = (p.mutacao.dados as DadosUploadAnexoOs | null)?.anexoId;
    return recusaDePdfRegeravel(p, os, anexoId && daRevisao.has(anexoId) ? revisao : undefined);
  });
  if (recusado) return 'RECUSADO';
  return daRevisao.size === 0 ? 'SEM_DOCUMENTO' : null;
}

/** O nome do PDF da OS: o código impresso nele (`OS-000123.pdf`, `OS-000123-R2.pdf` ou `OSP-….pdf`), como no upload. */
export function nomeDoPdfOs(codigoExibido: string): string {
  return `${codigoExibido}.pdf`;
}

/** `tel:` com o +55 no número brasileiro com DDD (10 ou 11 dígitos), que disca de qualquer lugar; null sem número. */
function linkTelefone(telefone: string | null | undefined): string | null {
  const d = somenteDigitos(telefone);
  if (d === '') return null;
  if (d.length === 10 || d.length === 11) return `tel:+55${d}`;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return `tel:+${d}`;
  return `tel:${d}`;
}

interface LinhaNota {
  id: string;
  texto: string;
  autor: string;
  quando: string;
  pendente: boolean;
}

interface AssinaturaVista {
  nome: string | null;
  papel: string | null;
  miniatura: Blob | null;
}

/** Os diálogos das ações do escritório (T4). */
type DialogoEscritorio = 'cancelar' | 'reabrir' | 'aceitar' | 'excluir';

/**
 * A OS (`/os/:id`, spec M2 §9), a mesma página para todos os perfis (M2P3-R2): o técnico atribuído e o ADMIN executam;
 * o COMERCIAL (e o técnico que não é o atribuído) só lê, salvo as notas do COMERCIAL responsável em ABERTA e
 * EM_ANDAMENTO (a matriz, `camposEditaveisOs`). O COMERCIAL não abre a OS de outro (a mesma regra do `observarTodas`).
 *
 * - Escritório (T4, ADMIN e COMERCIAL responsável), conforme `transicoesPermitidasOs` e `camposEditaveisOs`: "Editar"
 *   (`/os/:id/editar`, o cabeçalho), "Atribuir/Trocar técnico" (ABERTA e EM_ANDAMENTO; em andamento sem "Nenhum"),
 *   "Trocar responsável" (FW-R4: só o ADMIN, só na OS avulsa, ABERTA e EM_ANDAMENTO; na de proposta ele segue o da
 *   proposta), "Cancelar OS" com o motivo (ADMIN; o COMERCIAL só em ABERTA), "Reabrir" com o motivo (ADMIN,
 *   CONCLUIDA), "Aceitar o trabalho" com confirmação (M2-R4: ADMIN, a proposta CANCELADA e a OS em andamento ou
 *   concluída; FW-R3: com a OS ainda aberta a faixa sugere cancelá-la) e "Excluir OS" (ABERTA sem técnico). Com a
 *   proposta cancelada, uma faixa avisa. A trava do CONFLITO (P4c-R15) vale para atribuir (técnico e responsável),
 *   cancelar, reabrir e aceitar, como no repositório; o cabeçalho e a exclusão seguem. Cada ação guarda o id da OS no
 *   começo e não escreve na tela se a rota trocou de OS no meio.
 *
 * - Cabeçalho: código, status, tipo e selos; o cliente (nome e telefone com `tel:`, nunca o CPF/CNPJ), o endereço
 *   *snapshot* com o link do mapa (nova aba), a data prevista e a proposta; no escritório, o técnico e o responsável.
 *   Descrição e itens (código, nome e quantidade prevista). A OS não tem valores.
 * - ABERTA: "Iniciar OS"; notas; as fotos só depois de iniciar.
 * - EM_ANDAMENTO: notas (só se acrescentam), fotos (a câmera ou, FW-R1, a galeria do aparelho, uma de cada vez, momento
 *   e legenda, galeria `n/20`) e o concluir: resumo, assinatura em tela cheia ou "Cliente não pôde assinar" com o
 *   motivo, "Precisa voltar" (Q21) e "Concluir e gerar PDF" (`OsRepo.concluir` com o `PdfService.gerarBlobOs`, depois o
 *   compartilhamento ou o painel "PDF pronto", P4c-R8).
 * - CONCLUIDA: resumo, assinatura ou recusa, o PDF para abrir e compartilhar (bytes do aparelho ou download sem cache,
 *   nunca pelo cache de arquivos) e "Gerar PDF novamente" quando falta ou foi recusado (`motivoParaRegerarOs`). O
 *   técnico atribuído ainda acrescenta notas e fotos, e o ADMIN notas (M2P1-R26, evidência).
 * - CANCELADA: o motivo; o técnico atribuído ainda acrescenta notas e fotos (M2P1-R26, M2P3-R9).
 * - CONFLITO da OS (P4c-R15): iniciar, concluir e gerar o PDF ficam desabilitados com "Resolva a pendência primeiro";
 *   notas, fotos e assinatura continuam (só se acrescentam).
 * Os erros saem pelo `mensagemErroOs`: os da foto e da nota no próprio campo, os de uma ação num toast. O resumo e a
 * nota digitados ficam no rascunho da aba (FW-R2, `rascunho-os`) até serem gravados.
 */
@Component({
  selector: 'app-os-execucao-page',
  imports: [RouterLink, LucideDynamicIcon, VisorPdf, PdfPronto, DialogoMotivo, AssinaturaTela, GaleriaOs],
  template: `
    <a routerLink="/os" class="inline-flex min-h-12 items-center text-sm text-blue-700">← {{ escritorio() ? 'Ordens de serviço' : 'Minhas OS' }}</a>
    <p role="status" aria-live="polite" class="sr-only">{{ anuncio() }}</p>

    @if (carregando()) {
      <p data-testid="carregando" class="py-8 text-center text-slate-500">Carregando…</p>
    } @else if (!os()) {
      <div class="py-8 text-center text-slate-600">
        <p>OS não encontrada neste aparelho.</p>
        <a routerLink="/os" class="mt-2 inline-flex min-h-12 items-center font-semibold text-blue-700 underline">Ver as OS</a>
      </div>
    } @else {
      @let o = os()!;
      <!-- com a folha "PDF pronto" no rodapé do celular, o fim da página continua alcançável -->
      <div class="space-y-4 sm:pb-0" [class.pb-72]="!!pdfPronto()">
        <header class="space-y-2">
          <h1 #titulo tabindex="-1" class="font-mono text-xl font-semibold outline-none">{{ codigo() }}</h1>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span data-status [attr.class]="'rounded-full px-2 py-0.5 text-xs font-medium ' + status().cor">{{ status().rotulo }}</span>
            <span class="text-slate-600">{{ tipo() }}</span>
          </div>
          @if (selos().length > 0) {
            <ul class="flex flex-wrap gap-1.5" aria-label="Avisos">
              @for (s of selos(); track s.tipo) {
                <li [attr.data-selo]="s.tipo" [attr.class]="'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ' + estilo(s).cor">
                  <svg [lucideIcon]="estilo(s).icone" [size]="12" aria-hidden="true"></svg>
                  {{ s.rotulo }}
                </li>
              }
            </ul>
          }
        </header>

        @if (pendencias().length > 0) {
          <section data-testid="pendencia" aria-labelledby="pendencia-titulo"
                   class="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <h2 id="pendencia-titulo" class="font-semibold">Pendência de sincronização</h2>
            <ul class="space-y-3 text-sm">
              @for (x of pendencias(); track x.mutationId) {
                <li class="space-y-2">
                  @if (x.tipo === 'CONFLITO') {
                    <p>Conflito: esta OS mudou em outro lugar depois que você a alterou aqui.</p>
                  } @else if (x.entidade === uploadAnexo) {
                    <p>{{ x.erro?.mensagem }}</p>
                  } @else {
                    <p>O servidor recusou: {{ x.erro?.mensagem }}</p>
                    @if (camposDa(x).length > 0) {
                      <ul class="list-disc pl-5">
                        @for (m of camposDa(x); track $index) { <li>{{ m }}</li> }
                      </ul>
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
                ? 'O PDF desta OS não está no aparelho nem no servidor. Se ele foi gerado em outro aparelho, sincronize esse aparelho antes.'
                : 'Gere o PDF de novo com o código atual: ele substitui o que foi recusado e vai na próxima sincronização.' }}
            </p>
            @if (conflito()) {
              <p id="dica-pendencia-regerar" class="font-semibold">Resolva a pendência primeiro.</p>
            }
            <button #botaoRegerar type="button" (click)="regerar()" [disabled]="ocupado() || conflito() || gravandoCampo()"
                    [attr.aria-describedby]="conflito() ? 'dica-pendencia-regerar' : null"
                    class="h-12 w-full rounded-lg bg-amber-700 px-4 font-semibold text-white disabled:opacity-60 sm:w-auto">
              {{ regerando() ? 'Gerando PDF…' : 'Gerar PDF novamente' }}
            </button>
          </section>
        }

        @if (o.status === 'CANCELADA') {
          <section data-testid="cancelada" aria-labelledby="cancelada-titulo" class="space-y-1 rounded-xl bg-white p-4 text-sm">
            <h2 id="cancelada-titulo" class="font-semibold">OS cancelada</h2>
            <p class="whitespace-pre-line text-slate-700">{{ o.motivoCancelamento ?? 'Sem motivo informado.' }}</p>
          </section>
        }

        @if (escritorio() && (temAcoesEscritorio() || propostaCancelada())) {
          <section data-testid="acoes-os" aria-labelledby="acoes-os-titulo" class="space-y-3 rounded-xl bg-white p-4">
            <h2 id="acoes-os-titulo" class="sr-only">Ações do escritório</h2>
            @if (propostaCancelada()) {
              <p data-testid="proposta-cancelada" class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                @if (aceito()) {
                  Trabalho aceito: a proposta reabre ao sincronizar.
                } @else if (o.status === 'ABERTA') {
                  <!-- FW-R3: sem trabalho feito, não há o que aceitar -->
                  A proposta desta OS foi cancelada.
                  A OS ainda não começou: se o serviço não vai acontecer, cancele a OS.
                } @else {
                  A proposta desta OS foi cancelada.
                  {{ admin() ? 'Aceite o trabalho para reabrir a proposta.' : 'Só o administrador aceita o trabalho, reabrindo a proposta.' }}
                }
              </p>
            }
            @if (conflito() && temAcaoTravada()) {
              <p id="dica-pendencia-escritorio" class="text-sm text-amber-800">Resolva a pendência primeiro.</p>
            }
            <div class="flex flex-wrap gap-2">
              @if (podeEditar()) {
                <a [routerLink]="['/os', o.id, 'editar']"
                   class="inline-flex h-12 items-center rounded-lg border border-slate-300 px-4 font-semibold text-slate-700">Editar</a>
              }
              @if (podeAtribuir() && !atribuindo()) {
                <button #botaoAtribuir type="button" (click)="abrirAtribuir()" [disabled]="ocupado() || conflito()"
                        [attr.aria-describedby]="conflito() ? 'dica-pendencia-escritorio' : null"
                        class="h-12 rounded-lg border border-slate-300 px-4 font-semibold text-slate-700 disabled:opacity-60">
                  {{ o.tecnicoId ? 'Trocar técnico' : 'Atribuir técnico' }}
                </button>
              }
              @if (podeTrocarResponsavel() && !trocandoResponsavel()) {
                <button #botaoResponsavel type="button" (click)="abrirResponsavel()" [disabled]="ocupado() || conflito()"
                        [attr.aria-describedby]="conflito() ? 'dica-pendencia-escritorio' : null"
                        class="h-12 rounded-lg border border-slate-300 px-4 font-semibold text-slate-700 disabled:opacity-60">Trocar responsável</button>
              }
              @if (podeAceitar()) {
                <button type="button" (click)="abrirDialogo('aceitar', $any($event.currentTarget))" [disabled]="ocupado() || conflito()"
                        [attr.aria-describedby]="conflito() ? 'dica-pendencia-escritorio' : null"
                        class="h-12 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-60">Aceitar o trabalho</button>
              }
              @if (podeReabrir()) {
                <button type="button" (click)="abrirDialogo('reabrir', $any($event.currentTarget))" [disabled]="ocupado() || conflito()"
                        [attr.aria-describedby]="conflito() ? 'dica-pendencia-escritorio' : null"
                        class="h-12 rounded-lg border border-slate-300 px-4 font-semibold text-slate-700 disabled:opacity-60">Reabrir</button>
              }
              @if (podeCancelar()) {
                <button type="button" (click)="abrirDialogo('cancelar', $any($event.currentTarget))" [disabled]="ocupado() || conflito()"
                        [attr.aria-describedby]="conflito() ? 'dica-pendencia-escritorio' : null"
                        class="h-12 rounded-lg border border-red-300 px-4 font-semibold text-red-700 disabled:opacity-60">Cancelar OS</button>
              }
              @if (podeExcluir()) {
                <button type="button" (click)="abrirDialogo('excluir', $any($event.currentTarget))" [disabled]="ocupado()"
                        class="h-12 rounded-lg border border-red-300 px-4 font-semibold text-red-700 disabled:opacity-60">Excluir OS</button>
              }
            </div>
            @if (atribuindo()) {
              <div class="space-y-2">
                <label for="tecnico-atribuir-os" class="block text-sm font-medium">Técnico da OS</label>
                <select #selectTecnico id="tecnico-atribuir-os" (change)="tecnicoEscolhido.set($any($event.target).value)"
                        class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 sm:w-72">
                  @if (o.status === 'ABERTA') {
                    <option value="" [selected]="!tecnicoEscolhido()">Nenhum</option>
                  }
                  @for (t of tecnicos(); track t.id) {
                    <option [value]="t.id" [selected]="t.id === tecnicoEscolhido()">{{ t.rotulo }}</option>
                  }
                </select>
                <div class="flex gap-2">
                  <button #botaoSalvarTecnico type="button" (click)="salvarTecnico()" [disabled]="ocupado() || conflito()"
                          class="h-12 flex-1 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-60 sm:flex-none">Salvar técnico</button>
                  <button type="button" (click)="fecharAtribuir()"
                          class="h-12 flex-1 rounded-lg border border-slate-300 px-4 font-semibold sm:flex-none">Cancelar</button>
                </div>
              </div>
            }
            @if (trocandoResponsavel()) {
              <div class="space-y-2">
                <label for="responsavel-os" class="block text-sm font-medium">Responsável da OS</label>
                <select #selectResponsavel id="responsavel-os" (change)="responsavelEscolhido.set($any($event.target).value)"
                        class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 sm:w-72">
                  @for (r of responsaveis(); track r.id) {
                    <option [value]="r.id" [selected]="r.id === responsavelEscolhido()">{{ r.rotulo }}</option>
                  }
                </select>
                <div class="flex gap-2">
                  <button #botaoSalvarResponsavel type="button" (click)="salvarResponsavel()" [disabled]="ocupado() || conflito()"
                          class="h-12 flex-1 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-60 sm:flex-none">Salvar responsável</button>
                  <button type="button" (click)="fecharResponsavel()"
                          class="h-12 flex-1 rounded-lg border border-slate-300 px-4 font-semibold sm:flex-none">Cancelar</button>
                </div>
              </div>
            }
          </section>
        }

        @if (podeIniciar()) {
          <section aria-label="Iniciar" class="space-y-2 rounded-xl bg-white p-4">
            @if (conflito()) {
              <p id="dica-pendencia-iniciar" class="text-sm text-amber-800">Resolva a pendência primeiro.</p>
            }
            <button #botaoIniciar type="button" (click)="iniciar()" [disabled]="ocupado() || conflito()"
                    [attr.aria-describedby]="conflito() ? 'dica-pendencia-iniciar' : null"
                    class="h-12 w-full rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-60 lg:w-auto">
              {{ iniciando() ? 'Iniciando…' : 'Iniciar OS' }}
            </button>
          </section>
        }

        <section aria-labelledby="dados-titulo" class="space-y-3 rounded-xl bg-white p-4">
          <h2 id="dados-titulo" class="font-semibold">Cliente e local</h2>
          <dl class="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt class="text-slate-500">Cliente</dt>
            <dd class="space-y-1">
              <span class="block font-medium">{{ clienteNome() }}</span>
              @if (telefone(); as t) {
                <a [href]="t.href" class="inline-flex min-h-12 items-center gap-2 font-semibold text-blue-700 underline">
                  <svg [lucideIcon]="iconeTelefone" [size]="16" aria-hidden="true"></svg>
                  {{ t.texto }}
                </a>
              }
            </dd>
            <dt class="text-slate-500">Endereço</dt>
            <dd class="space-y-1">
              @if (endereco(); as e) {
                <span class="block">{{ e }}</span>
                <a data-testid="mapa" [href]="urlMapa()" target="_blank" rel="noopener noreferrer"
                   aria-label="Abrir no mapa (nova aba)"
                   class="inline-flex min-h-12 items-center gap-2 font-semibold text-blue-700 underline">
                  <svg [lucideIcon]="iconeMapa" [size]="16" aria-hidden="true"></svg>
                  Abrir no mapa
                </a>
              } @else {
                <span class="text-slate-500">Sem endereço</span>
              }
            </dd>
            <dt class="text-slate-500">Data prevista</dt>
            <dd data-testid="prevista">{{ data(o.dataPrevista) || 'Sem data prevista' }}</dd>
            @if (o.propostaCodigoExibido; as pc) {
              <dt class="text-slate-500">Proposta</dt>
              <dd>
                @if (escritorio() && o.propostaId) {
                  <a [routerLink]="['/propostas', o.propostaId]" class="inline-flex min-h-12 items-center text-blue-700 underline lg:min-h-0">Proposta {{ pc }}</a>
                } @else {
                  Proposta {{ pc }}
                }
              </dd>
            }
            @if (escritorio()) {
              <dt class="text-slate-500">Técnico</dt>
              <dd data-testid="tecnico">{{ o.tecnicoId ? (nome(o.tecnicoId) ?? 'Técnico não identificado') : 'Nenhum' }}</dd>
              <dt class="text-slate-500">Responsável</dt>
              <dd data-testid="responsavel">
                {{ o.responsavelId ? (nome(o.responsavelId) ?? 'Não identificado') : '—' }}
                @if (admin() && o.propostaId && (o.status === 'ABERTA' || o.status === 'EM_ANDAMENTO')) {
                  <span class="block text-xs text-slate-500">O responsável segue o da proposta.</span>
                }
              </dd>
            }
            @if (iniciadaEm(); as i) {
              <dt class="text-slate-500">Iniciada em</dt>
              <dd>{{ i }}</dd>
            }
            @if (o.concluidaEm) {
              <dt class="text-slate-500">Concluída em</dt>
              <dd>{{ dataHora(o.concluidaEm) }}</dd>
            }
          </dl>
        </section>

        @if (o.descricao) {
          <section aria-labelledby="descricao-titulo" class="space-y-2 rounded-xl bg-white p-4">
            <h2 id="descricao-titulo" class="font-semibold">Descrição</h2>
            <p data-testid="descricao" class="whitespace-pre-line text-sm text-slate-700">{{ o.descricao }}</p>
          </section>
        }

        <section aria-labelledby="itens-titulo" class="space-y-3 rounded-xl bg-white p-4">
          <h2 id="itens-titulo" class="font-semibold">Itens</h2>
          <ul data-testid="itens" class="divide-y divide-slate-100 text-sm">
            @for (l of itens(); track l.id) {
              <li class="flex items-baseline justify-between gap-3 py-2">
                <span class="min-w-0">
                  <span data-nome class="block font-medium">{{ l.nome }}</span>
                  <span data-codigo class="block font-mono text-xs text-slate-500">{{ l.codigo }}</span>
                </span>
                <span data-quantidade class="shrink-0 font-semibold">{{ l.quantidade }}</span>
              </li>
            } @empty {
              <li class="py-2 text-slate-500">Nenhum item.</li>
            }
          </ul>
        </section>

        @if (o.status === 'CONCLUIDA') {
          <section data-testid="conclusao" aria-labelledby="conclusao-titulo" class="space-y-3 rounded-xl bg-white p-4 text-sm">
            <h2 id="conclusao-titulo" class="font-semibold">Conclusão</h2>
            <div>
              <p class="text-slate-500">Resumo da execução</p>
              <p class="whitespace-pre-line text-slate-900">{{ o.resumoExecucao ?? '—' }}</p>
            </div>
            @if (assinaturaVista(); as a) {
              <div class="space-y-2">
                <p>Assinada por {{ a.nome ?? 'nome não informado' }}{{ a.papel ? ' (' + a.papel + ')' : '' }}</p>
                @if (urlAssinatura(); as url) {
                  <img [src]="url" [alt]="'Assinatura de ' + (a.nome ?? 'quem assinou')" class="h-24 w-auto rounded border border-slate-200 bg-white" />
                }
              </div>
            } @else if (o.assinaturaRecusada) {
              <p>Cliente não pôde assinar: {{ o.motivoRecusa }}</p>
            }
            @if (o.propostaId && !o.concluiProposta) {
              <p class="text-amber-800">Retorno pendente: esta OS não conclui a proposta.</p>
            }
          </section>
        }

        <section aria-labelledby="notas-titulo" class="space-y-3 rounded-xl bg-white p-4">
          <h2 id="notas-titulo" class="font-semibold">Notas</h2>
          <ul data-testid="notas" class="space-y-2 text-sm">
            @for (n of notas(); track n.id) {
              <li class="border-l-2 border-slate-200 pl-3">
                <p class="whitespace-pre-line break-words text-slate-900">{{ n.texto }}</p>
                <p class="text-xs text-slate-500">
                  {{ n.autor }} · {{ n.quando }}
                  @if (n.pendente) { <span class="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Não sincronizada</span> }
                </p>
              </li>
            } @empty {
              <li class="text-slate-500">Nenhuma nota ainda.</li>
            }
          </ul>
          @if (podeNotar()) {
            <div class="space-y-1">
              <label for="nota-nova" class="text-sm font-medium">Nova nota</label>
              <textarea #campoNota id="nota-nova" name="nota" rows="3" [value]="nota()" (input)="digitarNota($any($event.target).value)"
                        [attr.aria-invalid]="erroNota() ? 'true' : 'false'"
                        [attr.aria-describedby]="'nota-ajuda' + (erroNota() ? ' erro-nota' : '')"
                        class="w-full rounded-lg border px-3 py-2" [class.border-slate-300]="!erroNota()" [class.border-red-600]="erroNota()"></textarea>
              <p id="nota-ajuda" class="text-xs text-slate-500">
                A nota não se edita depois. <span [class.text-red-600]="tamanhoNota() > maxNota">{{ tamanhoNota() }}/{{ maxNota }}</span>
              </p>
              @if (erroNota(); as e) { <p id="erro-nota" data-testid="erro-nota" role="alert" class="text-sm text-red-600">{{ e }}</p> }
              <button type="button" (click)="adicionarNota()" [disabled]="gravandoNota()"
                      class="h-12 w-full rounded-lg border border-blue-600 px-4 font-semibold text-blue-700 disabled:opacity-60 sm:w-auto">
                {{ gravandoNota() ? 'Adicionando…' : 'Adicionar' }}
              </button>
            </div>
          }
        </section>

        @if (podeFotografar() || fotoDepoisDeIniciar() || fotos().length > 0 || erroFoto()) {
          <section aria-labelledby="fotos-titulo" class="space-y-3 rounded-xl bg-white p-4">
            <h2 #tituloFotos id="fotos-titulo" tabindex="-1" class="font-semibold outline-none">Fotos</h2>
            @if (fotoDepoisDeIniciar()) {
              <p class="text-sm text-slate-600">Inicie a OS para tirar fotos.</p>
            }
            <!-- fora do bloco de captura: a recusa de uma foto que chega com a OS já em outro status continua visível -->
            @if (erroFoto(); as e) { <p id="erro-foto" data-testid="erro-foto" role="alert" class="text-sm text-red-600">{{ e }}</p> }
            @if (podeFotografar()) {
              <div class="space-y-3">
                <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Momento da foto">
                  <span class="text-sm text-slate-600" aria-hidden="true">Momento:</span>
                  @for (m of momentos; track m) {
                    <button type="button" (click)="escolherMomento(m)" [attr.aria-pressed]="momento() === m"
                            class="min-h-12 rounded-full border px-4 text-sm"
                            [class.border-blue-600]="momento() === m" [class.bg-blue-50]="momento() === m"
                            [class.border-slate-300]="momento() !== m">{{ rotuloMomento[m] }}</button>
                  }
                </div>
                <div class="space-y-1">
                  <label for="foto-legenda" class="text-sm font-medium">Legenda (opcional)</label>
                  <input #campoLegenda id="foto-legenda" name="legenda" type="text" [value]="legenda()" (input)="digitarLegenda($any($event.target).value)"
                         [attr.aria-invalid]="legendaLonga() ? 'true' : 'false'"
                         [attr.aria-describedby]="'legenda-ajuda' + (erroFoto() === erroLegenda ? ' erro-foto' : '')"
                         class="h-12 w-full rounded-lg border px-3" [class.border-slate-300]="!legendaLonga()" [class.border-red-600]="legendaLonga()" />
                  <p id="legenda-ajuda" class="text-xs text-slate-500">
                    Vale para a próxima foto. <span [class.text-red-600]="legendaLonga()">{{ tamanhoLegenda() }}/{{ maxLegenda }}</span>
                  </p>
                </div>
                @if (dicaFoto(); as d) {
                  <p id="dica-foto" class="text-sm text-slate-600">{{ d }}</p>
                }
                <!-- FW-R1 (Q13): a câmera e a galeria (a foto tirada fora do app, ou a câmera que recarregou a página) -->
                <input #inputFoto type="file" accept="image/*" capture="environment" class="hidden" (change)="fotoEscolhida($event)" />
                <input #inputGaleria data-testid="input-galeria" type="file" accept="image/*" class="hidden" (change)="fotoEscolhida($event)" />
                <div class="flex flex-col gap-2 sm:flex-row">
                  <button #botaoFoto type="button" (click)="tirarFoto(inputFoto)" [disabled]="gravandoFoto() || limiteFotos() || ocupado()"
                          [attr.aria-describedby]="dicaFoto() ? 'dica-foto' : null"
                          class="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-60 sm:w-auto">
                    <svg [lucideIcon]="iconeCamera" [size]="18" aria-hidden="true"></svg>
                    {{ gravandoFoto() ? 'Gravando foto…' : 'Tirar foto' }}
                  </button>
                  <button #botaoGaleria type="button" (click)="tirarFoto(inputGaleria)" [disabled]="gravandoFoto() || limiteFotos() || ocupado()"
                          [attr.aria-describedby]="dicaFoto() ? 'dica-foto' : null"
                          class="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-blue-600 px-4 font-semibold text-blue-700 disabled:opacity-60 sm:w-auto">
                    <svg [lucideIcon]="iconeGaleria" [size]="18" aria-hidden="true"></svg>
                    Escolher da galeria
                  </button>
                </div>
              </div>
            }
            <app-galeria-os [fotos]="fotos()" (abrir)="abrirFoto($event)" />
          </section>
        }

        @if (emExecucao()) {
          <section aria-labelledby="concluir-titulo" class="space-y-4 rounded-xl bg-white p-4">
            <h2 id="concluir-titulo" class="font-semibold">Concluir a OS</h2>

            <div class="space-y-1">
              <label for="resumo" class="text-sm font-medium">Resumo da execução</label>
              <textarea #campoResumo id="resumo" name="resumo" rows="4" [value]="resumo()" (input)="digitarResumo($any($event.target).value)"
                        aria-required="true" [attr.aria-invalid]="erroResumo() ? 'true' : 'false'"
                        [attr.aria-describedby]="'resumo-ajuda' + (erroResumo() ? ' erro-resumo' : '')"
                        class="w-full rounded-lg border px-3 py-2" [class.border-slate-300]="!erroResumo()" [class.border-red-600]="erroResumo()"></textarea>
              <p id="resumo-ajuda" class="text-xs text-slate-500">
                O que foi feito, em poucas linhas: vai no PDF. <span [class.text-red-600]="tamanhoResumo() > maxResumo">{{ tamanhoResumo() }}/{{ maxResumo }}</span>
              </p>
              @if (erroResumo(); as e) { <p id="erro-resumo" data-testid="erro-resumo" role="alert" class="text-sm text-red-600">{{ e }}</p> }
            </div>

            <div data-testid="assinatura" class="space-y-2">
              <p class="text-sm font-medium">Assinatura do cliente</p>
              @if (assinaturaVista(); as a) {
                <p class="text-sm">Assinada por {{ a.nome ?? 'nome não informado' }}{{ a.papel ? ' (' + a.papel + ')' : '' }}</p>
                @if (urlAssinatura(); as url) {
                  <img [src]="url" [alt]="'Assinatura de ' + (a.nome ?? 'quem assinou')" class="h-24 w-auto rounded border border-slate-200 bg-white" />
                }
              } @else if (o.assinaturaRecusada) {
                <p class="text-sm">Cliente não pôde assinar: {{ o.motivoRecusa }}</p>
              } @else {
                <p class="text-sm text-slate-500">Ainda sem assinatura.</p>
              }
              @if (erroAssinatura(); as e) {
                <p id="erro-assinatura-os" data-testid="erro-assinatura-os" role="alert" class="text-sm text-red-600">{{ e }}</p>
              }
              <div class="flex flex-col gap-2 sm:flex-row">
                <button #botaoColher type="button" (click)="abrirAssinatura($any($event.currentTarget))" [disabled]="ocupado()"
                        [attr.aria-describedby]="erroAssinatura() ? 'erro-assinatura-os' : null"
                        class="h-12 rounded-lg border border-blue-600 px-4 font-semibold text-blue-700 disabled:opacity-60">
                  {{ assinada() ? 'Colher de novo' : 'Colher assinatura' }}
                </button>
                @if (!assinada()) {
                  <button type="button" (click)="abrirRecusa($any($event.currentTarget))" [disabled]="ocupado()"
                          [attr.aria-describedby]="erroAssinatura() ? 'erro-assinatura-os' : null"
                          class="h-12 rounded-lg border border-slate-300 px-4 font-semibold text-slate-700 disabled:opacity-60">Cliente não pôde assinar</button>
                }
              </div>
            </div>

            @if (o.propostaId) {
              @if (o.concluiProposta) {
                <!-- um alvo só (a caixa e o texto), de pelo menos 48 px -->
                <label for="precisa-voltar" class="flex min-h-12 cursor-pointer items-start gap-3 py-1">
                  <input id="precisa-voltar" name="precisaVoltar" type="checkbox" [checked]="precisaVoltar()"
                         (change)="precisaVoltar.set($any($event.target).checked)" [disabled]="ocupado()"
                         class="mt-0.5 size-5 shrink-0" />
                  <span>
                    <span class="block text-sm font-medium">Precisa voltar</span>
                    <span class="block text-xs text-slate-500">
                      Falta peça ou parte do serviço. A proposta continua em execução, e o escritório agenda o retorno.
                    </span>
                  </span>
                </label>
              } @else {
                <p class="text-sm text-slate-600">Esta OS não conclui a proposta: ela continua em execução depois da conclusão.</p>
              }
            }

            @if (conflito()) {
              <p id="dica-pendencia-concluir" class="text-sm text-amber-800">Resolva a pendência primeiro.</p>
            } @else if (gravandoCampo()) {
              <p id="dica-gravando-concluir" class="text-sm text-slate-600">Aguarde: {{ gravandoFoto() ? 'a foto' : gravandoNota() ? 'a nota' : 'a assinatura' }} ainda está sendo gravada.</p>
            }
            <button #botaoConcluir type="button" (click)="concluir()" [disabled]="ocupado() || conflito() || gravandoCampo()"
                    [attr.aria-describedby]="conflito() ? 'dica-pendencia-concluir' : gravandoCampo() ? 'dica-gravando-concluir' : null"
                    class="h-12 w-full rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-60 lg:w-auto">
              {{ concluindo() ? 'Gerando PDF…' : 'Concluir e gerar PDF' }}
            </button>
          </section>
        }

        @if (documentos().length > 0) {
          <section data-testid="documentos" aria-labelledby="documentos-titulo" class="space-y-3 rounded-xl bg-white p-4">
            <h2 id="documentos-titulo" class="font-semibold">PDF da OS</h2>
            <ul class="divide-y divide-slate-100">
              @for (d of documentos(); track d.id) {
                <li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span class="min-w-0">
                    <span class="block font-mono font-semibold">{{ d.codigoExibido }}</span>
                    <span class="block text-slate-500">Revisão {{ d.revisaoOs ?? 1 }} · {{ dataHora(d.tiradaEm) }} · {{ d.enviado ? 'Enviado' : 'Aguardando envio' }}</span>
                  </span>
                  <span class="flex gap-2">
                    <button type="button" (click)="abrirDocumento(d)" [attr.aria-label]="'Abrir ' + d.codigoExibido"
                            class="h-12 rounded-lg border border-slate-300 px-4 font-semibold">Abrir</button>
                    <button type="button" (click)="compartilharDocumento(d, $any($event.currentTarget))" [disabled]="ocupado()" [attr.aria-label]="'Compartilhar ' + d.codigoExibido"
                            class="h-12 rounded-lg border border-blue-600 px-4 font-semibold text-blue-700 disabled:opacity-60">Compartilhar</button>
                  </span>
                </li>
              }
            </ul>
            <app-visor-pdf #visorDocumento [titulo]="'PDF ' + (documentoAberto()?.codigoExibido ?? '')" rotuloAbrir="Abrir PDF"
                           textoAba="O PDF foi aberto em uma nova aba." textoGerando="Abrindo PDF…"
                           [nomeArquivo]="nomeDoPdf(documentoAberto()?.codigoExibido ?? codigo())" />
          </section>
        }

        @if (escritorio()) {
          <section data-testid="historico" aria-labelledby="historico-titulo" class="space-y-3 rounded-xl bg-white p-4">
            <h2 id="historico-titulo" class="font-semibold">Histórico</h2>
            <ol class="space-y-2 text-sm">
              @for (h of o.historico; track $index) {
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

      @if (assinando()) {
        <app-assinatura-tela [gatilho]="gatilho()" [ocupado]="gravandoAssinatura()" [erro]="erroTelaAssinatura()"
                             (confirmado)="assinar($event)" (cancelado)="assinando.set(false)" />
      }
      @switch (dialogoEscritorio()) {
        @case ('cancelar') {
          <app-dialogo-motivo [gatilho]="gatilho()" titulo="Cancelar OS"
                              texto="O motivo fica no histórico da OS. A proposta não muda: decida depois se gera outra OS."
                              rotuloConfirmar="Cancelar OS" rotuloCancelar="Voltar" [perigo]="true" [ocupado]="ocupado()"
                              (confirmado)="cancelarOs($event)" (cancelado)="dialogoEscritorio.set(null)" />
        }
        @case ('reabrir') {
          <app-dialogo-motivo [gatilho]="gatilho()" titulo="Reabrir OS"
                              texto="A OS volta para em andamento, com uma nova revisão: o PDF da próxima conclusão sai com o código novo."
                              rotuloConfirmar="Reabrir" rotuloCancelar="Voltar" [ocupado]="ocupado()"
                              (confirmado)="reabrirOs($event)" (cancelado)="dialogoEscritorio.set(null)" />
        }
        @case ('aceitar') {
          <app-dialogo-motivo [gatilho]="gatilho()" titulo="Aceitar o trabalho"
                              texto="A proposta desta OS foi cancelada. Aceitar o trabalho reabre a proposta no servidor: ela volta para em execução, ou para finalizada se todo o trabalho acabou."
                              rotuloConfirmar="Aceitar o trabalho" rotuloCancelar="Voltar" [pedirMotivo]="false" [ocupado]="ocupado()"
                              (confirmado)="aceitarTrabalho()" (cancelado)="dialogoEscritorio.set(null)" />
        }
        @case ('excluir') {
          <app-dialogo-motivo [gatilho]="gatilho()" titulo="Excluir OS" texto="A OS sai deste aparelho e do servidor. Não dá para desfazer."
                              rotuloConfirmar="Excluir" rotuloCancelar="Voltar" [pedirMotivo]="false" [perigo]="true" [ocupado]="ocupado()"
                              (confirmado)="excluirOs()" (cancelado)="dialogoEscritorio.set(null)" />
        }
      }
      @if (recusando()) {
        <app-dialogo-motivo [gatilho]="gatilho()" titulo="Cliente não pôde assinar"
                            texto="O motivo vai no PDF da OS, no lugar da assinatura." rotuloConfirmar="Registrar"
                            [ocupado]="ocupado()" (confirmado)="recusar($event)" (cancelado)="recusando.set(false)" />
      }
    }
  `,
})
export class OsExecucaoPage {
  /** `:id` da rota. */
  readonly id = input.required<string>();

  private readonly repo = inject(OsRepo);
  private readonly propostas = inject(PropostasRepo);
  private readonly router = inject(Router);
  private readonly pdf = inject(PdfService);
  private readonly arquivos = inject(ArquivosService);
  private readonly toasts = inject(Toasts);
  private readonly online = inject(ConectividadeService).online;
  private readonly usuario = inject(AuthService).usuario;
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly titulo = viewChild<ElementRef<HTMLElement>>('titulo');
  private readonly campoNota = viewChild<ElementRef<HTMLTextAreaElement>>('campoNota');
  private readonly campoResumo = viewChild<ElementRef<HTMLTextAreaElement>>('campoResumo');
  private readonly campoLegenda = viewChild<ElementRef<HTMLInputElement>>('campoLegenda');
  private readonly botaoColher = viewChild<ElementRef<HTMLButtonElement>>('botaoColher');
  private readonly botaoFoto = viewChild<ElementRef<HTMLButtonElement>>('botaoFoto');
  private readonly botaoConcluir = viewChild<ElementRef<HTMLButtonElement>>('botaoConcluir');
  private readonly tituloFotos = viewChild<ElementRef<HTMLElement>>('tituloFotos');
  private readonly visorDocumento = viewChild('visorDocumento', { read: VisorPdf });
  private readonly botaoAtribuir = viewChild<ElementRef<HTMLButtonElement>>('botaoAtribuir');
  private readonly selectTecnico = viewChild<ElementRef<HTMLSelectElement>>('selectTecnico');
  private readonly botaoSalvarTecnico = viewChild<ElementRef<HTMLButtonElement>>('botaoSalvarTecnico');
  private readonly botaoResponsavel = viewChild<ElementRef<HTMLButtonElement>>('botaoResponsavel');
  private readonly selectResponsavel = viewChild<ElementRef<HTMLSelectElement>>('selectResponsavel');
  private readonly botaoSalvarResponsavel = viewChild<ElementRef<HTMLButtonElement>>('botaoSalvarResponsavel');
  private readonly botaoIniciar = viewChild<ElementRef<HTMLButtonElement>>('botaoIniciar');
  private readonly botaoRegerar = viewChild<ElementRef<HTMLButtonElement>>('botaoRegerar');
  private readonly inputGaleria = viewChild<ElementRef<HTMLInputElement>>('inputGaleria');
  private readonly botaoGaleria = viewChild<ElementRef<HTMLButtonElement>>('botaoGaleria');

  protected readonly os = signal<OsLocal | undefined>(undefined);
  private readonly carregou = signal(false);
  protected readonly anexos = signal<AnexoOsVisivel[]>([]);
  protected readonly pendencias = signal<Pendencia[]>([]);
  private readonly clientes = toSignal(inject(ClientesRepo).observarTodos());
  private readonly usuarios = toSignal(this.propostas.observarUsuarios(), { initialValue: [] });
  private readonly estado = toSignal(this.repo.observarEstadoSync(), {
    initialValue: { naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() } as EstadoSync,
  });
  private readonly hoje = hojeReativo();

  protected readonly carregando = computed(() => !this.carregou() || this.clientes() === undefined);
  protected readonly anuncio = signal('');
  /** Uma ação que muda o status ou gera o PDF está em curso (iniciar, concluir, gerar de novo, recusa, compartilhar). */
  protected readonly ocupado = signal(false);
  protected readonly iniciando = signal(false);
  protected readonly concluindo = signal(false);
  protected readonly regerando = signal(false);
  /** O que mais deixou a tela `ocupado` (a dica do "Tirar foto"). */
  private readonly emCurso = signal<'compartilhar' | 'recusa' | null>(null);
  protected readonly gravandoNota = signal(false);
  protected readonly gravandoFoto = signal(false);
  protected readonly gravandoAssinatura = signal(false);
  /** O botão que abriu a assinatura ou a recusa: recebe o foco de volta (o Safari não foca o botão no clique). */
  protected readonly gatilho = signal<HTMLElement | null>(null);
  protected readonly assinando = signal(false);
  protected readonly recusando = signal(false);
  protected readonly erroTelaAssinatura = signal<string | null>(null);
  protected readonly documentoAberto = signal<AnexoOsVisivel | null>(null);
  /** P4c-R8: o PDF esperando um toque para o compartilhamento (o navegador recusou sem gesto). */
  protected readonly pdfPronto = signal<File | null>(null);

  protected readonly nota = signal('');
  protected readonly erroNota = signal<string | null>(null);
  protected readonly legenda = signal('');
  protected readonly momento = signal<MomentoFoto | null>(null);
  protected readonly erroFoto = signal<string | null>(null);
  protected readonly resumo = signal('');
  protected readonly erroResumo = signal<string | null>(null);
  protected readonly erroAssinatura = signal<string | null>(null);
  protected readonly precisaVoltar = signal(false);
  /** T4: o diálogo aberto de uma ação do escritório, a atribuição em edição e o status da proposta da OS. */
  protected readonly dialogoEscritorio = signal<DialogoEscritorio | null>(null);
  protected readonly atribuindo = signal(false);
  protected readonly tecnicoEscolhido = signal('');
  /** FW-R4: o responsável da OS avulsa em edição (ADMIN). */
  protected readonly trocandoResponsavel = signal(false);
  protected readonly responsavelEscolhido = signal('');
  private readonly statusProposta = signal<StatusProposta | null>(null);
  /** M2: a OS cujo "Aceitar o trabalho" já foi para a fila: até o sync reabrir a proposta, não se oferece de novo. */
  protected readonly aceiteEnviado = signal<string | null>(null);

  protected readonly uploadAnexo = TIPO_UPLOAD_ANEXO_OS;
  protected readonly momentos = MOMENTOS;
  protected readonly rotuloMomento = ROTULO_MOMENTO;
  protected readonly maxFotos = FOTOS_MAX_OS;
  protected readonly maxNota = NOTA_MAX_OS;
  protected readonly maxLegenda = LEGENDA_MAX_OS;
  protected readonly maxResumo = RESUMO_MAX_OS;
  protected readonly iconeCamera = LucideCamera;
  protected readonly iconeGaleria = LucideImage;
  protected readonly iconeMapa = LucideMapPin;
  protected readonly iconeTelefone = LucidePhone;
  protected readonly data = dataBr;
  protected readonly dataHora = dataHoraBr;
  protected readonly nomeDoPdf = nomeDoPdfOs;
  protected readonly erroLegenda = ERRO_LEGENDA;

  // ---- perfil e posse ----

  /** ADMIN e COMERCIAL: a visão do escritório (técnico, responsável, histórico, link da proposta). */
  protected readonly escritorio = computed(() => {
    const perfil = this.usuario()?.perfil;
    return perfil === 'ADMIN' || perfil === 'COMERCIAL';
  });
  private readonly ehResponsavel = computed(() => {
    const o = this.os();
    return !!o && o.responsavelId === this.usuario()?.id;
  });
  private readonly ehTecnicoAtribuido = computed(() => {
    const o = this.os();
    const u = this.usuario();
    return !!o && u?.perfil === 'TECNICO' && o.tecnicoId === u.id;
  });
  /** Quem executa (spec M2 §6): o ADMIN e o técnico atribuído. O COMERCIAL e outro técnico só leem. */
  private readonly executor = computed(() => this.usuario()?.perfil === 'ADMIN' || this.ehTecnicoAtribuido());

  protected readonly podeIniciar = computed(() => {
    const o = this.os();
    const u = this.usuario();
    if (!o || !u || o.status !== 'ABERTA' || !this.executor()) return false;
    return transicoesPermitidasOs('ABERTA', u.perfil, this.ehResponsavel(), this.ehTecnicoAtribuido()).includes('EM_ANDAMENTO');
  });
  protected readonly emExecucao = computed(() => {
    const o = this.os();
    const u = this.usuario();
    return !!o && !!u && this.executor() && podeExecutar(o.status, u.perfil, this.ehTecnicoAtribuido());
  });
  /**
   * Notas, pela matriz (`camposEditaveisOs`): em ABERTA e EM_ANDAMENTO, quem executa e o COMERCIAL responsável (T4).
   * Depois do encerramento (M2P1-R26, M2P3-R9: a evidência do campo), em CONCLUIDA o ADMIN e o técnico atribuído; em
   * CANCELADA só o técnico atribuído.
   */
  protected readonly podeNotar = computed(() => {
    const o = this.os();
    const u = this.usuario();
    if (!o || !u) return false;
    return camposEditaveisOs(o.status, u.perfil, this.ehResponsavel(), this.ehTecnicoAtribuido()).includes('notas');
  });
  /**
   * Fotos (o `exigirAnexoDeCampo` do repositório): quem executa, em andamento; o técnico atribuído também na OS
   * encerrada, concluída ou cancelada (M2P1-R26, M2P3-R9).
   */
  protected readonly podeFotografar = computed(() => {
    const status = this.os()?.status;
    return (status === 'EM_ANDAMENTO' && this.executor())
      || ((status === 'CONCLUIDA' || status === 'CANCELADA') && this.ehTecnicoAtribuido());
  });
  /** I1: uma escrita de campo em curso (foto, nota, assinatura): o concluir espera, e o PDF sai com ela. */
  protected readonly gravandoCampo = computed(() => this.gravandoFoto() || this.gravandoNota() || this.gravandoAssinatura());
  protected readonly fotoDepoisDeIniciar = computed(() => this.os()?.status === 'ABERTA' && this.executor());
  protected readonly conflito = computed(() => this.pendencias().some((x) => x.tipo === 'CONFLITO'));
  protected readonly motivoRegerar = computed(() => {
    const o = this.os();
    return o ? motivoParaRegerarOs(o, this.anexos(), this.pendencias(), this.usuario()) : null;
  });

  // ---- escritório (T4) ----

  protected readonly admin = computed(() => this.usuario()?.perfil === 'ADMIN');
  /** "Editar" (o cabeçalho): ADMIN e COMERCIAL responsável, em ABERTA e EM_ANDAMENTO (`podeEditarCabecalho`). */
  protected readonly podeEditar = computed(() => {
    const o = this.os();
    const u = this.usuario();
    return !!o && !!u && this.escritorio() && podeEditarCabecalho(o.status, u.perfil, this.ehResponsavel());
  });
  /** O técnico (`atribuir`): ADMIN e COMERCIAL responsável, em ABERTA e EM_ANDAMENTO. */
  protected readonly podeAtribuir = computed(() => {
    const o = this.os();
    const u = this.usuario();
    return !!o && !!u && this.escritorio() && camposEditaveisOs(o.status, u.perfil, this.ehResponsavel(), false).includes('tecnicoId');
  });
  /** → CANCELADA: o ADMIN em ABERTA e EM_ANDAMENTO; o COMERCIAL responsável só em ABERTA. */
  protected readonly podeCancelar = computed(() => {
    const o = this.os();
    const u = this.usuario();
    return !!o && !!u && this.escritorio() && transicoesPermitidasOs(o.status, u.perfil, this.ehResponsavel(), false).includes('CANCELADA');
  });
  /** CONCLUIDA → EM_ANDAMENTO: só o ADMIN. */
  protected readonly podeReabrir = computed(() => {
    const o = this.os();
    const u = this.usuario();
    return o?.status === 'CONCLUIDA' && !!u && this.escritorio()
      && transicoesPermitidasOs('CONCLUIDA', u.perfil, this.ehResponsavel(), false).includes('EM_ANDAMENTO');
  });
  /**
   * A proposta da OS (no aparelho) está cancelada e a OS não: o caso do M2-R4. A recusada não entra (o servidor só
   * reabre a cancelada, e o `aceitarTrabalho` a recusa no aparelho).
   */
  protected readonly propostaCancelada = computed(() => {
    const o = this.os();
    return !!o?.propostaId && o.status !== 'CANCELADA' && this.statusProposta() === 'CANCELADA';
  });
  /**
   * M2-R4: só o ADMIN aceita o trabalho; uma vez (M2: o aceite enviado espera o sync reabrir a proposta). FW-R3: não com
   * a OS ainda ABERTA (nenhum trabalho feito, como o selo "Trabalho em proposta cancelada"): a faixa sugere cancelá-la.
   */
  protected readonly aceito = computed(() => this.aceiteEnviado() === this.id());
  protected readonly podeAceitar = computed(
    () => this.admin() && this.propostaCancelada() && this.os()?.status !== 'ABERTA' && !this.aceito(),
  );
  /** Como o DELETE do servidor: ABERTA sem técnico (com técnico, cancela-se), pelo ADMIN ou o COMERCIAL responsável. */
  protected readonly podeExcluir = computed(() => {
    const o = this.os();
    return !!o && o.status === 'ABERTA' && o.tecnicoId === null && (this.admin() || (this.escritorio() && this.ehResponsavel()));
  });
  /**
   * FW-R4: o responsável da OS avulsa, só pelo ADMIN, em ABERTA e EM_ANDAMENTO (a matriz, `camposEditaveisOs`). Na OS
   * de proposta ele segue o da proposta (M2P1-R16): nunca aqui.
   */
  protected readonly podeTrocarResponsavel = computed(() => {
    const o = this.os();
    const u = this.usuario();
    return !!o && !!u && o.propostaId === null && this.admin()
      && camposEditaveisOs(o.status, u.perfil, this.ehResponsavel(), false).includes('responsavelId');
  });
  protected readonly temAcaoTravada = computed(
    () => this.podeAtribuir() || this.podeTrocarResponsavel() || this.podeCancelar() || this.podeReabrir() || this.podeAceitar(),
  );
  protected readonly temAcoesEscritorio = computed(() => this.temAcaoTravada() || this.podeEditar() || this.podeExcluir());
  /** Os técnicos para a atribuição: os ativos e, se for o caso, o atual inativo (marcado). */
  protected readonly tecnicos = computed(() => {
    const atual = this.os()?.tecnicoId ?? null;
    return this.usuarios()
      .filter((u) => u.perfil === 'TECNICO' && (u.ativo !== false || u.id === atual))
      .map((u) => ({ id: u.id, rotulo: u.ativo === false ? `${u.nome} (inativo)` : u.nome }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  });
  /** Os responsáveis possíveis: ADMIN e COMERCIAL ativos e, se for o caso, o atual inativo (marcado). */
  protected readonly responsaveis = computed(() => {
    const atual = this.os()?.responsavelId ?? null;
    return this.usuarios()
      .filter((u) => (u.perfil === 'ADMIN' || u.perfil === 'COMERCIAL') && (u.ativo !== false || u.id === atual))
      .map((u) => ({ id: u.id, rotulo: u.ativo === false ? `${u.nome} (inativo)` : u.nome }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  });
  private readonly propostaDaOs = computed(() => this.os()?.propostaId ?? null);

  // ---- cabeçalho ----

  protected readonly codigo = computed(() => {
    const o = this.os();
    return o ? codigoOsExibido(o) : '';
  });
  protected readonly status = computed(() => STATUS_OS[this.os()?.status ?? 'ABERTA']);
  protected readonly tipo = computed(() => rotuloTipoOs(this.os()?.tipo ?? 'SERVICO'));
  protected readonly selos = computed<SeloOs[]>(() => {
    const o = this.os();
    return o ? selosDaOs(o, { naoSincronizada: this.estado().naOutbox.has(o.id), hoje: this.hoje() }) : [];
  });
  private readonly cliente = computed(() => {
    const id = this.os()?.clienteId;
    return id ? (this.clientes() ?? []).find((c) => c.id === id) : undefined;
  });
  /** Só o nome: o CPF/CNPJ do cliente nunca aparece na OS (Q18, M2P2-R8). */
  protected readonly clienteNome = computed(() => {
    const c = this.cliente();
    if (c) return c.nome;
    return this.os()?.clienteId ? 'Cliente não encontrado neste aparelho.' : 'Sem cliente';
  });
  protected readonly telefone = computed(() => {
    const t = this.cliente()?.telefone;
    const href = linkTelefone(t);
    return href ? { href, texto: formatarTelefone(t) || t! } : null;
  });
  protected readonly endereco = computed(() => {
    const o = this.os();
    return o ? linhaDoEndereco(enderecoDaOs(o)) : null;
  });
  /** O mapa procura o endereço sem o complemento (sala, bloco, apto.): só atrapalha a busca. */
  protected readonly urlMapa = computed(() => {
    const o = this.os();
    const busca = o ? linhaDoEndereco({ ...enderecoDaOs(o), complemento: null }) : null;
    return busca ? MAPA + encodeURIComponent(busca) : null;
  });
  protected readonly iniciadaEm = computed(() => {
    const o = this.os();
    const i = o?.iniciadaEm ?? o?.iniciadaLocalEm ?? null;
    return i ? dataHoraBr(i) : null;
  });
  protected readonly itens = computed(() =>
    (this.os()?.itens ?? []).map((l) => ({
      id: l.id,
      codigo: l.codigo,
      nome: l.nome,
      quantidade: `${quantidadeBr(Number(deMilesimos(BigInt(l.quantidadePrevistaMilesimos))))} ${l.unidade}`,
    })),
  );
  private readonly nomes = computed(() => new Map(this.usuarios().map((u) => [u.id, u.nome])));

  // ---- notas, fotos, assinatura e PDF ----

  protected readonly notas = computed<LinhaNota[]>(() =>
    (this.os()?.notas ?? []).map((n) => ({
      id: n.id,
      texto: n.texto,
      autor: this.nome(n.autorId ?? n.autorLocalId ?? null) ?? 'Usuário',
      quando: dataHoraBr(n.criadaEm ?? n.criadaLocalEm ?? null),
      pendente: n.criadaEm === null,
    })),
  );
  protected readonly tamanhoNota = computed(() => tamanhoTextoOs(this.nota()));
  protected readonly tamanhoLegenda = computed(() => tamanhoTextoOs(this.legenda()));
  protected readonly legendaLonga = computed(() => this.tamanhoLegenda() > LEGENDA_MAX_OS);
  protected readonly tamanhoResumo = computed(() => tamanhoTextoOs(this.resumo()));
  protected readonly fotos = computed(() => this.anexos().filter((a) => a.tipo === 'FOTO'));
  protected readonly limiteFotos = computed(() => this.fotos().length >= FOTOS_MAX_OS);
  /**
   * T2 carry: por que o "Tirar foto" está desabilitado, à vista e ligado ao botão: o limite, ou a ação em curso que o
   * trava (a conclusão, o PDF de novo, o compartilhamento, o registro da recusa ou outra). A foto gravando já diz
   * "Gravando foto…" no próprio botão.
   */
  protected readonly dicaFoto = computed(() => {
    if (this.limiteFotos()) return `Esta OS já tem o máximo de ${FOTOS_MAX_OS} fotos.`;
    if (this.gravandoFoto() || !this.ocupado()) return null;
    if (this.concluindo()) return 'Aguarde a conclusão da OS para tirar outra foto.';
    if (this.regerando()) return 'Aguarde o PDF ficar pronto para tirar outra foto.';
    switch (this.emCurso()) {
      case 'compartilhar':
        return 'Aguarde o compartilhamento do PDF para tirar outra foto.';
      case 'recusa':
        return 'Aguarde o registro da recusa para tirar outra foto.';
      default:
        return 'Aguarde a ação em curso para tirar outra foto.';
    }
  });
  protected readonly documentos = computed(() => this.anexos().filter((a) => a.tipo === 'DOCUMENTO' && !!a.codigoExibido));

  /**
   * A assinatura que vale (a do `temAssinatura` do repositório): a última colhida aqui e ainda não enviada; senão, a
   * aceita pelo servidor. null sem nenhuma.
   */
  protected readonly assinaturaVista = computed<AssinaturaVista | null>(() => {
    const o = this.os();
    const anexos = this.anexos();
    const pendente = anexos
      .filter((a) => a.tipo === 'ASSINATURA' && !a.enviado)
      .sort((a, b) => (a.tiradaEm ?? '').localeCompare(b.tiradaEm ?? ''))
      .at(-1);
    if (pendente) return { nome: pendente.assinanteNome, papel: pendente.assinantePapel, miniatura: pendente.miniatura };
    if (!o?.assinaturaAnexoId) return null;
    const aceita = anexos.find((a) => a.id === o.assinaturaAnexoId);
    return {
      nome: o.assinanteNome ?? aceita?.assinanteNome ?? null,
      papel: o.assinantePapel ?? aceita?.assinantePapel ?? null,
      miniatura: aceita?.miniatura ?? null,
    };
  });
  protected readonly assinada = computed(() => this.assinaturaVista() !== null);
  protected readonly urlAssinatura = signal<string | null>(null);

  constructor() {
    // um effect e não toObservable + switchMap (como no detalhe da proposta); a fonte troca com o id
    effect((aoLimpar) => {
      const id = this.id();
      this.carregou.set(false);
      this.os.set(undefined);
      this.anexos.set([]);
      this.pendencias.set([]);
      this.limparFormulario();
      // FW-R2: o rascunho desta OS (fora do rastreio: a renovação do token reemite o usuário e não apaga o digitado)
      const usuarioId = untracked(this.usuario)?.id ?? null;
      const rascunho = usuarioId ? lerRascunhoOs(usuarioId, id) : {};
      this.nota.set(rascunho.nota ?? '');
      let primeira = true;
      // fora do rastreio: uma fonte que emite na hora da inscrição (o `podeVer` lê o usuário) não liga o effect a ele
      const assinaturas = untracked(() => [
        this.repo.observarOs(id).subscribe((lida) => {
          // T4: o COMERCIAL não abre a OS de outro comercial (o filtro do `observarTodas`)
          const o = lida && this.podeVer(lida) ? lida : undefined;
          // o rascunho vale mais; sem ele, a OS reaberta traz o resumo da conclusão anterior preenchido
          if (primeira) this.resumo.set(rascunho.resumo ?? o?.resumoExecucao ?? '');
          primeira = false;
          this.os.set(o);
          this.carregou.set(true);
        }),
        this.repo.observarAnexos(id).subscribe((a) => this.anexos.set(a)),
        this.repo.observarPendencias(id).subscribe((x) => this.pendencias.set(x)),
      ]);
      aoLimpar(() => assinaturas.forEach((a) => a.unsubscribe()));
    });
    // T4: o status da proposta da OS (o "Aceitar o trabalho" e a faixa da proposta cancelada), só no escritório
    effect((aoLimpar) => {
      const propostaId = this.propostaDaOs();
      this.statusProposta.set(null);
      if (!propostaId || !this.escritorio()) return;
      const assinatura = this.propostas.observarProposta(propostaId).subscribe((p) => this.statusProposta.set(p?.status ?? null));
      aoLimpar(() => assinatura.unsubscribe());
    });
    // a miniatura da assinatura (o próprio PNG) num URL de blob, revogado quando muda e no destroy
    effect((aoLimpar) => {
      const miniatura = this.assinaturaVista()?.miniatura ?? null;
      if (!miniatura) {
        this.urlAssinatura.set(null);
        return;
      }
      const url = URL.createObjectURL(miniatura);
      this.urlAssinatura.set(url);
      aoLimpar(() => URL.revokeObjectURL(url));
    });
  }

  protected estilo(s: SeloOs) {
    return ESTILO_SELO_OS[s.tipo];
  }

  protected rotuloStatus(s: StatusOs): string {
    return rotuloStatusOs(s);
  }

  /** O nome do usuário do aparelho; o próprio usuário vale mesmo fora da lista. */
  protected nome(usuarioId: string | null): string | null {
    if (!usuarioId) return null;
    const u = this.usuario();
    return this.nomes().get(usuarioId) ?? (u?.id === usuarioId ? u.nome : null);
  }

  /** As mensagens dos campos recusados, com o rótulo do campo: "Resumo da execução: …". */
  protected camposDa(x: Pendencia): string[] {
    return Object.entries(x.erro?.campos ?? {}).map(([campo, mensagem]) => `${rotuloCampoOs(campo)}: ${mensagem}`);
  }

  private podeVer(o: OsLocal): boolean {
    const u = this.usuario();
    return u?.perfil !== 'COMERCIAL' || o.responsavelId === u.id;
  }

  // ---- escritório (T4) ----

  protected abrirDialogo(d: DialogoEscritorio, gatilho: HTMLElement | null): void {
    this.gatilho.set(gatilho);
    this.dialogoEscritorio.set(d);
  }

  protected abrirAtribuir(): void {
    this.trocandoResponsavel.set(false);
    this.tecnicoEscolhido.set(this.os()?.tecnicoId ?? '');
    this.atribuindo.set(true);
    afterNextRender(() => this.selectTecnico()?.nativeElement.focus(), { injector: this.injector });
  }

  protected fecharAtribuir(): void {
    this.atribuindo.set(false);
    this.devolverFoco(() => this.botaoAtribuir()?.nativeElement);
  }

  /** O técnico novo (`atribuir`: TECNICO ativo; em andamento não fica sem técnico; trava do CONFLITO). */
  protected async salvarTecnico(): Promise<void> {
    const tecnicoId = this.tecnicoEscolhido() || null;
    // N1: o mesmo técnico não grava nada (o repositório não muda a OS): só fecha
    if (tecnicoId === (this.os()?.tecnicoId ?? null)) {
      this.fecharAtribuir();
      return;
    }
    await this.acaoEscritorio((id) => this.repo.atribuir(id, { tecnicoId }), 'Técnico atualizado.', () => {
      this.atribuindo.set(false);
      this.devolverFoco(() => this.botaoAtribuir()?.nativeElement);
    }, () => this.devolverFoco(() => this.botaoSalvarTecnico()?.nativeElement));
  }

  /** FW-R4: o editor do responsável da OS avulsa (um editor de cada vez: fecha o do técnico). */
  protected abrirResponsavel(): void {
    this.atribuindo.set(false);
    this.responsavelEscolhido.set(this.os()?.responsavelId ?? '');
    this.trocandoResponsavel.set(true);
    afterNextRender(() => this.selectResponsavel()?.nativeElement.focus(), { injector: this.injector });
  }

  protected fecharResponsavel(): void {
    this.trocandoResponsavel.set(false);
    this.devolverFoco(() => this.botaoResponsavel()?.nativeElement);
  }

  /**
   * FW-R4: o responsável novo (`atribuir` com `responsavelId`: ADMIN ou COMERCIAL ativo, só na avulsa; a trava do
   * CONFLITO e o id guardado, como o técnico). O mesmo responsável só fecha.
   */
  protected async salvarResponsavel(): Promise<void> {
    const responsavelId = this.responsavelEscolhido();
    if (!responsavelId || responsavelId === (this.os()?.responsavelId ?? '')) {
      this.fecharResponsavel();
      return;
    }
    await this.acaoEscritorio((id) => this.repo.atribuir(id, { responsavelId }), 'Responsável atualizado.', () => {
      this.trocandoResponsavel.set(false);
      this.devolverFoco(() => this.botaoResponsavel()?.nativeElement);
    }, () => this.devolverFoco(() => this.botaoSalvarResponsavel()?.nativeElement));
  }

  protected async cancelarOs(motivo: string | null): Promise<void> {
    if (motivo === null) return;
    await this.acaoEscritorio((id) => this.repo.cancelar(id, motivo), 'OS cancelada.', () => this.focarTitulo());
  }

  protected async reabrirOs(motivo: string | null): Promise<void> {
    if (motivo === null) return;
    await this.acaoEscritorio((id) => this.repo.reabrir(id, motivo), 'OS reaberta.', () => this.focarTitulo());
  }

  /** M2-R4: o comando vai na fila; o servidor reabre a proposta (EM_EXECUCAO, ou FINALIZADA se o trabalho acabou). */
  protected async aceitarTrabalho(): Promise<void> {
    await this.acaoEscritorio((id) => this.repo.aceitarTrabalho(id), 'Trabalho aceito. A proposta será reaberta ao sincronizar.', () => {
      this.aceiteEnviado.set(this.id());
      this.focarTitulo();
    });
  }

  /** A OS sai do aparelho (e do servidor): a tela volta para a proposta dela, ou para a lista na avulsa. */
  protected async excluirOs(): Promise<void> {
    const propostaId = this.os()?.propostaId ?? null;
    await this.acaoEscritorio((id) => this.repo.excluir(id), 'OS excluída.', () => {
      void this.router.navigate(propostaId ? ['/propostas', propostaId] : ['/os']);
    });
  }

  /**
   * Uma ação do escritório: guarda o id no começo e, se a rota trocou de OS enquanto ela gravava, não escreve nada na
   * tela (nem o aviso, nem o erro): o resultado não é desta OS. Na recusa, o diálogo fica aberto (com o motivo), e
   * `aoFalhar` devolve o foco ao botão que se desabilitou (M2).
   */
  private async acaoEscritorio(
    fazer: (id: string) => Promise<void>, aviso: string, depois: () => void, aoFalhar?: () => void,
  ): Promise<void> {
    if (this.ocupado()) return;
    const id = this.id();
    this.ocupado.set(true);
    try {
      await fazer(id);
      if (this.id() !== id) return;
      this.dialogoEscritorio.set(null);
      this.avisar(aviso);
      depois();
    } catch (e) {
      if (this.id() !== id) return;
      this.toasts.erro(mensagemErroOs(e));
      aoFalhar?.();
    } finally {
      this.ocupado.set(false);
    }
  }

  // ---- iniciar ----

  protected async iniciar(): Promise<void> {
    if (this.ocupado()) return;
    const id = this.id();
    this.ocupado.set(true);
    this.iniciando.set(true);
    try {
      await this.repo.iniciar(id);
      if (this.id() !== id) return;
      this.avisar('OS iniciada. Agora você pode tirar fotos.');
      // o botão some com a OS em andamento: o foco vai ao título, não ao body
      this.focarTitulo();
    } catch (e) {
      if (this.id() !== id) return;
      this.toasts.erro(mensagemErroOs(e));
      // M2: o botão fica (a OS segue aberta) e se desabilitou com o foco nele
      this.devolverFoco(() => this.botaoIniciar()?.nativeElement);
    } finally {
      this.iniciando.set(false);
      this.ocupado.set(false);
    }
  }

  // ---- notas ----

  protected digitarNota(valor: string): void {
    this.nota.set(valor);
    this.guardarRascunho('nota', valor);
    if (this.erroNota() && this.validarNota(valor) === null) this.erroNota.set(null);
  }

  protected async adicionarNota(): Promise<void> {
    if (this.gravandoNota()) return;
    const texto = this.nota();
    const erro = this.validarNota(texto);
    this.erroNota.set(erro);
    if (erro) {
      this.campoNota()?.nativeElement.focus();
      return;
    }
    const id = this.id();
    this.gravandoNota.set(true);
    try {
      await this.repo.adicionarNota(id, texto);
      // FW-R2: a nota gravada sai do rascunho (mesmo que a rota já seja de outra OS)
      this.guardarRascunho('nota', null, id);
      if (this.id() !== id) return;
      this.nota.set('');
      this.avisar('Nota adicionada.');
      this.campoNota()?.nativeElement.focus();
    } catch (e) {
      if (this.id() !== id) return;
      this.erroNota.set(mensagemErroOs(e));
      this.campoNota()?.nativeElement.focus();
    } finally {
      this.gravandoNota.set(false);
    }
  }

  private validarNota(texto: string): string | null {
    const n = tamanhoTextoOs(texto);
    if (n === 0) return 'Escreva a nota.';
    if (n > NOTA_MAX_OS) return `Máximo de ${NOTA_MAX_OS} caracteres.`;
    return null;
  }

  // ---- fotos ----

  protected escolherMomento(m: MomentoFoto): void {
    this.momento.update((atual) => (atual === m ? null : m));
  }

  protected digitarLegenda(valor: string): void {
    this.legenda.set(valor);
    if (this.erroFoto() === ERRO_LEGENDA && !this.legendaLonga()) this.erroFoto.set(null);
  }

  /**
   * "Tirar foto" (a câmera) e "Escolher da galeria" (FW-R1, o input sem `capture`): abre o input ainda dentro do toque.
   * A legenda longa demais é recusada antes: a foto tirada não se perderia, mas teria de ser tirada de novo.
   */
  protected tirarFoto(input: HTMLInputElement): void {
    if (this.gravandoFoto() || this.ocupado()) return;
    if (this.legendaLonga()) {
      this.erroFoto.set(ERRO_LEGENDA);
      this.campoLegenda()?.nativeElement.focus();
      return;
    }
    input.click();
  }

  /**
   * A foto escolhida no input (uma por toque, nunca várias em paralelo): `adicionarFoto` com o momento e a legenda. O
   * input é zerado na hora (a mesma foto pode ser escolhida de novo). Os erros (`FOTO_*`, `SEM_ESPACO`, limite) ficam no
   * próprio bloco, com o texto do `mensagemErroOs`.
   */
  protected async fotoEscolhida(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const arquivo = input.files?.[0] ?? null;
    input.value = '';
    if (!arquivo || this.gravandoFoto()) return;
    if (this.ocupado()) {
      // I1: a foto que chega durante a geração do PDF (ex.: o seletor do computador) ficaria fora dele
      this.erroFoto.set(FOTO_DURANTE_PDF);
      return;
    }
    const legenda = stripJava(this.legenda());
    if (this.legendaLonga()) {
      this.erroFoto.set(ERRO_LEGENDA);
      return;
    }
    const antes = this.fotos().length;
    // M2: o botão que abriu o input ("Tirar foto" ou, FW-R1, "Escolher da galeria") se desabilita com o foco nele; o
    // foco fica no título da seção e volta a ele no fim
    const daGaleria = input === this.inputGaleria()?.nativeElement;
    const origem = () => (daGaleria ? this.botaoGaleria() : this.botaoFoto())?.nativeElement;
    const documento = this.host.nativeElement.ownerDocument;
    const botao = origem();
    if (documento.activeElement === botao || documento.activeElement === documento.body) this.tituloFotos()?.nativeElement.focus();
    const id = this.id();
    this.gravandoFoto.set(true);
    this.erroFoto.set(null);
    this.anuncio.set('Gravando a foto…');
    try {
      await this.repo.adicionarFoto(id, arquivo, { legenda: legenda === '' ? null : legenda, momento: this.momento() });
      if (this.id() !== id) return;
      this.legenda.set('');
      this.anuncio.set(`Foto gravada (${antes + 1} de ${FOTOS_MAX_OS}).`);
    } catch (e) {
      if (this.id() !== id) return;
      // o técnico não entende um erro interno (Dexie, decodificador): a mensagem genérica é a da foto
      this.erroFoto.set(e instanceof ErroCampo ? mensagemErroOs(e) : FALHA_GRAVAR_FOTO);
      this.anuncio.set('');
    } finally {
      this.gravandoFoto.set(false);
      this.devolverFoco(origem, () => this.tituloFotos()?.nativeElement);
    }
  }

  /**
   * "Ver foto": a foto inteira numa aba aberta ainda dentro do toque (o iOS bloqueia `window.open` depois de um
   * `await`); com o popup bloqueado, baixa. Bytes do aparelho ou, online, o download sem cache.
   */
  protected abrirFoto(a: AnexoOsVisivel): void {
    if (!a.temBytes && !(a.arquivoId !== null && this.online())) {
      this.toasts.erro(SEM_INTERNET_FOTO);
      return;
    }
    const nome = `${this.codigo()}-foto-${this.fotos().findIndex((x) => x.id === a.id) + 1}.jpg`;
    const janela = abrirJanelaEmBranco(`Foto da ${this.codigo()}`, 'Abrindo foto…');
    this.bytesDoAnexo(a, 'image/jpeg').then(
      (blob) => {
        if (!janela) {
          baixarArquivo(blob, nome);
          this.toasts.mostrar(`O navegador bloqueou a nova aba. Foto baixada: ${nome}`);
          return;
        }
        const url = URL.createObjectURL(blob);
        janela.location.href = url;
        revogarUrl(url, true);
      },
      (e: unknown) => {
        janela?.close();
        this.toasts.erro(this.erroDoDownload(e, SEM_INTERNET_FOTO, FALHA_FOTO));
      },
    );
  }

  // ---- assinatura ----

  protected abrirAssinatura(gatilho: HTMLElement | null): void {
    this.gatilho.set(gatilho);
    this.erroTelaAssinatura.set(null);
    this.assinando.set(true);
  }

  protected async assinar(a: AssinaturaColhida): Promise<void> {
    if (this.gravandoAssinatura()) return;
    const id = this.id();
    this.gravandoAssinatura.set(true);
    this.erroTelaAssinatura.set(null);
    try {
      await this.repo.assinar(id, a);
      if (this.id() !== id) return;
      this.assinando.set(false);
      this.erroAssinatura.set(null);
      this.avisar('Assinatura colhida.');
    } catch (e) {
      // a tela fica aberta, com o desenho e o nome
      if (this.id() === id) this.erroTelaAssinatura.set(mensagemErroOs(e));
    } finally {
      this.gravandoAssinatura.set(false);
    }
  }

  protected abrirRecusa(gatilho: HTMLElement | null): void {
    this.gatilho.set(gatilho);
    this.recusando.set(true);
  }

  protected async recusar(motivo: string | null): Promise<void> {
    if (this.ocupado() || motivo === null) return;
    const id = this.id();
    this.ocupado.set(true);
    this.emCurso.set('recusa');
    try {
      await this.repo.recusarAssinatura(id, motivo);
      if (this.id() !== id) return;
      this.recusando.set(false);
      this.erroAssinatura.set(null);
      this.avisar('Recusa registrada.');
    } catch (e) {
      // o diálogo fica aberto, com o motivo digitado
      if (this.id() === id) this.toasts.erro(mensagemErroOs(e));
    } finally {
      this.emCurso.set(null);
      this.ocupado.set(false);
    }
  }

  // ---- concluir ----

  protected digitarResumo(valor: string): void {
    this.resumo.set(valor);
    this.guardarRascunho('resumo', valor);
    if (this.erroResumo() && textoOsValido(valor, RESUMO_MIN_OS, RESUMO_MAX_OS)) this.erroResumo.set(null);
  }

  /**
   * "Concluir e gerar PDF": confere o resumo e a assinatura (ou a recusa) como o repositório, chama `concluir` com o
   * gerador do PDF da OS e o "Precisa voltar" (Q21), avisa e compartilha `OS-….pdf` (ou deixa o painel "PDF pronto").
   */
  protected async concluir(): Promise<void> {
    const o = this.os();
    // I1: com uma foto, nota ou assinatura ainda gravando, o PDF sairia sem ela (e a foto do ADMIN seria recusada)
    if (!o || this.ocupado() || this.gravandoCampo()) return;
    const resumo = this.resumo();
    const erroResumo = textoOsValido(resumo, RESUMO_MIN_OS, RESUMO_MAX_OS)
      ? null
      : `Informe o resumo da execução (de ${RESUMO_MIN_OS} a ${RESUMO_MAX_OS} caracteres).`;
    const recusa = o.assinaturaRecusada && textoOsValido(o.motivoRecusa, MOTIVO_MIN_OS, MOTIVO_MAX_OS);
    const erroAssinatura = this.assinada() || recusa ? null : 'Colha a assinatura ou registre que o cliente não pôde assinar.';
    this.erroResumo.set(erroResumo);
    this.erroAssinatura.set(erroAssinatura);
    if (erroResumo) {
      this.campoResumo()?.nativeElement.focus();
      return;
    }
    if (erroAssinatura) {
      this.botaoColher()?.nativeElement.focus();
      return;
    }
    const precisaVoltar = this.precisaVoltar();
    const aviso = o.propostaId === null
      ? CONCLUIDA_AVULSA
      : precisaVoltar || !o.concluiProposta ? CONCLUIDA_COM_RETORNO : CONCLUIDA_COM_PROPOSTA;
    const id = this.id();
    this.ocupado.set(true);
    this.concluindo.set(true);
    this.anuncio.set('Gerando o PDF da OS…');
    try {
      const { blob, codigoExibido } = await this.repo.concluir(id, resumo, (e) => this.pdf.gerarBlobOs(e), { precisaVoltar });
      // FW-R2: a OS concluída leva o resumo; o rascunho dele sai
      this.guardarRascunho('resumo', null, id);
      // a rota trocou de OS: o PDF é da outra (ela o mostra em "PDF da OS"); nada desta tela muda
      if (this.id() !== id) return;
      this.precisaVoltar.set(false);
      this.avisar(aviso);
      // a seção do concluir some com a OS concluída: o foco vai ao título (o painel "PDF pronto" o toma, se aparecer)
      this.focarTitulo();
      await this.compartilhar(arquivoPdf(blob, nomeDoPdfOs(codigoExibido)), blob);
    } catch (e) {
      if (this.id() === id && !this.erroNosCampos(e)) this.toasts.erro(mensagemErroOs(e));
    } finally {
      this.concluindo.set(false);
      this.ocupado.set(false);
      // M2: o botão se desabilitou com o foco nele; numa recusa ele fica, e o foco volta a ele
      if (this.id() === id) this.devolverFoco(() => this.botaoConcluir()?.nativeElement);
    }
  }

  /** A recusa `VALIDACAO` do resumo ou da assinatura vai para o campo (com o foco nele); true se foi. */
  private erroNosCampos(e: unknown): boolean {
    if (!(e instanceof ErroOs) || e.codigo !== 'VALIDACAO' || !e.campos) return false;
    const resumo = e.campos['resumoExecucao'];
    const assinatura = e.campos['assinatura'] ?? e.campos['motivoRecusa'];
    if (!resumo && !assinatura) return false;
    this.erroResumo.set(resumo ?? null);
    this.erroAssinatura.set(assinatura ?? null);
    (resumo ? this.campoResumo() : this.botaoColher())?.nativeElement.focus();
    return true;
  }

  // ---- PDF ----

  /** "Gerar PDF novamente" (M2P2-R18): `regerarPdf` com o gerador do PDF da OS, depois o compartilhamento. */
  protected async regerar(): Promise<void> {
    if (this.ocupado() || this.gravandoCampo()) return;
    const id = this.id();
    this.ocupado.set(true);
    this.regerando.set(true);
    this.anuncio.set('Gerando o PDF da OS…');
    try {
      const { blob, codigoExibido } = await this.repo.regerarPdf(id, (e) => this.pdf.gerarBlobOs(e));
      if (this.id() !== id) return;
      this.avisar('PDF gerado de novo. Ele vai para o servidor na próxima sincronização.');
      // M3: a faixa do "Gerar PDF novamente" some com o PDF novo: o foco vai ao título (o painel "PDF pronto" o toma)
      this.focarTitulo();
      await this.compartilhar(arquivoPdf(blob, nomeDoPdfOs(codigoExibido)), blob);
    } catch (e) {
      if (this.id() !== id) return;
      this.toasts.erro(mensagemErroOs(e));
      // M2: a faixa fica (o PDF não saiu) e o botão se desabilitou com o foco nele
      this.devolverFoco(() => this.botaoRegerar()?.nativeElement);
    } finally {
      this.regerando.set(false);
      this.ocupado.set(false);
    }
  }

  /**
   * "Abrir": o PDF do aparelho; sem os bytes, baixado na hora (online), sem cache. Sem internet, avisa sem abrir aba.
   * Chamado direto do clique: o visor abre a aba do celular antes de qualquer `await`.
   */
  protected abrirDocumento(d: AnexoOsVisivel): void {
    if (!this.alcancavel(d)) {
      this.toasts.erro(SEM_INTERNET_PDF);
      return;
    }
    const visor = this.visorDocumento();
    if (!visor) return;
    this.documentoAberto.set(d);
    visor.abrir(() => this.bytesDoAnexo(d, 'application/pdf'), `PDF ${d.codigoExibido}`)
      .catch((e: unknown) => this.toasts.erro(this.erroDoDownload(e, SEM_INTERNET_PDF, FALHA_PDF)));
  }

  /** M2: o "Compartilhar" se desabilita durante a leitura e o compartilhamento: o foco sempre volta a ele (`botao`). */
  protected async compartilharDocumento(d: AnexoOsVisivel, botao?: HTMLElement | null): Promise<void> {
    if (!this.alcancavel(d)) {
      this.toasts.erro(SEM_INTERNET_PDF);
      return;
    }
    if (this.ocupado()) return;
    const id = this.id();
    this.ocupado.set(true);
    this.emCurso.set('compartilhar');
    try {
      const blob = await this.bytesDoAnexo(d, 'application/pdf');
      if (this.id() !== id) return;
      await this.compartilhar(arquivoPdf(blob, nomeDoPdfOs(d.codigoExibido ?? this.codigo())), blob);
    } catch (e) {
      if (this.id() === id) this.toasts.erro(this.erroDoDownload(e, SEM_INTERNET_PDF, FALHA_PDF));
    } finally {
      this.emCurso.set(null);
      this.ocupado.set(false);
      if (this.id() === id && botao) this.devolverFoco(() => (botao.isConnected ? botao : undefined));
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

  /** Os bytes estão aqui, ou dá para baixá-los agora. */
  private alcancavel(a: AnexoOsVisivel): boolean {
    return a.temBytes || (!!a.arquivoId && this.online());
  }

  /** Os bytes do aparelho (`blobDoAnexo`) ou o download sem cache (nunca o cache de arquivos: Q18, disco). */
  private async bytesDoAnexo(a: AnexoOsVisivel, tipo: string): Promise<Blob> {
    const local = a.temBytes ? await this.repo.blobDoAnexo(a.id) : null;
    if (local) return local;
    if (!a.arquivoId) throw new Error('Anexo sem arquivo no servidor');
    const remoto = await this.arquivos.baixarSemCache(a.arquivoId);
    return remoto.type === tipo ? remoto : new Blob([remoto], { type: tipo });
  }

  /** M1: "Sem internet" só sem internet; a sessão vencida diz para entrar de novo; o resto, tentar de novo. */
  private erroDoDownload(e: unknown, semInternet: string, falha: string): string {
    if (!this.online()) return semInternet;
    if (e instanceof ErroDownload && e.motivo === 'SEM_SESSAO') return e.message;
    return falha;
  }

  private avisar(mensagem: string): void {
    this.toasts.mostrar(mensagem);
    this.anuncio.set(mensagem);
  }

  /**
   * M2: depois do próximo desenho, o foco volta a `alvo` se ele se perdeu (no body, ou num dos `de`, onde foi deixado
   * enquanto `alvo` estava desabilitado).
   */
  private devolverFoco(alvo: () => HTMLElement | undefined, ...de: (() => HTMLElement | undefined)[]): void {
    afterNextRender(
      () => {
        const documento = this.host.nativeElement.ownerDocument;
        const ativo = documento.activeElement;
        const el = alvo();
        const perdido = !ativo || ativo === documento.body || de.some((f) => f() === ativo);
        if (el && perdido && !(el as HTMLButtonElement).disabled) el.focus();
      },
      { injector: this.injector },
    );
  }

  /**
   * FW-R2: guarda o texto digitado (null esquece) no rascunho da OS `osId` (a da rota, por padrão) do usuário. Só o
   * resumo e a nota; sem usuário, nada.
   */
  private guardarRascunho(campo: CampoRascunhoOs, texto: string | null, osId = this.id()): void {
    const usuarioId = this.usuario()?.id;
    if (usuarioId) gravarRascunhoOs(usuarioId, osId, campo, texto);
  }

  /** M4: o que é desta OS na tela (campos, erros, diálogos e o painel do PDF) não passa para outra. */
  private limparFormulario(): void {
    this.nota.set('');
    this.erroNota.set(null);
    this.legenda.set('');
    this.momento.set(null);
    this.erroFoto.set(null);
    this.resumo.set('');
    this.erroResumo.set(null);
    this.erroAssinatura.set(null);
    this.erroTelaAssinatura.set(null);
    this.precisaVoltar.set(false);
    this.pdfPronto.set(null);
    this.assinando.set(false);
    this.recusando.set(false);
    this.documentoAberto.set(null);
    this.dialogoEscritorio.set(null);
    this.atribuindo.set(false);
    this.trocandoResponsavel.set(false);
  }

  /** O foco vai ao título depois do próximo desenho (o botão da ação some com a mudança de status). */
  private focarTitulo(): void {
    // com o painel "PDF pronto" na tela, o foco é dele (ele o toma ao abrir; o título não o rouba)
    afterNextRender(() => {
      if (!this.pdfPronto()) this.titulo()?.nativeElement.focus();
    }, { injector: this.injector });
  }
}
