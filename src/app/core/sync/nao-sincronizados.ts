import { Observable } from 'rxjs';
import { observar } from '../db/observar';
import type { RegeraDb } from '../db/regera-db';

/** Ids de agregados com mutação na outbox ou pendência — os que o usuário vê como "Não sincronizado". */
export function observarNaoSincronizados(db: RegeraDb): Observable<Set<string>> {
  return observar(async () => {
    const ids = [
      ...(await db.outbox.toArray()).map((m) => m.agregadoId),
      ...(await db.pendencias.toArray()).map((p) => p.agregadoId),
    ];
    return new Set(ids);
  });
}
