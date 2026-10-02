import { afterNextRender, Component, computed, effect, ElementRef, inject, Injector, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth-service';
import { avisarAoSairDaPagina, ComAlteracoes, instantaneo } from '../../core/navegacao/alteracoes-guard';
import { formatarTelefone } from '../../core/util/formatos';
import { Toasts } from '../../shared/ui/toasts';
import { ClienteLocal, EnderecoDados, filtrarClientes, ROTULO_TIPO_ENDERECO } from '../clientes/cliente-models';
import { ClientesRepo } from '../clientes/clientes-repo';
import { lerCampoDecimal, textoDecimal } from '../propostas/edicao-wizard';
import { stripJava } from '../propostas/proposta-models';
import { PropostasRepo } from '../propostas/propostas-repo';
import { ErroOs } from './erro-os';
import { mensagemErroOs } from './formatos-os';
import {
  CampoEdicaoOs, camposEditaveisOs, codigoOsExibido, ItemOsLocal, OsLocal, rotuloTipoOs, tamanhoTextoOs, TIPOS_OS, TipoOs,
} from './os-models';
import { EdicaoCabecalhoOs, enderecoDaOs, EnderecoOs, LinhaOs, linhaDoEndereco, OsRepo } from './os-repo';

const MAX_DESCRICAO = 4000;
const QUANTIDADE_MIN = 1n;
const QUANTIDADE_MAX = 999_999_999n;
const ERRO_QUANTIDADE = 'A quantidade vai de 0,001 a 999.999,999.';
/** Quantos clientes a busca mostra de uma vez (ela refina). */
const MAX_CLIENTES = 20;

/** Os campos do endereço na tela, na ordem do formulário, com o nome do erro do repositório (`endereco*`). */
const CAMPOS_ENDERECO = [
  { chave: 'cep', rotulo: 'CEP', erro: 'enderecoCep', modo: 'numeric' },
  { chave: 'logradouro', rotulo: 'Logradouro', erro: 'enderecoLogradouro', modo: 'text' },
  { chave: 'numero', rotulo: 'Número', erro: 'enderecoNumero', modo: 'text' },
  { chave: 'complemento', rotulo: 'Complemento', erro: 'enderecoComplemento', modo: 'text' },
  { chave: 'bairro', rotulo: 'Bairro', erro: 'enderecoBairro', modo: 'text' },
  { chave: 'cidade', rotulo: 'Cidade', erro: 'enderecoCidade', modo: 'text' },
  { chave: 'uf', rotulo: 'UF', erro: 'enderecoUf', modo: 'text' },
] as const;
type ChaveEndereco = (typeof CAMPOS_ENDERECO)[number]['chave'];
type EnderecoTela = Record<ChaveEndereco, string>;

/** Os campos que esta tela edita (o técnico muda em "Atribuir técnico", na tela da OS). */
type CampoTela = Extract<CampoEdicaoOs, 'tipo' | 'descricao' | 'dataPrevista' | 'urgente' | 'endereco' | 'itens' | 'concluiProposta'>;
const CAMPOS_TELA: readonly CampoTela[] = ['tipo', 'descricao', 'dataPrevista', 'urgente', 'endereco', 'itens', 'concluiProposta'];

interface LinhaTela {
  id: string;
  item: ItemOsLocal;
  quantidade: string;
}

/** O id do campo na tela para cada nome de erro do repositório (o foco vai ao primeiro com erro). */
const ALVO_DO_ERRO: Readonly<Record<string, string>> = {
  clienteId: 'busca-cliente-os',
  tipo: 'tipo-os',
  descricao: 'descricao-os',
  tecnicoId: 'tecnico-os',
  dataPrevista: 'data-os',
  enderecoId: 'endereco-os-0',
  ...Object.fromEntries(CAMPOS_ENDERECO.map((c) => [c.erro, `endereco-${c.chave}`])),
};

function vazio(t: string): string | null {
  const v = stripJava(t);
  return v === '' ? null : v;
}

function enderecoParaTela(e: EnderecoOs | EnderecoDados): EnderecoTela {
  return {
    cep: e.cep ?? '', logradouro: e.logradouro ?? '', numero: e.numero ?? '', complemento: e.complemento ?? '',
    bairro: e.bairro ?? '', cidade: e.cidade ?? '', uf: e.uf ?? '',
  };
}

function enderecoDaTela(e: EnderecoTela): EnderecoOs {
  const uf = vazio(e.uf);
  return {
    cep: vazio(e.cep), logradouro: vazio(e.logradouro), numero: vazio(e.numero), complemento: vazio(e.complemento),
    bairro: vazio(e.bairro), cidade: vazio(e.cidade), uf: uf === null ? null : uf.toUpperCase(),
  };
}

/** A posição do endereço que a OS avulsa usa por padrão: o principal, senão o primeiro (o mesmo do `criarAvulsa`). */
function enderecoPadrao(c: ClienteLocal): number | null {
  if (c.enderecos.length === 0) return null;
  const principal = c.enderecos.findIndex((e) => e.tipo === 'PRINCIPAL');
  return principal >= 0 ? principal : 0;
}

/**
 * Formulário da OS no escritório (spec M2 §9, Q6), ADMIN e COMERCIAL (rota):
 * - `/os/nova`: a OS avulsa (`criarAvulsa`): cliente (busca local, sem o CPF/CNPJ na tela), o endereço pela posição em
 *   `cliente.enderecos` (o principal vem marcado), tipo, descrição (obrigatória: a avulsa não tem itens), técnico
 *   ativo, data prevista e urgência. `?clienteId=` já abre com o cliente.
 * - `/os/:id/editar`: o cabeçalho (`salvarCabecalho`, com a versão carregada), com os campos que `camposEditaveisOs`
 *   deixa no status: em ABERTA, tipo, descrição, data, urgência, endereço, itens (quantidade e tirar a linha) e "Esta
 *   OS conclui a proposta?"; em andamento, data e urgência (e o "conclui" pelo ADMIN, Q21). Os outros ficam
 *   desabilitados. Só o que mudou vai ao repositório. O técnico muda em "Atribuir técnico", na tela da OS (a trava do
 *   CONFLITO vale lá). O COMERCIAL não abre a OS de outro.
 * Sair com alterações pede confirmação (`alteracoesGuard`). Os erros de campo ficam no campo (e o foco vai ao
 * primeiro); os outros, num toast pelo `mensagemErroOs`.
 */
@Component({
  selector: 'app-os-form-page',
  imports: [RouterLink],
  template: `
    <a [routerLink]="voltarPara()" class="inline-flex min-h-12 items-center text-sm text-blue-700">← {{ editando() ? 'Voltar para a OS' : 'Ordens de serviço' }}</a>
    <p role="status" aria-live="polite" class="sr-only">{{ anuncio() }}</p>

    @if (carregando()) {
      <p data-testid="carregando" class="py-8 text-center text-slate-500">Carregando…</p>
    } @else if (editando() && !os()) {
      <div class="py-8 text-center text-slate-600">
        <p>OS não encontrada neste aparelho.</p>
        <a routerLink="/os" class="mt-2 inline-flex min-h-12 items-center font-semibold text-blue-700 underline">Ver as OS</a>
      </div>
    } @else if (editando() && editaveis().size === 0) {
      <div class="py-8 text-center text-slate-600">
        <p>Esta OS não pode ser editada.</p>
        <a [routerLink]="voltarPara()" class="mt-2 inline-flex min-h-12 items-center font-semibold text-blue-700 underline">Voltar para a OS</a>
      </div>
    } @else {
      <h1 #titulo tabindex="-1" class="mb-4 text-xl font-semibold outline-none">{{ editando() ? 'Editar ' + codigo() : 'Nova OS avulsa' }}</h1>
      @if (dica(); as d) { <p data-testid="dica" class="mb-3 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">{{ d }}</p> }

      <form novalidate (submit)="$event.preventDefault(); salvar()" class="space-y-4">
        <section aria-labelledby="cliente-titulo" class="space-y-3 rounded-xl bg-white p-4">
          <h2 id="cliente-titulo" class="font-semibold">Cliente e local</h2>

          @if (editando()) {
            <p class="text-sm"><span class="text-slate-500">Cliente: </span><span class="font-medium">{{ clienteNome() }}</span></p>
          } @else {
            <div class="space-y-2">
              @if (cliente(); as c) {
                <div data-testid="cliente-escolhido" class="flex items-center gap-3 rounded-lg border border-blue-600 bg-blue-50 px-3 py-2">
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-medium">{{ c.nome }}</p>
                    @if (resumoCliente(c); as r) { <p class="truncate text-sm text-slate-600">{{ r }}</p> }
                  </div>
                  <button type="button" (click)="trocarCliente()" class="h-12 shrink-0 rounded-lg px-3 text-sm font-semibold text-blue-700">Trocar</button>
                </div>
              } @else {
                <label for="busca-cliente-os" class="block text-sm font-medium">Cliente</label>
                <input id="busca-cliente-os" type="search" [value]="busca()" (input)="busca.set($any($event.target).value)"
                       placeholder="Nome, CPF/CNPJ ou telefone" autocomplete="off" aria-required="true"
                       [attr.aria-invalid]="erros()['clienteId'] ? 'true' : 'false'"
                       [attr.aria-describedby]="erros()['clienteId'] ? 'erro-cliente-os' : null"
                       class="h-12 w-full rounded-lg border px-3" [class.border-slate-300]="!erros()['clienteId']"
                       [class.border-red-600]="erros()['clienteId']" />
                <ul class="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200" aria-label="Clientes encontrados">
                  @for (c of resultados(); track c.id) {
                    <li>
                      <button type="button" data-testid="escolher-cliente" (click)="escolherCliente(c)"
                              class="flex min-h-12 w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50">
                        <span class="font-medium">{{ c.nome }}</span>
                        @if (resumoCliente(c); as r) { <span class="text-sm text-slate-500">{{ r }}</span> }
                      </button>
                    </li>
                  } @empty {
                    <li class="px-3 py-3 text-sm text-slate-500">
                      {{ busca().trim() ? 'Nenhum cliente encontrado.' : 'Nenhum cliente neste aparelho ainda.' }}
                    </li>
                  }
                </ul>
              }
              @if (erros()['clienteId']; as e) { <p id="erro-cliente-os" role="alert" class="text-sm text-red-600">{{ e }}</p> }
            </div>

            @if (cliente(); as c) {
              <fieldset class="space-y-2" [attr.aria-describedby]="erros()['enderecoId'] ? 'erro-endereco-os' : null">
                <legend class="text-sm font-medium">Endereço do serviço</legend>
                @for (e of c.enderecos; track $index) {
                  <label [for]="'endereco-os-' + $index" class="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2"
                         [class.border-blue-600]="enderecoIdx() === $index" [class.border-slate-200]="enderecoIdx() !== $index">
                    <input [id]="'endereco-os-' + $index" type="radio" name="endereco-os" [value]="$index" [checked]="enderecoIdx() === $index"
                           (change)="escolherEndereco(c, $index)" class="mt-1 size-5 shrink-0" />
                    <span class="min-w-0 text-sm">
                      <span class="block font-medium">{{ rotuloEndereco(e) }}</span>
                      <span class="block text-slate-600">{{ linhaEndereco(e) || 'Endereço incompleto' }}</span>
                    </span>
                  </label>
                } @empty {
                  <p class="text-sm text-slate-600">Este cliente não tem endereço cadastrado. A OS fica sem endereço.</p>
                }
                @if (erros()['enderecoId']; as e) { <p id="erro-endereco-os" role="alert" class="text-sm text-red-600">{{ e }}</p> }
              </fieldset>
            }
          }

          @if (editando()) {
            <fieldset class="space-y-3">
              <legend class="text-sm font-medium">Endereço do serviço</legend>
              @if (pode('endereco') && enderecosDoCliente().length > 0) {
                <div class="space-y-1">
                  <label for="endereco-do-cliente" class="text-sm text-slate-600">Usar um endereço do cliente</label>
                  <select id="endereco-do-cliente" (change)="usarEnderecoDoCliente($any($event.target))"
                          class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3">
                    <option value="">Escolha…</option>
                    @for (e of enderecosDoCliente(); track $index) {
                      <option [value]="$index">{{ rotuloEndereco(e) }}: {{ linhaEndereco(e) }}</option>
                    }
                  </select>
                </div>
              }
              <div class="grid gap-3 sm:grid-cols-2">
                @for (c of camposEndereco; track c.chave) {
                  <div class="space-y-1">
                    <label [for]="'endereco-' + c.chave" class="text-sm font-medium">{{ c.rotulo }}</label>
                    <input [id]="'endereco-' + c.chave" type="text" [attr.inputmode]="c.modo" [disabled]="!pode('endereco')" [value]="endereco()[c.chave]"
                           (input)="digitarEndereco(c.chave, $any($event.target).value)"
                           [attr.aria-invalid]="erros()[c.erro] ? 'true' : 'false'"
                           [attr.aria-describedby]="erros()[c.erro] ? 'erro-endereco-' + c.chave : null"
                           class="h-12 w-full rounded-lg border px-3 disabled:bg-slate-100" [class.border-slate-300]="!erros()[c.erro]"
                           [class.border-red-600]="erros()[c.erro]" />
                    @if (erros()[c.erro]; as e) { <p [id]="'erro-endereco-' + c.chave" role="alert" class="text-sm text-red-600">{{ e }}</p> }
                  </div>
                }
              </div>
            </fieldset>
          }
        </section>

        <section aria-labelledby="servico-titulo" class="space-y-3 rounded-xl bg-white p-4">
          <h2 id="servico-titulo" class="font-semibold">Serviço</h2>
          <div class="space-y-1">
            <label for="tipo-os" class="text-sm font-medium">Tipo</label>
            <select id="tipo-os" [disabled]="!pode('tipo')" (change)="tipo.set($any($event.target).value)" aria-required="true"
                    [attr.aria-invalid]="erros()['tipo'] ? 'true' : 'false'" [attr.aria-describedby]="erros()['tipo'] ? 'erro-tipo-os' : null"
                    class="h-12 w-full rounded-lg border bg-white px-3 disabled:bg-slate-100" [class.border-slate-300]="!erros()['tipo']"
                    [class.border-red-600]="erros()['tipo']">
              @if (!editando()) { <option value="" [selected]="tipo() === ''">Escolha o tipo…</option> }
              @for (t of tipos; track t.valor) {
                <option [value]="t.valor" [selected]="t.valor === tipo()">{{ t.rotulo }}</option>
              }
            </select>
            @if (erros()['tipo']; as e) { <p id="erro-tipo-os" role="alert" class="text-sm text-red-600">{{ e }}</p> }
          </div>

          <div class="space-y-1">
            <label for="descricao-os" class="text-sm font-medium">Descrição</label>
            <textarea id="descricao-os" rows="4" [disabled]="!pode('descricao')" [value]="descricao()" (input)="descricao.set($any($event.target).value)"
                      [attr.aria-required]="editando() ? null : 'true'" [attr.aria-invalid]="erros()['descricao'] ? 'true' : 'false'"
                      [attr.aria-describedby]="'ajuda-descricao-os' + (erros()['descricao'] ? ' erro-descricao-os' : '')"
                      class="w-full rounded-lg border px-3 py-2 disabled:bg-slate-100" [class.border-slate-300]="!erros()['descricao']"
                      [class.border-red-600]="erros()['descricao']"></textarea>
            <p id="ajuda-descricao-os" class="text-xs text-slate-500">
              O técnico lê a descrição: não escreva valores. <span [class.text-red-600]="tamanhoDescricao() > maxDescricao">{{ tamanhoDescricao() }}/{{ maxDescricao }}</span>
            </p>
            @if (erros()['descricao']; as e) { <p id="erro-descricao-os" role="alert" class="text-sm text-red-600">{{ e }}</p> }
          </div>

          @if (editando()) {
            <p class="text-sm"><span class="text-slate-500">Técnico: </span>{{ tecnicoAtual() }}</p>
          } @else {
            <div class="space-y-1">
              <label for="tecnico-os" class="text-sm font-medium">Técnico</label>
              <select id="tecnico-os" (change)="tecnicoId.set($any($event.target).value)"
                      [attr.aria-invalid]="erros()['tecnicoId'] ? 'true' : 'false'" [attr.aria-describedby]="erros()['tecnicoId'] ? 'erro-tecnico-os' : null"
                      class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3">
                <option value="" [selected]="tecnicoId() === ''">Nenhum (atribuir depois)</option>
                @for (t of tecnicos(); track t.id) {
                  <option [value]="t.id" [selected]="t.id === tecnicoId()">{{ t.nome }}</option>
                }
              </select>
              @if (erros()['tecnicoId']; as e) { <p id="erro-tecnico-os" role="alert" class="text-sm text-red-600">{{ e }}</p> }
            </div>
          }

          <div class="space-y-1">
            <label for="data-os" class="text-sm font-medium">Data prevista (opcional)</label>
            <input id="data-os" type="date" [disabled]="!pode('dataPrevista')" [value]="dataPrevista()" (input)="dataPrevista.set($any($event.target).value)"
                   [attr.aria-invalid]="erros()['dataPrevista'] ? 'true' : 'false'" [attr.aria-describedby]="erros()['dataPrevista'] ? 'erro-data-os' : null"
                   class="h-12 w-full rounded-lg border bg-white px-3 disabled:bg-slate-100 sm:w-72" [class.border-slate-300]="!erros()['dataPrevista']"
                   [class.border-red-600]="erros()['dataPrevista']" />
            @if (erros()['dataPrevista']; as e) { <p id="erro-data-os" role="alert" class="text-sm text-red-600">{{ e }}</p> }
          </div>

          <!-- um alvo só (a caixa e o texto), de pelo menos 48 px -->
          <label for="urgente-os" class="flex min-h-12 cursor-pointer items-center gap-3">
            <input id="urgente-os" type="checkbox" [disabled]="!pode('urgente')" [checked]="urgente()" (change)="urgente.set($any($event.target).checked)"
                   class="size-5 shrink-0" />
            <span class="text-sm font-medium">Urgente (prazo de 7 dias em vez de 20)</span>
          </label>

          @if (editando() && os()?.propostaId) {
            <label for="conclui-os" class="flex min-h-12 cursor-pointer items-start gap-3 py-1">
              <input id="conclui-os" type="checkbox" [disabled]="!pode('concluiProposta')" [checked]="concluiProposta()"
                     (change)="concluiProposta.set($any($event.target).checked)" class="mt-0.5 size-5 shrink-0" />
              <span>
                <span class="block text-sm font-medium">Esta OS conclui a proposta?</span>
                <span class="block text-xs text-slate-500">Desmarque se vai ser preciso outra visita: a proposta continua em execução.</span>
              </span>
            </label>
          }
        </section>

        @if (editando()) {
          <section aria-labelledby="itens-titulo" class="space-y-3 rounded-xl bg-white p-4">
            <h2 id="itens-titulo" class="font-semibold">Itens</h2>
            <ul class="divide-y divide-slate-100">
              @for (l of linhas(); track l.id) {
                <li class="flex flex-wrap items-end gap-3 py-2">
                  <span class="min-w-0 flex-1 text-sm">
                    <span class="block font-medium">{{ l.item.nome }}</span>
                    <span class="block font-mono text-xs text-slate-500">{{ l.item.codigo }}</span>
                  </span>
                  <span class="space-y-1">
                    <label [for]="'quantidade-' + l.id" class="block text-xs text-slate-600">Quantidade ({{ l.item.unidade }})</label>
                    <input [id]="'quantidade-' + l.id" [name]="'quantidade-' + l.id" type="text" inputmode="decimal" [disabled]="!pode('itens')"
                           [value]="l.quantidade" (input)="digitarQuantidade(l.id, $any($event.target).value)"
                           [attr.aria-invalid]="erros()['quantidade-' + l.id] ? 'true' : 'false'"
                           [attr.aria-describedby]="erros()['quantidade-' + l.id] ? 'erro-quantidade-' + l.id : null"
                           class="h-12 w-32 rounded-lg border px-3 text-right disabled:bg-slate-100"
                           [class.border-slate-300]="!erros()['quantidade-' + l.id]" [class.border-red-600]="erros()['quantidade-' + l.id]" />
                  </span>
                  @if (pode('itens')) {
                    <button type="button" (click)="tirarLinha(l.id)" [attr.aria-label]="'Tirar ' + l.item.nome"
                            class="h-12 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-red-700">Tirar</button>
                  }
                  @if (erros()['quantidade-' + l.id]; as e) {
                    <p [id]="'erro-quantidade-' + l.id" role="alert" class="w-full text-sm text-red-600">{{ e }}</p>
                  }
                </li>
              } @empty {
                <li class="py-2 text-sm text-slate-500">Nenhum item.</li>
              }
            </ul>
          </section>
        }

        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <a [routerLink]="voltarPara()" class="inline-flex h-12 items-center justify-center rounded-lg border border-slate-300 px-4 font-semibold text-slate-700">Cancelar</a>
          <button type="submit" [disabled]="salvando()"
                  class="h-12 rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-60">
            {{ salvando() ? (editando() ? 'Salvando…' : 'Criando…') : (editando() ? 'Salvar' : 'Criar OS') }}
          </button>
        </div>
      </form>
    }
  `,
})
export class OsFormPage implements ComAlteracoes {
  /** `:id` da rota: a edição do cabeçalho; ausente em `/os/nova`. */
  readonly id = input<string>();
  /** `?clienteId=` em `/os/nova`: já abre com o cliente. */
  readonly clienteId = input<string>();

  private readonly repo = inject(OsRepo);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly usuario = inject(AuthService).usuario;
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly clientes = toSignal(inject(ClientesRepo).observarTodos());
  private readonly usuarios = toSignal(inject(PropostasRepo).observarUsuarios(), { initialValue: [] });

  protected readonly os = signal<OsLocal | undefined>(undefined);
  private readonly carregou = signal(false);
  protected readonly salvando = signal(false);
  protected readonly anuncio = signal('');
  protected readonly erros = signal<Record<string, string>>({});

  // ---- o formulário ----
  protected readonly busca = signal('');
  private readonly clienteEscolhido = signal<string | null>(null);
  protected readonly enderecoIdx = signal<number | null>(null);
  protected readonly tipo = signal<TipoOs | ''>('');
  protected readonly descricao = signal('');
  protected readonly tecnicoId = signal('');
  protected readonly dataPrevista = signal('');
  protected readonly urgente = signal(false);
  protected readonly concluiProposta = signal(true);
  protected readonly endereco = signal<EnderecoTela>({
    cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '',
  });
  protected readonly linhas = signal<LinhaTela[]>([]);

  /** Estado ao abrir: sair com outro pede confirmação. */
  private readonly estadoSalvo = signal('');
  /** Depois de salvar, sair não pergunta nada. */
  private liberado = false;
  /** A OS nova já recebeu o estado inicial (o `?clienteId=`): a lista de clientes que muda depois não o refaz. */
  private iniciouNova = false;
  /** N5: o conteúdo do endereço escolhido (`instantaneo`), para reachar a posição se a lista do cliente mudar. */
  private enderecoEscolhido: string | null = null;

  protected readonly tipos = TIPOS_OS.map((t) => ({ valor: t, rotulo: rotuloTipoOs(t) }));
  protected readonly camposEndereco = CAMPOS_ENDERECO;
  protected readonly maxDescricao = MAX_DESCRICAO;

  protected readonly editando = computed(() => !!this.id());
  protected readonly carregando = computed(() => this.clientes() === undefined || (this.editando() && !this.carregou()));
  protected readonly codigo = computed(() => {
    const o = this.os();
    return o ? codigoOsExibido(o) : '';
  });
  protected readonly voltarPara = computed(() => (this.id() ? ['/os', this.id()!] : ['/os']));

  /** Os campos que o perfil muda nesta OS, no status dela (`camposEditaveisOs`); na OS nova, todos. */
  protected readonly editaveis = computed<ReadonlySet<CampoTela>>(() => {
    if (!this.editando()) return new Set(CAMPOS_TELA);
    const o = this.os();
    const u = this.usuario();
    if (!o || !u) return new Set();
    const campos = camposEditaveisOs(o.status, u.perfil, o.responsavelId === u.id, false);
    return new Set(CAMPOS_TELA.filter((c) => campos.includes(c) && (c !== 'concluiProposta' || o.propostaId !== null)));
  });
  protected readonly dica = computed(() => {
    if (!this.editando() || this.os()?.status !== 'EM_ANDAMENTO') return null;
    return this.editaveis().has('concluiProposta')
      ? 'Com a OS em andamento, só a data prevista, a urgência e "Esta OS conclui a proposta?" mudam.'
      : 'Com a OS em andamento, só a data prevista e a urgência mudam.';
  });

  protected readonly cliente = computed(() => {
    const id = this.editando() ? this.os()?.clienteId : this.clienteEscolhido();
    return id ? (this.clientes() ?? []).find((c) => c.id === id) : undefined;
  });
  protected readonly clienteNome = computed(() => this.cliente()?.nome ?? (this.os()?.clienteId ? 'Cliente não encontrado neste aparelho.' : 'Sem cliente'));
  protected readonly enderecosDoCliente = computed(() => this.cliente()?.enderecos ?? []);
  protected readonly resultados = computed(() => filtrarClientes(this.clientes() ?? [], this.busca()).slice(0, MAX_CLIENTES));
  protected readonly tecnicos = computed(() =>
    this.usuarios()
      .filter((u) => u.perfil === 'TECNICO' && u.ativo !== false)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  );
  protected readonly tecnicoAtual = computed(() => {
    const id = this.os()?.tecnicoId;
    if (!id) return 'Nenhum';
    return this.usuarios().find((u) => u.id === id)?.nome ?? 'Técnico não identificado';
  });
  protected readonly tamanhoDescricao = computed(() => tamanhoTextoOs(this.descricao()));

  private readonly alterado = computed(() => this.temAlteracoes());

  constructor() {
    avisarAoSairDaPagina(this.alterado);
    // a OS nova: o estado inicial (com o ?clienteId=, quando houver) é a base do "sem alterações"
    effect(() => {
      if (this.iniciouNova || this.editando()) return;
      const clientes = this.clientes();
      if (clientes === undefined) return;
      const id = this.clienteId();
      this.iniciouNova = true;
      untracked(() => {
        const c = id ? clientes.find((x) => x.id === id) : undefined;
        this.clienteEscolhido.set(c?.id ?? null);
        if (c) this.escolherEndereco(c, enderecoPadrao(c));
        this.estadoSalvo.set(this.estado());
      });
    });
    // N5: o sync mudou os endereços do cliente escolhido com o formulário aberto: a posição segue o mesmo endereço; se
    // ele sumiu, volta ao padrão e avisa no campo
    effect(() => {
      const c = this.editando() ? undefined : this.cliente();
      if (!c) return;
      untracked(() => {
        const idx = this.enderecoIdx();
        const chave = this.enderecoEscolhido;
        if (idx === null || chave === null || (c.enderecos[idx] && instantaneo(c.enderecos[idx]) === chave)) return;
        const achado = c.enderecos.findIndex((x) => instantaneo(x) === chave);
        if (achado >= 0) {
          this.enderecoIdx.set(achado);
          return;
        }
        this.escolherEndereco(c, enderecoPadrao(c));
        this.erros.update((x) => ({ ...x, enderecoId: 'Os endereços do cliente mudaram: confira o endereço do serviço.' }));
      });
    });
    // N4: a busca de clientes diz quantos achou (o leitor de tela não vê a lista mudar)
    effect(() => {
      const busca = this.busca().trim();
      const n = this.resultados().length;
      if (this.editando() || this.clienteEscolhido() !== null || busca === '') return;
      untracked(() => this.anuncio.set(n === 0 ? 'Nenhum cliente encontrado.' : n === 1 ? '1 cliente encontrado.' : `${n} clientes encontrados.`));
    });
    // a edição: carrega a OS (uma vez por id); a versão carregada é a base do conflito
    effect(() => {
      const id = this.id();
      if (id) void this.carregar(id);
    });
  }

  temAlteracoes(): boolean {
    if (this.liberado || this.carregando()) return false;
    if (this.editando() && (!this.os() || this.editaveis().size === 0)) return false;
    return this.estado() !== this.estadoSalvo();
  }

  protected pode(campo: CampoTela): boolean {
    return this.editaveis().has(campo);
  }

  protected rotuloEndereco(e: EnderecoDados): string {
    return ROTULO_TIPO_ENDERECO[e.tipo];
  }

  protected linhaEndereco(e: EnderecoDados): string {
    return linhaDoEndereco(e) ?? '';
  }

  /** Cidade e telefone, o que houver; nunca o CPF/CNPJ (Q18: nenhuma tela da OS o mostra). */
  protected resumoCliente(c: ClienteLocal): string {
    const i = enderecoPadrao(c);
    const cidade = i === null ? null : c.enderecos[i].cidade;
    return [cidade, c.telefone ? formatarTelefone(c.telefone) : null].filter((x) => !!x).join(' · ');
  }

  protected escolherCliente(c: ClienteLocal): void {
    this.clienteEscolhido.set(c.id);
    this.escolherEndereco(c, enderecoPadrao(c));
    this.limparErro('clienteId', 'enderecoId');
  }

  /** O endereço pela posição, guardando também o conteúdo dele (N5: a posição se reacha se a lista mudar). */
  protected escolherEndereco(c: ClienteLocal, idx: number | null): void {
    this.enderecoIdx.set(idx);
    this.enderecoEscolhido = idx === null || !c.enderecos[idx] ? null : instantaneo(c.enderecos[idx]);
  }

  protected trocarCliente(): void {
    this.clienteEscolhido.set(null);
    this.enderecoIdx.set(null);
    this.busca.set('');
    afterNextRender(() => this.focar('busca-cliente-os'), { injector: this.injector });
  }

  protected digitarEndereco(chave: ChaveEndereco, valor: string): void {
    this.endereco.update((e) => ({ ...e, [chave]: valor }));
  }

  protected usarEnderecoDoCliente(select: HTMLSelectElement): void {
    const e = select.value === '' ? undefined : this.enderecosDoCliente()[Number(select.value)];
    // a lista volta ao "Escolha…": ela só preenche os campos
    select.value = '';
    if (!e) return;
    this.endereco.set(enderecoParaTela(e));
    this.anuncio.set(`Endereço preenchido com o ${ROTULO_TIPO_ENDERECO[e.tipo].toLowerCase()} do cliente.`);
  }

  protected digitarQuantidade(id: string, valor: string): void {
    this.linhas.update((ls) => ls.map((l) => (l.id === id ? { ...l, quantidade: valor } : l)));
    this.limparErro(`quantidade-${id}`);
  }

  protected tirarLinha(id: string): void {
    const linha = this.linhas().find((l) => l.id === id);
    this.linhas.update((ls) => ls.filter((l) => l.id !== id));
    if (linha) this.anuncio.set(`${linha.item.nome} tirado da OS.`);
  }

  protected async salvar(): Promise<void> {
    if (this.salvando()) return;
    if (this.editando()) await this.salvarCabecalho();
    else await this.criar();
  }

  // ---- OS avulsa ----

  private async criar(): Promise<void> {
    const erros: Record<string, string> = {};
    const clienteId = this.clienteEscolhido();
    const tipo = this.tipo();
    const descricao = stripJava(this.descricao());
    if (!clienteId) erros['clienteId'] = 'Escolha o cliente.';
    if (tipo === '') erros['tipo'] = 'Escolha o tipo.';
    if (descricao === '') erros['descricao'] = 'Descreva o serviço.';
    else if (tamanhoTextoOs(descricao) > MAX_DESCRICAO) erros['descricao'] = `Máximo de ${MAX_DESCRICAO} caracteres.`;
    if (this.mostrarErros(erros)) return;
    const idx = this.enderecoIdx();
    this.salvando.set(true);
    try {
      const id = await this.repo.criarAvulsa({
        clienteId: clienteId!,
        tipo: tipo as TipoOs,
        descricao,
        ...(idx !== null ? { enderecoId: idx } : {}),
        tecnicoId: this.tecnicoId() || null,
        dataPrevista: this.dataPrevista() || null,
        urgente: this.urgente(),
      });
      this.liberado = true;
      this.toasts.mostrar('OS criada.');
      await this.router.navigate(['/os', id]);
    } catch (e) {
      this.recusado(e);
    } finally {
      this.salvando.set(false);
    }
  }

  // ---- cabeçalho ----

  private async carregar(id: string): Promise<void> {
    this.carregou.set(false);
    this.liberado = false;
    this.erros.set({});
    const lida = await this.repo.buscar(id);
    // a rota trocou de OS enquanto esta carregava: o resultado é de outra tela
    if (this.id() !== id) return;
    const u = this.usuario();
    // o COMERCIAL não abre a OS de outro (o mesmo filtro do `observarTodas`)
    const os = lida && u?.perfil === 'COMERCIAL' && lida.responsavelId !== u.id ? undefined : lida;
    this.os.set(os);
    if (os) {
      this.tipo.set(os.tipo);
      this.descricao.set(os.descricao ?? '');
      this.dataPrevista.set(os.dataPrevista ?? '');
      this.urgente.set(os.urgente);
      this.concluiProposta.set(os.concluiProposta);
      this.endereco.set(enderecoParaTela(enderecoDaOs(os)));
      this.linhas.set(os.itens.map((item) => ({
        id: item.id, item, quantidade: textoDecimal(BigInt(item.quantidadePrevistaMilesimos), 3, false),
      })));
    }
    this.estadoSalvo.set(untracked(() => this.estado()));
    this.carregou.set(true);
  }

  private async salvarCabecalho(): Promise<void> {
    const os = this.os();
    const id = this.id();
    if (!os || !id) return;
    const erros: Record<string, string> = {};
    const edicao: Partial<EdicaoCabecalhoOs> = {};
    if (this.pode('tipo') && this.tipo() !== os.tipo && this.tipo() !== '') edicao.tipo = this.tipo() as TipoOs;
    if (this.pode('descricao')) {
      const d = vazio(this.descricao());
      if (tamanhoTextoOs(d) > MAX_DESCRICAO) erros['descricao'] = `Máximo de ${MAX_DESCRICAO} caracteres.`;
      else if (d !== os.descricao) edicao.descricao = d;
    }
    if (this.pode('dataPrevista') && (this.dataPrevista() || null) !== os.dataPrevista) edicao.dataPrevista = this.dataPrevista() || null;
    if (this.pode('urgente') && this.urgente() !== os.urgente) edicao.urgente = this.urgente();
    if (this.pode('concluiProposta') && this.concluiProposta() !== os.concluiProposta) edicao.concluiProposta = this.concluiProposta();
    if (this.pode('endereco')) {
      const e = enderecoDaTela(this.endereco());
      if (instantaneo(e) !== instantaneo(enderecoDaOs(os))) edicao.endereco = e;
    }
    if (this.pode('itens')) {
      const itens: LinhaOs[] = [];
      for (const l of this.linhas()) {
        const q = lerCampoDecimal(l.quantidade, 3, QUANTIDADE_MIN, QUANTIDADE_MAX, ERRO_QUANTIDADE);
        if (typeof q === 'string') erros[`quantidade-${l.id}`] = q === 'Informe o valor.' ? ERRO_QUANTIDADE : q;
        else itens.push({ ...l.item, quantidadePrevistaMilesimos: Number(q) });
      }
      const antes = os.itens.map((i) => [i.id, i.quantidadePrevistaMilesimos]);
      const depois = itens.map((i) => [i.id, i.quantidadePrevistaMilesimos]);
      if (instantaneo(antes) !== instantaneo(depois)) edicao.itens = itens;
    }
    if (this.mostrarErros(erros)) return;
    if (Object.keys(edicao).length === 0) {
      this.liberado = true;
      await this.router.navigate(['/os', id]);
      return;
    }
    this.salvando.set(true);
    try {
      await this.repo.salvarCabecalho(id, edicao, os.version);
      if (this.id() !== id) return;
      this.liberado = true;
      this.toasts.mostrar('OS salva.');
      await this.router.navigate(['/os', id]);
    } catch (e) {
      if (this.id() === id) this.recusado(e);
    } finally {
      this.salvando.set(false);
    }
  }

  // ---- erros e foco ----

  /** Mostra os erros da tela (e foca o primeiro); true se havia algum. */
  private mostrarErros(erros: Record<string, string>): boolean {
    this.erros.set(erros);
    const campos = Object.keys(erros);
    if (campos.length === 0) return false;
    this.anuncio.set('Revise os campos destacados.');
    afterNextRender(() => this.focarErro(campos), { injector: this.injector });
    return true;
  }

  /** A recusa do repositório: `VALIDACAO` com campos da tela vai para eles; o resto, para o toast. */
  private recusado(e: unknown): void {
    if (e instanceof ErroOs && e.codigo === 'VALIDACAO' && e.campos) {
      const campos = this.editando() ? e.campos : this.camposDaAvulsa(e.campos);
      const naTela = Object.fromEntries(Object.entries(campos).filter(([c]) => c in ALVO_DO_ERRO));
      if (Object.keys(naTela).length > 0) {
        this.mostrarErros(naTela);
        return;
      }
    }
    this.toasts.erro(mensagemErroOs(e));
  }

  /**
   * M4: na OS avulsa o endereço é a escolha de um endereço do cliente (não há os campos `endereco*` na tela): a recusa
   * do snapshot copiado vai para a escolha, com o caminho para corrigir.
   */
  private camposDaAvulsa(campos: Record<string, string>): Record<string, string> {
    const r: Record<string, string> = {};
    for (const [c, m] of Object.entries(campos)) {
      if (c.startsWith('endereco') && c !== 'enderecoId') {
        r['enderecoId'] = 'O endereço escolhido tem dados inválidos: corrija no cadastro do cliente.';
      } else {
        r[c] = m;
      }
    }
    return r;
  }

  private focarErro(campos: string[]): void {
    for (const c of campos) {
      const alvo = c.startsWith('quantidade-') ? c : ALVO_DO_ERRO[c];
      if (alvo && this.focar(alvo)) return;
    }
  }

  /** Foca o elemento de id `id` na página; false se ele não está lá. */
  private focar(id: string): boolean {
    const el = this.host.nativeElement.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    el?.focus();
    return !!el;
  }

  private limparErro(...campos: string[]): void {
    if (!campos.some((c) => c in this.erros())) return;
    this.erros.update((e) => Object.fromEntries(Object.entries(e).filter(([c]) => !campos.includes(c))));
  }

  /** O que conta como alteração: os campos da tela (a busca do cliente, não). */
  private estado(): string {
    return instantaneo({
      cliente: this.clienteEscolhido(), endereco: this.enderecoIdx(), tipo: this.tipo(), descricao: this.descricao(),
      tecnico: this.tecnicoId(), data: this.dataPrevista(), urgente: this.urgente(), conclui: this.concluiProposta(),
      enderecoOs: this.endereco(), linhas: this.linhas().map((l) => [l.id, l.quantidade]),
    });
  }
}
