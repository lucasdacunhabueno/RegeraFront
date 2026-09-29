import { Component, effect, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Perfil } from '../../core/auth/auth-models';
import { camposComErro, mensagemDeErro } from '../../core/http/erro-api';
import { Toasts } from '../../shared/ui/toasts';
import { ROTULO_PERFIL, UsuariosApi } from './usuarios-api';

@Component({
  selector: 'app-usuario-form-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <a routerLink="/usuarios" class="text-sm text-blue-700">← Usuários</a>
    <h1 class="mb-4 mt-2 text-xl font-semibold">{{ id() ? 'Editar usuário' : 'Novo usuário' }}</h1>

    <form [formGroup]="form" (ngSubmit)="salvar()" class="space-y-4 rounded-xl bg-white p-4">
      <div class="space-y-1">
        <label for="nome" class="text-sm font-medium">Nome</label>
        <input id="nome" formControlName="nome" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
        @if (erroCampo('nome'); as msg) { <p class="text-sm text-red-600">{{ msg }}</p> }
      </div>

      <div class="space-y-1">
        <label for="email" class="text-sm font-medium">E-mail</label>
        <input id="email" type="email" formControlName="email" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
        @if (erroCampo('email'); as msg) { <p class="text-sm text-red-600">{{ msg }}</p> }
      </div>

      <div class="space-y-1">
        <label for="perfil" class="text-sm font-medium">Perfil</label>
        <select id="perfil" formControlName="perfil" class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3">
          @for (p of perfis; track p) { <option [value]="p">{{ rotulo[p] }}</option> }
        </select>
      </div>

      @if (id()) {
        <label class="flex items-center gap-2">
          <input id="ativo" type="checkbox" formControlName="ativo" class="size-5" /> Ativo
        </label>
      } @else {
        <div class="space-y-1">
          <label for="senha" class="text-sm font-medium">Senha inicial</label>
          <input id="senha" type="password" formControlName="senha" autocomplete="new-password" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (erroCampo('senha'); as msg) { <p class="text-sm text-red-600">{{ msg }}</p> }
        </div>
      }

      @if (erro()) { <p class="text-sm text-red-600" role="alert">{{ erro() }}</p> }

      <button type="submit" [disabled]="salvando()" class="h-12 w-full rounded-lg bg-blue-600 font-semibold text-white disabled:opacity-60">
        Salvar
      </button>
    </form>

    @if (id()) {
      <form (submit)="$event.preventDefault(); redefinirSenha()" class="mt-4 space-y-3 rounded-xl bg-white p-4">
        <h2 class="font-semibold">Redefinir senha</h2>
        <input id="novaSenha" type="password" [value]="novaSenha()" (input)="novaSenha.set($any($event.target).value)"
               autocomplete="new-password" placeholder="Nova senha (mín. 8)" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
        <button type="submit" [disabled]="redefinindo() || novaSenha().length < 8" class="h-12 w-full rounded-lg border border-slate-300 font-semibold disabled:opacity-60">
          Redefinir senha
        </button>
      </form>
    }
  `,
})
export class UsuarioFormPage {
  readonly id = input<string>();

  private readonly api = inject(UsuariosApi);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly perfis: Perfil[] = ['ADMIN', 'COMERCIAL', 'TECNICO'];
  protected readonly rotulo = ROTULO_PERFIL;
  protected readonly salvando = signal(false);
  protected readonly erro = signal<string | null>(null);
  protected readonly errosServidor = signal<Record<string, string>>({});
  protected readonly novaSenha = signal('');
  protected readonly redefinindo = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group({
    nome: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    perfil: ['COMERCIAL' as Perfil, Validators.required],
    ativo: [true],
    senha: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
  });

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) {
        this.form.controls.senha.disable();
        void this.carregar(id);
      }
    });
  }

  protected erroCampo(campo: 'nome' | 'email' | 'senha'): string | null {
    const controle = this.form.controls[campo];
    if (this.errosServidor()[campo]) return this.errosServidor()[campo];
    if (!controle.touched || controle.valid) return null;
    if (campo === 'senha') return 'A senha deve ter entre 8 e 72 caracteres.';
    if (campo === 'email') return 'E-mail inválido.';
    return 'Informe o nome.';
  }

  protected async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.salvando.set(true);
    this.erro.set(null);
    this.errosServidor.set({});
    const { nome, email, perfil, ativo, senha } = this.form.getRawValue();
    const id = this.id();
    try {
      if (id) {
        await firstValueFrom(this.api.alterar(id, { nome, email, perfil, ativo }));
      } else {
        await firstValueFrom(this.api.criar({ nome, email, perfil, senha }));
      }
      this.toasts.mostrar('Usuário salvo.');
      await this.router.navigateByUrl('/usuarios');
    } catch (e) {
      const campos = camposComErro(e);
      this.errosServidor.set(campos);
      this.erro.set(Object.keys(campos).length === 0 ? mensagemDeErro(e) : null);
    } finally {
      this.salvando.set(false);
    }
  }

  protected async redefinirSenha(): Promise<void> {
    const id = this.id();
    if (!id || this.redefinindo()) return;
    this.redefinindo.set(true);
    try {
      await firstValueFrom(this.api.redefinirSenha(id, this.novaSenha()));
      this.novaSenha.set('');
      this.toasts.mostrar('Senha redefinida. As sessões do usuário foram encerradas.');
    } catch (e) {
      this.toasts.erro(mensagemDeErro(e));
    } finally {
      this.redefinindo.set(false);
    }
  }

  private async carregar(id: string): Promise<void> {
    try {
      const u = await firstValueFrom(this.api.buscar(id));
      this.form.patchValue({ nome: u.nome, email: u.email, perfil: u.perfil, ativo: u.ativo });
    } catch (e) {
      this.erro.set(mensagemDeErro(e));
    }
  }
}
