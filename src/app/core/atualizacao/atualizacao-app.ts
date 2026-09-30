import { inject, Injectable } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { Toasts } from '../../shared/ui/toasts';

@Injectable({ providedIn: 'root' })
export class AtualizacaoApp {
  private readonly sw = inject(SwUpdate);
  private readonly toasts = inject(Toasts);
  private iniciado = false;

  iniciar(): void {
    if (this.iniciado || !this.sw.isEnabled) return;
    this.iniciado = true;
    this.sw.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() =>
        this.toasts.mostrar('Nova versão disponível.', {
          acao: 'Atualizar',
          aoAgir: () => document.location.reload(),
          fixo: true,
        }),
      );
  }
}
