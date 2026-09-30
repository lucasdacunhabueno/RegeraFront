import { Observable } from 'rxjs';
import { observar } from '../db/observar';
import type { RegeraDb } from '../db/regera-db';

/**
 * Ids de agregados com mutação na outbox ou pendência — os que o usuário vê como "Não sincronizado".
 * O conjunto sai em ordem do mais antigo ao mais recente: pendências por `criadaEm`, depois a outbox por `seq`
 * (a outbox só guarda o que ainda não teve resposta). Um id repetido fica na posição da ocorrência mais recente.
 */
export async function lerNaoSincronizados(db: RegeraDb): Promise<Set<string>> {
  const pendencias = (await db.pendencias.toArray()).sort((a, b) => (a.criadaEm < b.criadaEm ? -1 : a.criadaEm > b.criadaEm ? 1 : 0));
  const ids = [...pendencias.map((p) => p.agregadoId), ...(await db.outbox.toArray()).map((m) => m.agregadoId)];
  const conjunto = new Set<string>();
  for (const id of ids) {
    conjunto.delete(id);
    conjunto.add(id);
  }
  return conjunto;
}

export function observarNaoSincronizados(db: RegeraDb): Observable<Set<string>> {
  return observar(() => lerNaoSincronizados(db));
}
