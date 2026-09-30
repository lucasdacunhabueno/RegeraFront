import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { RegeraDb } from '../db/regera-db';
import { RespostaSessao, UsuarioSessao } from './auth-models';
import { AuthService } from './auth-service';

const ANA: UsuarioSessao = { id: 'u1', nome: 'Ana', email: 'ana@regera.test', perfil: 'COMERCIAL', ativo: true };
const RESPOSTA: RespostaSessao = { accessToken: 'tok-1', expiresIn: 900, usuario: ANA };

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let db: RegeraDb;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    db = TestBed.inject(RegeraDb);
  });

  afterEach(async () => {
    http.verify();
    await db.limparTudo();
    vi.unstubAllGlobals();
  });

  it('login guarda token em memória e sessão no banco local', async () => {
    const p = auth.login('ana@regera.test', 'x');
    http.expectOne('/api/auth/login').flush(RESPOSTA);
    await p;

    expect(auth.token()).toBe('tok-1');
    expect(auth.usuario()?.nome).toBe('Ana');
    expect(await db.lerMeta('sessao')).toEqual(ANA);
  });

  it('login de outro usuário apaga os dados locais do anterior', async () => {
    await db.gravarMeta('sessao', { ...ANA, id: 'outro' });
    await db.gravarMeta('cursor', 99);

    const p = auth.login('ana@regera.test', 'x');
    http.expectOne('/api/auth/login').flush(RESPOSTA);
    await p;

    expect(await db.lerMeta('cursor')).toBeUndefined();
  });

  it('iniciar sem internet mantém a sessão local', async () => {
    await db.gravarMeta('sessao', ANA);

    await auth.iniciar();
    http.expectOne('/api/auth/refresh').error(new ProgressEvent('error'), { status: 0 });
    const ok = await auth.renovar();

    expect(ok).toBe(false);
    expect(auth.usuario()?.id).toBe('u1');
    expect(auth.sessaoExpirada()).toBe(false);
  });

  it('refresh recusado marca sessão expirada mas preserva usuário local', async () => {
    await db.gravarMeta('sessao', ANA);

    await auth.iniciar();
    http.expectOne('/api/auth/refresh').flush({ codigo: 'SESSAO_INVALIDA' }, { status: 401, statusText: 'x' });
    await auth.renovar();

    expect(auth.sessaoExpirada()).toBe(true);
    expect(auth.usuario()?.id).toBe('u1');
    expect(auth.token()).toBeNull();
  });

  it('renovações simultâneas fazem uma única requisição', async () => {
    const p1 = auth.renovar();
    const p2 = auth.renovar();
    http.expectOne('/api/auth/refresh').flush(RESPOSTA);

    expect(await p1).toBe(true);
    expect(await p2).toBe(true);
  });

  it('usa navigator.locks para serializar renovação entre abas', async () => {
    const request = vi.fn((_nome: string, fn: () => Promise<boolean>) => fn());
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });

    const p = auth.renovar();
    http.expectOne('/api/auth/refresh').flush(RESPOSTA);
    await p;

    expect(request).toHaveBeenCalledWith('regera-refresh', expect.any(Function));
  });

  it('logout sem internet limpa sessão e banco local', async () => {
    await db.gravarMeta('sessao', ANA);
    await auth.iniciar();
    http.expectOne('/api/auth/refresh').flush(RESPOSTA);
    await auth.renovar();

    const p = auth.logout();
    http.expectOne('/api/auth/logout').error(new ProgressEvent('error'), { status: 0 });
    await p;

    expect(auth.usuario()).toBeNull();
    expect(auth.token()).toBeNull();
    expect(await db.meta.count()).toBe(0);
  });
});
