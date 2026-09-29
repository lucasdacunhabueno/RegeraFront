import { DestroyRef, inject, Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ConectividadeService {
  private readonly estado = signal(navigator.onLine);
  readonly online = this.estado.asReadonly();

  constructor() {
    const aoConectar = () => this.estado.set(true);
    const aoDesconectar = () => this.estado.set(false);
    window.addEventListener('online', aoConectar);
    window.addEventListener('offline', aoDesconectar);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', aoConectar);
      window.removeEventListener('offline', aoDesconectar);
    });
  }
}
