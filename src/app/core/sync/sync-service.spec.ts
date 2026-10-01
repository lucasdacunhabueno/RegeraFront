import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ItemCatalogoDados, paraItemLocal } from '../../features/catalogo/item-models';
import { ClienteDados, paraClienteLocal } from '../../features/clientes/cliente-models';
import { ID_EMPRESA, paraEmpresaLocal } from '../../features/empresa/empresa-models';
import { codigoProvisorioValido } from '../../features/propostas/codigo-provisorio';
import {
  DocumentoLocal, paraPropostaLocal, PropostaDados, StatusProposta,
} from '../../features/propostas/proposta-models';
import { ErroProposta, PropostasRepo } from '../../features/propostas/propostas-repo';
import { paraTemplateLocal } from '../../features/templates/template-models';
import { Toasts } from '../../shared/ui/toasts';
import { PendenciasService } from './pendencias-service';
import { ArquivosService } from '../arquivos/arquivos-service';
import { AuthService } from '../auth/auth-service';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { RegeraDb } from '../db/regera-db';
import { TIPO_UPLOAD_DOCUMENTO } from './sync-models';
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
    pull.flush({ cursor: 42, temMais: false, mudancas: [], usuarios: [{ id: 'u1', nome: 'Ana', email: 'ana@regera.com', perfil: 'ADMIN' }] });
    await p;

    expect(await db.outbox.count()).toBe(0);
    const local = await db.clientes.get('c1');
    expect(local?.version).toBe(0);
    expect(local?.nome).toBe('A servidor');
    expect(await db.lerMeta('cursor')).toBe(42);
    expect(await db.usuarios.count()).toBe(1);
    // P4b-R20: o e-mail fica guardado (variável responsavel.email do PDF)
    expect(await db.usuarios.get('u1')).toEqual({ id: 'u1', nome: 'Ana', email: 'ana@regera.com', perfil: 'ADMIN' });
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

  it('aplica a página do pull numa transação só, sem sobrescrever o que tem pendência local', async () => {
    await db.clientes.put(paraClienteLocal('c0', 0, dados('Minha edição')));
    await db.pendencias.put({
      mutationId: 'm0', entidade: 'cliente', agregadoId: 'c0', tipo: 'REJEITADO',
      mutacao: { mutationId: 'm0', entidade: 'cliente', agregadoId: 'c0', op: 'UPSERT', baseVersion: 0, dados: null, criadaEm: '' },
      criadaEm: '',
    });
    await db.clientes.put(paraClienteLocal('c1', 0, dados('Vai sumir')));
    const mudancas = Array.from({ length: 300 }, (_, i) => ({
      entidade: 'cliente', id: `c${i}`, version: 1, deleted: i === 1, dados: i === 1 ? null : dados(`S${i}`),
    }));
    const transacao = vi.spyOn(db, 'transaction');

    const p = sync.sincronizar();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull')))
      .flush({ cursor: 300, temMais: false, usuarios: [], mudancas });
    await p;

    const comClientes = transacao.mock.calls.filter((args) => args.some((a) => Array.isArray(a) && a.includes(db.clientes)));
    expect(comClientes).toHaveLength(1);
    expect((await db.clientes.get('c0'))?.nome).toBe('Minha edição');
    expect(await db.clientes.get('c1')).toBeUndefined();
    expect((await db.clientes.get('c299'))?.nome).toBe('S299');
    expect(await db.clientes.count()).toBe(299);
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

  it('outro perfil (não técnico) limpa propostas e os documentos já enviados; os não enviados esperam o upload', async () => {
    await db.gravarMeta('cursor', 50);
    await db.gravarMeta('cursorDono', 'u1:ADMIN');
    await db.propostas.put(paraPropostaLocal('p1', 1, {
      codigoProvisorio: 'PROV-0Z9XY7', tipo: 'VENDA', status: 'ENVIADA', responsavelId: 'u1', dataEmissao: '2026-10-01',
      descontoGeralPercentual: 0, itens: [],
    }));
    const doc = { propostaId: 'p1', revisao: 1, codigoExibido: 'PROV-0Z9XY7', sha256: 'ab', geradoEm: '', geradoPor: 'u1', bytes: null };
    await db.documentos.bulkPut([
      { ...doc, id: 'd1', enviado: true, arquivoId: 'a1' },
      { ...doc, id: 'd2', enviado: false, arquivoId: null },
    ]);
    perfil = 'COMERCIAL';

    const promessa = sync.sincronizar();
    const pull = await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull' && r.params.get('cursor') === '0'));
    expect(await db.propostas.count()).toBe(0);
    expect((await db.documentos.toArray()).map((d) => d.id)).toEqual(['d2']);
    pull.flush({ cursor: 8, temMais: false, mudancas: [], usuarios: [] });
    await promessa;
  });

  it('virou técnico: apaga todos os documentos e os uploads da outbox e das pendências, antes do push (§10)', async () => {
    await db.gravarMeta('cursor', 50);
    await db.gravarMeta('cursorDono', 'u1:COMERCIAL');
    const doc = { propostaId: 'p1', revisao: 1, codigoExibido: 'PROV-0Z9XY7', sha256: 'ab', geradoEm: '', geradoPor: 'u1', bytes: null };
    await db.documentos.bulkPut([
      { ...doc, id: 'd1', enviado: true, arquivoId: 'a1' },
      { ...doc, id: 'd2', enviado: false, arquivoId: null },
    ]);
    const upload = (mutationId: string) => ({
      mutationId, entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', op: 'UPLOAD' as const,
      baseVersion: null, dados: { documentoId: 'd2' }, criadaEm: '',
    });
    await db.outbox.add(upload('up1'));
    await db.pendencias.put({ mutationId: 'up0', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p0',
      tipo: 'REJEITADO', mutacao: upload('up0'), criadaEm: '' });
    // uma mutação comum fica (bloqueada por pendência para não ir ao push neste teste)
    const mut = { mutationId: 'mm', entidade: 'cliente' as const, agregadoId: 'o1', op: 'UPSERT' as const, baseVersion: null, dados: dados('O'), criadaEm: '' };
    await db.outbox.add(mut);
    await db.pendencias.put({ mutationId: 'mm', entidade: 'cliente', agregadoId: 'o1', tipo: 'REJEITADO', mutacao: mut, criadaEm: '' });
    perfil = 'TECNICO';

    const promessa = sync.sincronizar();
    // sem push do upload: o primeiro pedido já é o pull do zero
    const pull = await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull' && r.params.get('cursor') === '0'));
    expect(await db.documentos.count()).toBe(0);
    expect((await db.outbox.toArray()).map((m) => m.mutationId)).toEqual(['mm']);
    expect((await db.pendencias.toArray()).map((p) => p.mutationId)).toEqual(['mm']);
    pull.flush({ cursor: 8, temMais: false, mudancas: [], usuarios: [] });
    await promessa;
    expect(await db.lerMeta('cursorDono')).toBe('u1:TECNICO');
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

  it('sincronizar durante a rodada envia, ao terminar, o que entrou na outbox no meio dela', async () => {
    const p = sync.sincronizar();
    const pull = await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull'));
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('A'), null);
    const p2 = sync.sincronizar();
    expect(p2).toBe(p);
    pull.flush({ cursor: 0, temMais: false, mudancas: [], usuarios: [] });

    // sem esperar o timer: a nova rodada começa assim que a atual termina
    const push = await vi.waitFor(() => http.expectOne('/api/sync/push'));
    push.flush({ resultados: [{ mutationId: push.request.body.mutacoes[0].mutationId, status: 'OK', version: 0, dados: dados('A') }] });
    await pullVazio();
    await p2;
    expect(await db.outbox.count()).toBe(0);
  });

  it('sincronizar durante a rodada com a outbox vazia não faz um segundo pull', async () => {
    const p = sync.sincronizar();
    const pull = await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull'));
    const p2 = sync.sincronizar();
    pull.flush({ cursor: 0, temMais: false, mudancas: [], usuarios: [] });
    await Promise.all([p, p2]);
    await new Promise((r) => setTimeout(r, 20));
    http.expectNone((r) => r.url === '/api/sync/pull');
    http.expectNone('/api/sync/push');
  });

  it('rodadas repetidas param no teto quando o servidor segue devolvendo ERRO_INTERNO', async () => {
    await sync.registrar('cliente', 'c1', 'UPSERT', dados('A'), null);
    const p = sync.sincronizar();
    // a primeira rodada e mais 3 repetições, cada uma pedida no meio da anterior
    for (let i = 0; i < 4; i++) {
      const push = await vi.waitFor(() => http.expectOne('/api/sync/push'));
      void sync.sincronizar();
      push.flush({
        resultados: [{ mutationId: push.request.body.mutacoes[0].mutationId, status: 'REJEITADO', erro: { codigo: 'ERRO_INTERNO', mensagem: 'falha' } }],
      });
      await pullVazio();
    }
    await p;
    await new Promise((r) => setTimeout(r, 20));
    http.expectNone('/api/sync/push');
    expect(await db.outbox.count()).toBe(1);
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

  it('pull ignora entidade desconhecida com nome de propriedade do Object (constructor)', async () => {
    const erro = vi.spyOn(TestBed.inject(Toasts), 'erro');
    const p = sync.sincronizar();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull'))).flush({
      cursor: 2, temMais: false, usuarios: [],
      mudancas: [
        { entidade: 'constructor', id: 'x', version: 0, deleted: false, dados: {} },
        { entidade: 'cliente', id: 'c1', version: 0, deleted: false, dados: dados('Ok') },
      ],
    });
    await p;
    expect(erro).not.toHaveBeenCalled();
    expect((await db.clientes.get('c1'))?.nome).toBe('Ok');
  });

  describe('propostas: transições, documento e código provisório', () => {
    const PROV = 'PROV-0Z9XY7';
    const SHA = 'a'.repeat(64);
    const URL_UPLOAD = '/api/propostas/p1/documentos';
    const prop = (status: StatusProposta, extra: Partial<PropostaDados> = {}): PropostaDados => ({
      codigoProvisorio: PROV, tipo: 'VENDA', status, responsavelId: 'u1', dataEmissao: '2026-10-01',
      descontoGeralPercentual: 0, itens: [], ...extra,
    });
    const numerada = (status: StatusProposta, extra: Partial<PropostaDados> = {}) => prop(status, { numero: 277, revisao: 1, ...extra });
    const PDF = new TextEncoder().encode('%PDF-1.7 conteúdo').buffer as ArrayBuffer;
    const docLocal = (extra: Partial<DocumentoLocal> = {}): DocumentoLocal => ({
      id: 'd1', propostaId: 'p1', revisao: 1, codigoExibido: PROV, sha256: SHA, geradoEm: '2026-10-01T12:00:00Z',
      geradoPor: 'u1', bytes: PDF, enviado: false, arquivoId: null, snapshot: { cliente: 'X' }, ...extra,
    });
    const docServidor = {
      id: 'd1', revisao: 1, codigoExibido: PROV, arquivoId: 'a1', sha256: SHA, geradoEm: '2026-10-01T12:00:01Z', geradoPor: 'u1',
    };
    const push = () => vi.waitFor(() => http.expectOne('/api/sync/push'));
    const ok = (req: TestRequest, version: number, d: unknown) =>
      req.flush({ resultados: [{ mutationId: req.request.body.mutacoes[0].mutationId, status: 'OK', version, dados: d }] });
    const rejeitar = (req: TestRequest, codigo: string) =>
      req.flush({ resultados: [{ mutationId: req.request.body.mutacoes[0].mutationId, status: 'REJEITADO', erro: { codigo, mensagem: 'x' } }] });
    const fila = () => db.outbox.orderBy('seq').toArray();

    it('transição (separada) nunca coalesce; edição antes ou depois dela é outra mutação', async () => {
      await sync.registrar('proposta', 'p1', 'UPSERT', prop('RASCUNHO', { observacoes: 'a' }), 4);
      await sync.registrar('proposta', 'p1', 'UPSERT', prop('ENVIADA'), 4, { separada: true });
      await sync.registrar('proposta', 'p1', 'UPSERT', prop('APROVADA'), 4, { separada: true });
      await sync.registrar('proposta', 'p1', 'UPSERT', prop('APROVADA', { tecnicoId: 't1' }), 4);

      let m = await fila();
      expect(m.map((x) => (x.dados as PropostaDados).status)).toEqual(['RASCUNHO', 'ENVIADA', 'APROVADA', 'APROVADA']);
      expect(m.map((x) => x.separada === true)).toEqual([false, true, true, false]);

      // a edição seguinte coalesce com a última (a edição), não com a transição nem com a primeira
      await sync.registrar('proposta', 'p1', 'UPSERT', prop('APROVADA', { tecnicoId: 't2' }), 4);
      m = await fila();
      expect(m).toHaveLength(4);
      expect((m[3].dados as PropostaDados).tecnicoId).toBe('t2');
      expect((m[0].dados as PropostaDados).observacoes).toBe('a');
    });

    it('upload enfileirado não coalesce; a edição seguinte vem depois dele', async () => {
      await sync.registrarUpload('p1', 'd1');
      await sync.registrar('proposta', 'p1', 'UPSERT', prop('ENVIADA', { tecnicoId: 't1' }), 4);
      await sync.registrar('proposta', 'p1', 'UPSERT', prop('ENVIADA', { tecnicoId: 't2' }), 4);
      const m = await fila();
      expect(m).toHaveLength(2);
      expect(m[0]).toMatchObject({ entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', op: 'UPLOAD', dados: { documentoId: 'd1' } });
      expect(m[1]).toMatchObject({ entidade: 'proposta', dados: { tecnicoId: 't2' } });
    });

    it('duas transições offline saem em ordem, e a segunda leva o baseVersion devolvido pela primeira', async () => {
      await db.propostas.put(paraPropostaLocal('p1', 4, numerada('ENVIADA')));
      await sync.registrar('proposta', 'p1', 'UPSERT', numerada('APROVADA'), 4, { separada: true });
      await sync.registrar('proposta', 'p1', 'UPSERT', numerada('EM_EXECUCAO'), 4, { separada: true });

      const p = sync.sincronizar();
      const push1 = await push();
      expect(push1.request.body.mutacoes).toHaveLength(1);
      expect(push1.request.body.mutacoes[0]).toMatchObject({ baseVersion: 4, dados: { status: 'APROVADA' } });
      ok(push1, 5, numerada('APROVADA'));
      const push2 = await push();
      expect(push2.request.body.mutacoes[0]).toMatchObject({ baseVersion: 5, dados: { status: 'EM_EXECUCAO' } });
      ok(push2, 6, numerada('EM_EXECUCAO'));
      await pullVazio();
      await p;

      expect(await db.outbox.count()).toBe(0);
      expect(await db.propostas.get('p1')).toMatchObject({ version: 6, status: 'EM_EXECUCAO' });
    });

    it('PROV offline com PDF: o upload espera a proposta, sobe depois dela (multipart) e marca o documento', async () => {
      await db.propostas.put(paraPropostaLocal('p1', null, prop('ENVIADA')));
      await db.documentos.put(docLocal());
      await sync.registrar('proposta', 'p1', 'UPSERT', prop('ENVIADA'), null, { separada: true });
      await sync.registrarUpload('p1', 'd1');

      const p = sync.sincronizar();
      const push1 = await push();
      expect(push1.request.body.mutacoes).toHaveLength(1);
      expect(push1.request.body.mutacoes[0]).toMatchObject({ entidade: 'proposta', id: 'p1' });
      http.expectNone(URL_UPLOAD);
      ok(push1, 0, numerada('ENVIADA'));

      const up = await vi.waitFor(() => http.expectOne(URL_UPLOAD));
      expect(up.request.method).toBe('POST');
      // só uploads vinham depois: a proposta já recebeu o número do servidor
      expect(await db.propostas.get('p1')).toMatchObject({ numero: 277, version: 0 });
      const corpo = up.request.body as FormData;
      const arquivo = corpo.get('arquivo') as File;
      expect(arquivo.type).toBe('application/pdf');
      expect(new Uint8Array(await arquivo.arrayBuffer())).toEqual(new Uint8Array(PDF));
      const metadados = corpo.get('metadados') as Blob;
      expect(metadados.type).toBe('application/json');
      expect(JSON.parse(await metadados.text())).toEqual({
        id: 'd1', revisao: 1, codigoExibido: PROV, sha256: SHA, snapshot: { cliente: 'X' },
      });
      up.flush({ documento: docServidor, versaoProposta: 1 }, { status: 201, statusText: 'Created' });
      await pullVazio();
      await p;

      expect(await db.outbox.count()).toBe(0);
      expect(await db.pendencias.count()).toBe(0);
      expect(await db.documentos.get('d1')).toMatchObject({ enviado: true, arquivoId: 'a1' });
      const local = await db.propostas.get('p1');
      expect(local).toMatchObject({ version: 1, numero: 277 });
      expect(local?.documentos).toEqual([docServidor]);
    });

    it('upload OK rebaseia a próxima mutação da proposta com a versaoProposta', async () => {
      await db.propostas.put(paraPropostaLocal('p1', 3, numerada('ENVIADA')));
      await db.documentos.put(docLocal({ codigoExibido: '000277' }));
      await sync.registrarUpload('p1', 'd1');
      await sync.registrar('proposta', 'p1', 'UPSERT', numerada('APROVADA'), 3, { separada: true });

      const p = sync.sincronizar();
      const up = await vi.waitFor(() => http.expectOne(URL_UPLOAD));
      http.expectNone('/api/sync/push');
      // 200: a repetição idempotente responde do mesmo jeito
      up.flush({ documento: { ...docServidor, codigoExibido: '000277' }, versaoProposta: 4 });
      const push1 = await push();
      expect(push1.request.body.mutacoes[0]).toMatchObject({ baseVersion: 4, dados: { status: 'APROVADA' } });
      expect((await db.propostas.get('p1'))?.version).toBe(4);
      ok(push1, 5, numerada('APROVADA', { documentos: [{ ...docServidor, codigoExibido: '000277' }] }));
      await pullVazio();
      await p;

      expect(await db.propostas.get('p1')).toMatchObject({ version: 5, status: 'APROVADA' });
      expect(await db.documentos.get('d1')).toMatchObject({ enviado: true, arquivoId: 'a1' });
    });

    it.each([
      [409, 'STATUS_INVALIDO', 'rascunho'],
      [409, 'REVISAO_INVALIDA', 'outra revisão'],
      [409, 'DOCUMENTO_DIVERGENTE', 'outro conteúdo'],
      [422, 'SHA_DIVERGENTE', 'integridade'],
      [422, 'CODIGO_EXIBIDO_INVALIDO', 'O código da proposta mudou. Gere o PDF de novo e reenvie.'],
      [404, 'PROPOSTA_NAO_ENCONTRADA', 'não foi encontrada'],
      [403, undefined, 'permissão'],
      [413, undefined, '10 MB'],
      [415, undefined, 'não é um PDF'],
      [400, 'VALIDACAO', 'recusado'],
    ])('upload recusado (%i %s) vira pendência REJEITADO e segura a proposta', async (status, codigo, trecho) => {
      await db.propostas.put(paraPropostaLocal('p1', 3, numerada('ENVIADA')));
      await db.documentos.put(docLocal());
      await sync.registrarUpload('p1', 'd1');
      await sync.registrar('proposta', 'p1', 'UPSERT', numerada('APROVADA'), 3, { separada: true });

      const p = sync.sincronizar();
      (await vi.waitFor(() => http.expectOne(URL_UPLOAD)))
        .flush(codigo ? { codigo, detail: 'detalhe' } : { detail: 'detalhe' }, { status, statusText: 'Erro' });
      await pullVazio();
      await p;
      http.expectNone('/api/sync/push');

      const pend = await db.pendencias.toArray();
      expect(pend).toHaveLength(1);
      expect(pend[0]).toMatchObject({
        tipo: 'REJEITADO', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1',
        mutacao: { op: 'UPLOAD', dados: { documentoId: 'd1' }, enviando: false },
        erro: { codigo: codigo ?? `HTTP_${status}` },
      });
      expect(pend[0].erro?.mensagem).toContain(trecho);
      expect(pend[0].erro?.mensagem).toContain(PROV);
      expect((await fila()).map((m) => m.op)).toEqual(['UPSERT']);
      expect(await db.documentos.get('d1')).toMatchObject({ enviado: false, arquivoId: null });
    });

    it('5xx no upload: continua na outbox, sem pendência, e o pull segue; queda de rede também', async () => {
      await db.documentos.put(docLocal());
      await sync.registrarUpload('p1', 'd1');

      const p = sync.sincronizar();
      (await vi.waitFor(() => http.expectOne(URL_UPLOAD))).flush({}, { status: 503, statusText: 'Indisponível' });
      await pullVazio();
      await p;
      let m = await fila();
      expect(m).toHaveLength(1);
      expect(m[0].enviando).toBe(false);
      expect(await db.pendencias.count()).toBe(0);

      const p2 = sync.sincronizar();
      (await vi.waitFor(() => http.expectOne(URL_UPLOAD))).error(new ProgressEvent('error'), { status: 0 });
      await p2;
      m = await fila();
      expect(m).toHaveLength(1);
      expect(await db.pendencias.count()).toBe(0);
      expect(await db.documentos.get('d1')).toMatchObject({ enviado: false });
    });

    it.each([408, 429])('upload com %i é transitório: fica na outbox, sem pendência', async (status) => {
      await db.documentos.put(docLocal());
      await sync.registrarUpload('p1', 'd1');

      const p = sync.sincronizar();
      (await vi.waitFor(() => http.expectOne(URL_UPLOAD))).flush({}, { status, statusText: 'x' });
      await pullVazio();
      await p;
      expect((await fila())[0]).toMatchObject({ op: 'UPLOAD', enviando: false });
      expect(await db.pendencias.count()).toBe(0);
    });

    it('P4b-R16: usar cadastro existente devolve à fila a proposta rejeitada pelo cliente, no lugar dela, e ela sai', async () => {
      await db.clientes.put(paraClienteLocal('C', null, dados('Novo')));
      await db.propostas.put(paraPropostaLocal('P', null, prop('RASCUNHO', { clienteId: 'C' })));
      await sync.registrar('cliente', 'C', 'UPSERT', dados('Novo'), null);
      await sync.registrar('proposta', 'P', 'UPSERT', prop('RASCUNHO', { clienteId: 'C' }), null);
      await sync.registrar('proposta', 'P', 'UPSERT', prop('ENVIADA', { clienteId: 'C' }), null, { separada: true });
      const seqP1 = (await fila()).find((m) => m.agregadoId === 'P')!.seq;

      const p = sync.sincronizar();
      const push1 = await push();
      const [mc, mp] = push1.request.body.mutacoes as { mutationId: string; id: string }[];
      expect([mc.id, mp.id]).toEqual(['C', 'P']);
      push1.flush({ resultados: [
        { mutationId: mc.mutationId, status: 'REJEITADO', erro: { codigo: 'DOCUMENTO_DUPLICADO', mensagem: 'x', idExistente: 'C9' } },
        { mutationId: mp.mutationId, status: 'REJEITADO', erro: { codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { clienteId: 'Cliente não encontrado.' } } },
      ] });
      await pullVazio();
      await p;
      const pendC = (await db.pendencias.toArray()).find((x) => x.agregadoId === 'C')!;
      expect(await db.pendencias.count()).toBe(2);

      const usar = TestBed.inject(PendenciasService).usarExistente(pendC);
      (await vi.waitFor(() => http.expectOne('/api/sync/agregado/cliente/C9')))
        .flush({ entidade: 'cliente', id: 'C9', version: 3, deleted: false, dados: dados('Original') });
      expect(await usar).toBe('C9');

      expect(await db.pendencias.count()).toBe(0);
      const m = await fila();
      expect(m.map((x) => [x.agregadoId, (x.dados as PropostaDados).status, (x.dados as PropostaDados).clienteId]))
        .toEqual([['P', 'RASCUNHO', 'C9'], ['P', 'ENVIADA', 'C9']]);
      expect(m[0].seq).toBe(seqP1);
      expect(m[0].mutationId).not.toBe(mp.mutationId);
      expect((await db.propostas.get('P'))?.clienteId).toBe('C9');

      // usarExistente pede a sincronização: as dependentes saem
      const push2 = await push();
      expect(push2.request.body.mutacoes[0]).toMatchObject({ id: 'P', baseVersion: null, dados: { clienteId: 'C9', status: 'RASCUNHO' } });
      ok(push2, 0, numerada('RASCUNHO', { clienteId: 'C9' }));
      const push3 = await push();
      expect(push3.request.body.mutacoes[0]).toMatchObject({ baseVersion: 0, dados: { clienteId: 'C9', status: 'ENVIADA' } });
      ok(push3, 1, numerada('ENVIADA', { clienteId: 'C9' }));
      await pullVazio();
      await sync.aguardarOciosa();
      expect(await db.outbox.count()).toBe(0);
      expect(await db.propostas.get('P')).toMatchObject({ clienteId: 'C9', version: 1, status: 'ENVIADA' });
    });


    it('P4b-R24: escrita alheia entre T e o UPLOAD — a próxima mutação vai sobre base + 1 e recebe CONFLITO', async () => {
      await db.propostas.put(paraPropostaLocal('p1', 4, numerada('ENVIADA')));
      await db.documentos.put(docLocal({ codigoExibido: '000277' }));
      await sync.registrar('proposta', 'p1', 'UPSERT', numerada('ENVIADA'), 4, { separada: true });
      await sync.registrarUpload('p1', 'd1');
      // A: "Cancelar" decidido offline sobre a ENVIADA
      await sync.registrar('proposta', 'p1', 'UPSERT', numerada('CANCELADA', { motivoEncerramento: 'Desistiu' }), 4, { separada: true });

      const p = sync.sincronizar();
      ok(await push(), 5, numerada('ENVIADA'));
      const up = await vi.waitFor(() => http.expectOne(URL_UPLOAD));
      expect((await fila())[0]).toMatchObject({ op: 'UPLOAD', baseVersion: 5 });
      // entre T (v5) e o upload, o admin atribuiu um técnico (v6); o toque do upload leva a v7
      up.flush({ documento: { ...docServidor, codigoExibido: '000277' }, versaoProposta: 7 }, { status: 201, statusText: 'Created' });
      const pushA = await push();
      // base 6 (= 5 + o toque), não 7: o servidor está em 7 e devolve CONFLITO, e o usuário decide
      expect(pushA.request.body.mutacoes[0]).toMatchObject({ baseVersion: 6, dados: { status: 'CANCELADA' } });
      expect((await db.propostas.get('p1'))?.version).toBe(6);
      pushA.flush({ resultados: [{
        mutationId: pushA.request.body.mutacoes[0].mutationId, status: 'CONFLITO',
        dadosServidor: numerada('ENVIADA', { tecnicoId: 't9' }), versionServidor: 7,
      }] });
      await pullVazio();
      await p;

      expect(await db.pendencias.toArray()).toMatchObject([{ tipo: 'CONFLITO', agregadoId: 'p1', versionServidor: 7 }]);
      expect(await db.documentos.get('d1')).toMatchObject({ enviado: true, arquivoId: 'a1' });
    });

    it('P4b-R24: sem escrita alheia (versaoProposta = base + 1), a próxima mutação vai sobre a versão devolvida', async () => {
      await db.propostas.put(paraPropostaLocal('p1', 4, numerada('ENVIADA')));
      await db.documentos.put(docLocal({ codigoExibido: '000277' }));
      await sync.registrar('proposta', 'p1', 'UPSERT', numerada('ENVIADA'), 4, { separada: true });
      await sync.registrarUpload('p1', 'd1');
      await sync.registrar('proposta', 'p1', 'UPSERT', numerada('APROVADA'), 4, { separada: true });

      const p = sync.sincronizar();
      ok(await push(), 5, numerada('ENVIADA'));
      (await vi.waitFor(() => http.expectOne(URL_UPLOAD)))
        .flush({ documento: { ...docServidor, codigoExibido: '000277' }, versaoProposta: 6 }, { status: 201, statusText: 'Created' });
      const pushA = await push();
      expect(pushA.request.body.mutacoes[0]).toMatchObject({ baseVersion: 6, dados: { status: 'APROVADA' } });
      ok(pushA, 7, numerada('APROVADA'));
      await pullVazio();
      await p;
      expect(await db.propostas.get('p1')).toMatchObject({ version: 7, status: 'APROVADA' });
    });

    it('P4b-R26: tombstone da proposta apaga os PDFs enviados dela; o PDF não enviado fica protegido pelo upload na fila', async () => {
      await db.propostas.bulkPut([
        paraPropostaLocal('p1', 3, numerada('ENVIADA')), paraPropostaLocal('p2', 3, numerada('ENVIADA')),
        paraPropostaLocal('p3', 3, numerada('ENVIADA')),
      ]);
      await db.documentos.bulkPut([
        docLocal({ id: 'd1', enviado: true, arquivoId: 'a1' }),
        docLocal({ id: 'd1b', revisao: 2, enviado: true, arquivoId: 'a1b', bytes: null }),
        docLocal({ id: 'd2', propostaId: 'p2', enviado: true, arquivoId: 'a2' }),
        docLocal({ id: 'd3', propostaId: 'p3' }),
      ]);
      await sync.registrarUpload('p3', 'd3');

      const p = sync.sincronizar();
      // o upload falha de forma transitória e fica na fila
      (await vi.waitFor(() => http.expectOne('/api/propostas/p3/documentos'))).flush({}, { status: 503, statusText: 'x' });
      (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull'))).flush({
        cursor: 9, temMais: false, usuarios: [],
        mudancas: [
          { entidade: 'proposta', id: 'p1', version: 4, deleted: true, dados: null },
          { entidade: 'proposta', id: 'p3', version: 4, deleted: true, dados: null },
        ],
      });
      await p;

      expect(await db.propostas.get('p1')).toBeUndefined();
      // p3 tem upload na fila: nem a proposta nem o PDF saem (o upload decide)
      expect(await db.propostas.get('p3')).toBeDefined();
      expect((await db.documentos.toArray()).map((d) => d.id).sort()).toEqual(['d2', 'd3']);
      expect((await fila()).map((m) => [m.agregadoId, m.op])).toEqual([['p3', 'UPLOAD']]);
    });

    it('P4b-R26: upload aceito tira os bytes dos PDFs enviados das revisões anteriores e mantém os da revisão atual', async () => {
      await db.propostas.put(paraPropostaLocal('p1', 3, numerada('ENVIADA', { revisao: 3 })));
      const outro = new TextEncoder().encode('%PDF-1.7 outro').buffer as ArrayBuffer;
      await db.documentos.bulkPut([
        docLocal({ id: 'r1', revisao: 1, enviado: true, arquivoId: 'a-r1' }),
        docLocal({ id: 'r2', revisao: 2, codigoExibido: `${PROV}-R2`, enviado: true, arquivoId: 'a-r2' }),
        docLocal({ id: 'r3a', revisao: 3, codigoExibido: `${PROV}-R3`, enviado: true, arquivoId: 'a-r3a', bytes: outro }),
        docLocal({ id: 'r3', revisao: 3, codigoExibido: `${PROV}-R3` }),
        docLocal({ id: 'x1', propostaId: 'p9', revisao: 1, enviado: true, arquivoId: 'a-x1' }),
      ]);
      await sync.registrarUpload('p1', 'r3');

      const p = sync.sincronizar();
      (await vi.waitFor(() => http.expectOne(URL_UPLOAD)))
        .flush({ documento: { ...docServidor, id: 'r3', revisao: 3, codigoExibido: `${PROV}-R3`, arquivoId: 'a-r3' }, versaoProposta: 4 },
          { status: 201, statusText: 'Created' });
      await pullVazio();
      await p;

      const docs = new Map((await db.documentos.toArray()).map((d) => [d.id, d]));
      // revisões 1 e 2: ficam só os metadados (abrem online pelo arquivoId)
      expect(docs.get('r1')).toMatchObject({ enviado: true, arquivoId: 'a-r1', bytes: null });
      expect(docs.get('r2')).toMatchObject({ enviado: true, arquivoId: 'a-r2', bytes: null });
      // revisão atual: os bytes ficam, inclusive os de um PDF anterior da mesma revisão
      expect(docs.get('r3')).toMatchObject({ enviado: true, arquivoId: 'a-r3' });
      expect(new Uint8Array(docs.get('r3')!.bytes!)).toEqual(new Uint8Array(PDF));
      expect(new Uint8Array(docs.get('r3a')!.bytes!)).toEqual(new Uint8Array(outro));
      // de outra proposta, nada muda
      expect(docs.get('x1')!.bytes).not.toBeNull();
    });

    it('P4b-R23: envio offline com a criação recusada (item inativado): corrigirProposta troca a linha e E, T e UPLOAD saem em ordem', async () => {
      const repo = TestBed.inject(PropostasRepo);
      const pendencias = TestBed.inject(PendenciasService);
      await db.clientes.put(paraClienteLocal('c1', 1, dados('Cliente')));
      await db.templates.put(paraTemplateLocal('t1', 1, { nome: 'Venda', tipoProposta: 'VENDA', padrao: true, ativo: true, blocos: [] }));
      await db.itens.bulkPut([paraItemLocal('i1', 1, item('PNL-1')), paraItemLocal('i2', 1, item('PNL-2'))]);

      // sem rede: cria, inclui o item e envia (o PDF com o PROV vai para o cliente)
      online.set(false);
      const id = await repo.criar('VENDA', 'c1');
      await repo.adicionarItem(id, (await db.itens.get('i1'))!);
      await repo.enviar(id, async () => new Blob([PDF], { type: 'application/pdf' }));
      const [doc] = await db.documentos.toArray();
      const seqE = (await fila())[0].seq;
      expect((await fila()).map((m) => [m.op, (m.dados as PropostaDados | null)?.status ?? null])).toEqual([
        ['UPSERT', 'RASCUNHO'], ['UPSERT', 'ENVIADA'], ['UPLOAD', null],
      ]);
      // enquanto isso, o admin inativou o item (o pull trouxe)
      await db.itens.put(paraItemLocal('i1', 2, { ...item('PNL-1'), ativo: false }));

      // a rede volta: E é recusado; T e UPLOAD ficam retidos
      online.set(true);
      const s1 = sync.sincronizar();
      const pushE = await push();
      expect(pushE.request.body.mutacoes).toHaveLength(1);
      pushE.flush({ resultados: [{
        mutationId: pushE.request.body.mutacoes[0].mutationId, status: 'REJEITADO',
        erro: { codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { 'itens[0].itemCatalogoId': 'Item do catálogo inativo ou não encontrado.' } },
      }] });
      await pullVazio();
      await s1;
      const [pend] = await db.pendencias.toArray();
      const local = (await db.propostas.get(id))!;
      expect(local.status).toBe('ENVIADA');

      // manter o item inativo é recusado aqui mesmo, sem mexer em nada
      const recusa = await pendencias.corrigirProposta(pend.mutationId, { itens: local.itens }).then(() => null, (e: unknown) => e);
      expect(recusa).toBeInstanceOf(ErroProposta);
      expect((recusa as ErroProposta).campo).toBe('itens[0].itemCatalogoId');
      expect(await db.pendencias.count()).toBe(1);

      // corrige: troca a linha pelo item ativo
      const nova = { ...local.itens[0], id: 'linha-nova', itemCatalogoId: 'i2', codigo: 'PNL-2', nome: 'PNL-2' };
      await pendencias.corrigirProposta(pend.mutationId, { itens: [nova] });
      expect(await db.pendencias.count()).toBe(0);
      expect(await db.propostas.get(id)).toMatchObject({ status: 'ENVIADA', itens: [{ id: 'linha-nova', itemCatalogoId: 'i2' }] });
      expect(await db.documentos.get(doc.id)).toMatchObject({ enviado: false, sha256: doc.sha256 });

      const pushE2 = await push();
      expect(pushE2.request.body.mutacoes[0]).toMatchObject({
        id, baseVersion: null, dados: { status: 'RASCUNHO', itens: [{ id: 'linha-nova', itemCatalogoId: 'i2' }] },
      });
      expect((await fila())[0].seq).toBe(seqE);
      ok(pushE2, 0, numerada('RASCUNHO', { codigoProvisorio: local.codigoProvisorio }));
      const pushT = await push();
      expect(pushT.request.body.mutacoes[0]).toMatchObject({
        id, baseVersion: 0, dados: { status: 'ENVIADA', itens: [{ id: 'linha-nova', itemCatalogoId: 'i2' }] },
      });
      ok(pushT, 1, numerada('ENVIADA', { codigoProvisorio: local.codigoProvisorio }));
      const up = await vi.waitFor(() => http.expectOne(`/api/propostas/${id}/documentos`));
      // o PDF é o mesmo que o cliente recebeu: mesmo documento, mesmo código exibido
      const metadados = JSON.parse(await ((up.request.body as FormData).get('metadados') as Blob).text());
      expect(metadados).toMatchObject({ id: doc.id, codigoExibido: doc.codigoExibido, sha256: doc.sha256 });
      up.flush({ documento: { ...docServidor, id: doc.id, codigoExibido: doc.codigoExibido }, versaoProposta: 2 },
        { status: 201, statusText: 'Created' });
      await pullVazio();
      await sync.aguardarOciosa();

      expect(await db.outbox.count()).toBe(0);
      expect(await db.pendencias.count()).toBe(0);
      expect(await db.documentos.get(doc.id)).toMatchObject({ enviado: true, arquivoId: 'a1' });
      expect(await db.propostas.get(id)).toMatchObject({ status: 'ENVIADA', numero: 277, version: 2 });
    });
    it('upload cujo PDF não está mais no aparelho vira pendência sem chamar o servidor', async () => {
      await db.documentos.put(docLocal({ bytes: null }));
      await sync.registrarUpload('p1', 'd1');

      const p = sync.sincronizar();
      await pullVazio();
      await p;
      http.expectNone(URL_UPLOAD);
      expect(await db.outbox.count()).toBe(0);
      expect((await db.pendencias.toArray())[0]).toMatchObject({ tipo: 'REJEITADO', erro: { codigo: 'DOCUMENTO_AUSENTE' } });
    });

    it('CODIGO_PROVISORIO_DUPLICADO: gera outro código, atualiza o local e a fila, e reenvia na mesma sincronização', async () => {
      await db.propostas.put(paraPropostaLocal('p1', null, prop('RASCUNHO')));
      await sync.registrar('proposta', 'p1', 'UPSERT', prop('RASCUNHO'), null);
      await sync.registrar('proposta', 'p1', 'UPSERT', prop('ENVIADA'), null, { separada: true });

      const p = sync.sincronizar();
      const push1 = await push();
      const m1 = push1.request.body.mutacoes[0];
      rejeitar(push1, 'CODIGO_PROVISORIO_DUPLICADO');

      const push2 = await push();
      const m2 = push2.request.body.mutacoes[0];
      const novo = m2.dados.codigoProvisorio as string;
      expect(m2.mutationId).not.toBe(m1.mutationId);
      expect(m2.dados.status).toBe('RASCUNHO');
      expect(codigoProvisorioValido(novo)).toBe(true);
      expect(novo).not.toBe(PROV);
      expect((await db.propostas.get('p1'))?.codigoProvisorio).toBe(novo);
      expect((await fila()).map((m) => (m.dados as PropostaDados).codigoProvisorio)).toEqual([novo, novo]);
      expect(await db.pendencias.count()).toBe(0);
      ok(push2, 0, numerada('RASCUNHO', { codigoProvisorio: novo }));

      const push3 = await push();
      expect(push3.request.body.mutacoes[0]).toMatchObject({ baseVersion: 0, dados: { status: 'ENVIADA', codigoProvisorio: novo } });
      ok(push3, 1, numerada('ENVIADA', { codigoProvisorio: novo }));
      await pullVazio();
      await p;

      expect(await db.pendencias.count()).toBe(0);
      expect(await db.propostas.get('p1')).toMatchObject({ codigoProvisorio: novo, numero: 277, version: 1 });
    });

    it('CODIGO_PROVISORIO_DUPLICADO de mutação alterada durante o envio não troca o código', async () => {
      await db.propostas.put(paraPropostaLocal('p1', null, prop('RASCUNHO')));
      await sync.registrar('proposta', 'p1', 'UPSERT', prop('RASCUNHO'), null);
      const seq = (await fila())[0].seq!;

      const p = sync.sincronizar();
      const push1 = await push();
      await db.outbox.update(seq, { mutationId: 'outro', enviando: false });
      rejeitar(push1, 'CODIGO_PROVISORIO_DUPLICADO');
      const push2 = await push();
      expect(push2.request.body.mutacoes[0]).toMatchObject({ mutationId: 'outro', dados: { codigoProvisorio: PROV } });
      expect((await db.propostas.get('p1'))?.codigoProvisorio).toBe(PROV);
      ok(push2, 0, numerada('RASCUNHO'));
      await pullVazio();
      await p;
    });

    it('CODIGO_PROVISORIO_DUPLICADO repetido para no teto de trocas e vira pendência', async () => {
      await db.propostas.put(paraPropostaLocal('p1', null, prop('RASCUNHO')));
      await sync.registrar('proposta', 'p1', 'UPSERT', prop('RASCUNHO'), null);

      const p = sync.sincronizar();
      // o envio original e mais 3 trocas
      for (let i = 0; i < 4; i++) rejeitar(await push(), 'CODIGO_PROVISORIO_DUPLICADO');
      await pullVazio();
      await p;
      http.expectNone('/api/sync/push');
      const pend = await db.pendencias.toArray();
      expect(pend).toHaveLength(1);
      expect(pend[0]).toMatchObject({ tipo: 'REJEITADO', erro: { codigo: 'CODIGO_PROVISORIO_DUPLICADO' } });
    });
  });
});
