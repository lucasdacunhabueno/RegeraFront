import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { mensagemDeErro } from '../../core/http/erro-api';
import { PendenciasService } from '../../core/sync/pendencias-service';
import { Pendencia } from '../../core/sync/sync-models';
import { SyncService } from '../../core/sync/sync-service';
import { Toasts } from '../../shared/ui/toasts';

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
            {{ p.tipo === 'CONFLITO' ? 'Alterado por outra pessoa enquanto você editava.' : p.erro?.mensagem }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            @if (p.tipo === 'CONFLITO') {
              <button type="button" (click)="manterMinha(p)" class="h-12 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white">Manter a minha</button>
              <button type="button" (click)="usarServidor(p)" class="h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold">Usar a do servidor</button>
            } @else {
              @if (p.erro?.codigo === 'DOCUMENTO_DUPLICADO' && p.erro?.idExistente) {
                <button type="button" (click)="usarExistente(p)" class="h-12 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white">Usar cadastro existente</button>
              }
              <button type="button" (click)="editar(p)" class="h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold">Editar</button>
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
  protected readonly online = inject(ConectividadeService).online;
  protected readonly itens = toSignal(this.servico.observar(), { initialValue: [] as Pendencia[] });
  protected readonly naoSincronizados = this.sync.naoSincronizados;
  protected readonly sincronizando = this.sync.sincronizando;

  protected titulo(p: Pendencia): string {
    const nome = (p.mutacao.dados as { nome?: string } | null)?.nome;
    return nome ?? (p.mutacao.op === 'DELETE' ? 'Exclusão de cliente' : 'Cliente');
  }

  protected sincronizar(): void {
    void this.sync.sincronizar();
  }

  protected editar(p: Pendencia): void {
    void this.router.navigateByUrl(`/clientes/${p.agregadoId}`);
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
