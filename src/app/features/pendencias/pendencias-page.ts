import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, effect, ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { mensagemDeErro } from '../../core/http/erro-api';
import { PdfService } from '../../core/pdf/pdf-service';
import { osNaoEncontrada, PendenciasService } from '../../core/sync/pendencias-service';
import { DadosUploadAnexoOs, Pendencia, TIPO_UPLOAD_ANEXO_OS, TIPO_UPLOAD_DOCUMENTO } from '../../core/sync/sync-models';
import { SyncService } from '../../core/sync/sync-service';
import { MENSAGEM_OS_NAO_ESTA_COM_VOCE } from '../../core/sync/tipos-upload';
import { Toasts } from '../../shared/ui/toasts';
import { mensagemErroOs, rotuloCampoOs, textoPerdaOs } from '../os/formatos-os';
import { codigoOsExibido, OsDados, OsLocal, TipoAnexoOs } from '../os/os-models';
import { OsRepo } from '../os/os-repo';
import { pdfRegeravel, recusaDePdfRegeravel } from '../os/pdf-regeravel';
import { arquivoPdf, compartilharArquivo, ResultadoCompartilhar } from '../propostas/compartilhar';
import { DialogoMotivo } from '../propostas/dialogo-motivo';
import { mensagemErroProposta, rotuloCodigo } from '../propostas/formatos-proposta';
import { PdfPronto } from '../propostas/pdf-pronto';
import { PropostaLocal } from '../propostas/proposta-models';
import { motivoParaRegerar, pendenciaCorrigivel, PropostasRepo } from '../propostas/propostas-repo';
import { regerarPdf } from '../propostas/regerar-pdf';
import { TIPOS_BLOCO } from '../templates/template-models';

const ROTULO_TIPO_BLOCO = new Map<string, string>(TIPOS_BLOCO.map((t) => [t.valor, t.rotulo]));
const ROTULO_CAMPO_TEMPLATE: Record<string, string> = {
  nome: 'Nome', tipoProposta: 'Tipo de proposta', ativo: 'Ativo', padrao: 'Padrão', blocos: 'Blocos',
};
const CAMINHO_BLOCO = /^blocos\[(\d+)\]/;
const ROTULO_ANEXO_OS: Readonly<Record<TipoAnexoOs, string>> = { FOTO: 'Foto', ASSINATURA: 'Assinatura', DOCUMENTO: 'PDF' };

/** P4c-R15: o texto da confirmação quando a ação levaria o que foi feito neste aparelho e ainda não foi enviado. */
const AVISO_PROPOSTA = 'Isto descarta o envio e o PDF gerado neste aparelho.';

/**
 * M2P2-R18: o texto da pendência quando dá para gerar o PDF da OS de novo, para cada recusa que isso resolve
 * (`RECUSAS_PDF_OS_QUE_SE_REGERAM`, a regra compartilhada): o código impresso mudou (o `OSP-` trocado, a numeração que
 * chegou) ou o arquivo sumiu do aparelho.
 */
const TEXTO_RECUSA_PDF_OS: Readonly<Record<string, string>> = {
  CODIGO_EXIBIDO_INVALIDO: 'O código da OS mudou depois que o PDF foi gerado. Gere o PDF novamente.',
  ANEXO_AUSENTE: 'O arquivo deste PDF não está mais neste aparelho. Gere o PDF novamente.',
};

/**
 * O PDF da OS reaberta (ou encerrada de outro jeito) no servidor depois da conclusão daqui (M2P1-R30 V1): gerar de novo
 * não resolve, porque a cópia do aparelho ainda é a da revisão recusada. O Descartar relê a OS (M2P2-R13), e quem a
 * executa a conclui de novo pela tela dela.
 */
const RECUSAS_PDF_OS_REABERTA: ReadonlySet<string> = new Set(['REVISAO_INVALIDA', 'STATUS_INVALIDO']);
const CONCLUIR_DE_NOVO = 'Depois, abra a OS: se ela voltou para em andamento, conclua de novo.';

/**
 * A recusa `VALIDACAO` da OS (ex.: o técnico desativado, a proposta cancelada lá): não há "Corrigir e reenviar" da OS.
 * A alteração feita na tela antes de descartar fica retida atrás da recusada, e o Descartar a leva junto (tira da fila
 * tudo da OS e aplica o servidor); a criação recusada some do aparelho. Então a ordem é descartar e depois refazer.
 */
const VALIDACAO_OS_EDICAO = 'Descarte esta pendência e depois refaça a alteração na OS: o que for alterado antes de descartar se perde.';
const VALIDACAO_OS_CRIACAO = 'Descarte e crie a OS de novo.';

/** M2P1-R19: o "Manter a minha" tirou notas que o perfil não acrescenta na OS encerrada no servidor. */
const NOTAS_DESCARTADAS = 'As notas não puderam ser acrescentadas: a OS está encerrada.';

/**
 * P4c-R15: a ação sobre a proposta ou a OS (não sobre o upload dela) pode levar o que foi feito aqui: pergunta antes.
 * O Descartar do upload da OS que não existe mais também (M2P2-R13: ele leva a OS inteira).
 */
const perguntaAntes = (p: Pendencia) => p.entidade === 'proposta' || p.entidade === 'os' || osNaoEncontrada(p);

/** A confirmação de uma ação que levaria o envio feito no aparelho (P4c-R15, N2). */
interface Confirmacao {
  pendencia: Pendencia;
  gatilho: HTMLElement | null;
  acao: 'servidor' | 'descartar';
  /** O aviso, conforme o que a ação levaria. */
  texto?: string;
}

@Component({
  selector: 'app-pendencias-page',
  imports: [RouterLink, PdfPronto, DialogoMotivo],
  template: `
    <h1 #cabecalho tabindex="-1" class="mb-4 text-xl font-semibold outline-none">Pendências de sync</h1>
    <p role="status" aria-live="polite" class="sr-only">{{ anuncio() }}</p>

    <section class="mb-4 flex items-center justify-between gap-3 rounded-xl bg-white p-4">
      <p class="text-sm text-slate-600">
        @if (naoSincronizados() > 0) {
          {{ naoSincronizados() }} alteração(ões) aguardando envio.
        } @else {
          Tudo enviado.
        }
        @if (!online()) {
          <span class="block text-amber-700">Sem internet: o envio acontece quando a conexão voltar.</span>
        }
      </p>
      <button type="button" (click)="sincronizar()" [disabled]="sincronizando() || !online()"
              class="h-12 shrink-0 rounded-lg border border-slate-300 px-4 text-sm font-semibold disabled:opacity-60">
        Sincronizar agora
      </button>
    </section>

    @if (itens().length === 0) {
      <p class="py-8 text-center text-slate-500">Nenhum conflito ou rejeição.</p>
    }

    <ul class="space-y-3 sm:pb-0" [class.pb-72]="!!pdfPronto()">
      @for (p of itens(); track p.mutationId) {
        <li class="rounded-xl bg-white p-4">
          <p class="font-medium">{{ titulo(p) }}</p>
          <p data-testid="mensagem" class="mt-1 text-sm" [class.text-amber-800]="p.tipo === 'CONFLITO'" [class.text-red-700]="p.tipo === 'REJEITADO'">
            {{ mensagem(p) }}
          </p>
          @if (p.erro?.campos; as campos) {
            <ul class="mt-1 text-sm text-red-700">
              @for (c of listarCampos(p, campos); track c[0]) {
                <li>{{ c[1] }}: {{ c[2] }}</li>
              }
            </ul>
          }
          <div class="mt-3 flex flex-wrap gap-2">
            @if (p.tipo === 'CONFLITO') {
              @if (excluidoNoServidor(p)) {
                <button type="button" (click)="usarServidor(p, $any($event.currentTarget))" [disabled]="ocupada(p)" class="h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold disabled:opacity-60">Descartar</button>
              } @else {
                <button type="button" (click)="manterMinha(p)" [disabled]="ocupada(p)" class="h-12 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-60">Manter a minha</button>
                <button type="button" (click)="usarServidor(p, $any($event.currentTarget))" [disabled]="ocupada(p)" class="h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold disabled:opacity-60">Usar a do servidor</button>
              }
            } @else {
              @if (p.entidade === 'cliente' && p.erro?.codigo === 'DOCUMENTO_DUPLICADO' && p.erro?.idExistente) {
                <button type="button" (click)="usarExistente(p)" [disabled]="ocupada(p)" class="h-12 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-60">Usar cadastro existente</button>
              }
              @if (corrigivel(p) && podeMexer(p)) {
                <button type="button" data-testid="corrigir" (click)="corrigir(p)" [disabled]="ocupada(p)"
                        class="h-12 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-60">Corrigir e reenviar</button>
              }
              @if (podeRegerar(p)) {
                @if (comConflito(p)) {
                  <!-- P4c-R15: como no detalhe e na tela da OS, o PDF novo espera o CONFLITO da proposta ou da OS -->
                  <p [id]="'dica-conflito-' + p.mutationId" class="w-full text-sm text-amber-800">Resolva a pendência primeiro.</p>
                }
                <button type="button" data-testid="regerar" (click)="regerar(p, $any($event.currentTarget))" [disabled]="ocupada(p) || comConflito(p)"
                        [attr.aria-describedby]="comConflito(p) ? 'dica-conflito-' + p.mutationId : null"
                        class="h-12 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-60">
                  {{ regerando(p) ? 'Gerando PDF…' : 'Gerar PDF novamente' }}
                </button>
              }
              @if (rotaEdicao(p); as rota) {
                <button type="button" (click)="editar(rota)" class="h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold">Editar</button>
              }
              @if (abrirProposta(p)) {
                <a data-testid="abrir-proposta" [routerLink]="['/propostas', p.agregadoId]"
                   class="inline-flex h-12 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold">Abrir proposta</a>
              }
              <button type="button" (click)="descartar(p, $any($event.currentTarget))" [disabled]="ocupada(p)" class="h-12 rounded-lg px-4 text-sm font-semibold text-red-600 disabled:opacity-60">Descartar</button>
            }
            @if (p.tipo === 'CONFLITO' && p.entidade === 'proposta' && temCopia(p)) {
              <a data-testid="abrir-proposta" [routerLink]="['/propostas', p.agregadoId]"
                 class="inline-flex h-12 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold">Abrir proposta</a>
            }
            @if (osLocal(p)) {
              <a data-testid="abrir-os" [routerLink]="['/os', p.agregadoId]"
                 class="inline-flex h-12 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold">Abrir OS</a>
            }
          </div>
        </li>
      }
    </ul>

    @if (pdfPronto(); as arquivo) {
      <div class="fixed inset-x-0 bottom-0 z-40 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:static sm:p-0">
        <app-pdf-pronto [arquivo]="arquivo" (concluido)="aposCompartilhar($event, arquivo)" />
      </div>
    }

    @if (confirmacao(); as c) {
      <app-dialogo-motivo [gatilho]="c.gatilho" [titulo]="c.acao === 'servidor' ? 'Usar a do servidor?' : 'Descartar a pendência?'"
                          [texto]="c.texto ?? ''" [rotuloConfirmar]="c.acao === 'servidor' ? 'Usar a do servidor' : 'Descartar'"
                          rotuloCancelar="Voltar" [pedirMotivo]="false" [perigo]="true" [ocupado]="ocupada(c.pendencia)"
                          (confirmado)="confirmar(c)" (cancelado)="confirmacao.set(null)" />
    }
  `,
})
export class PendenciasPage {
  private readonly servico = inject(PendenciasService);
  private readonly sync = inject(SyncService);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly auth = inject(AuthService);
  protected readonly admin = computed(() => this.auth.usuario()?.perfil === 'ADMIN');
  protected readonly online = inject(ConectividadeService).online;
  protected readonly itens = toSignal(this.servico.observar(), { initialValue: [] as Pendencia[] });
  protected readonly naoSincronizados = this.sync.naoSincronizados;
  protected readonly sincronizando = this.sync.sincronizando;
  protected readonly anuncio = signal('');
  /** P4c-R8: o PDF regerado esperando um toque para o compartilhamento (o navegador recusou sem gesto). */
  protected readonly pdfPronto = signal<File | null>(null);
  protected readonly corrigivel = pendenciaCorrigivel;

  constructor() {
    effect(() => {
      const id = this.focarAoSair();
      if (id && !this.itens().some((x) => x.mutationId === id)) {
        this.focarAoSair.set(null);
        this.cabecalho()?.nativeElement.focus();
      }
    });
  }

  private readonly propostasRepo = inject(PropostasRepo);
  private readonly osRepo = inject(OsRepo);
  private readonly injector = inject(Injector);
  private readonly pdf = inject(PdfService);
  /** As propostas do aparelho por id: o código exibido e o status dos títulos e das ações. */
  private readonly propostas = toSignal(
    this.propostasRepo.observarTodas().pipe(map((l) => new Map(l.map((p) => [p.id, p] as const)))),
    { initialValue: new Map<string, PropostaLocal>() },
  );

  protected titulo(p: Pendencia): string {
    const exclusao = p.mutacao.op === 'DELETE';
    switch (p.entidade) {
      case 'cliente': {
        const nome = (p.mutacao.dados as { nome?: string } | null)?.nome;
        return nome ?? (exclusao ? 'Exclusão de cliente' : 'Cliente');
      }
      case 'item_catalogo': {
        // exclusão não leva dados: usa o que o servidor devolveu, se houver
        const d = (p.mutacao.dados ?? p.dadosServidor) as { codigo?: string; nome?: string } | null | undefined;
        const rotulo = exclusao ? 'Exclusão de item do catálogo' : 'Item do catálogo';
        const detalhe = [d?.codigo, d?.nome].filter((x) => !!x).join(' · ');
        return detalhe ? `${rotulo}: ${detalhe}` : rotulo;
      }
      case 'empresa':
        return 'Dados da empresa';
      case 'template_proposta': {
        const nome = ((p.mutacao.dados ?? p.dadosServidor) as { nome?: string } | null | undefined)?.nome;
        const rotulo = exclusao ? 'Exclusão de template' : 'Template de proposta';
        return nome ? `${rotulo}: ${nome}` : rotulo;
      }
      case 'proposta': {
        const codigo = this.codigoDaProposta(p);
        return codigo ? `Proposta ${codigo}` : 'Proposta';
      }
      case TIPO_UPLOAD_DOCUMENTO: {
        const codigo = this.codigoDaProposta(p);
        return codigo ? `PDF da proposta ${codigo}` : 'PDF da proposta';
      }
      case 'os': {
        const codigo = this.codigoDaOs(p);
        return codigo ? `OS ${codigo}` : 'OS';
      }
      case TIPO_UPLOAD_ANEXO_OS: {
        const anexoId = (p.mutacao.dados as DadosUploadAnexoOs | null)?.anexoId;
        const tipo = anexoId ? this.contextoOs().tiposDeAnexo.get(anexoId) : undefined;
        const rotulo = `${tipo ? ROTULO_ANEXO_OS[tipo] : 'Anexo'} da OS`;
        const codigo = this.codigoDaOs(p);
        return codigo ? `${rotulo} ${codigo}` : rotulo;
      }
    }
  }

  /**
   * As OS com pendência (dela ou de um anexo dela) neste aparelho, o tipo dos anexos e a revisão dos PDFs: os títulos,
   * o "Abrir OS" e o "Gerar PDF novamente".
   */
  private readonly contextoOs = toSignal(this.servico.observarOsDasPendencias(), {
    initialValue: { os: new Map<string, OsLocal>(), tiposDeAnexo: new Map<string, TipoAnexoOs>(), revisoesDosPdfs: new Map<string, number>() },
  });

  /** A OS da pendência (dela ou de um anexo dela) neste aparelho: com ela, "Abrir OS" (`/os/:id`). */
  protected osLocal(p: Pendencia): OsLocal | undefined {
    if (p.entidade !== 'os' && p.entidade !== TIPO_UPLOAD_ANEXO_OS) return undefined;
    return this.contextoOs().os.get(p.agregadoId);
  }

  /**
   * O código exibido da OS (`OS-000123`, com `-R<n>`, ou o `OSP-…`): o do aparelho e, sem a cópia local, o dos dados
   * do servidor ou da mutação. O upload de anexo só leva o id do anexo: sem a cópia local, fica sem código.
   */
  private codigoDaOs(p: Pendencia): string | null {
    const local = this.osLocal(p);
    if (local) return codigoOsExibido(local);
    if (p.entidade !== 'os') return null;
    const d = (p.dadosServidor ?? p.mutacao.dados) as Partial<OsDados> | null | undefined;
    if (!d?.codigoProvisorio) return null;
    return codigoOsExibido({ numero: d.numero ?? null, revisao: d.revisao ?? null, codigoProvisorio: d.codigoProvisorio });
  }

  /** M2P1-R30 (V1): a mutação é de uma revisão anterior à do servidor, isto é, a OS foi reaberta depois. */
  private reabertaNoServidor(p: Pendencia): boolean {
    const minha = (p.mutacao.dados as Partial<OsDados> | null)?.revisao;
    const dele = (p.dadosServidor as Partial<OsDados> | null | undefined)?.revisao;
    return minha != null && dele != null && minha < dele;
  }

  /** O código da proposta: o do aparelho (número ou PROV) e, sem a cópia local, o da mutação. */
  private codigoDaProposta(p: Pendencia): string | null {
    const local = this.propostas().get(p.agregadoId);
    if (local) return rotuloCodigo(local);
    const d = (p.mutacao.dados ?? p.dadosServidor) as { codigoProvisorio?: string } | null | undefined;
    return d?.codigoProvisorio ?? null;
  }

  /** A proposta está neste aparelho: sem ela não há o que corrigir nem abrir (ex.: exclusão recusada), só descartar. */
  protected temCopia(p: Pendencia): boolean {
    return this.propostas().has(p.agregadoId);
  }

  /** Corrigir e reenviar / gerar o PDF: com a cópia local, o ADMIN ou o comercial responsável. */
  protected podeMexer(p: Pendencia): boolean {
    const u = this.auth.usuario();
    const local = this.propostas().get(p.agregadoId);
    if (!u || !local) return false;
    return u.perfil === 'ADMIN' || (u.perfil === 'COMERCIAL' && local.responsavelId === u.id);
  }

  /**
   * "Gerar PDF novamente":
   * - na proposta, o upload recusado por `CODIGO_EXIBIDO_INVALIDO` de uma proposta que já saiu do rascunho. M5: a
   *   regra é a do `motivoParaRegerar` (a mesma do detalhe e do `regerarDocumento`), com só esta pendência;
   * - na OS, `podeRegerarOs`.
   */
  protected podeRegerar(p: Pendencia): boolean {
    if (p.entidade === TIPO_UPLOAD_ANEXO_OS) return this.podeRegerarOs(p);
    const local = this.propostas().get(p.agregadoId);
    return !!local && motivoParaRegerar(local, [], [p]) === 'CODIGO_EXIBIDO_INVALIDO' && this.podeMexer(p);
  }

  /** Executa a OS no aparelho (a tela dela conclui e gera o PDF): o ADMIN ou o técnico atribuído. */
  private executaOs(p: Pendencia): boolean {
    const os = this.osLocal(p);
    const u = this.auth.usuario();
    return !!os && !!u && (u.perfil === 'ADMIN' || (u.perfil === 'TECNICO' && os.tecnicoId === u.id));
  }

  /**
   * O PDF da OS recusado que o `OsRepo.regerarPdf` troca (M2P2-R18), pela regra compartilhada (`pdf-regeravel`): a
   * recusa é das que gerar de novo resolve, do PDF da revisão atual (o de outra revisão fica, com a pendência dele); a
   * OS está CONCLUIDA no aparelho; quem vê é o ADMIN ou o técnico atribuído; o TECNICO nunca, se o servidor disse que
   * outro usuário concluiu a OS (a pendência `OS_CONCLUIDA_POR_OUTRO` ou o histórico, M2P1-R28/R29).
   */
  private podeRegerarOs(p: Pendencia): boolean {
    const os = this.osLocal(p);
    if (!os) return false;
    const anexoId = (p.mutacao.dados as DadosUploadAnexoOs | null)?.anexoId;
    // só os PDFs têm revisão no contexto
    const revisao = anexoId ? this.contextoOs().revisoesDosPdfs.get(anexoId) : undefined;
    if (!recusaDePdfRegeravel(p, os, revisao)) return false;
    // a regra compartilhada (`pdfRegeravel`); a tela não vê a fila: a conclusão daqui ainda sem resposta é `concluidaEm` null
    const daOs = this.itens().filter((x) => x.agregadoId === p.agregadoId);
    return pdfRegeravel(os, this.auth.usuario(), daOs, os.concluidaEm === null);
  }

  /** O PDF da OS reaberta no servidor (`RECUSAS_PDF_OS_REABERTA`), para quem a executa: a pendência diz o que fazer. */
  private pdfDaOsReaberta(p: Pendencia): boolean {
    if (p.tipo !== 'REJEITADO' || p.entidade !== TIPO_UPLOAD_ANEXO_OS || !RECUSAS_PDF_OS_REABERTA.has(p.erro?.codigo ?? '')) return false;
    const anexoId = (p.mutacao.dados as DadosUploadAnexoOs | null)?.anexoId;
    return !!anexoId && this.contextoOs().revisoesDosPdfs.has(anexoId) && this.executaOs(p);
  }

  /** P4c-R15: a proposta ou a OS da pendência tem um CONFLITO (o PDF novo espera, como no detalhe e na tela da OS). */
  protected comConflito(p: Pendencia): boolean {
    return this.itens().some((x) => x.agregadoId === p.agregadoId && x.tipo === 'CONFLITO');
  }

  /** "Abrir proposta": toda rejeição de proposta que não é a correção direta (o conflito tem o link à parte). */
  protected abrirProposta(p: Pendencia): boolean {
    return p.entidade === 'proposta' && this.temCopia(p) && !(this.corrigivel(p) && this.podeMexer(p));
  }

  /** Para onde "Editar" leva; null = sem edição (ex.: catálogo para quem não é admin). */
  protected rotaEdicao(p: Pendencia): string | null {
    if (p.entidade === 'cliente') return `/clientes/${p.agregadoId}`;
    if (p.entidade === 'item_catalogo' && this.admin()) return `/catalogo/${p.agregadoId}`;
    if (p.entidade === 'template_proposta' && this.admin()) return `/templates/${p.agregadoId}`;
    return null;
  }

  protected excluidoNoServidor(p: Pendencia): boolean {
    return p.tipo === 'CONFLITO' && p.dadosServidor == null;
  }

  protected mensagem(p: Pendencia): string | undefined {
    if (p.entidade === 'item_catalogo' && p.erro?.codigo === 'CODIGO_DUPLICADO') {
      return 'Este código já é usado por outro item. Edite o código deste item.';
    }
    if (p.entidade === TIPO_UPLOAD_DOCUMENTO && p.erro?.codigo === 'CODIGO_EXIBIDO_INVALIDO') {
      if (this.podeRegerar(p)) return 'O código da proposta mudou depois que o PDF foi gerado. Gere o PDF novamente.';
      return this.propostas().get(p.agregadoId)?.status === 'RASCUNHO'
        ? 'Este PDF é de uma revisão que já foi substituída. Descarte esta pendência.'
        : `${p.erro?.mensagem ?? 'O código impresso no PDF não é o da proposta.'} Descarte esta pendência.`;
    }
    if (this.podeRegerarOs(p)) return TEXTO_RECUSA_PDF_OS[p.erro?.codigo ?? ''];
    if (this.pdfDaOsReaberta(p)) return `${p.erro?.mensagem ?? ''} ${CONCLUIR_DE_NOVO}`.trim();
    // M2-R3/R22: o envio do técnico que perdeu a atribuição há mais de 7 dias; o upload recusado já vem com o texto
    if (p.entidade === 'os' && p.erro?.codigo === 'ACESSO_NEGADO' && this.auth.usuario()?.perfil === 'TECNICO') {
      return MENSAGEM_OS_NAO_ESTA_COM_VOCE;
    }
    if (p.entidade === 'os' && p.tipo === 'REJEITADO' && p.erro?.codigo === 'VALIDACAO') {
      const ordem = p.mutacao.baseVersion === null ? VALIDACAO_OS_CRIACAO : VALIDACAO_OS_EDICAO;
      return p.erro.mensagem ? `${p.erro.mensagem} ${ordem}` : ordem;
    }
    if (p.tipo !== 'CONFLITO') return p.erro?.mensagem;
    if (this.excluidoNoServidor(p)) return 'Excluído por outra pessoa.';
    if (p.entidade === 'os' && this.reabertaNoServidor(p)) {
      return 'Esta OS foi reaberta por outra pessoa. "Manter a minha" guarda o seu resumo e as notas; a OS continua em andamento.';
    }
    return 'Alterado por outra pessoa enquanto você editava.';
  }

  /**
   * [caminho, rótulo, mensagem]; nos templates o caminho vira texto (`blocos[0].config…` → "Bloco 1 (Itens)"); na OS e
   * nos anexos dela, pelo `rotuloCampoOs` (N1: `notas[0].texto` → "Nota", `itens[1].codigo` → "Item 2 (código)").
   */
  protected listarCampos(p: Pendencia, campos: Record<string, string>): [string, string, string][] {
    return Object.entries(campos).map(([campo, msg]) => [campo, this.rotuloCampo(p, campo), msg]);
  }

  private rotuloCampo(p: Pendencia, campo: string): string {
    if (p.entidade === 'os' || p.entidade === TIPO_UPLOAD_ANEXO_OS) return rotuloCampoOs(campo);
    if (p.entidade !== 'template_proposta') return campo;
    const m = CAMINHO_BLOCO.exec(campo);
    if (!m) return ROTULO_CAMPO_TEMPLATE[campo] ?? campo;
    const i = Number(m[1]);
    const blocos = (p.mutacao.dados as { blocos?: unknown } | null)?.blocos;
    const tipo = Array.isArray(blocos) ? (blocos[i] as { tipo?: unknown } | null)?.tipo : undefined;
    const rotulo = typeof tipo === 'string' ? ROTULO_TIPO_BLOCO.get(tipo) : undefined;
    return rotulo ? `Bloco ${i + 1} (${rotulo})` : `Bloco ${i + 1}`;
  }

  protected sincronizar(): void {
    void this.sync.sincronizar();
  }

  protected editar(rota: string): void {
    void this.router.navigateByUrl(rota);
  }

  protected corrigir(p: Pendencia): void {
    void this.router.navigate(['/propostas', p.agregadoId, 'corrigir']);
  }

  /**
   * "Gerar PDF novamente", depois compartilhar ou o painel "PDF pronto": na proposta, o mesmo caminho do detalhe
   * (`regerarPdf`); na OS, o da tela dela (`OsRepo.regerarPdf` com o PDF da OS), e os erros pela `mensagemErroOs`.
   * `gatilho`: o botão, que recebe o foco de volta se a geração falha (desabilitado durante ela, ele o perde).
   */
  protected regerar(p: Pendencia, gatilho: HTMLElement | null = null): Promise<void> {
    if (p.entidade !== TIPO_UPLOAD_ANEXO_OS) {
      return this.regerarCom(p, gatilho, 'Gerando o PDF da proposta…', mensagemErroProposta,
        () => regerarPdf(this.propostasRepo, this.pdf, p.agregadoId));
    }
    return this.regerarCom(p, gatilho, 'Gerando o PDF da OS…', mensagemErroOs, async () => {
      const { blob, codigoExibido } = await this.osRepo.regerarPdf(p.agregadoId, (e) => this.pdf.gerarBlobOs(e));
      // o nome é o código impresso nele, como no upload e na tela da OS
      return { arquivo: arquivoPdf(blob, `${codigoExibido}.pdf`), blob };
    });
  }

  private async regerarCom(
    p: Pendencia,
    gatilho: HTMLElement | null,
    gerando: string,
    mensagemErro: (e: unknown) => string,
    gerar: () => Promise<{ arquivo: File; blob: Blob }>,
  ): Promise<void> {
    let falhou = false;
    await this.agir(p, async () => {
      this.regerandoIds.update((s) => new Set(s).add(p.mutationId));
      try {
        this.anuncio.set(gerando);
        const { arquivo, blob } = await gerar();
        this.toasts.mostrar('PDF gerado de novo. Ele vai para o servidor na próxima sincronização.');
        this.anuncio.set('PDF gerado de novo.');
        // a pendência sai da lista: o foco vai ao título (o botão que o tinha deixou de existir)
        this.focarAoSair.set(p.mutationId);
        const r = await compartilharArquivo(arquivo, blob);
        if (r === 'precisa-toque') this.pdfPronto.set(arquivo);
        else this.aposCompartilhar(r, arquivo);
      } catch (e) {
        falhou = true;
        this.anuncio.set('');
        this.toasts.erro(mensagemErro(e));
      } finally {
        this.regerandoIds.update((s) => {
          const resto = new Set(s);
          resto.delete(p.mutationId);
          return resto;
        });
      }
    });
    // N3: com a pendência ainda na lista, o botão volta a ficar habilitado no próximo render e retoma o foco, só se o
    // foco se perdeu (no body) ou ficou nele: o usuário que foi a outro controle durante a geração fica onde está
    if (!falhou || !gatilho) return;
    afterNextRender(() => {
      const ativo = gatilho.ownerDocument.activeElement;
      if (gatilho.isConnected && (!ativo || ativo === gatilho.ownerDocument.body || ativo === gatilho)) gatilho.focus();
    }, { injector: this.injector });
  }

  private readonly regerandoIds = signal<ReadonlySet<string>>(new Set());
  protected regerando(p: Pendencia): boolean {
    return this.regerandoIds().has(p.mutationId);
  }

  private readonly cabecalho = viewChild<ElementRef<HTMLElement>>('cabecalho');
  /** A pendência cuja saída da lista pede o foco no título. */
  private readonly focarAoSair = signal<string | null>(null);

  protected aposCompartilhar(r: Exclude<ResultadoCompartilhar, 'precisa-toque'> | 'fechado', arquivo: File): void {
    this.pdfPronto.set(null);
    if (r === 'baixado') this.toasts.mostrar(`PDF baixado: ${arquivo.name}`);
  }

  protected manterMinha(p: Pendencia): Promise<void> {
    return this.agir(p, async () => {
      const r = await this.servico.manterMinha(p);
      if (r?.notasDescartadas) this.toasts.mostrar(NOTAS_DESCARTADAS);
    });
  }

  /**
   * A confirmação aberta (`DialogoMotivo` sem motivo, `alertdialog`): de "Usar a do servidor" ou de "Descartar", com o
   * botão que a abriu para o foco voltar.
   */
  protected readonly confirmacao = signal<Confirmacao | null>(null);

  /**
   * "Usar a do servidor" (e o "Descartar" do excluído lá). P4c-R15: numa proposta com envio ou PDF feito neste aparelho
   * (`descartaEnvio`), pergunta antes — a fila do agregado sai inteira, e o cliente pode já ter o PDF. Na OS, o mesmo
   * com as fotos, a assinatura e o PDF ainda não enviados.
   */
  protected usarServidor(p: Pendencia, gatilho: HTMLElement | null = null): Promise<void> {
    if (!perguntaAntes(p)) return this.agir(p, () => this.servico.usarServidor(p));
    return this.perguntarSeDescartaEnvio({ pendencia: p, gatilho, acao: 'servidor' });
  }

  /**
   * "Descartar" de uma rejeição. N2: numa proposta recusada com envio ou PDF atrás (`descartaEnvio`), a mesma
   * confirmação — descartar também tira da fila o envio e apaga o PDF. Na OS, as fotos, a assinatura e o PDF não
   * enviados. O upload recusado (PDF da proposta, anexo da OS) descarta só o arquivo dele (a ação é essa) e vai direto,
   * como as outras entidades.
   */
  protected descartar(p: Pendencia, gatilho: HTMLElement | null = null): Promise<void> {
    if (!perguntaAntes(p)) return this.agir(p, () => this.servico.descartar(p));
    return this.perguntarSeDescartaEnvio({ pendencia: p, gatilho, acao: 'descartar' });
  }

  private async perguntarSeDescartaEnvio(c: Confirmacao): Promise<void> {
    const p = c.pendencia;
    if (this.ocupada(p)) return;
    // P4c-R15: o aviso diz o que sai; na OS, conforme o que ela levaria
    const aviso = await this.avisoDoDescarte(p).catch((e: unknown) => {
      this.toasts.erro(this.mensagemDoErro(p, e));
      return undefined;
    });
    if (aviso === undefined) return;
    if (aviso !== null) {
      this.confirmacao.set({ ...c, texto: aviso });
      return;
    }
    await this.agir(p, () => this.executarDescarte(c));
  }

  /** O texto da confirmação, ou null quando a ação não leva nada feito aqui. */
  private async avisoDoDescarte(p: Pendencia): Promise<string | null> {
    if (p.entidade === 'os' || osNaoEncontrada(p)) {
      // M1: o aviso nomeia o que sai (o início, as notas, a recusa, a conclusão e o resumo, as fotos, o PDF…)
      const perda = await this.servico.perdaDaOs(p);
      return perda.length > 0 ? textoPerdaOs(perda) : null;
    }
    return (await this.servico.descartaEnvio(p)) ? AVISO_PROPOSTA : null;
  }

  protected async confirmar(c: Confirmacao): Promise<void> {
    await this.agir(c.pendencia, async () => {
      await this.executarDescarte(c);
      // a pendência sai da lista com o botão que abriu o diálogo: o foco vai ao título
      this.focarAoSair.set(c.pendencia.mutationId);
    });
    this.confirmacao.set(null);
  }

  private executarDescarte(c: Confirmacao): Promise<void> {
    return c.acao === 'servidor' ? this.servico.usarServidor(c.pendencia) : this.servico.descartar(c.pendencia);
  }

  protected async usarExistente(p: Pendencia): Promise<void> {
    await this.agir(p, async () => {
      const id = await this.servico.usarExistente(p);
      await this.router.navigateByUrl(`/clientes/${id}`);
    });
  }

  /** mutationIds com ação em curso: os botões da pendência ficam desabilitados e um segundo toque não faz nada. */
  private readonly emCurso = signal<ReadonlySet<string>>(new Set());

  protected ocupada(p: Pendencia): boolean {
    return this.emCurso().has(p.mutationId);
  }

  /**
   * O toast de uma ação que falhou. M4: numa proposta (ou no PDF dela), como nas outras telas de proposta
   * (`mensagemErroProposta`: a recusa do repositório com a mensagem dela, o erro técnico com a genérica); na OS (ou num
   * anexo dela), o mesmo pela `mensagemErroOs`; a falha de rede ou do servidor, pela `mensagemDeErro`.
   */
  private mensagemDoErro(p: Pendencia, e: unknown): string {
    if (e instanceof HttpErrorResponse) return mensagemDeErro(e);
    if (p.entidade === 'proposta' || p.entidade === TIPO_UPLOAD_DOCUMENTO) return mensagemErroProposta(e);
    if (p.entidade === 'os' || p.entidade === TIPO_UPLOAD_ANEXO_OS) return mensagemErroOs(e);
    return e instanceof Error ? e.message : mensagemDeErro(e);
  }

  protected async agir(p: Pendencia, acao: () => Promise<unknown>): Promise<void> {
    if (this.ocupada(p)) return;
    this.emCurso.update((s) => new Set(s).add(p.mutationId));
    try {
      await acao();
    } catch (e) {
      this.toasts.erro(this.mensagemDoErro(p, e));
    } finally {
      this.emCurso.update((s) => {
        const resto = new Set(s);
        resto.delete(p.mutationId);
        return resto;
      });
    }
  }
}
