import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';
import { RegeraDb } from '../db/regera-db';
import { authInterceptor } from './auth-interceptor';
import { AuthService, ESPERA_REPETIR_RENOVACAO } from './auth-service';

const USUARIO = { id: 'u1', nome: 'Ana', email: 'ana@regera.test', perfil: 'COMERCIAL' as const, ativo: true };

describe('authInterceptor', () => {
  let http: HttpClient;
  let mock: HttpTestingController;
  let auth: AuthService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: ESPERA_REPETIR_RENOVACAO, useValue: 0 },
      ],
    });
    http = TestBed.inject(HttpClient);
    mock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    const p = auth.login('ana@regera.test', 'x');
    mock.expectOne('/api/auth/login').flush({ accessToken: 'tok-1', expiresIn: 900, usuario: USUARIO });
    await p;
  });

  afterEach(async () => {
    mock.verify();
    await TestBed.inject(RegeraDb).limparTudo();
  });

  it('adiciona Bearer nas chamadas da API', async () => {
    const p = firstValueFrom(http.get('/api/usuarios'));
    const req = mock.expectOne('/api/usuarios');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-1');
    req.flush([]);
    await p;
  });

  it('não adiciona Bearer nas rotas de autenticação', async () => {
    const p = firstValueFrom(http.post('/api/auth/logout', {}));
    const req = mock.expectOne('/api/auth/logout');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(null);
    await p;
  });

  it('em 401 renova o token e repete a chamada uma vez', async () => {
    const p = firstValueFrom(http.get<string[]>('/api/usuarios'));
    mock.expectOne('/api/usuarios').flush(null, { status: 401, statusText: 'x' });
    mock.expectOne('/api/auth/refresh').flush({ accessToken: 'tok-2', expiresIn: 900, usuario: USUARIO });

    const repetida = await vi.waitFor(() =>
      mock.expectOne((r) => r.url === '/api/usuarios' && r.headers.get('Authorization') === 'Bearer tok-2'),
    );
    repetida.flush(['ok']);

    expect(await p).toEqual(['ok']);
  });

  it('se a renovação falha, propaga o 401', async () => {
    const p = firstValueFrom(http.get('/api/usuarios'));
    mock.expectOne('/api/usuarios').flush(null, { status: 401, statusText: 'x' });
    // a renovação recusada é repetida uma vez (a tolerância da rotação, ESPERA_REPETIR_RENOVACAO) antes de desistir
    mock.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'x' });
    (await vi.waitFor(() => mock.expectOne('/api/auth/refresh'))).flush(null, { status: 401, statusText: 'x' });

    await expect(p).rejects.toMatchObject({ status: 401 });
  });
});
