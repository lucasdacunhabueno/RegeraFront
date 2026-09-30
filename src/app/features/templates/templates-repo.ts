import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { observar } from '../../core/db/observar';
import { RegeraDb } from '../../core/db/regera-db';
import { observarNaoSincronizados } from '../../core/sync/nao-sincronizados';
import { SyncService } from '../../core/sync/sync-service';
import { ErroCampo } from '../../core/util/erro-campo';
import { uuidv7 } from '../../core/util/uuid';
import { paraTemplateLocal, TemplateDados, TemplateLocal, TipoProposta, validarBlocos } from './template-models';

@Injectable({ providedIn: 'root' })
export class TemplatesRepo {
  private readonly db = inject(RegeraDb);
  private readonly sync = inject(SyncService);

  observarTodos(): Observable<TemplateLocal[]> {
    return observar(() => this.db.templates.orderBy('nomeBusca').toArray());
  }

  observarNaoSincronizados(): Observable<Set<string>> {
    return observarNaoSincronizados(this.db);
  }

  buscar(id: string): Promise<TemplateLocal | undefined> {
    return this.db.templates.get(id);
  }

  async temPendencia(id: string): Promise<boolean> {
    return (await this.db.pendencias.where('agregadoId').equals(id).count()) > 0;
  }

  /** O template padrão (ativo) do tipo, se houver. */
  async padraoPorTipo(tipo: TipoProposta): Promise<TemplateLocal | undefined> {
    const doTipo = await this.db.templates.where('tipoProposta').equals(tipo).toArray();
    return doTipo.find((t) => t.padrao && t.ativo);
  }

  /**
   * versaoCarregada: versão que o formulário carregou — usada como base para o servidor detectar conflito.
   * Marcar como padrão desmarca os outros do mesmo tipo só aqui no aparelho, sem mutação para eles: o servidor
   * desmarca na mesma transação e o pull traz as versões novas.
   */
  async salvar(dados: TemplateDados, id?: string, versaoCarregada?: number | null): Promise<string> {
    // a tela mostra os erros de cada bloco com validarBlocos; aqui é a última barreira antes da outbox
    const [primeiro] = Object.values(validarBlocos(dados.blocos));
    if (primeiro) {
      throw new ErroCampo('blocos', primeiro);
    }
    if (dados.padrao && !dados.ativo) {
      throw new ErroCampo('padrao', 'Um template inativo não pode ser o padrão.');
    }
    const agregadoId = id ?? uuidv7();
    const normalizados: TemplateDados = { ...dados, nome: dados.nome.trim() };
    await this.db.transaction('rw', [this.db.templates, this.db.outbox, this.db.pendencias], async () => {
      const atual = await this.db.templates.get(agregadoId);
      const version = versaoCarregada !== undefined ? versaoCarregada : (atual?.version ?? null);
      if (normalizados.padrao) {
        const outros = await this.db.templates
          .where('tipoProposta')
          .equals(normalizados.tipoProposta)
          .filter((t) => t.padrao && t.id !== agregadoId)
          .toArray();
        await this.db.templates.bulkPut(outros.map((t) => ({ ...t, padrao: false })));
      }
      await this.db.templates.put(paraTemplateLocal(agregadoId, version, normalizados));
      await this.db.pendencias
        .where('agregadoId')
        .equals(agregadoId)
        .filter((p) => p.tipo === 'REJEITADO' && p.entidade === 'template_proposta')
        .delete();
      await this.sync.registrar('template_proposta', agregadoId, 'UPSERT', normalizados, version);
    });
    void this.sync.sincronizar();
    return agregadoId;
  }

  async excluir(id: string, versaoCarregada?: number | null): Promise<void> {
    await this.db.transaction('rw', [this.db.templates, this.db.outbox, this.db.pendencias], async () => {
      const atual = await this.db.templates.get(id);
      const version = versaoCarregada !== undefined ? versaoCarregada : (atual?.version ?? null);
      await this.db.templates.delete(id);
      await this.db.pendencias
        .where('agregadoId')
        .equals(id)
        .filter((p) => p.tipo === 'REJEITADO' && p.entidade === 'template_proposta')
        .delete();
      await this.sync.registrar('template_proposta', id, 'DELETE', null, version);
    });
    void this.sync.sincronizar();
  }
}
