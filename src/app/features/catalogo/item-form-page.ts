import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ArquivosService } from '../../core/arquivos/arquivos-service';
import { ImagemService } from '../../core/arquivos/imagem-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { mensagemDeErro } from '../../core/http/erro-api';
import { ErroCampo } from '../../core/util/erro-campo';
import { formatarMoedaInput, parseMoeda } from '../../core/util/moeda';
import { Toasts } from '../../shared/ui/toasts';
import { CatalogoRepo } from './catalogo-repo';
import { ItemCatalogoDados, NaturezaItem, UNIDADES } from './item-models';

const MAX_PRECO = 999_999_999_999.99;
type CampoPreco = 'precoCusto' | 'precoVenda' | 'precoLocacaoMensal';

@Component({
  selector: 'app-item-form-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <a routerLink="/catalogo" class="text-sm text-blue-700">← Catálogo</a>
    <h1 class="mb-4 mt-2 text-xl font-semibold">{{ id() ? 'Editar item' : 'Novo item' }}</h1>

    @if (temPendencia()) {
      <p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        Este item tem uma pendência de sincronização. <a routerLink="/pendencias" class="font-semibold underline">Ver pendências</a>
      </p>
    }

    <form [formGroup]="form" (ngSubmit)="salvar()" class="space-y-4">
      <section class="space-y-4 rounded-xl bg-white p-4">
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label for="natureza" class="text-sm font-medium">Tipo</label>
            <select id="natureza" formControlName="natureza" class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3">
              <option value="PRODUTO">Produto</option>
              <option value="SERVICO">Serviço</option>
            </select>
          </div>
          <div class="space-y-1">
            <label for="unidade" class="text-sm font-medium">Unidade</label>
            <select id="unidade" formControlName="unidade" class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3">
              @for (u of unidades; track u) { <option [value]="u">{{ u }}</option> }
            </select>
          </div>
        </div>

        <div class="space-y-1">
          <label for="codigo" class="text-sm font-medium">Código</label>
          <input id="codigo" formControlName="codigo" maxlength="40" (input)="maiusculas()" autocomplete="off"
                 class="h-12 w-full rounded-lg border border-slate-300 px-3 uppercase" />
          @if (erroCodigo()) { <p class="text-sm text-red-600">{{ erroCodigo() }}</p> }
        </div>

        <div class="space-y-1">
          <label for="nome" class="text-sm font-medium">Nome</label>
          <input id="nome" formControlName="nome" maxlength="160" class="h-12 w-full rounded-lg border border-slate-300 px-3" />
          @if (form.controls.nome.touched && form.controls.nome.invalid) { <p class="text-sm text-red-600">Informe o nome.</p> }
        </div>

        <div class="space-y-1">
          <label for="descricao" class="text-sm font-medium">Descrição</label>
          <textarea id="descricao" formControlName="descricao" maxlength="2000" rows="3"
                    class="w-full rounded-lg border border-slate-300 px-3 py-2"></textarea>
        </div>
      </section>

      <section class="space-y-4 rounded-xl bg-white p-4">
        <h2 class="font-semibold">Preços</h2>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label for="precoCusto" class="text-sm font-medium">Custo (R$)</label>
            <input id="precoCusto" formControlName="precoCusto" inputmode="decimal" placeholder="0,00"
                   class="h-12 w-full rounded-lg border border-slate-300 px-3" />
            @if (erros().precoCusto) { <p class="text-sm text-red-600">{{ erros().precoCusto }}</p> }
          </div>
          <div class="space-y-1">
            <label for="precoVenda" class="text-sm font-medium">Venda (R$)</label>
            <input id="precoVenda" formControlName="precoVenda" inputmode="decimal" placeholder="0,00"
                   class="h-12 w-full rounded-lg border border-slate-300 px-3" />
            @if (erros().precoVenda) { <p class="text-sm text-red-600">{{ erros().precoVenda }}</p> }
          </div>
        </div>
        @if (margem() !== null) {
          <p class="text-sm text-slate-600">Margem: {{ margem() }}%</p>
        }

        <label class="flex items-center gap-2">
          <input id="locavel" type="checkbox" formControlName="locavel" class="size-5" /> Disponível para locação
        </label>
        @if (locavel()) {
          <div class="space-y-1">
            <label for="precoLocacaoMensal" class="text-sm font-medium">Locação mensal (R$)</label>
            <input id="precoLocacaoMensal" formControlName="precoLocacaoMensal" inputmode="decimal" placeholder="0,00"
                   class="h-12 w-full rounded-lg border border-slate-300 px-3" />
            @if (erros().precoLocacaoMensal) { <p class="text-sm text-red-600">{{ erros().precoLocacaoMensal }}</p> }
          </div>
        }
        <label class="flex items-center gap-2">
          <input id="ativo" type="checkbox" formControlName="ativo" class="size-5" /> Ativo (aparece para os comerciais)
        </label>
      </section>

      <section class="space-y-3 rounded-xl bg-white p-4">
        <h2 class="font-semibold">Foto</h2>
        @if (fotoUrl()) {
          <img [src]="fotoUrl()" alt="Foto do item" class="h-40 w-full rounded-lg object-cover" />
          <button type="button" (click)="removerFoto()" class="text-sm text-red-600">Remover foto</button>
        }
        <input id="foto" type="file" accept="image/*" [disabled]="!online() || enviandoFoto()" (change)="escolherFoto($event)"
               aria-label="Escolher foto" class="block w-full text-sm" />
        @if (!online()) { <p class="text-sm text-amber-700">A foto precisa de internet.</p> }
        @if (enviandoFoto()) { <p class="text-sm text-slate-500">Enviando foto…</p> }
      </section>

      @if (erroGeral()) { <p class="text-sm text-red-600" role="alert">{{ erroGeral() }}</p> }

      <button type="submit" [disabled]="salvando() || enviandoFoto()"
              class="h-12 w-full rounded-lg bg-blue-600 font-semibold text-white disabled:opacity-60">Salvar</button>
      @if (id()) {
        <button type="button" data-testid="excluir" (click)="excluir()" [disabled]="excluindo()"
                class="h-12 w-full rounded-lg border border-red-300 font-semibold text-red-600 disabled:opacity-60">Excluir item</button>
      }
    </form>
  `,
})
export class ItemFormPage {
  readonly id = input<string>();

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly repo = inject(CatalogoRepo);
  private readonly arquivos = inject(ArquivosService);
  private readonly imagem = inject(ImagemService);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly online = inject(ConectividadeService).online;
  protected readonly unidades = UNIDADES;
  protected readonly salvando = signal(false);
  protected readonly excluindo = signal(false);
  protected readonly enviandoFoto = signal(false);
  protected readonly temPendencia = signal(false);
  protected readonly erroCodigo = signal<string | null>(null);
  protected readonly erroGeral = signal<string | null>(null);
  protected readonly erros = signal<Partial<Record<CampoPreco, string>>>({});
  protected readonly fotoArquivoId = signal<string | null>(null);
  protected readonly fotoUrl = signal<string | null>(null);
  private versaoCarregada: number | null | undefined;

  protected readonly form = this.fb.group({
    natureza: this.fb.control<NaturezaItem>('PRODUTO'),
    codigo: ['', [Validators.required, Validators.maxLength(40)]],
    nome: ['', [Validators.required, Validators.maxLength(160)]],
    descricao: ['', Validators.maxLength(2000)],
    unidade: ['un'],
    precoCusto: [''],
    precoVenda: [''],
    locavel: [false],
    precoLocacaoMensal: [''],
    ativo: [true],
  });

  protected readonly locavel = toSignal(this.form.controls.locavel.valueChanges, { initialValue: false });
  private readonly valores = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly margem = computed(() => {
    const v = this.valores();
    const custo = parseMoeda(v.precoCusto ?? '');
    const venda = parseMoeda(v.precoVenda ?? '');
    if (custo === null || venda === null || Number.isNaN(custo) || Number.isNaN(venda) || custo <= 0 || venda <= 0) return null;
    return (((venda - custo) / venda) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  });

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) void this.carregar(id);
    });
  }

  protected maiusculas(): void {
    const c = this.form.controls.codigo;
    c.setValue(c.value.toUpperCase(), { emitEvent: false });
    this.erroCodigo.set(null);
  }

  protected async escolherFoto(evento: Event): Promise<void> {
    const arquivo = (evento.target as HTMLInputElement).files?.[0];
    if (!arquivo) return;
    this.enviandoFoto.set(true);
    try {
      const reduzida = await this.imagem.redimensionar(arquivo, 800, 'image/jpeg');
      const enviado = await this.arquivos.enviar(reduzida, arquivo.name.replace(/\.[^.]+$/, '') + '.jpg');
      this.fotoArquivoId.set(enviado.id);
      this.fotoUrl.set(await this.arquivos.obterUrl(enviado.id));
    } catch (e) {
      this.toasts.erro(e instanceof Error && !('status' in e) ? e.message : mensagemDeErro(e));
    } finally {
      this.enviandoFoto.set(false);
    }
  }

  protected removerFoto(): void {
    this.fotoArquivoId.set(null);
    this.fotoUrl.set(null);
  }

  protected async salvar(): Promise<void> {
    this.erroGeral.set(null);
    const v = this.form.getRawValue();
    const erros: Partial<Record<CampoPreco, string>> = {};
    const lerPreco = (campo: CampoPreco, obrigatorio: boolean, mensagemVazio: string): number | null => {
      const n = parseMoeda(v[campo]);
      if (n === null) {
        if (obrigatorio) erros[campo] = mensagemVazio;
        return null;
      }
      if (Number.isNaN(n) || n > MAX_PRECO) {
        erros[campo] = 'Valor inválido.';
        return null;
      }
      return n;
    };
    const precoCusto = lerPreco('precoCusto', false, '');
    const precoVenda = lerPreco('precoVenda', true, 'Informe o preço de venda.');
    const precoLocacaoMensal = v.locavel ? lerPreco('precoLocacaoMensal', true, 'Informe o preço de locação mensal.') : null;
    this.erros.set(erros);
    if (this.form.invalid || Object.keys(erros).length > 0) {
      this.form.markAllAsTouched();
      this.erroGeral.set('Corrija os campos destacados.');
      return;
    }
    const dados: ItemCatalogoDados = {
      natureza: v.natureza,
      codigo: v.codigo.trim().toUpperCase(),
      nome: v.nome.trim(),
      descricao: v.descricao.trim() || null,
      unidade: v.unidade,
      precoCusto,
      precoVenda,
      locavel: v.locavel,
      precoLocacaoMensal,
      fotoArquivoId: this.fotoArquivoId(),
      ativo: v.ativo,
    };
    this.salvando.set(true);
    try {
      await this.repo.salvar(dados, this.id(), this.versaoCarregada);
      this.toasts.mostrar('Item salvo.');
      await this.router.navigateByUrl('/catalogo');
    } catch (e) {
      if (e instanceof ErroCampo) this.erroCodigo.set(e.message);
      else this.toasts.erro('Não foi possível salvar o item.');
    } finally {
      this.salvando.set(false);
    }
  }

  protected async excluir(): Promise<void> {
    const id = this.id();
    if (!id || this.excluindo() || !window.confirm('Excluir este item do catálogo?')) return;
    this.excluindo.set(true);
    try {
      await this.repo.excluir(id, this.versaoCarregada);
      this.toasts.mostrar('Item excluído.');
      await this.router.navigateByUrl('/catalogo');
    } catch {
      this.toasts.erro('Não foi possível excluir o item.');
    } finally {
      this.excluindo.set(false);
    }
  }

  private async carregar(id: string): Promise<void> {
    const i = await this.repo.buscar(id);
    this.temPendencia.set(await this.repo.temPendencia(id));
    if (!i) return;
    this.versaoCarregada = i.version;
    this.form.patchValue({
      natureza: i.natureza,
      codigo: i.codigo,
      nome: i.nome,
      descricao: i.descricao ?? '',
      unidade: i.unidade,
      precoCusto: formatarMoedaInput(i.precoCusto),
      precoVenda: formatarMoedaInput(i.precoVenda),
      locavel: i.locavel,
      precoLocacaoMensal: formatarMoedaInput(i.precoLocacaoMensal),
      ativo: i.ativo,
    });
    this.fotoArquivoId.set(i.fotoArquivoId);
    if (i.fotoArquivoId) this.fotoUrl.set(await this.arquivos.obterUrl(i.fotoArquivoId));
  }
}
