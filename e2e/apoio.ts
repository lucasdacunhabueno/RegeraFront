import { expect, Page } from '@playwright/test';

/**
 * Espera a sincronização que o app dispara ao abrir terminar (o `ultimoSync` do Dexie `regera` é gravado depois do
 * carregamento desta página). Com o banco local grande, o pull inicial leva várias páginas; se o teste ficar offline e
 * salvar algo no meio dele, o `sincronizar()` de ao voltar a internet só reaproveita a rodada em curso (que já passou
 * do push) e a mutação nova espera o próximo ciclo de 60 s.
 */
export async function aguardarSincronizacaoInicial(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const abertura = indexedDB.open('regera');
              abertura.onerror = () => resolve(false);
              abertura.onsuccess = () => {
                const db = abertura.result;
                if (!db.objectStoreNames.contains('meta')) {
                  db.close();
                  resolve(false);
                  return;
                }
                const leitura = db.transaction('meta').objectStore('meta').get('ultimoSync');
                leitura.onsuccess = () => {
                  db.close();
                  const valor = (leitura.result as { valor?: unknown } | undefined)?.valor;
                  resolve(typeof valor === 'string' && valor >= new Date(performance.timeOrigin).toISOString());
                };
                leitura.onerror = () => {
                  db.close();
                  resolve(false);
                };
              };
            }),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}
