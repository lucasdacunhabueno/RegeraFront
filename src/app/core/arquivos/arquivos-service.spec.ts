import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth-service';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { RegeraDb } from '../db/regera-db';
import { ArquivosService } from './arquivos-service';

describe('ArquivosService', () => {
  let svc: ArquivosService;
  let http: HttpTestingController;
  let db: RegeraDb;
  const online = signal(true);

  const autenticado = signal(true);

  beforeEach(() => {
    online.set(true);
    autenticado.set(true);
    let n = 0;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(() => `blob:fake${n++ || ''}`);
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConectividadeService, useValue: { online } },
        { provide: AuthService, useValue: { autenticado } },
      ],
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

  it('enviar recusa arquivo acima de 10 MB sem chamar a API', async () => {
    const grande = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' });
    await expect(svc.enviar(grande, 'grande.png')).rejects.toThrow('Arquivo maior que 10 MB.');
    http.expectNone('/api/arquivos');
  });

  it('enviar devolve o arquivo enviado mesmo se o cache local falhar', async () => {
    vi.spyOn(db.arquivos, 'put').mockRejectedValue(new Error('cota cheia'));
    const p = svc.enviar(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), 'foto.jpg');
    (await vi.waitFor(() => http.expectOne('/api/arquivos'))).flush({ id: 'a6', nome: 'foto.jpg', mime: 'image/jpeg', tamanho: 1, sha256: 'x' });
    expect((await p).id).toBe('a6');
  });

  it('obterUrl concorrente para o mesmo id faz um download e cria uma URL só', async () => {
    const p1 = svc.obterUrl('a7');
    const p2 = svc.obterUrl('a7');
    (await vi.waitFor(() => http.expectOne('/api/arquivos/a7'))).flush(new Blob([new Uint8Array([1])], { type: 'image/png' }));
    const [u1, u2] = await Promise.all([p1, p2]);
    expect(u1).toBe(u2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(await svc.obterUrl('a7')).toBe(u1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('limpar revoga as URLs criadas e esquece os ids', async () => {
    await db.arquivos.put({ id: 'a8', mime: 'image/png', bytes: new Uint8Array([9]).buffer });
    const url = await svc.obterUrl('a8');
    svc.limpar();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    await svc.obterUrl('a8');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('limpar é chamado quando o banco local é apagado', async () => {
    await db.arquivos.put({ id: 'a9', mime: 'image/png', bytes: new Uint8Array([9]).buffer });
    const url = await svc.obterUrl('a9');
    await db.limparTudo();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it('garantirCache baixa e grava sem criar URL; se já existe, não baixa', async () => {
    const p = svc.garantirCache('b1');
    (await vi.waitFor(() => http.expectOne('/api/arquivos/b1'))).flush(new Blob([new Uint8Array([1, 2])], { type: 'image/png' }));
    await p;
    expect((await db.arquivos.get('b1'))?.bytes.byteLength).toBe(2);
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    await svc.garantirCache('b1');
    http.expectNone('/api/arquivos/b1');
  });

  it('garantirCache é silencioso em erro e offline', async () => {
    const p = svc.garantirCache('b2');
    (await vi.waitFor(() => http.expectOne('/api/arquivos/b2'))).flush(null, { status: 500, statusText: 'x' });
    await expect(p).resolves.toBeUndefined();

    online.set(false);
    await expect(svc.garantirCache('b3')).resolves.toBeUndefined();
    http.expectNone('/api/arquivos/b3');
  });

  it('limpar() durante um garantirCache em voo não regrava os bytes depois', async () => {
    const p = svc.garantirCache('b4');
    const req = await vi.waitFor(() => http.expectOne('/api/arquivos/b4'));
    svc.limpar();
    req.flush(new Blob([new Uint8Array([1])], { type: 'image/png' }));
    await p;
    expect(await db.arquivos.get('b4')).toBeUndefined();
  });

  it('logout (limparTudo) durante um download em voo não deixa bytes da sessão anterior', async () => {
    const p = svc.obterUrl('b5');
    const req = await vi.waitFor(() => http.expectOne('/api/arquivos/b5'));
    await db.limparTudo();
    req.flush(new Blob([new Uint8Array([1])], { type: 'image/png' }));
    expect(await p).toBeNull();
    expect(await db.arquivos.get('b5')).toBeUndefined();
  });

  it('limpar() durante o upload não grava o cache local, mas devolve o resultado do servidor', async () => {
    const p = svc.enviar(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), 'foto.jpg');
    const req = await vi.waitFor(() => http.expectOne('/api/arquivos'));
    svc.limpar();
    req.flush({ id: 'c1', nome: 'foto.jpg', mime: 'image/jpeg', tamanho: 1, sha256: 'x' });
    expect((await p).id).toBe('c1');
    expect(await db.arquivos.get('c1')).toBeUndefined();
  });

  it('obterDataUrl monta o data URL base64 a partir do cache, sem ir ao servidor nem criar object URL', async () => {
    await db.arquivos.put({ id: 'd1', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]).buffer });
    expect(await svc.obterDataUrl('d1')).toBe('data:image/png;base64,iVBORw==');
    http.expectNone('/api/arquivos/d1');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('obterDataUrl baixa online e grava no cache; offline sem cache, sem sessão ou erro devolvem null', async () => {
    const p = svc.obterDataUrl('d2');
    (await vi.waitFor(() => http.expectOne('/api/arquivos/d2'))).flush(new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' }));
    expect(await p).toBe('data:image/jpeg;base64,/9j/');
    expect((await db.arquivos.get('d2'))?.bytes.byteLength).toBe(3);

    const p2 = svc.obterDataUrl('d3');
    (await vi.waitFor(() => http.expectOne('/api/arquivos/d3'))).flush(null, { status: 404, statusText: 'x' });
    expect(await p2).toBeNull();

    online.set(false);
    expect(await svc.obterDataUrl('d4')).toBeNull();
    online.set(true);
    autenticado.set(false);
    expect(await svc.obterDataUrl('d5')).toBeNull();
    http.expectNone('/api/arquivos/d4');
    http.expectNone('/api/arquivos/d5');
  });

  it('obterDataUrl com bytes grandes (acima do limite de argumentos) não quebra', async () => {
    const bytes = new Uint8Array(300_000).fill(65);
    await db.arquivos.put({ id: 'd6', mime: 'image/png', bytes: bytes.buffer });
    const url = await svc.obterDataUrl('d6');
    expect(url?.startsWith('data:image/png;base64,QUFB')).toBe(true);
    expect(url!.length).toBe('data:image/png;base64,'.length + 400_000);
  });

  it('limpar() durante um obterDataUrl em voo devolve null e não grava os bytes', async () => {
    const p = svc.obterDataUrl('d7');
    const req = await vi.waitFor(() => http.expectOne('/api/arquivos/d7'));
    svc.limpar();
    req.flush(new Blob([new Uint8Array([1])], { type: 'image/png' }));
    expect(await p).toBeNull();
    expect(await db.arquivos.get('d7')).toBeUndefined();
  });

  it('limpar() depois da leitura do cache e antes do fim devolve null (bytes da sessão anterior)', async () => {
    await db.arquivos.put({ id: 'd8', mime: 'image/png', bytes: new Uint8Array([1]).buffer });
    const p = svc.obterDataUrl('d8');
    svc.limpar();
    expect(await p).toBeNull();
  });

  it('sem sessão não baixa nada', async () => {
    autenticado.set(false);
    await svc.garantirCache('b6');
    expect(await svc.obterUrl('b7')).toBeNull();
    http.expectNone('/api/arquivos/b6');
    http.expectNone('/api/arquivos/b7');
  });

  describe('baixarSemCache (PDF da proposta: no-store, P4b-R6)', () => {
    it('baixa pelo mesmo GET autenticado e devolve o Blob, sem gravar no Dexie nem criar URL', async () => {
      const p = svc.baixarSemCache('pdf-1');
      const req = await vi.waitFor(() => http.expectOne('/api/arquivos/pdf-1'));
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
      const blob = await p;
      expect(await blob.text()).toBe('%PDF-1.7');
      expect(await db.arquivos.count()).toBe(0);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('nunca usa o cache: mesmo com os bytes lá, vai ao servidor', async () => {
      await db.arquivos.put({ id: 'pdf-2', mime: 'application/pdf', bytes: new Uint8Array([1]).buffer });
      const p = svc.baixarSemCache('pdf-2');
      (await vi.waitFor(() => http.expectOne('/api/arquivos/pdf-2'))).flush(new Blob(['novo']));
      expect(await (await p).text()).toBe('novo');
    });

    it('offline ou sem sessão falha sem pedir nada; erro do servidor propaga', async () => {
      online.set(false);
      await expect(svc.baixarSemCache('pdf-3')).rejects.toThrow('Sem internet');
      online.set(true);
      autenticado.set(false);
      await expect(svc.baixarSemCache('pdf-3')).rejects.toThrow();
      http.expectNone('/api/arquivos/pdf-3');
      autenticado.set(true);
      const p = svc.baixarSemCache('pdf-4');
      const erro = p.then(() => null, (e: unknown) => e);
      (await vi.waitFor(() => http.expectOne('/api/arquivos/pdf-4'))).flush(null, { status: 404, statusText: 'x' });
      expect(await erro).toBeTruthy();
      expect(await db.arquivos.count()).toBe(0);
    });
  });
});
