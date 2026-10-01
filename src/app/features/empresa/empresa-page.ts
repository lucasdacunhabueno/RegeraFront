import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ArquivosService } from '../../core/arquivos/arquivos-service';
import { ImagemService } from '../../core/arquivos/imagem-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { RegeraDb } from '../../core/db/regera-db';
import { camposComErro, mensagemDeErro } from '../../core/http/erro-api';
import { cnpjValido, normalizarDocumento } from '../../core/util/documentos';
import { formatarTelefone, mascararDocumento, somenteDigitos } from '../../core/util/formatos';
import { Toasts } from '../../shared/ui/toasts';
import { EmpresaApi, EmpresaResposta } from './empresa-api';
import { EmpresaDados, ID_EMPRESA, paraEmpresaLocal } from './empresa-models';

const vazio = (v: string) => (v.trim() === '' ? null : v.trim());
const naoSoEspacos = (c: AbstractControl<string>): ValidationErrors | null =>
  c.value.trim() === '' ? { required: true } : null;

@Component({
  selector: 'app-empresa-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <a routerLink="/mais" class="text-sm text-blue-700">← Mais</a>
    <h1 class="mb-4 mt-2 text-xl font-semibold">Empresa</h1>
    <p class="mb-3 text-sm text-slate-600">Estes dados aparecem no cabeçalho das propostas.</p>

    @if (!online()) {
      <p class="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">Alterar os dados da empresa precisa de internet.</p>
    }

    <form [formGroup]="form" (ngSubmit)="salvar()" class="space-y-4">
      <section class="space-y-4 rounded-xl bg-white p-4">
        <div class="space-y-3">
          <p class="text-sm font-medium">Logo</p>
          @if (logoUrl()) {
            <img [src]="logoUrl()" alt="Logo da empresa" class="h-20 w-auto rounded bg-slate-50 object-contain p-2" />
          }
          @if (logoArquivoId() && online()) {
            <button type="button" (click)="removerLogo()" [disabled]="enviandoLogo()" class="block text-sm text-red-600">Remover logo</button>
          }
          <input #inputLogo id="logo" type="file" accept="image/png,image/jpeg,image/webp" [disabled]="!online() || enviandoLogo()"
                 (change)="escolherLogo($event)" aria-label="Escolher logo" class="block w-full text-sm" />
          @if (campo('logoArquivoId')) { <p class="text-sm text-red-600">{{ campo('logoArquivoId') }}</p> }
        </div>

        <div class="space-y-1">
          <label for="razaoSocial" class="text-sm font-medium">Razão social</label>
          <input id="razaoSocial" formControlName="razaoSocial" maxlength="160" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (campo('razaoSocial')) { <p class="text-sm text-red-600">{{ campo('razaoSocial') }}</p> }
        </div>
        <div class="space-y-1">
          <label for="nomeFantasia" class="text-sm font-medium">Nome fantasia</label>
          <input id="nomeFantasia" formControlName="nomeFantasia" maxlength="160" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (campo('nomeFantasia')) { <p class="text-sm text-red-600">{{ campo('nomeFantasia') }}</p> }
        </div>
        <div class="space-y-1">
          <label for="cnpj" class="text-sm font-medium">CNPJ</label>
          <input id="cnpj" formControlName="cnpj" (input)="mascararCnpj()" autocomplete="off" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (campo('cnpj')) { <p class="text-sm text-red-600">{{ campo('cnpj') }}</p> }
        </div>
        <div class="space-y-1">
          <label for="endereco" class="text-sm font-medium">Endereço</label>
          <input id="endereco" formControlName="endereco" maxlength="300" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (campo('endereco')) { <p class="text-sm text-red-600">{{ campo('endereco') }}</p> }
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label for="telefone" class="text-sm font-medium">Telefone</label>
            <input id="telefone" formControlName="telefone" inputmode="tel" maxlength="15" (input)="mascararTelefone()"
                   class="h-12 w-full rounded-lg border border-slate-300 px-3" />
            @if (campo('telefone')) { <p class="text-sm text-red-600">{{ campo('telefone') }}</p> }
          </div>
          <div class="space-y-1">
            <label for="email" class="text-sm font-medium">E-mail</label>
            <input id="email" type="email" formControlName="email" maxlength="160" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
            @if (campo('email')) { <p class="text-sm text-red-600">{{ campo('email') }}</p> }
          </div>
        </div>
        <div class="space-y-1">
          <label for="site" class="text-sm font-medium">Site</label>
          <input id="site" formControlName="site" maxlength="160" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (campo('site')) { <p class="text-sm text-red-600">{{ campo('site') }}</p> }
        </div>
      </section>

      <section class="space-y-4 rounded-xl bg-white p-4">
        <h2 class="font-semibold">Padrões das propostas</h2>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label for="validadePadraoDias" class="text-sm font-medium">Validade (dias)</label>
            <input id="validadePadraoDias" type="number" min="1" max="365" formControlName="validadePadraoDias"
                   class="h-12 w-full rounded-lg border border-slate-300 px-3" />
            @if (campo('validadePadraoDias')) { <p class="text-sm text-red-600">{{ campo('validadePadraoDias') }}</p> }
          </div>
          <div class="space-y-1">
            <label for="corPrimaria" class="text-sm font-medium">Cor</label>
            <input id="corPrimaria" type="color" formControlName="corPrimaria" class="h-12 w-full rounded-lg border border-slate-300 px-1" />
            @if (campo('corPrimaria')) { <p class="text-sm text-red-600">{{ campo('corPrimaria') }}</p> }
          </div>
        </div>
        <div class="space-y-1">
          <label for="condicoesPagamentoPadrao" class="text-sm font-medium">Condições de pagamento padrão</label>
          <textarea id="condicoesPagamentoPadrao" formControlName="condicoesPagamentoPadrao" maxlength="500" rows="3"
                    class="w-full rounded-lg border border-slate-300 px-3 py-2"></textarea>
          @if (campo('condicoesPagamentoPadrao')) { <p class="text-sm text-red-600">{{ campo('condicoesPagamentoPadrao') }}</p> }
        </div>
      </section>

      @if (erroGeral()) { <p class="text-sm text-red-600" role="alert">{{ erroGeral() }}</p> }
      <button type="submit" [disabled]="!online() || salvando() || enviandoLogo()"
              class="h-12 w-full rounded-lg bg-blue-600 font-semibold text-white disabled:opacity-60">Salvar</button>
    </form>
  `,
})
export class EmpresaPage {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(EmpresaApi);
  private readonly db = inject(RegeraDb);
  private readonly arquivos = inject(ArquivosService);
  private readonly imagem = inject(ImagemService);
  private readonly toasts = inject(Toasts);
  protected readonly online = inject(ConectividadeService).online;
  protected readonly salvando = signal(false);
  protected readonly enviandoLogo = signal(false);
  protected readonly erroGeral = signal<string | null>(null);
  protected readonly erros = signal<Record<string, string>>({});
  protected readonly logoUrl = signal<string | null>(null);
  protected readonly logoArquivoId = signal<string | null>(null);
  private readonly inputLogo = viewChild<ElementRef<HTMLInputElement>>('inputLogo');
  private version: number | null = null;

  protected readonly form = this.fb.group({
    razaoSocial: ['', [Validators.required, naoSoEspacos, Validators.maxLength(160)]],
    nomeFantasia: [''],
    cnpj: [''],
    endereco: [''],
    telefone: [''],
    email: ['', Validators.email],
    site: [''],
    corPrimaria: ['#1d4ed8'],
    validadePadraoDias: [15, [Validators.required, Validators.min(1), Validators.max(365)]],
    condicoesPagamentoPadrao: [''],
  });

  constructor() {
    void this.carregar();
  }

  protected campo(nome: string): string | null {
    return this.erros()[nome] ?? null;
  }

  protected mascararCnpj(): void {
    const c = this.form.controls.cnpj;
    c.setValue(mascararDocumento('PJ', c.value), { emitEvent: false });
    this.erros.update((e) => ({ ...e, cnpj: '' }));
  }

  protected mascararTelefone(): void {
    const c = this.form.controls.telefone;
    c.setValue(formatarTelefone(c.value), { emitEvent: false });
  }

  protected removerLogo(): void {
    this.logoArquivoId.set(null);
    this.logoUrl.set(null);
    const input = this.inputLogo()?.nativeElement;
    if (input) input.value = '';
  }

  protected async escolherLogo(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const arquivo = input.files?.[0];
    if (!arquivo) return;
    this.enviandoLogo.set(true);
    try {
      const reduzida = await this.imagem.redimensionar(arquivo, 400, 'image/png');
      const enviado = await this.arquivos.enviar(reduzida, 'logo.png');
      this.logoArquivoId.set(enviado.id);
      this.logoUrl.set(await this.arquivos.obterUrl(enviado.id));
    } catch (e) {
      this.toasts.erro(e instanceof HttpErrorResponse ? mensagemDeErro(e) : e instanceof Error ? e.message : mensagemDeErro(e));
    } finally {
      this.enviandoLogo.set(false);
      // permite escolher o mesmo arquivo de novo
      input.value = '';
    }
  }

  protected async salvar(): Promise<void> {
    if (this.enviandoLogo() || this.salvando()) return;
    this.erroGeral.set(null);
    const v = this.form.getRawValue();
    const cnpj = normalizarDocumento(v.cnpj);
    const erros: Record<string, string> = {};
    if (cnpj && !cnpjValido(cnpj)) erros['cnpj'] = 'CNPJ inválido.';
    if (this.form.controls.razaoSocial.invalid) erros['razaoSocial'] = 'Informe a razão social.';
    if (this.form.controls.validadePadraoDias.invalid) erros['validadePadraoDias'] = 'Entre 1 e 365 dias.';
    if (this.form.controls.email.invalid) erros['email'] = 'E-mail inválido.';
    this.erros.set(erros);
    if (Object.keys(erros).length > 0 || this.form.invalid) {
      this.form.markAllAsTouched();
      this.erroGeral.set('Corrija os campos destacados.');
      return;
    }
    const dados: EmpresaDados = {
      razaoSocial: v.razaoSocial.trim(),
      nomeFantasia: vazio(v.nomeFantasia),
      cnpj: cnpj || null,
      endereco: vazio(v.endereco),
      telefone: vazio(somenteDigitos(v.telefone)),
      email: vazio(v.email),
      site: vazio(v.site),
      logoArquivoId: this.logoArquivoId(),
      corPrimaria: v.corPrimaria,
      validadePadraoDias: Number(v.validadePadraoDias),
      condicoesPagamentoPadrao: vazio(v.condicoesPagamentoPadrao),
    };
    this.salvando.set(true);
    try {
      const r = await this.api.salvar(this.version, dados);
      this.version = r.version;
      try {
        // cópia local imediata (o pull confirma depois) — o PDF do P4 lê daqui
        await this.db.empresa.put(paraEmpresaLocal(ID_EMPRESA, r.version, r.dados));
      } catch {
        // já está salvo no servidor; o próximo pull grava a cópia local
      }
      this.toasts.mostrar('Dados da empresa salvos.');
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 409) {
        this.toasts.erro(mensagemDeErro(e));
        await this.carregar(true);
      } else {
        this.erros.set(camposComErro(e));
        this.erroGeral.set(mensagemDeErro(e));
      }
    } finally {
      this.salvando.set(false);
    }
  }

  /** aposConflito: precisa da versão atual do servidor; sem ela, avisa em vez de ficar com a versão velha. */
  private async carregar(aposConflito = false): Promise<void> {
    let r: EmpresaResposta | null = null;
    let erro: unknown = null;
    if (this.online()) {
      try {
        r = await this.api.obter();
      } catch (e) {
        erro = e;
      }
    } else if (aposConflito) {
      erro = new HttpErrorResponse({ status: 0 });
    }
    if (aposConflito && erro) {
      this.erroGeral.set(`Não foi possível carregar a versão atual: ${mensagemDeErro(erro)} Recarregue antes de salvar de novo.`);
      return;
    }
    if (erro) this.toasts.erro(mensagemDeErro(erro));
    const local = r ? undefined : await this.db.empresa.get(ID_EMPRESA);
    const d = r?.dados ?? local ?? null;
    this.version = r ? r.version : (local?.version ?? null);
    if (!d) return;
    const e = paraEmpresaLocal(ID_EMPRESA, this.version, d);
    this.form.patchValue({
      razaoSocial: e.razaoSocial,
      nomeFantasia: e.nomeFantasia ?? '',
      cnpj: mascararDocumento('PJ', e.cnpj ?? ''),
      endereco: e.endereco ?? '',
      telefone: formatarTelefone(e.telefone),
      email: e.email ?? '',
      site: e.site ?? '',
      corPrimaria: e.corPrimaria,
      validadePadraoDias: e.validadePadraoDias,
      condicoesPagamentoPadrao: e.condicoesPagamentoPadrao ?? '',
    });
    this.logoArquivoId.set(e.logoArquivoId);
    this.logoUrl.set(e.logoArquivoId ? await this.arquivos.obterUrl(e.logoArquivoId) : null);
  }
}
