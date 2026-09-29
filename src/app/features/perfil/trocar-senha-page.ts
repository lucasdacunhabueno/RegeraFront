import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth-service';
import { mensagemDeErro } from '../../core/http/erro-api';
import { Toasts } from '../../shared/ui/toasts';
import { UsuariosApi } from '../usuarios/usuarios-api';

@Component({
  selector: 'app-trocar-senha-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <a routerLink="/mais" class="text-sm text-blue-700">← Mais</a>
    <h1 class="mb-4 mt-2 text-xl font-semibold">Trocar senha</h1>
    <form [formGroup]="form" (ngSubmit)="salvar()" class="space-y-4 rounded-xl bg-white p-4">
      <div class="space-y-1">
        <label for="senhaAtual" class="text-sm font-medium">Senha atual</label>
        <input id="senhaAtual" type="password" formControlName="senhaAtual" autocomplete="current-password" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
      </div>
      <div class="space-y-1">
        <label for="novaSenha" class="text-sm font-medium">Nova senha</label>
        <input id="novaSenha" type="password" formControlName="novaSenha" autocomplete="new-password" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
      </div>
      <div class="space-y-1">
        <label for="confirmacao" class="text-sm font-medium">Confirme a nova senha</label>
        <input id="confirmacao" type="password" formControlName="confirmacao" autocomplete="new-password" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
      </div>
      @if (erro()) { <p class="text-sm text-red-600" role="alert">{{ erro() }}</p> }
      <button type="submit" [disabled]="salvando()" class="h-12 w-full rounded-lg bg-blue-600 font-semibold text-white disabled:opacity-60">
        Salvar
      </button>
    </form>
  `,
})
export class TrocarSenhaPage {
  private readonly api = inject(UsuariosApi);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly salvando = signal(false);
  protected readonly erro = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    senhaAtual: ['', Validators.required],
    novaSenha: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
    confirmacao: ['', Validators.required],
  });

  protected async salvar(): Promise<void> {
    const { senhaAtual, novaSenha, confirmacao } = this.form.getRawValue();
    if (this.form.invalid) {
      this.erro.set('A nova senha deve ter entre 8 e 72 caracteres.');
      return;
    }
    if (novaSenha !== confirmacao) {
      this.erro.set('As senhas não conferem.');
      return;
    }
    this.salvando.set(true);
    this.erro.set(null);
    try {
      await firstValueFrom(this.api.trocarMinhaSenha(senhaAtual, novaSenha));
      // O servidor revoga todas as sessões de refresh ao trocar a própria senha.
      this.toasts.mostrar('Senha alterada. Entre novamente.');
      await this.auth.logout();
      await this.router.navigateByUrl('/login');
    } catch (e) {
      this.erro.set(mensagemDeErro(e));
    } finally {
      this.salvando.set(false);
    }
  }
}
