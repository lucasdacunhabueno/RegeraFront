import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  mensagem: string;
  tipo: 'info' | 'erro';
  acao?: string;
  aoAgir?: () => void;
}

export interface OpcoesToast {
  tipo?: 'info' | 'erro';
  acao?: string;
  aoAgir?: () => void;
  fixo?: boolean;
}

@Injectable({ providedIn: 'root' })
export class Toasts {
  private seq = 0;
  readonly itens = signal<Toast[]>([]);

  mostrar(mensagem: string, opcoes: OpcoesToast = {}): void {
    const toast: Toast = { id: ++this.seq, mensagem, tipo: opcoes.tipo ?? 'info', acao: opcoes.acao, aoAgir: opcoes.aoAgir };
    this.itens.update((lista) => [...lista, toast]);
    if (!opcoes.fixo) {
      setTimeout(() => this.fechar(toast.id), 5000);
    }
  }

  erro(mensagem: string): void {
    this.mostrar(mensagem, { tipo: 'erro' });
  }

  fechar(id: number): void {
    this.itens.update((lista) => lista.filter((t) => t.id !== id));
  }
}
