import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ClienteDados, paraClienteLocal } from '../../features/clientes/cliente-models';
import { AuthService } from '../auth/auth-service';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { RegeraDb } from '../db/regera-db';
import { PendenciasService } from './pendencias-service';
import { Pendencia } from './sync-models';
import { SyncService } from './sync-service';

const dados = (nome: string, documento = '52998224725'): ClienteDados => ({
  tipo: 'PF', documento, nome, nomeFantasia: null, inscricaoEstadual: null, inscricaoMunicipal: null,
  email: null, telefone: null, whatsapp: null, contatoNome: null, observacoes: null, enderecos: [],
});

function pendencia(p: Partial<Pendencia> & Pick<Pendencia, 'tipo'>): Pendencia {
  return {
    mutationId: 'm1', entidade: 'cliente', agregadoId: 'c1', criadaEm: '',
    mutacao: { mutationId: 'm1', entidade: 'cliente', agregadoId: 'c1', op: 'UPSERT', baseVersion: 1, dados: dados('Minha'), criadaEm: '' },
    ...p,
  };
}

describe('PendenciasService', () => {
  let svc: PendenciasService;
  let db: RegeraDb;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { autenticado: () => true, sessaoExpirada: () => false } },
        { provide: ConectividadeService, useValue: { online: signal(false) } },
      ],
    });
    svc = TestBed.inject(PendenciasService);
    db = TestBed.inject(RegeraDb);
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(SyncService), 'sincronizar').mockResolvedValue();
  });

  afterEach(async () => {
    http.verify();
    vi.restoreAllMocks();
    await db.limparTudo();
  });

  it('manter a minha reenfileira os dados locais sobre a versão do servidor', async () => {
    await db.clientes.put(paraClienteLocal('c1', 1, dados('Minha')));
    const p = pendencia({ tipo: 'CONFLITO', versionServidor: 4, dadosServidor: dados('Servidor') });
    await db.pendencias.put(p);
    await db.outbox.add({ ...p.mutacao, mutationId: 'm2', dados: dados('Minha mais nova') });

    await svc.manterMinha(p);

    expect(await db.pendencias.count()).toBe(0);
    const fila = await db.outbox.toArray();
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ op: 'UPSERT', baseVersion: 4, dados: { nome: 'Minha' } });
    expect((await db.clientes.get('c1'))?.version).toBe(4);
  });

  const urlServidor = '/api/sync/agregado/cliente/c1';

  it('usar a do servidor busca o estado atual, aplica e limpa a fila do agregado', async () => {
    await db.clientes.put(paraClienteLocal('c1', 1, dados('Minha')));
    const p = pendencia({ tipo: 'CONFLITO', versionServidor: 4, dadosServidor: dados('Servidor') });
    await db.pendencias.put(p);
    await db.outbox.add({ ...p.mutacao, mutationId: 'm2' });

    const promessa = svc.usarServidor(p);
    (await vi.waitFor(() => http.expectOne(urlServidor)))
      .flush({ entidade: 'cliente', id: 'c1', version: 5, deleted: false, dados: dados('Servidor atual') });
    await promessa;

    expect(await db.pendencias.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.clientes.get('c1')).toMatchObject({ nome: 'Servidor atual', version: 5 });
  });

  it('usar a do servidor sem dados (excluído lá) apaga o local', async () => {
    await db.clientes.put(paraClienteLocal('c1', 1, dados('Minha')));
    const p = pendencia({ tipo: 'CONFLITO', versionServidor: 2 });
    await db.pendencias.put(p);

    const promessa = svc.usarServidor(p);
    (await vi.waitFor(() => http.expectOne(urlServidor)))
      .flush({ codigo: 'NAO_ENCONTRADO' }, { status: 404, statusText: 'Not Found' });
    await promessa;

    expect(await db.clientes.get('c1')).toBeUndefined();
    expect(await db.pendencias.count()).toBe(0);
  });

  it('usar a do servidor sem rede cai para os dados guardados na pendência', async () => {
    await db.clientes.put(paraClienteLocal('c1', 1, dados('Minha')));
    const p = pendencia({ tipo: 'CONFLITO', versionServidor: 4, dadosServidor: dados('Servidor') });
    await db.pendencias.put(p);
    await db.outbox.add({ ...p.mutacao, mutationId: 'm2' });

    const promessa = svc.usarServidor(p);
    (await vi.waitFor(() => http.expectOne(urlServidor))).error(new ProgressEvent('error'), { status: 0 });
    await promessa;

    expect(await db.clientes.get('c1')).toMatchObject({ nome: 'Servidor', version: 4 });
    expect(await db.pendencias.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('descartar criação rejeitada apaga o registro local sem consultar o servidor', async () => {
    await db.clientes.put(paraClienteLocal('c1', null, dados('Nova')));
    const p = pendencia({ tipo: 'REJEITADO', erro: { codigo: 'VALIDACAO', mensagem: 'x' } });
    p.mutacao.baseVersion = null;
    await db.pendencias.put(p);

    await svc.descartar(p);

    expect(await db.clientes.get('c1')).toBeUndefined();
    expect(await db.pendencias.count()).toBe(0);
  });

  it('descartar edição rejeitada volta ao estado do servidor', async () => {
    await db.clientes.put(paraClienteLocal('c1', 1, dados('Minha')));
    const p = pendencia({ tipo: 'REJEITADO', erro: { codigo: 'VALIDACAO', mensagem: 'x' } });
    await db.pendencias.put(p);

    const promessa = svc.descartar(p);
    (await vi.waitFor(() => http.expectOne('/api/sync/agregado/cliente/c1')))
      .flush({ entidade: 'cliente', id: 'c1', version: 1, deleted: false, dados: dados('Do servidor') });
    await promessa;

    expect((await db.clientes.get('c1'))?.nome).toBe('Do servidor');
  });

  it('usar cadastro existente troca o duplicado local pelo existente', async () => {
    await db.clientes.put(paraClienteLocal('c1', null, dados('Duplicado')));
    const p = pendencia({ tipo: 'REJEITADO', erro: { codigo: 'DOCUMENTO_DUPLICADO', mensagem: 'x', idExistente: 'c9' } });
    p.mutacao.baseVersion = null;
    await db.pendencias.put(p);

    const promessa = svc.usarExistente(p);
    (await vi.waitFor(() => http.expectOne('/api/sync/agregado/cliente/c9')))
      .flush({ entidade: 'cliente', id: 'c9', version: 3, deleted: false, dados: dados('Original') });

    expect(await promessa).toBe('c9');
    expect(await db.clientes.get('c1')).toBeUndefined();
    expect(await db.clientes.get('c9')).toMatchObject({ nome: 'Original', version: 3 });
    expect(await db.pendencias.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
