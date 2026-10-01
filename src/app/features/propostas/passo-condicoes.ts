import { Component, computed, inject } from '@angular/core';
import type { Perfil } from '../../core/auth/auth-models';
import type { UsuarioResumo } from '../../core/sync/sync-models';
import { moedaCentavos } from './formatos-proposta';
import { EstadoWizard } from './wizard-estado';

/** Usuários ativos com um dos perfis, mais o já escolhido (mesmo inativo, para o select mostrá-lo). */
function opcoesDeUsuario(usuarios: readonly UsuarioResumo[], perfis: readonly Perfil[], atual: string | null) {
  return usuarios
    .filter((u) => perfis.includes(u.perfil) && (u.ativo !== false || u.id === atual))
    .map((u) => ({ id: u.id, rotulo: u.ativo === false ? `${u.nome} (inativo)` : u.nome }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

/**
 * Passo 3 (§13): condições. Template (ativos do tipo; o padrão vem pré-selecionado na criação), validade, pagamento,
 * prazo, desconto geral e observações; técnico opcional (o ADMIN ou o responsável trocam) e, só para o ADMIN, o
 * responsável.
 */
@Component({
  selector: 'app-passo-condicoes',
  template: `
    <section class="space-y-4 rounded-xl bg-white p-4" aria-labelledby="titulo-passo">
      <h2 id="titulo-passo" tabindex="-1" class="font-semibold outline-none">Condições</h2>

      <div class="space-y-1">
        <label for="template" class="text-sm font-medium">Template</label>
        <select id="template" (change)="e.templateId.set($any($event.target).value || null); limpar('templateId')"
                [attr.aria-invalid]="erros().templateId ? 'true' : 'false'"
                [attr.aria-describedby]="erros().templateId ? 'template-erro' : null"
                class="h-12 w-full rounded-lg border bg-white px-3" [class.border-slate-300]="!erros().templateId"
                [class.border-red-600]="erros().templateId">
          <option value="" [selected]="!e.templateId()">Selecione</option>
          @for (t of opcoesTemplate(); track t.id) {
            <option [value]="t.id" [selected]="t.id === e.templateId()">{{ t.rotulo }}</option>
          }
        </select>
        @if (erros().templateId; as erro) { <p id="template-erro" role="alert" class="text-sm text-red-600">{{ erro }}</p> }
        @if (e.templatesDoTipo().length === 0) {
          <p class="text-sm text-amber-800">Nenhum template ativo para este tipo neste aparelho.</p>
        }
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1">
          <label for="validade" class="text-sm font-medium">Validade</label>
          <input id="validade" type="date" [value]="e.validadeAte()" (input)="e.validadeAte.set($any($event.target).value); limpar('validadeAte')"
                 [attr.aria-invalid]="erros().validadeAte ? 'true' : 'false'"
                  [attr.aria-describedby]="erros().validadeAte ? 'validade-erro' : null"
                 class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3" />
          @if (erros().validadeAte; as erro) { <p id="validade-erro" class="text-sm text-red-600">{{ erro }}</p> }
        </div>
        <div class="space-y-1">
          <label for="desconto-geral" class="text-sm font-medium">Desconto geral (%)</label>
          <input id="desconto-geral" inputmode="decimal" autocomplete="off" [value]="e.descontoGeral()"
                 (input)="e.descontoGeral.set($any($event.target).value); limpar('descontoGeralPercentual')"
                 [attr.aria-invalid]="erros().descontoGeral ? 'true' : 'false'"
                 [attr.aria-describedby]="erros().descontoGeral ? 'desconto-geral-erro' : null"
                 class="h-12 w-full rounded-lg border px-3 text-right" [class.border-slate-300]="!erros().descontoGeral"
                 [class.border-red-600]="erros().descontoGeral" />
          @if (erros().descontoGeral; as erro) { <p id="desconto-geral-erro" class="text-sm text-red-600">{{ erro }}</p> }
        </div>
      </div>

      <div class="space-y-1">
        <label for="condicoes-pagamento" class="text-sm font-medium">Condições de pagamento</label>
        <textarea id="condicoes-pagamento" rows="3" maxlength="1000" [value]="e.condicoesPagamento()"
                  (input)="e.condicoesPagamento.set($any($event.target).value); limpar('condicoesPagamento')"
                  [attr.aria-invalid]="erros().condicoesPagamento ? 'true' : 'false'"
                  [attr.aria-describedby]="erros().condicoesPagamento ? 'condicoes-erro' : null"
                  class="w-full rounded-lg border border-slate-300 px-3 py-2"></textarea>
        @if (erros().condicoesPagamento; as erro) { <p id="condicoes-erro" class="text-sm text-red-600">{{ erro }}</p> }
      </div>

      <div class="space-y-1">
        <label for="prazo-execucao" class="text-sm font-medium">Prazo de execução</label>
        <input id="prazo-execucao" maxlength="200" autocomplete="off" [value]="e.prazoExecucao()"
               (input)="e.prazoExecucao.set($any($event.target).value); limpar('prazoExecucao')"
               [attr.aria-invalid]="erros().prazoExecucao ? 'true' : 'false'"
                  [attr.aria-describedby]="erros().prazoExecucao ? 'prazo-erro' : null"
               class="h-12 w-full rounded-lg border border-slate-300 px-3" />
        @if (erros().prazoExecucao; as erro) { <p id="prazo-erro" class="text-sm text-red-600">{{ erro }}</p> }
      </div>

      <div class="space-y-1">
        <label for="observacoes" class="text-sm font-medium">Observações</label>
        <textarea id="observacoes" rows="3" maxlength="4000" [value]="e.observacoes()"
                  (input)="e.observacoes.set($any($event.target).value); limpar('observacoes')"
                  [attr.aria-invalid]="erros().observacoes ? 'true' : 'false'"
                  [attr.aria-describedby]="erros().observacoes ? 'observacoes-erro' : null"
                  class="w-full rounded-lg border border-slate-300 px-3 py-2"></textarea>
        @if (erros().observacoes; as erro) { <p id="observacoes-erro" class="text-sm text-red-600">{{ erro }}</p> }
      </div>

      <div class="space-y-1">
        <label for="tecnico" class="text-sm font-medium">Técnico (opcional)</label>
        <select id="tecnico" [disabled]="!e.podeTrocarTecnico()" (change)="e.tecnicoId.set($any($event.target).value || null); limpar('tecnicoId')"
                [attr.aria-invalid]="erros().tecnicoId ? 'true' : 'false'"
                  [attr.aria-describedby]="erros().tecnicoId ? 'tecnico-erro' : null"
                class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 disabled:bg-slate-100">
          <option value="" [selected]="!e.tecnicoId()">Nenhum</option>
          @for (u of tecnicos(); track u.id) {
            <option [value]="u.id" [selected]="u.id === e.tecnicoId()">{{ u.rotulo }}</option>
          }
        </select>
        @if (erros().tecnicoId; as erro) { <p id="tecnico-erro" class="text-sm text-red-600">{{ erro }}</p> }
      </div>

      @if (e.admin()) {
        <div class="space-y-1">
          <label for="responsavel" class="text-sm font-medium">Responsável</label>
          <select id="responsavel" (change)="e.responsavelId.set($any($event.target).value); limpar('responsavelId')"
                  [attr.aria-invalid]="erros().responsavelId ? 'true' : 'false'"
                  [attr.aria-describedby]="erros().responsavelId ? 'responsavel-erro' : null"
                  class="h-12 w-full rounded-lg border border-slate-300 bg-white px-3">
            @for (u of responsaveis(); track u.id) {
              <option [value]="u.id" [selected]="u.id === e.responsavelId()">{{ u.rotulo }}</option>
            }
          </select>
          @if (erros().responsavelId; as erro) { <p id="responsavel-erro" class="text-sm text-red-600">{{ erro }}</p> }
        </div>
      }

      <p class="flex items-baseline justify-between border-t border-slate-200 pt-3 font-semibold">
        <span>Total</span>
        <span data-testid="total-condicoes">{{ total() }}</span>
      </p>
    </section>
  `,
})
export class PassoCondicoes {
  protected readonly e = inject(EstadoWizard);
  protected readonly erros = this.e.errosCondicoes;

  /**
   * Os ativos do tipo e, se o gravado não está entre eles (desativado depois, ou fora do aparelho), ele também, marcado:
   * o select nunca mostra "Selecione" com um template escolhido por baixo.
   */
  protected readonly opcoesTemplate = computed(() => {
    const padrao = this.e.padroes().get(this.e.tipo());
    const opcoes = this.e.templatesDoTipo().map((t) => ({ id: t.id, rotulo: t.id === padrao ? `${t.nome} (padrão)` : t.nome }));
    const id = this.e.templateId();
    if (!id || opcoes.some((o) => o.id === id)) return opcoes;
    const atual = this.e.template();
    const rotulo = !atual ? 'Template fora deste aparelho' : atual.ativo ? atual.nome : `${atual.nome} (inativo)`;
    return [...opcoes, { id, rotulo }];
  });
  protected readonly tecnicos = computed(() => opcoesDeUsuario(this.e.usuarios(), ['TECNICO'], this.e.tecnicoId()));
  protected readonly responsaveis = computed(() => {
    const atual = this.e.responsavelId();
    const opcoes = opcoesDeUsuario(this.e.usuarios(), ['ADMIN', 'COMERCIAL'], atual);
    // o responsável gravado pode não ter vindo no sync (ex.: usuário removido): continua escolhível
    return atual && !opcoes.some((o) => o.id === atual) ? [{ id: atual, rotulo: 'Responsável atual' }, ...opcoes] : opcoes;
  });
  protected readonly total = computed(() => {
    const t = this.e.totais();
    return t ? moedaCentavos(Number(t.totalCentavos)) : '—';
  });

  protected limpar(campo: string): void {
    this.e.limparErroServidor((c) => c === campo);
  }
}
