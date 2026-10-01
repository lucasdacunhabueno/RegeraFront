import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { mensagemDeErro } from '../../core/http/erro-api';
import { PendenciasService } from '../../core/sync/pendencias-service';
import { Pendencia } from '../../core/sync/sync-models';
import { SyncService } from '../../core/sync/sync-service';
import { Toasts } from '../../shared/ui/toasts';
import { TIPOS_BLOCO } from '../templates/template-models';

const ROTULO_TIPO_BLOCO = new Map<string, string>(TIPOS_BLOCO.map((t) => [t.valor, t.rotulo]));
const ROTULO_CAMPO_TEMPLATE: Record<string, string> = {
  nome: 'Nome', tipoProposta: 'Tipo de proposta', ativo: 'Ativo', padrao: 'Padrão', blocos: 'Blocos',
};
const CAMINHO_BLOCO = /^blocos\[(\d+)\]/;

@Component({
  selector: 'app-pendencias-page',
  template: `
    <h1 class="mb-4 text-xl font-semibold">Pendências de sync</h1>

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

    <ul class="space-y-3">
      @for (p of itens(); track p.mutationId) {
        <li class="rounded-xl bg-white p-4">
          <p class="font-medium">{{ titulo(p) }}</p>
          <p class="mt-1 text-sm" [class.text-amber-800]="p.tipo === 'CONFLITO'" [class.text-red-700]="p.tipo === 'REJEITADO'">
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
                <button type="button" (click)="usarServidor(p)" class="h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold">Descartar</button>
              } @else {
                <button type="button" (click)="manterMinha(p)" class="h-12 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white">Manter a minha</button>
                <button type="button" (click)="usarServidor(p)" class="h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold">Usar a do servidor</button>
              }
            } @else {
              @if (p.entidade === 'cliente' && p.erro?.codigo === 'DOCUMENTO_DUPLICADO' && p.erro?.idExistente) {
                <button type="button" (click)="usarExistente(p)" class="h-12 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white">Usar cadastro existente</button>
              }
              @if (rotaEdicao(p); as rota) {
                <button type="button" (click)="editar(rota)" class="h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold">Editar</button>
              }
              <button type="button" (click)="descartar(p)" class="h-12 rounded-lg px-4 text-sm font-semibold text-red-600">Descartar</button>
            }
          </div>
        </li>
      }
    </ul>
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
        const d = (p.mutacao.dados ?? p.dadosServidor) as { codigoProvisorio?: string } | null | undefined;
        return d?.codigoProvisorio ? `Proposta ${d.codigoProvisorio}` : 'Proposta';
      }
    }
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
    if (p.tipo !== 'CONFLITO') return p.erro?.mensagem;
    return this.excluidoNoServidor(p) ? 'Excluído por outra pessoa.' : 'Alterado por outra pessoa enquanto você editava.';
  }

  /** [caminho, rótulo, mensagem]; nos templates o caminho vira texto (`blocos[0].config…` → "Bloco 1 (Itens)"). */
  protected listarCampos(p: Pendencia, campos: Record<string, string>): [string, string, string][] {
    return Object.entries(campos).map(([campo, msg]) => [campo, this.rotuloCampo(p, campo), msg]);
  }

  private rotuloCampo(p: Pendencia, campo: string): string {
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

  protected manterMinha(p: Pendencia): Promise<void> {
    return this.agir(() => this.servico.manterMinha(p));
  }

  protected usarServidor(p: Pendencia): Promise<void> {
    return this.agir(() => this.servico.usarServidor(p));
  }

  protected descartar(p: Pendencia): Promise<void> {
    return this.agir(() => this.servico.descartar(p));
  }

  protected async usarExistente(p: Pendencia): Promise<void> {
    await this.agir(async () => {
      const id = await this.servico.usarExistente(p);
      await this.router.navigateByUrl(`/clientes/${id}`);
    });
  }

  protected async agir(acao: () => Promise<unknown>): Promise<void> {
    try {
      await acao();
    } catch (e) {
      this.toasts.erro(e instanceof Error && !(e instanceof HttpErrorResponse) ? e.message : mensagemDeErro(e));
    }
  }
}
