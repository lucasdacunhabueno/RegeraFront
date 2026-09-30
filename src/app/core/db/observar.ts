import { liveQuery } from 'dexie';
import { Observable } from 'rxjs';

/** Consulta ao Dexie que reemite sempre que as tabelas lidas mudam. */
export function observar<T>(consulta: () => Promise<T>): Observable<T> {
  return new Observable<T>((assinante) => {
    const s = liveQuery(consulta).subscribe({
      next: (v) => assinante.next(v),
      error: (e) => assinante.error(e),
    });
    return () => s.unsubscribe();
  });
}
