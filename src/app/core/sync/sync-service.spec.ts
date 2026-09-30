import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ItemCatalogoDados, paraItemLocal } from '../../features/catalogo/item-models';
import { ClienteDados, paraClienteLocal } from '../../features/clientes/cliente-models';
import { ID_EMPRESA, paraEmpresaLocal } from '../../features/empresa/empresa-models';
import { Toasts } from '../../shared/ui/toasts';
import { ArquivosService } from '../arquivos/arquivos-service';
import { AuthService } from '../auth/auth-service';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { RegeraDb } from '../db/regera-db';
import { SyncService } from './sync-service';

const dados = (nome: string): ClienteDados => ({
  tipo: 'PF', documento: '52998224725', nome, nomeFantasia: null, inscricaoEstadual: null,
  inscricaoMunicipal: null, email: null, telefone: null, whatsapp: null, contatoNome: null,
  observacoes: null, enderecos: [],
});
const item = (codigo: string): ItemCatalogoDados => ({
  natureza: 'PRODUTO', codigo, nome: codigo, descricao: null, unidade: 'un', precoVenda: 1,
  locavel: false, fotoArquivoId: null, ativo: true,
});

describe('SyncService', () => {
  let sync: SyncService;
  let db: RegeraDb;
  let http: HttpTestingController;
  const online = signal(true);
  let perfil = 'ADMIN';
  let autenticado = true;

  beforeEach(() => {
    online.set(true);
    perfil = 'ADMIN';
    autenticado = true;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { autenticado: () => autenticado, sessaoExpirada: () => false, usuario: () => ({ id: 'u1', perfil }) } },
        { provide: ConectividadeService, useValue: { online } },
      ],
    });
    sync = TestBed.inject(SyncService);
    db = TestBed.inject(RegeraDb);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(async () => {
    http.verify();
    await db.limparTudo();
  });

  const pullVazio = (cursor = 0) =>
    vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull' && r.params.get('cursor') === String(cursor)))
      .then((req) => req.flush({ cursor, temMais: false, mudancas: [], usuarios: [] }));

  it('coalesce edições do mesmo agregado mantendo a baseVersion da primeira', async () => {
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('A'), 3);
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('B'), 7);

    const fila = await db.outbox.toArray();
    expect(fila).toHaveLength(1);
    expect(fila[0].baseVersion).toBe(3);
    expect((fila[0].dados as ClienteDados).nome).toBe('B');
  });

  it('excluir registro que nunca foi ao servidor apaga a mutação', async () => {
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('A'), null);
    await sync.registrar('cliente', 'c1', 'DELETE', null, null);
    expect(await db.outbox.count()).toBe(0);
  });

  it('envia a outbox, aplica OK no local e faz pull gravando o cursor', async () => {
    await db.clientes.put(paraClienteLocal('c1', null, dados('A')));
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('A'), null);

    const p = sync.sincronizar();
    const push = await vi.waitFor(() => http.expectOne('/api/sync/push'));
    const mut = push.request.body.mutacoes[0];
    expect(mut).toMatchObject({ entidade: 'cliente', id: 'c1', op: 'UPSERT', baseVersion: null });
    push.flush({ resultados: [{ mutationId: mut.mutationId, status: 'OK', version: 0, dados: dados('A servidor') }] });

    const pull = await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull'));
    pull.flush({ cursor: 42, temMais: false, mudancas: [], usuarios: [{ id: 'u1', nome: 'Ana', perfil: 'ADMIN' }] });
    await p;

    expect(await db.outbox.count()).toBe(0);
    const local = await db.clientes.get('c1');
    expect(local?.version).toBe(0);
    expect(local?.nome).toBe('A servidor');
    expect(await db.lerMeta('cursor')).toBe(42);
    expect(await db.usuarios.count()).toBe(1);
    expect(sync.ultimoSync()).not.toBeNull();
  });

  it('edição feita durante o envio não se perde e herda a nova versão', async () => {
    await db.clientes.put(paraClienteLocal('c1', null, dados('A')));
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('A'), null);

    const p = sync.sincronizar();
    const push = await vi.waitFor(() => http.expectOne('/api/sync/push'));
    await db.clientes.put(paraClienteLocal('c1', null, dados('B')));
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('B'), null);
    const mut = push.request.body.mutacoes[0];
    push.flush({ resultados: [{ mutationId: mut.mutationId, status: 'OK', version: 0, dados: dados('A') }] });

    const push2 = await vi.waitFor(() => http.expectOne('/api/sync/push'));
    expect(push2.request.body.mutacoes[0]).toMatchObject({ baseVersion: 0, dados: { nome: 'B' } });
    push2.flush({ resultados: [{ mutationId: push2.request.body.mutacoes[0].mutationId, status: 'OK', version: 1, dados: dados('B') }] });
    await pullVazio();
    await p;

    expect((await db.clientes.get('c1'))?.nome).toBe('B');
    expect((await db.clientes.get('c1'))?.version).toBe(1);
  });

  it('CONFLITO vira pendência e segura as mutações seguintes do agregado', async () => {
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('A'), 0);

    const p = sync.sincronizar();
    const push = await vi.waitFor(() => http.expectOne('/api/sync/push'));
    const mut = push.request.body.mutacoes[0];
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('B'), 0);
    push.flush({ resultados: [{ mutationId: mut.mutationId, status: 'CONFLITO', dadosServidor: dados('Servidor'), versionServidor: 2 }] });
    await pullVazio();
    await p;

    const pend = await db.pendencias.toArray();
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({ tipo: 'CONFLITO', agregadoId: 'c1', versionServidor: 2 });
    expect(await db.outbox.count()).toBe(1);
    await vi.waitFor(() => expect(sync.problemas()).toBe(1));

    const p2 = sync.sincronizar();
    await pullVazio();
    await p2;
    http.expectNone('/api/sync/push');
  });

  it('pull não sobrescreve registro com mutação pendente e aplica tombstone nos demais', async () => {
    await db.clientes.put(paraClienteLocal('c1', 0, dados('Minha edição')));
    await db.clientes.put(paraClienteLocal('c2', 0, dados('Vai sumir')));
    await db.pendencias.put({
      mutationId: 'm1', entidade: 'cliente', agregadoId: 'c1', tipo: 'REJEITADO',
      mutacao: { mutationId: 'm1', entidade: 'cliente', agregadoId: 'c1', op: 'UPSERT', baseVersion: 0, dados: null, criadaEm: '' },
      criadaEm: '',
    });

    const p = sync.sincronizar();
    const pull = await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull'));
    pull.flush({
      cursor: 10, temMais: false, usuarios: [],
      mudancas: [
        { entidade: 'cliente', id: 'c1', version: 5, deleted: false, dados: dados('Do servidor') },
        { entidade: 'cliente', id: 'c2', version: 1, deleted: true, dados: null },
        { entidade: 'cliente', id: 'c3', version: 0, deleted: false, dados: dados('Novo') },
      ],
    });
    await p;

    expect((await db.clientes.get('c1'))?.nome).toBe('Minha edição');
    expect(await db.clientes.get('c2')).toBeUndefined();
    expect((await db.clientes.get('c3'))?.nome).toBe('Novo');
  });

  it('pull pagina enquanto temMais', async () => {
    const p = sync.sincronizar();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull' && r.params.get('cursor') === '0')))
      .flush({ cursor: 5, temMais: true, mudancas: [], usuarios: [] });
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull' && r.params.get('cursor') === '5')))
      .flush({ cursor: 9, temMais: false, mudancas: [], usuarios: [] });
    await p;
    expect(await db.lerMeta('cursor')).toBe(9);
  });

  it('queda de rede no push mantém a outbox e reenvia o mesmo mutationId', async () => {
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('A'), null);

    const p = sync.sincronizar();
    const push = await vi.waitFor(() => http.expectOne('/api/sync/push'));
    const idOriginal = push.request.body.mutacoes[0].mutationId;
    push.error(new ProgressEvent('error'), { status: 0 });
    await p;
    expect(await db.outbox.count()).toBe(1);

    const p2 = sync.sincronizar();
    const reenvio = await vi.waitFor(() => http.expectOne('/api/sync/push'));
    expect(reenvio.request.body.mutacoes[0].mutationId).toBe(idOriginal);
    reenvio.flush({ resultados: [{ mutationId: idOriginal, status: 'OK', version: 0, dados: dados('A') }] });
    await pullVazio();
    await p2;
    expect(await db.outbox.count()).toBe(0);
  });

  it('erro transitório do servidor (ERRO_INTERNO) mantém a outbox, não cria pendência e reenvia o mesmo mutationId', async () => {
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('A'), null);

    const p = sync.sincronizar();
    const push = await vi.waitFor(() => http.expectOne('/api/sync/push'));
    const idOriginal = push.request.body.mutacoes[0].mutationId;
    push.flush({
      resultados: [{ mutationId: idOriginal, status: 'REJEITADO', erro: { codigo: 'ERRO_INTERNO', mensagem: 'falha' } }],
    });
    // sem novo push na mesma rodada: segue direto para o pull
    await pullVazio();
    await p;
    http.expectNone('/api/sync/push');

    expect(await db.outbox.count()).toBe(1);
    expect((await db.outbox.toArray())[0].enviando).toBe(false);
    expect(await db.pendencias.count()).toBe(0);

    const p2 = sync.sincronizar();
    const reenvio = await vi.waitFor(() => http.expectOne('/api/sync/push'));
    expect(reenvio.request.body.mutacoes[0].mutationId).toBe(idOriginal);
    reenvio.flush({ resultados: [{ mutationId: idOriginal, status: 'OK', version: 0, dados: dados('A') }] });
    await pullVazio();
    await p2;
    expect(await db.outbox.count()).toBe(0);
  });

  it('guarda: mutação alterada durante o envio não é apagada nem sobrescreve o local', async () => {
    await db.clientes.put(paraClienteLocal('c1', null, dados('Local')));
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('A'), null);
    const seq = (await db.outbox.toArray())[0].seq!;

    const p = sync.sincronizar();
    const push = await vi.waitFor(() => http.expectOne('/api/sync/push'));
    const mut = push.request.body.mutacoes[0];
    await db.outbox.update(seq, { mutationId: 'outro', dados: dados('Nova'), enviando: false });
    push.flush({ resultados: [{ mutationId: mut.mutationId, status: 'OK', version: 0, dados: dados('Servidor') }] });
    // a mutação alterada segue elegível e é enviada na rodada seguinte
    const push2 = await vi.waitFor(() => http.expectOne('/api/sync/push'));
    expect(push2.request.body.mutacoes[0]).toMatchObject({ mutationId: 'outro', baseVersion: 0, dados: { nome: 'Nova' } });
    push2.error(new ProgressEvent('error'), { status: 0 });
    await p;

    const fila = await db.outbox.toArray();
    expect(fila).toHaveLength(1);
    expect((fila[0].dados as ClienteDados).nome).toBe('Nova');
    expect((await db.clientes.get('c1'))?.nome).toBe('Local');
  });

  it('pull não sobrescreve registro cuja mutação entrou na outbox durante o pull', async () => {
    await db.clientes.put(paraClienteLocal('c1', 0, dados('Local')));
    const p = sync.sincronizar();
    const pull = await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull'));
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('Editado'), 0);
    pull.flush({
      cursor: 3, temMais: false, usuarios: [],
      mudancas: [{ entidade: 'cliente', id: 'c1', version: 5, deleted: false, dados: dados('Do servidor') }],
    });
    await p;
    expect((await db.clientes.get('c1'))?.nome).toBe('Local');
    expect(await db.outbox.count()).toBe(1);
  });

  it('cursor de outro usuário recomeça do zero e limpa clientes e usuários, sem tocar a outbox', async () => {
    await db.gravarMeta('cursor', 50);
    await db.gravarMeta('cursorDono', 'outro');
    await db.clientes.put(paraClienteLocal('velho', 1, dados('Velho')));
    await db.usuarios.put({ id: 'x', nome: 'X', perfil: 'ADMIN' } as never);
    const mut = { mutationId: 'mm', entidade: 'cliente' as const, agregadoId: 'o1', op: 'UPSERT' as const, baseVersion: null, dados: dados('O'), criadaEm: '' };
    await db.outbox.add(mut);
    await db.pendencias.put({ mutationId: 'mm', entidade: 'cliente', agregadoId: 'o1', tipo: 'REJEITADO', mutacao: mut, criadaEm: '' });

    const promessa = sync.sincronizar();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull' && r.params.get('cursor') === '0')))
      .flush({ cursor: 7, temMais: false, mudancas: [], usuarios: [] });
    await promessa;

    expect(await db.clientes.get('velho')).toBeUndefined();
    expect(await db.usuarios.count()).toBe(0);
    expect(await db.outbox.count()).toBe(1);
    expect(await db.pendencias.count()).toBe(1);
    expect(await db.lerMeta('cursor')).toBe(7);
    expect(await db.lerMeta('cursorDono')).toBe('u1:ADMIN');
  });

  it('cursor do mesmo usuário e perfil continua de onde parou', async () => {
    await db.gravarMeta('cursor', 50);
    await db.gravarMeta('cursorDono', 'u1:ADMIN');
    const promessa = sync.sincronizar();
    await pullVazio(50);
    await promessa;
  });

  it('mesmo usuário com outro perfil recomeça do zero e limpa itens e empresa antes do pull', async () => {
    await db.gravarMeta('cursor', 50);
    await db.gravarMeta('cursorDono', 'u1:ADMIN');
    await db.itens.put(paraItemLocal('i1', 1, item('PNL')));
    await db.empresa.put(paraEmpresaLocal(ID_EMPRESA, 1, { razaoSocial: 'Velha' }));
    const limpar = vi.spyOn(TestBed.inject(ArquivosService), 'limpar');
    perfil = 'COMERCIAL';

    const promessa = sync.sincronizar();
    const pull = await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull' && r.params.get('cursor') === '0'));
    expect(await db.itens.count()).toBe(0);
    expect(await db.empresa.count()).toBe(0);
    expect(limpar).toHaveBeenCalled();
    pull.flush({ cursor: 8, temMais: false, mudancas: [], usuarios: [] });
    await promessa;
    expect(await db.lerMeta('cursorDono')).toBe('u1:COMERCIAL');
  });

  it('cursorDono no formato antigo (só o id) força um pull completo', async () => {
    await db.gravarMeta('cursor', 50);
    await db.gravarMeta('cursorDono', 'u1');
    await db.itens.put(paraItemLocal('i1', 1, item('PNL')));
    const promessa = sync.sincronizar();
    await pullVazio(0);
    await promessa;
    expect(await db.itens.count()).toBe(0);
    expect(await db.lerMeta('cursorDono')).toBe('u1:ADMIN');
  });

  it('pull com mudanças garante em cache o logo da empresa e as fotos dos itens ativos, sem esperar', async () => {
    const garantir = vi.spyOn(TestBed.inject(ArquivosService), 'garantirCache').mockReturnValue(new Promise<void>(() => undefined));
    const promessa = sync.sincronizar();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull'))).flush({
      cursor: 4, temMais: false, usuarios: [],
      mudancas: [
        { entidade: 'empresa', id: ID_EMPRESA, version: 1, deleted: false, dados: { razaoSocial: 'Regera', logoArquivoId: 'logo-1' } },
        { entidade: 'item_catalogo', id: 'i1', version: 0, deleted: false, dados: { ...item('A'), fotoArquivoId: 'foto-a' } },
        { entidade: 'item_catalogo', id: 'i2', version: 0, deleted: false, dados: { ...item('B'), fotoArquivoId: 'foto-b', ativo: false } },
      ],
    });
    await promessa; // não fica preso esperando os downloads
    await vi.waitFor(() => expect(garantir).toHaveBeenCalledWith('logo-1'));
    await vi.waitFor(() => expect(garantir).toHaveBeenCalledWith('foto-a'));
    expect(garantir).not.toHaveBeenCalledWith('foto-b');
  });

  it('prefetch para de pedir arquivos depois do logout', async () => {
    const resolvers: (() => void)[] = [];
    const garantir = vi.spyOn(TestBed.inject(ArquivosService), 'garantirCache')
      .mockImplementation(() => new Promise<void>((r) => resolvers.push(r)));
    const promessa = sync.sincronizar();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull'))).flush({
      cursor: 4, temMais: false, usuarios: [],
      mudancas: [
        { entidade: 'empresa', id: ID_EMPRESA, version: 1, deleted: false, dados: { razaoSocial: 'Regera', logoArquivoId: 'logo-1' } },
        { entidade: 'item_catalogo', id: 'i1', version: 0, deleted: false, dados: { ...item('A'), fotoArquivoId: 'foto-a' } },
        { entidade: 'item_catalogo', id: 'i3', version: 0, deleted: false, dados: { ...item('C'), fotoArquivoId: 'foto-c' } },
      ],
    });
    await promessa;
    await vi.waitFor(() => expect(garantir).toHaveBeenCalledTimes(2));
    autenticado = false;
    resolvers.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 20));
    expect(garantir).toHaveBeenCalledTimes(2);
    expect(garantir).not.toHaveBeenCalledWith('foto-c');
  });

  it('prefetch para quando o cache de arquivos é limpo (troca de sessão)', async () => {
    const arquivos = TestBed.inject(ArquivosService);
    const resolvers: (() => void)[] = [];
    const garantir = vi.spyOn(arquivos, 'garantirCache').mockImplementation(() => new Promise<void>((r) => resolvers.push(r)));
    const promessa = sync.sincronizar();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull'))).flush({
      cursor: 4, temMais: false, usuarios: [],
      mudancas: [
        { entidade: 'empresa', id: ID_EMPRESA, version: 1, deleted: false, dados: { razaoSocial: 'Regera', logoArquivoId: 'logo-1' } },
        { entidade: 'item_catalogo', id: 'i1', version: 0, deleted: false, dados: { ...item('A'), fotoArquivoId: 'foto-a' } },
        { entidade: 'item_catalogo', id: 'i3', version: 0, deleted: false, dados: { ...item('C'), fotoArquivoId: 'foto-c' } },
      ],
    });
    await promessa;
    await vi.waitFor(() => expect(garantir).toHaveBeenCalledTimes(2));
    arquivos.limpar();
    resolvers.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 20));
    expect(garantir).toHaveBeenCalledTimes(2);
  });

  it('pull sem mudanças não busca arquivos; falha no prefetch não vira erro do sync', async () => {
    await db.empresa.put(paraEmpresaLocal(ID_EMPRESA, 1, { razaoSocial: 'Regera', logoArquivoId: 'logo-1' }));
    const garantir = vi.spyOn(TestBed.inject(ArquivosService), 'garantirCache').mockRejectedValue(new Error('x'));
    const erro = vi.spyOn(TestBed.inject(Toasts), 'erro');
    const p1 = sync.sincronizar();
    await pullVazio();
    await p1;
    expect(garantir).not.toHaveBeenCalled();

    const p2 = sync.sincronizar();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull'))).flush({
      cursor: 1, temMais: false, usuarios: [],
      mudancas: [{ entidade: 'cliente', id: 'c1', version: 0, deleted: false, dados: dados('X') }],
    });
    await p2;
    await vi.waitFor(() => expect(garantir).toHaveBeenCalledWith('logo-1'));
    await new Promise((r) => setTimeout(r, 10));
    expect(erro).not.toHaveBeenCalled();
  });

  it('aguardarOciosa espera a sincronização em curso terminar', async () => {
    const promessa = sync.sincronizar();
    let ocioso = false;
    const espera = sync.aguardarOciosa().then(() => (ocioso = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(ocioso).toBe(false);
    await pullVazio();
    await promessa;
    await espera;
    expect(ocioso).toBe(true);
  });

  it('cursor que não avança com temMais encerra o pull após uma requisição', async () => {
    const p = sync.sincronizar();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull')))
      .flush({ cursor: 0, temMais: true, mudancas: [], usuarios: [] });
    await p;
    http.expectNone((r) => r.url === '/api/sync/pull');
  });

  it('offline não chama a API', async () => {
    online.set(false);
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('A'), null);
    await sync.sincronizar();
    http.expectNone('/api/sync/push');
    http.expectNone((r) => r.url === '/api/sync/pull');
  });

  it('chamadas simultâneas compartilham a mesma sincronização', async () => {
    const p1 = sync.sincronizar();
    const p2 = sync.sincronizar();
    await pullVazio();
    await Promise.all([p1, p2]);
  });

  it('conta mutações e pendências não sincronizadas', async () => {
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('A'), null);
    await db.pendencias.put({
      mutationId: 'm9', entidade: 'cliente', agregadoId: 'c9', tipo: 'REJEITADO',
      mutacao: { mutationId: 'm9', entidade: 'cliente', agregadoId: 'c9', op: 'UPSERT', baseVersion: null, dados: null, criadaEm: '' },
      criadaEm: '',
    });
    expect(await sync.contarNaoSincronizados()).toBe(2);
    await vi.waitFor(() => expect(sync.naoSincronizados()).toBe(1));
  });
});
