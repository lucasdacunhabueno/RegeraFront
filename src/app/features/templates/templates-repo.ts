import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { observar } from '../../core/db/observar';
import { RegeraDb } from '../../core/db/regera-db';
import { lerNaoSincronizados, observarNaoSincronizados } from '../../core/sync/nao-sincronizados';
import { SyncService } from '../../core/sync/sync-service';
import { ErroCampo } from '../../core/util/erro-campo';
import { uuidv7 } from '../../core/util/uuid';
import {
  padraoEfetivo,
  paraTemplateLocal,
  TemplateDados,
  TemplateLocal,
  TIPOS_PROPOSTA,
  TipoProposta,
  validarBlocos,
} from './template-models';

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

  /** O padrão efetivo do tipo (ver `padraoEfetivo`): a intenção local não sincronizada vence o que veio do servidor. */
  async padraoPorTipo(tipo: TipoProposta): Promise<TemplateLocal | undefined> {
    const doTipo = await this.db.templates.where('tipoProposta').equals(tipo).toArray();
    return padraoEfetivo(doTipo, tipo, await lerNaoSincronizados(this.db));
  }

  /** Tipo → id do padrão efetivo; a lista mostra o selo "Padrão" só nesses. */
  observarPadroesEfetivos(): Observable<Map<TipoProposta, string>> {
    return observar(async () => {
      const todos = await this.db.templates.toArray();
      const pendentes = await lerNaoSincronizados(this.db);
      const mapa = new Map<TipoProposta, string>();
      for (const { valor } of TIPOS_PROPOSTA) {
        const padrao = padraoEfetivo(todos, valor, pendentes);
        if (padrao) mapa.set(valor, padrao.id);
      }
      return mapa;
    });
  }

  /**
   * versaoCarregada: versão que o formulário carregou — usada como base para o servidor detectar conflito.
   * Marcar como padrão não mexe nos outros do tipo aqui (se esta mutação fosse rejeitada e descartada, eles ficariam
   * desmarcados para sempre): o servidor desmarca na mesma transação, o pull traz as versões novas e, até lá,
   * `padraoPorTipo`/`observarPadroesEfetivos` dão preferência ao pendente.
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
