import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { RegeraDb } from '../db/regera-db';
import { RespostaSessao, UsuarioSessao } from './auth-models';
import { AuthService, ESPERA_REPETIR_RENOVACAO } from './auth-service';

const ANA: UsuarioSessao = { id: 'u1', nome: 'Ana', email: 'ana@regera.test', perfil: 'COMERCIAL', ativo: true };
const RESPOSTA: RespostaSessao = { accessToken: 'tok-1', expiresIn: 900, usuario: ANA };

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let db: RegeraDb;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ESPERA_REPETIR_RENOVACAO, useValue: 0 }],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    db = TestBed.inject(RegeraDb);
  });

  /** A segunda tentativa sai depois da espera (0 nos testes). */
  const proximoRefresh = () => vi.waitFor(() => http.expectOne('/api/auth/refresh'));

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

  it('refresh recusado duas vezes marca sessão expirada mas preserva usuário local', async () => {
    await db.gravarMeta('sessao', ANA);

    await auth.iniciar();
    http.expectOne('/api/auth/refresh').flush({ codigo: 'SESSAO_INVALIDA' }, { status: 401, statusText: 'x' });
    (await proximoRefresh()).flush({ codigo: 'SESSAO_INVALIDA' }, { status: 401, statusText: 'x' });
    expect(await auth.renovar()).toBe(false);

    expect(auth.sessaoExpirada()).toBe(true);
    expect(auth.usuario()?.id).toBe('u1');
    expect(auth.token()).toBeNull();
  });

  it('refresh recusado porque outra página girou o cookie: tenta de novo uma vez e a sessão continua', async () => {
    // a página recarregada no meio de uma renovação: a antiga (pelo service worker) gira o cookie, e a nova, que
    // mandou o cookie velho ao mesmo tempo, recebe o 401 da tolerância do servidor; o cookie novo já está no navegador
    const request = vi.fn((_nome: string, fn: () => Promise<boolean>) => fn());
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });
    await db.gravarMeta('sessao', ANA);

    await auth.iniciar();
    http.expectOne('/api/auth/refresh').flush({ codigo: 'SESSAO_INVALIDA' }, { status: 401, statusText: 'x' });
    const segunda = await proximoRefresh();
    // durante a espera e a segunda tentativa, nada de "Sua sessão expirou" (nem piscando)
    expect(auth.sessaoExpirada()).toBe(false);
    segunda.flush(RESPOSTA);

    expect(await auth.renovar()).toBe(true);
    expect(auth.sessaoExpirada()).toBe(false);
    expect(auth.token()).toBe('tok-1');
    // as duas tentativas e a espera ficam dentro da mesma trava: nenhuma outra aba gira o cookie no meio
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('a segunda tentativa sai 1 s depois do 401, não antes (espera padrão)', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    db = TestBed.inject(RegeraDb);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const p = auth.renovar();
      http.expectOne('/api/auth/refresh').flush({ codigo: 'SESSAO_INVALIDA' }, { status: 401, statusText: 'x' });
      await vi.advanceTimersByTimeAsync(999);
      expect(http.match('/api/auth/refresh')).toHaveLength(0);
      expect(auth.sessaoExpirada()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const segunda = http.match('/api/auth/refresh');
      expect(segunda).toHaveLength(1);
      vi.useRealTimers();
      segunda[0].flush(RESPOSTA);
      expect(await p).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('erro de rede no refresh não repete', async () => {
    const p = auth.renovar();
    http.expectOne('/api/auth/refresh').error(new ProgressEvent('error'), { status: 0 });
    expect(await p).toBe(false);
    // http.verify (afterEach) confere que não houve segunda tentativa
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
