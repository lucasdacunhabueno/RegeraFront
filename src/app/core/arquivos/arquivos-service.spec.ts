import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { RegeraDb } from '../db/regera-db';
import { ArquivosService } from './arquivos-service';

describe('ArquivosService', () => {
  let svc: ArquivosService;
  let http: HttpTestingController;
  let db: RegeraDb;
  const online = signal(true);

  beforeEach(() => {
    online.set(true);
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(() => 'blob:fake');
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ConectividadeService, useValue: { online } }],
    });
    svc = TestBed.inject(ArquivosService);
    http = TestBed.inject(HttpTestingController);
    db = TestBed.inject(RegeraDb);
  });

  afterEach(async () => {
    http.verify();
    await db.limparTudo();
  });

  it('envia multipart no campo "arquivo" e guarda os bytes em cache', async () => {
    const p = svc.enviar(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'foto.jpg');
    const req = await vi.waitFor(() => http.expectOne('/api/arquivos'));
    expect(req.request.method).toBe('POST');
    const corpo = req.request.body as FormData;
    expect(corpo.get('arquivo')).toBeInstanceOf(Blob);
    req.flush({ id: 'a1', nome: 'foto.jpg', mime: 'image/jpeg', tamanho: 3, sha256: 'x' });

    expect((await p).id).toBe('a1');
    const cache = await db.arquivos.get('a1');
    expect(cache?.mime).toBe('image/jpeg');
    expect(cache?.bytes.byteLength).toBe(3);
  });

  it('enviar sem internet falha sem chamar a API', async () => {
    online.set(false);
    await expect(svc.enviar(new Blob(['x']), 'x.jpg')).rejects.toThrow('Sem internet');
    http.expectNone('/api/arquivos');
  });

  it('obterUrl usa o cache local sem ir ao servidor', async () => {
    await db.arquivos.put({ id: 'a2', mime: 'image/png', bytes: new Uint8Array([9]).buffer });
    expect(await svc.obterUrl('a2')).toBe('blob:fake');
    http.expectNone('/api/arquivos/a2');
  });

  it('obterUrl busca, guarda e reaproveita; erro devolve null', async () => {
    const p = svc.obterUrl('a3');
    (await vi.waitFor(() => http.expectOne('/api/arquivos/a3'))).flush(new Blob([new Uint8Array([7, 7])], { type: 'image/png' }));
    expect(await p).toBe('blob:fake');
    expect((await db.arquivos.get('a3'))?.bytes.byteLength).toBe(2);

    const p2 = svc.obterUrl('a4');
    (await vi.waitFor(() => http.expectOne('/api/arquivos/a4'))).flush(null, { status: 404, statusText: 'x' });
    expect(await p2).toBeNull();
  });

  it('offline e sem cache devolve null', async () => {
    online.set(false);
    expect(await svc.obterUrl('a5')).toBeNull();
    http.expectNone('/api/arquivos/a5');
  });
});
