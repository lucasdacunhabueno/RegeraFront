import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { mensagemDeErro } from '../../core/http/erro-api';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule],
  template: `
    <div class="flex min-h-dvh items-center justify-center px-4">
      <form [formGroup]="form" (ngSubmit)="entrar()" class="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-sm">
        <h1 class="text-2xl font-semibold text-blue-700">Regera</h1>

        @if (!online()) {
          <p class="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">Sem internet: o login precisa de conexão.</p>
        }

        <div class="space-y-1">
          <label for="email" class="text-sm font-medium">E-mail</label>
          <input id="email" type="email" formControlName="email" autocomplete="username"
                 class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (form.controls.email.touched && form.controls.email.invalid) {
            <p class="text-sm text-red-600">Informe um e-mail válido.</p>
          }
        </div>

        <div class="space-y-1">
          <label for="senha" class="text-sm font-medium">Senha</label>
          <input id="senha" type="password" formControlName="senha" autocomplete="current-password"
                 class="h-12 w-full rounded-lg border border-slate-300 px-3" />
        </div>

        @if (erro()) {
          <p class="text-sm text-red-600" role="alert">{{ erro() }}</p>
        }

        <button type="submit" [disabled]="enviando()"
                class="h-12 w-full rounded-lg bg-blue-600 font-semibold text-white disabled:opacity-60">
          {{ enviando() ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>
    </div>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly online = inject(ConectividadeService).online;
  protected readonly enviando = signal(false);
  protected readonly erro = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    email: [this.auth.usuario()?.email ?? '', [Validators.required, Validators.email]],
    senha: ['', Validators.required],
  });

  protected async entrar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.enviando.set(true);
    this.erro.set(null);
    try {
      const { email, senha } = this.form.getRawValue();
      await this.auth.login(email, senha);
      await this.router.navigateByUrl('/');
    } catch (e) {
      this.erro.set(mensagemDeErro(e));
    } finally {
      this.enviando.set(false);
    }
  }
}
