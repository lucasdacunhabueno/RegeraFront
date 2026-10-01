import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { observar } from '../db/observar';
import { RegeraDb } from '../db/regera-db';
import type { PropostaDados } from '../../features/propostas/proposta-models';
import { Adaptador, adaptadorDe } from './adaptadores';
import { DadosUpload, Entidade, Mudanca, Pendencia, TIPO_UPLOAD_DOCUMENTO } from './sync-models';
import { SyncService } from './sync-service';

/** Decisões do usuário sobre conflitos e rejeições (§11.5). */
@Injectable({ providedIn: 'root' })
export class PendenciasService {
  private readonly db = inject(RegeraDb);
  private readonly http = inject(HttpClient);
  private readonly sync = inject(SyncService);

  observar(): Observable<Pendencia[]> {
    return observar(async () => (await this.db.pendencias.toArray()).sort((a, b) => a.criadaEm.localeCompare(b.criadaEm)));
  }

  async manterMinha(p: Pendencia): Promise<void> {
    const adaptador = this.adaptador(p);
    const tabela = adaptador.tabela(this.db);
    const base = p.versionServidor ?? null;
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, this.db.documentos, tabela], async () => {
      const local = await tabela.get(p.agregadoId);
      await this.limparAgregado(p);
      if (local) {
        await tabela.put(adaptador.paraLocal(p.agregadoId, base, adaptador.dadosDe(local)));
      }
      await this.sync.registrar(p.entidade as Entidade, p.agregadoId, local ? 'UPSERT' : 'DELETE', local ? adaptador.dadosDe(local) : null, base);
    });
    void this.sync.sincronizar();
  }

  /** Busca o estado ATUAL do servidor (dadosServidor pode estar velho); sem rede, usa o que a pendência guardou. */
  async usarServidor(p: Pendencia): Promise<void> {
    this.adaptador(p);
    let atual: Mudanca | null | undefined;
    try {
      atual = await this.buscarNoServidor(p, p.agregadoId);
    } catch (e) {
      if (!(e instanceof HttpErrorResponse && e.status === 0)) throw e;
      atual = p.dadosServidor == null ? null : { dados: p.dadosServidor, version: p.versionServidor ?? null, deleted: false } as unknown as Mudanca;
    }
    await this.aplicarEClear(p, p.agregadoId, atual);
  }

  async descartar(p: Pendencia): Promise<void> {
    if (p.entidade === TIPO_UPLOAD_DOCUMENTO) return this.descartarUpload(p);
    if (p.mutacao.baseVersion === null) {
      const tabela = this.adaptador(p).tabela(this.db);
      await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, this.db.documentos, tabela], async () => {
        await this.limparAgregado(p);
        await tabela.delete(p.agregadoId);
      });
      return;
    }
    await this.aplicarEClear(p, p.agregadoId, await this.buscarNoServidor(p, p.agregadoId));
  }

  /**
   * DOCUMENTO_DUPLICADO: fica com o cadastro que já existe no servidor e some com o duplicado local. Se o duplicado
   * nunca chegou ao servidor (some de vez), as propostas que apontavam para ele passam a apontar para o existente.
   */
  async usarExistente(p: Pendencia): Promise<string> {
    const idExistente = p.erro?.idExistente;
    if (!idExistente) throw new Error('Pendência sem idExistente');
    const adaptador = this.adaptador(p);
    const existente = await this.buscarNoServidor(p, idExistente);
    if (!existente || existente.deleted) throw new Error('O cadastro existente não foi encontrado no servidor.');
    // atualização: o agregado local existe no servidor, então restaura a cópia dele em vez de apagar
    const proprio = p.mutacao.baseVersion !== null ? await this.buscarNoServidor(p, p.agregadoId) : null;
    const tabela = adaptador.tabela(this.db);
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, this.db.documentos, tabela, this.db.propostas], async () => {
      await this.limparAgregado(p);
      if (proprio && !proprio.deleted) {
        await tabela.put(adaptador.paraLocal(p.agregadoId, proprio.version, proprio.dados));
      } else {
        await tabela.delete(p.agregadoId);
        if (p.entidade === 'cliente') await this.remapearCliente(p.agregadoId, idExistente);
      }
      await tabela.put(adaptador.paraLocal(idExistente, existente.version, existente.dados));
    });
    return idExistente;
  }

  /**
   * O cliente `de` deixou de existir no aparelho em favor de `para`: troca o `clienteId` nas propostas locais e nos
   * `dados` das mutações de proposta na fila. A mutação reescrita ganha outro `mutationId` (e deixa de estar em voo):
   * o resultado de um envio em curso com o id antigo não é aplicado por cima, e ela sai de novo.
   */
  private async remapearCliente(de: string, para: string): Promise<void> {
    await this.db.propostas.where('clienteId').equals(de).modify({ clienteId: para });
    const naFila = await this.db.outbox
      .filter((m) => m.entidade === 'proposta' && (m.dados as PropostaDados | null)?.clienteId === de)
      .toArray();
    for (const m of naFila) {
      await this.db.outbox.update(m.seq!, {
        dados: { ...(m.dados as PropostaDados), clienteId: para },
        mutationId: crypto.randomUUID(),
        enviando: false,
      });
    }
  }

  /**
   * Upload recusado: some com o envio — a pendência e o PDF local ainda não enviado. A proposta e as mutações dela
   * na fila ficam e voltam a sair.
   */
  private async descartarUpload(p: Pendencia): Promise<void> {
    const documentoId = (p.mutacao.dados as DadosUpload | null)?.documentoId;
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, this.db.documentos], async () => {
      await this.db.pendencias.delete(p.mutationId);
      if (!documentoId) return;
      await this.db.outbox
        .filter((m) => m.entidade === TIPO_UPLOAD_DOCUMENTO && (m.dados as DadosUpload | null)?.documentoId === documentoId)
        .delete();
      const doc = await this.db.documentos.get(documentoId);
      if (doc && !doc.enviado) await this.db.documentos.delete(documentoId);
    });
    void this.sync.sincronizar();
  }

  /** O adaptador da entidade da pendência; o upload não tem (só "Descartar" vale para ele). */
  private adaptador(p: Pendencia): Adaptador {
    const adaptador = adaptadorDe(p.entidade);
    if (!adaptador) throw new Error('Esta ação não vale para esta pendência.');
    return adaptador;
  }

  /**
   * Tira da fila e das pendências tudo do agregado. P4b-R14: os uploads de PDF que saem junto não têm mais como ser
   * enviados, então os documentos locais deles ainda não enviados são apagados; os já enviados ficam (cópia do servidor).
   * Precisa de `documentos` na transação.
   */
  private async limparAgregado(p: Pendencia): Promise<void> {
    const naFila = await this.db.outbox.where('agregadoId').equals(p.agregadoId).toArray();
    const pendentes = await this.db.pendencias.where('agregadoId').equals(p.agregadoId).toArray();
    const documentoIds = [...naFila, ...pendentes.map((x) => x.mutacao)]
      .filter((m) => m.entidade === TIPO_UPLOAD_DOCUMENTO)
      .map((m) => (m.dados as DadosUpload | null)?.documentoId)
      .filter((id): id is string => !!id);
    await this.db.pendencias.where('agregadoId').equals(p.agregadoId).delete();
    await this.db.outbox.where('agregadoId').equals(p.agregadoId).delete();
    if (documentoIds.length > 0) {
      await this.db.documentos.where('id').anyOf(documentoIds).filter((d) => !d.enviado).delete();
    }
  }

  /** Aplica o estado do servidor (null/deleted = apagar) e limpa o agregado, tudo numa transação. */
  private async aplicarEClear(p: Pendencia, id: string, m: Mudanca | null): Promise<void> {
    const adaptador = this.adaptador(p);
    const tabela = adaptador.tabela(this.db);
    await this.db.transaction('rw', [this.db.pendencias, this.db.outbox, this.db.documentos, tabela], async () => {
      await this.limparAgregado(p);
      if (!m || m.deleted) {
        await tabela.delete(id);
      } else {
        await tabela.put(adaptador.paraLocal(id, m.version, m.dados));
      }
    });
  }

  /** null = 404. Não escreve nada. */
  private async buscarNoServidor(p: Pendencia, id: string): Promise<Mudanca | null> {
    try {
      return await firstValueFrom(this.http.get<Mudanca>(`/api/sync/agregado/${p.entidade}/${id}`));
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 404) return null;
      throw e;
    }
  }
}
