import { Component, computed, input, output } from '@angular/core';
import { EditorTexto } from '../../shared/editor/editor-texto';
import {
  Assinante,
  ASSINANTES,
  Bloco,
  ColunaItens,
  COLUNAS_ITENS,
  ConfigAssinatura,
  ConfigCabecalho,
  ConfigItens,
  ConfigTexto,
  ConfigTotais,
  TiptapNo,
  TIPOS_BLOCO,
} from './template-models';
import { TituloVariaveis } from './titulo-variaveis';

const MAX_RESUMO = 60;
const ROTULO_COLUNA = new Map<string, string>(COLUNAS_ITENS.map((c) => [c.valor, c.rotulo]));
const ROTULO_ASSINANTE = new Map<string, string>(ASSINANTES.map((a) => [a.valor, a.rotulo]));
const ROTULO_BLOCO = new Map<string, string>(TIPOS_BLOCO.map((t) => [t.valor, t.rotulo]));

/** Rótulo do tipo do bloco; tipo que esta versão não conhece (vindo do pull) → "Bloco desconhecido". */
export function rotuloBloco(b: Bloco): string {
  return ROTULO_BLOCO.get(b.tipo) ?? 'Bloco desconhecido';
}

/** Texto corrido de um nó do Tiptap: variáveis como `{{nome}}`, blocos separados por espaço. */
function textoDe(no: TiptapNo): string {
  if (no.type === 'text') return typeof no.text === 'string' ? no.text : '';
  if (no.type === 'variavel') return `{{${String(no.attrs?.['nome'] ?? '')}}}`;
  if (no.type === 'hardBreak') return ' ';
  const filhos = (no.content ?? []).map(textoDe);
  return no.type === 'paragraph' || no.type === 'heading' ? filhos.join('') : filhos.filter((t) => t !== '').join(' ');
}

/** Resumo do bloco no cartão da lista (título do cabeçalho, começo do texto, colunas, assinantes…). */
export function resumoBloco(b: Bloco): string {
  const c = b.config as unknown as Record<string, unknown> | undefined;
  switch (b.tipo) {
    case 'CABECALHO':
      return typeof c?.['titulo'] === 'string' ? c['titulo'] : '';
    case 'TEXTO': {
      const doc = b.config?.conteudo;
      const texto = (doc?.content ?? []).map(textoDe).filter((t) => t !== '').join(' ').replace(/\s+/g, ' ').trim();
      return texto.length > MAX_RESUMO ? texto.slice(0, MAX_RESUMO) + '…' : texto;
    }
    case 'ITENS':
      return (Array.isArray(c?.['colunas']) ? (c['colunas'] as string[]) : []).map((v) => ROTULO_COLUNA.get(v) ?? v).join(', ');
    case 'TOTAIS':
      return c?.['mostrarDescontos'] === false ? 'Sem descontos' : 'Com descontos';
    case 'ASSINATURA':
      return (Array.isArray(c?.['assinantes']) ? (c['assinantes'] as string[]).map((v) => ROTULO_ASSINANTE.get(v) ?? v) : []).join(
        ', ',
      );
    default:
      return '';
  }
}

/** Liga ou desliga `valor` na lista, mantendo a ordem de `todos` (a mesma ordem das colunas no PDF). */
function alternar<T extends string>(lista: readonly T[], valor: T, todos: readonly { valor: T }[]): T[] {
  const set = new Set(lista);
  if (set.has(valor)) set.delete(valor);
  else set.add(valor);
  return todos.map((t) => t.valor).filter((v) => set.has(v));
}

const marcado = (e: Event) => (e.target as HTMLInputElement).checked;

/**
 * Formulário das opções de um bloco (§9.1), um por tipo. Emite `configChange` com o config inteiro atualizado; o pai
 * deve devolvê-lo em `bloco` de forma síncrona (P4a-R10: o editor de texto trata o eco).
 */
@Component({
  selector: 'app-bloco-config',
  imports: [EditorTexto, TituloVariaveis],
  template: `
    @let id = bloco().id;
    <div class="space-y-3">
      @if (erroExtra(); as erro) {
        <p data-testid="erro-bloco-config" role="alert" class="text-sm text-red-600">{{ erro }}</p>
      }
      @if (cabecalho(); as c) {
        <label class="flex min-h-12 items-center gap-3">
          <input type="checkbox" role="switch" name="mostrarLogo" class="size-5" [checked]="c.mostrarLogo"
                 (change)="emitir({ ...c, mostrarLogo: marcado($event) })" />
          Mostrar a logo da empresa
        </label>
        <label class="flex min-h-12 items-center gap-3">
          <input type="checkbox" role="switch" name="mostrarDadosEmpresa" class="size-5" [checked]="c.mostrarDadosEmpresa"
                 (change)="emitir({ ...c, mostrarDadosEmpresa: marcado($event) })" />
          Mostrar os dados da empresa
        </label>
        <div class="space-y-1">
          <label [for]="id + '-titulo'" class="text-sm font-medium">Título</label>
          <app-titulo-variaveis [idCampo]="id + '-titulo'" [valor]="c.titulo" (valorChange)="emitir({ ...c, titulo: $event })" />
        </div>
      } @else if (texto(); as c) {
        <app-editor-texto rotulo="Texto do bloco" [conteudo]="c.conteudo" (conteudoChange)="emitir({ conteudo: $event })" />
      } @else if (itens(); as c) {
        <fieldset class="space-y-1" [attr.aria-describedby]="c.colunas.length === 0 ? id + '-erro-colunas' : null">
          <legend class="mb-1 text-sm font-medium">Colunas da tabela</legend>
          <div class="grid grid-cols-2 gap-x-3">
            @for (col of colunas; track col.valor) {
              <label class="flex min-h-12 items-center gap-3">
                <input type="checkbox" name="coluna" class="size-5" [value]="col.valor" [checked]="c.colunas.includes(col.valor)"
                       (change)="emitir({ ...c, colunas: alternarColuna(c.colunas, col.valor) })" />
                {{ col.rotulo }}
              </label>
            }
          </div>
          @if (c.colunas.length === 0) {
            <p [id]="id + '-erro-colunas'" role="alert" class="text-sm text-red-600">Escolha pelo menos uma coluna.</p>
          }
        </fieldset>
        <label class="flex min-h-12 items-center gap-3">
          <input type="checkbox" role="switch" name="agruparPorNatureza" class="size-5" [checked]="c.agruparPorNatureza"
                 (change)="emitir({ ...c, agruparPorNatureza: marcado($event) })" />
          Separar produtos e serviços
        </label>
      } @else if (totais(); as c) {
        <label class="flex min-h-12 items-center gap-3">
          <input type="checkbox" role="switch" name="mostrarDescontos" class="size-5" [checked]="c.mostrarDescontos"
                 (change)="emitir({ mostrarDescontos: marcado($event) })" />
          Mostrar a linha de descontos
        </label>
      } @else if (assinatura(); as c) {
        <fieldset class="space-y-1" [attr.aria-describedby]="c.assinantes.length === 0 ? id + '-erro-assinantes' : null">
          <legend class="mb-1 text-sm font-medium">Quem assina</legend>
          @for (a of assinantes; track a.valor) {
            <label class="flex min-h-12 items-center gap-3">
              <input type="checkbox" name="assinante" class="size-5" [value]="a.valor" [checked]="c.assinantes.includes(a.valor)"
                     (change)="emitir({ assinantes: alternarAssinante(c.assinantes, a.valor) })" />
              {{ a.rotulo }}
            </label>
          }
          @if (c.assinantes.length === 0) {
            <p [id]="id + '-erro-assinantes'" role="alert" class="text-sm text-red-600">Escolha pelo menos um assinante.</p>
          }
        </fieldset>
      } @else if (bloco().tipo === 'QUEBRA_PAGINA') {
        <p class="text-sm text-slate-600">O que vier depois deste bloco começa numa nova página do PDF.</p>
      } @else {
        <p class="text-sm text-slate-600">
          Este tipo de bloco não é reconhecido por esta versão do app. Atualize o app para editá-lo, ou remova o bloco.
        </p>
      }
    </div>
  `,
})
export class BlocoConfig {
  readonly bloco = input.required<Bloco>();
  /** Erro do `validarBlocos` para este bloco; mostrado aqui, a não ser que já haja a mensagem própria de lista vazia. */
  readonly erro = input<string | null>(null);
  readonly configChange = output<Bloco['config']>();

  protected readonly colunas = COLUNAS_ITENS;
  protected readonly assinantes = ASSINANTES;
  protected readonly marcado = marcado;

  protected readonly cabecalho = computed((): ConfigCabecalho | null => {
    const b = this.bloco();
    return b.tipo === 'CABECALHO' ? b.config : null;
  });
  protected readonly texto = computed((): ConfigTexto | null => {
    const b = this.bloco();
    return b.tipo === 'TEXTO' ? b.config : null;
  });
  protected readonly itens = computed((): ConfigItens | null => {
    const b = this.bloco();
    return b.tipo === 'ITENS' ? b.config : null;
  });
  protected readonly totais = computed((): ConfigTotais | null => {
    const b = this.bloco();
    return b.tipo === 'TOTAIS' ? b.config : null;
  });
  protected readonly assinatura = computed((): ConfigAssinatura | null => {
    const b = this.bloco();
    return b.tipo === 'ASSINATURA' ? b.config : null;
  });

  protected readonly erroExtra = computed(() => {
    const erro = this.erro();
    const listaVazia = this.itens()?.colunas.length === 0 || this.assinatura()?.assinantes.length === 0;
    return erro && !listaVazia ? erro : null;
  });

  protected emitir(config: Bloco['config']): void {
    this.configChange.emit(config);
  }

  protected alternarColuna(lista: ColunaItens[], valor: ColunaItens): ColunaItens[] {
    return alternar(lista, valor, COLUNAS_ITENS);
  }

  protected alternarAssinante(lista: Assinante[], valor: Assinante): Assinante[] {
    return alternar(lista, valor, ASSINANTES);
  }
}
