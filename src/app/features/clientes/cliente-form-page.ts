import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { documentoValido, normalizarDocumento } from '../../core/util/documentos';
import {
  formatarCep,
  formatarDocumento,
  formatarTelefone,
  mascararDocumento,
  somenteDigitos,
} from '../../core/util/formatos';
import { Toasts } from '../../shared/ui/toasts';
import { ClienteDados, EnderecoDados, ROTULO_TIPO_ENDERECO, TipoEndereco, TipoPessoa } from './cliente-models';
import { ClientesRepo, ErroCampo } from './clientes-repo';
import { ConsultasExternas } from './consultas-externas';

function criarGrupoEndereco(fb: NonNullableFormBuilder, e?: Partial<EnderecoDados>) {
  return fb.group({
    tipo: fb.control<TipoEndereco>(e?.tipo ?? 'PRINCIPAL'),
    cep: [formatarCep(e?.cep), Validators.maxLength(9)],
    logradouro: [e?.logradouro ?? '', Validators.maxLength(160)],
    numero: [e?.numero ?? '', Validators.maxLength(20)],
    complemento: [e?.complemento ?? '', Validators.maxLength(80)],
    bairro: [e?.bairro ?? '', Validators.maxLength(80)],
    cidade: [e?.cidade ?? '', Validators.maxLength(80)],
    uf: [e?.uf ?? '', Validators.pattern(/^([A-Za-z]{2})?$/)],
  });
}

type GrupoEndereco = ReturnType<typeof criarGrupoEndereco>;

const vazio = (v: string) => (v.trim() === '' ? null : v.trim());

@Component({
  selector: 'app-cliente-form-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <a routerLink="/clientes" class="text-sm text-blue-700">← Clientes</a>
    <h1 class="mb-4 mt-2 text-xl font-semibold">{{ id() ? 'Editar cliente' : 'Novo cliente' }}</h1>

    @if (temPendencia()) {
      <p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        Este cliente tem uma pendência de sincronização.
        <a routerLink="/pendencias" class="font-semibold underline">Ver pendências</a>
      </p>
    }
    @if (naoEncontrado()) {
      <p class="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">Cliente não encontrado neste aparelho.</p>
    }

    <form [formGroup]="form" (ngSubmit)="salvar()" class="space-y-4">
      <section class="space-y-4 rounded-xl bg-white p-4">
        <div class="space-y-1">
          <label for="tipo" class="text-sm font-medium">Tipo</label>
          <select id="tipo" formControlName="tipo" class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3">
            <option value="PF">Pessoa física</option>
            <option value="PJ">Pessoa jurídica</option>
          </select>
        </div>

        <div class="space-y-1">
          <label for="documento" class="text-sm font-medium">{{ tipo() === 'PF' ? 'CPF' : 'CNPJ' }}</label>
          <div class="flex gap-2">
            <input id="documento" formControlName="documento" (input)="aoDigitarDocumento()" autocomplete="off"
                   [attr.inputmode]="tipo() === 'PF' ? 'numeric' : 'text'"
                   class="h-12 w-full rounded-lg border border-slate-300 px-3" />
            @if (tipo() === 'PJ' && online()) {
              <button type="button" data-testid="buscar-cnpj" (click)="preencherPeloCnpj()" [disabled]="consultando()"
                      class="h-12 shrink-0 rounded-lg border border-slate-300 px-3 text-sm disabled:opacity-60">
                Preencher
              </button>
            }
          </div>
          @if (erroDocumento()) {
            <p class="text-sm text-red-600">{{ erroDocumento() }}</p>
          }
        </div>

        <div class="space-y-1">
          <label for="nome" class="text-sm font-medium">{{ tipo() === 'PF' ? 'Nome' : 'Razão social' }}</label>
          <input id="nome" formControlName="nome" maxlength="160" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (form.controls.nome.touched && form.controls.nome.invalid) {
            <p class="text-sm text-red-600">Informe o nome.</p>
          }
        </div>

        @if (tipo() === 'PJ') {
          <div class="space-y-1">
            <label for="nomeFantasia" class="text-sm font-medium">Nome fantasia</label>
            <input id="nomeFantasia" formControlName="nomeFantasia" maxlength="160" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (form.controls.nomeFantasia.touched && form.controls.nomeFantasia.invalid) {
            <p class="text-sm text-red-600">Máximo de 160 caracteres.</p>
          }
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <label for="inscricaoEstadual" class="text-sm font-medium">Inscrição estadual</label>
              <input id="inscricaoEstadual" formControlName="inscricaoEstadual" maxlength="30" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (form.controls.inscricaoEstadual.touched && form.controls.inscricaoEstadual.invalid) {
            <p class="text-sm text-red-600">Máximo de 30 caracteres.</p>
          }
            </div>
            <div class="space-y-1">
              <label for="inscricaoMunicipal" class="text-sm font-medium">Inscrição municipal</label>
              <input id="inscricaoMunicipal" formControlName="inscricaoMunicipal" maxlength="30" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (form.controls.inscricaoMunicipal.touched && form.controls.inscricaoMunicipal.invalid) {
            <p class="text-sm text-red-600">Máximo de 30 caracteres.</p>
          }
            </div>
          </div>
        }
      </section>

      <section class="space-y-4 rounded-xl bg-white p-4">
        <h2 class="font-semibold">Contato</h2>
        <div class="space-y-1">
          <label for="email" class="text-sm font-medium">E-mail</label>
          <input id="email" type="email" formControlName="email" maxlength="160" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (form.controls.email.touched && form.controls.email.invalid) {
            <p class="text-sm text-red-600">E-mail inválido (máximo de 160 caracteres).</p>
          }
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label for="telefone" class="text-sm font-medium">Telefone</label>
            <input id="telefone" formControlName="telefone" inputmode="tel" maxlength="15" (input)="mascararTelefone('telefone')"
                   class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          </div>
          <div class="space-y-1">
            <label for="whatsapp" class="text-sm font-medium">WhatsApp</label>
            <input id="whatsapp" formControlName="whatsapp" inputmode="tel" maxlength="15" (input)="mascararTelefone('whatsapp')"
                   class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          </div>
        </div>
        <div class="space-y-1">
          <label for="contatoNome" class="text-sm font-medium">Pessoa de contato</label>
          <input id="contatoNome" formControlName="contatoNome" maxlength="120" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (form.controls.contatoNome.touched && form.controls.contatoNome.invalid) {
            <p class="text-sm text-red-600">Máximo de 120 caracteres.</p>
          }
        </div>
      </section>

      <section class="space-y-4 rounded-xl bg-white p-4" formArrayName="enderecos">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">Endereços</h2>
          <button type="button" data-testid="adicionar-endereco" (click)="adicionarEndereco()" [disabled]="enderecos.length >= maxEnderecos"
                  class="text-sm font-semibold text-blue-700 disabled:opacity-50">
            + Endereço
          </button>
        </div>
        @for (g of enderecos.controls; track g; let i = $index) {
          <div data-testid="endereco" [formGroupName]="i" class="space-y-3 rounded-lg border border-slate-200 p-3">
            <div class="flex gap-2">
              <select formControlName="tipo" aria-label="Tipo do endereço" class="h-12 flex-1 rounded-lg border border-slate-300 bg-white px-3">
                @for (t of tiposEndereco; track t) {
                  <option [value]="t">{{ rotuloTipo[t] }}</option>
                }
              </select>
              <button type="button" (click)="removerEndereco(i)" class="h-12 rounded-lg px-3 text-sm text-red-600">Remover</button>
            </div>
            <div class="flex gap-2">
              <input formControlName="cep" placeholder="CEP" aria-label="CEP" inputmode="numeric" maxlength="9" (input)="mascararCep(i)"
                     class="h-12 w-full rounded-lg border border-slate-300 px-3" />
              @if (online()) {
                <button type="button" data-testid="buscar-cep" (click)="buscarCep(i)" [disabled]="consultando()"
                        class="h-12 shrink-0 rounded-lg border border-slate-300 px-3 text-sm disabled:opacity-60">
                  Buscar CEP
                </button>
              }
            </div>
            <input formControlName="logradouro" maxlength="160" placeholder="Logradouro" aria-label="Logradouro" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
            <div class="grid grid-cols-3 gap-2">
              <input formControlName="numero" maxlength="20" placeholder="Número" aria-label="Número" class="h-12 rounded-lg border border-slate-300 px-3" />
              <input formControlName="complemento" maxlength="80" placeholder="Complemento" aria-label="Complemento" class="col-span-2 h-12 rounded-lg border border-slate-300 px-3" />
            </div>
            <input formControlName="bairro" maxlength="80" placeholder="Bairro" aria-label="Bairro" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
            <div class="grid grid-cols-4 gap-2">
              <input formControlName="cidade" maxlength="80" placeholder="Cidade" aria-label="Cidade" class="col-span-3 h-12 rounded-lg border border-slate-300 px-3" />
              <input formControlName="uf" placeholder="UF" aria-label="UF" maxlength="2" class="h-12 rounded-lg border border-slate-300 px-3 uppercase" />
            </div>
            @if (g.controls.uf.touched && g.controls.uf.invalid) {
              <p class="text-sm text-red-600">UF inválida.</p>
            }
          </div>
        } @empty {
          <p class="text-sm text-slate-500">Nenhum endereço.</p>
        }
        @if (enderecos.length >= maxEnderecos) {
          <p class="text-sm text-slate-500">Máximo de 10 endereços.</p>
        }
      </section>

      <section class="space-y-1 rounded-xl bg-white p-4">
        <label for="observacoes" class="text-sm font-medium">Observações</label>
        <textarea id="observacoes" formControlName="observacoes" maxlength="2000" rows="3" class="w-full rounded-lg border border-slate-300 px-3 py-2"></textarea>
      </section>

      @if (erroGeral()) {
        <p role="alert" class="text-sm text-red-600">{{ erroGeral() }}</p>
      }
      <button type="submit" [disabled]="salvando()" class="h-12 w-full rounded-lg bg-blue-600 font-semibold text-white disabled:opacity-60">
        Salvar
      </button>
      @if (id()) {
        <button type="button" data-testid="excluir" (click)="excluir()" [disabled]="excluindo()" class="h-12 w-full rounded-lg border border-red-300 font-semibold text-red-600 disabled:opacity-60">
          Excluir cliente
        </button>
      }
    </form>
  `,
})
export class ClienteFormPage {
  readonly id = input<string>();

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly repo = inject(ClientesRepo);
  private readonly consultas = inject(ConsultasExternas);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly online = inject(ConectividadeService).online;
  protected readonly tiposEndereco: TipoEndereco[] = ['PRINCIPAL', 'COBRANCA', 'INSTALACAO'];
  protected readonly rotuloTipo = ROTULO_TIPO_ENDERECO;
  protected readonly salvando = signal(false);
  protected readonly consultando = signal(false);
  protected readonly excluindo = signal(false);
  protected readonly erroGeral = signal<string | null>(null);
  protected readonly maxEnderecos = 10;
  protected readonly erroDocumento = signal<string | null>(null);
  protected readonly temPendencia = signal(false);
  protected readonly naoEncontrado = signal(false);
  /** Versão lida ao abrir o formulário (undefined = cliente novo). */
  private versaoCarregada: number | null | undefined;

  protected readonly form = this.fb.group({
    tipo: this.fb.control<TipoPessoa>('PF'),
    documento: ['', Validators.required],
    nome: ['', [Validators.required, Validators.maxLength(160)]],
    nomeFantasia: ['', Validators.maxLength(160)],
    inscricaoEstadual: ['', Validators.maxLength(30)],
    inscricaoMunicipal: ['', Validators.maxLength(30)],
    email: ['', [Validators.email, Validators.maxLength(160)]],
    telefone: ['', Validators.maxLength(15)],
    whatsapp: ['', Validators.maxLength(15)],
    contatoNome: ['', Validators.maxLength(120)],
    observacoes: ['', Validators.maxLength(2000)],
    enderecos: this.fb.array<GrupoEndereco>([]),
  });

  protected readonly tipo = toSignal(this.form.controls.tipo.valueChanges, { initialValue: 'PF' as TipoPessoa });

  constructor() {
    this.form.controls.tipo.valueChanges.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => this.aoDigitarDocumento());
    effect(() => {
      const id = this.id();
      if (id) void this.carregar(id);
    });
  }

  protected get enderecos(): FormArray<GrupoEndereco> {
    return this.form.controls.enderecos;
  }

  protected aoDigitarDocumento(): void {
    const c = this.form.controls.documento;
    c.setValue(mascararDocumento(this.form.controls.tipo.value, c.value), { emitEvent: false });
    this.erroDocumento.set(null);
  }

  protected mascararTelefone(campo: 'telefone' | 'whatsapp'): void {
    const c = this.form.controls[campo];
    c.setValue(formatarTelefone(c.value), { emitEvent: false });
  }

  protected mascararCep(i: number): void {
    const c = this.enderecos.at(i).controls.cep;
    c.setValue(formatarCep(c.value), { emitEvent: false });
  }

  protected adicionarEndereco(e?: Partial<EnderecoDados>): void {
    if (this.enderecos.length >= this.maxEnderecos) return;
    this.enderecos.push(criarGrupoEndereco(this.fb, e));
  }

  protected removerEndereco(i: number): void {
    this.enderecos.removeAt(i);
  }

  protected async buscarCep(i: number): Promise<void> {
    const grupo = this.enderecos.at(i);
    this.consultando.set(true);
    try {
      const r = await this.consultas.buscarCep(grupo.controls.cep.value);
      if (!r) {
        this.toasts.erro('CEP não encontrado.');
        return;
      }
      const patch: Record<string, string> = {};
      if (r.logradouro) patch['logradouro'] = r.logradouro;
      if (r.bairro) patch['bairro'] = r.bairro;
      if (r.cidade) patch['cidade'] = r.cidade;
      if (r.uf) patch['uf'] = r.uf;
      grupo.patchValue(patch);
    } finally {
      this.consultando.set(false);
    }
  }

  protected async preencherPeloCnpj(): Promise<void> {
    this.consultando.set(true);
    try {
      const r = await this.consultas.buscarCnpj(this.form.controls.documento.value);
      if (!r) {
        this.toasts.erro('Não foi possível consultar este CNPJ.');
        return;
      }
      const patch: Record<string, string> = {};
      if (r.nome) patch['nome'] = r.nome;
      if (r.nomeFantasia) patch['nomeFantasia'] = r.nomeFantasia;
      if (r.email) patch['email'] = r.email;
      if (r.telefone) patch['telefone'] = formatarTelefone(r.telefone);
      this.form.patchValue(patch);
      if (this.enderecos.length === 0) this.adicionarEndereco({ tipo: 'PRINCIPAL', ...r.endereco });
    } finally {
      this.consultando.set(false);
    }
  }

  protected async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.erroGeral.set('Corrija os campos destacados.');
      return;
    }
    this.erroGeral.set(null);
    const v = this.form.getRawValue();
    const documento = normalizarDocumento(v.documento);
    if (!documentoValido(v.tipo, documento)) {
      this.erroDocumento.set(v.tipo === 'PF' ? 'CPF inválido.' : 'CNPJ inválido.');
      return;
    }
    const pj = v.tipo === 'PJ';
    const dados: ClienteDados = {
      tipo: v.tipo,
      documento,
      nome: v.nome.trim(),
      nomeFantasia: pj ? vazio(v.nomeFantasia) : null,
      inscricaoEstadual: pj ? vazio(v.inscricaoEstadual) : null,
      inscricaoMunicipal: pj ? vazio(v.inscricaoMunicipal) : null,
      email: vazio(v.email),
      telefone: vazio(somenteDigitos(v.telefone)),
      whatsapp: vazio(somenteDigitos(v.whatsapp)),
      contatoNome: vazio(v.contatoNome),
      observacoes: vazio(v.observacoes),
      enderecos: v.enderecos.map((e) => ({
        tipo: e.tipo,
        cep: vazio(somenteDigitos(e.cep)),
        logradouro: vazio(e.logradouro),
        numero: vazio(e.numero),
        complemento: vazio(e.complemento),
        bairro: vazio(e.bairro),
        cidade: vazio(e.cidade),
        uf: vazio(e.uf)?.toUpperCase() ?? null,
      })),
    };
    this.salvando.set(true);
    try {
      await this.repo.salvar(dados, this.id(), this.versaoCarregada);
      this.toasts.mostrar('Cliente salvo.');
      await this.router.navigateByUrl('/clientes');
    } catch (e) {
      if (e instanceof ErroCampo) {
        this.erroDocumento.set(e.message);
      } else {
        this.toasts.erro('Não foi possível salvar o cliente.');
      }
    } finally {
      this.salvando.set(false);
    }
  }

  protected async excluir(): Promise<void> {
    const id = this.id();
    if (!id || this.excluindo() || !window.confirm('Excluir este cliente?')) return;
    this.excluindo.set(true);
    try {
      await this.repo.excluir(id, this.versaoCarregada);
      this.toasts.mostrar('Cliente excluído.');
      await this.router.navigateByUrl('/clientes');
    } catch {
      this.toasts.erro('Não foi possível excluir o cliente.');
    } finally {
      this.excluindo.set(false);
    }
  }

  private async carregar(id: string): Promise<void> {
    const c = await this.repo.buscar(id);
    this.temPendencia.set(await this.repo.temPendencia(id));
    if (!c) {
      this.naoEncontrado.set(true);
      return;
    }
    this.versaoCarregada = c.version;
    this.form.patchValue({
      tipo: c.tipo,
      documento: formatarDocumento(c.documento),
      nome: c.nome,
      nomeFantasia: c.nomeFantasia ?? '',
      inscricaoEstadual: c.inscricaoEstadual ?? '',
      inscricaoMunicipal: c.inscricaoMunicipal ?? '',
      email: c.email ?? '',
      telefone: formatarTelefone(c.telefone),
      whatsapp: formatarTelefone(c.whatsapp),
      contatoNome: c.contatoNome ?? '',
      observacoes: c.observacoes ?? '',
    });
    this.enderecos.clear();
    c.enderecos.forEach((e) => this.adicionarEndereco(e));
  }
}
