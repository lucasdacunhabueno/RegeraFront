import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ItemCatalogoDados, paraItemLocal } from '../../features/catalogo/item-models';
import { ClienteDados, paraClienteLocal } from '../../features/clientes/cliente-models';
import { paraPropostaLocal, PropostaDados } from '../../features/propostas/proposta-models';
import { AuthService } from '../auth/auth-service';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { RegeraDb } from '../db/regera-db';
import { PendenciasService } from './pendencias-service';
import { Pendencia, TIPO_UPLOAD_DOCUMENTO } from './sync-models';
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

  it('manter a minha devolve a mutação à fila sobre a versão do servidor, na frente da edição retida (P4b-R17)', async () => {
    await db.clientes.put(paraClienteLocal('c1', 1, dados('Minha mais nova')));
    const p = pendencia({ tipo: 'CONFLITO', versionServidor: 4, dadosServidor: dados('Servidor') });
    await db.pendencias.put(p);
    await db.outbox.add({ ...p.mutacao, mutationId: 'm2', dados: dados('Minha mais nova') });

    await svc.manterMinha(p);

    expect(await db.pendencias.count()).toBe(0);
    const fila = await db.outbox.orderBy('seq').toArray();
    expect(fila).toHaveLength(2);
    expect(fila[0]).toMatchObject({ op: 'UPSERT', baseVersion: 4, dados: { nome: 'Minha' } });
    expect(fila[0].mutationId).not.toBe('m1');
    expect(fila[1]).toMatchObject({ mutationId: 'm2', dados: { nome: 'Minha mais nova' } });
    expect((await db.clientes.get('c1'))?.version).toBe(4);
  });

  it('manter a minha sem edição retida deixa uma mutação só, como antes', async () => {
    await db.clientes.put(paraClienteLocal('c1', 1, dados('Minha')));
    const p = pendencia({ tipo: 'CONFLITO', versionServidor: 4, dadosServidor: dados('Servidor') });
    p.mutacao.seq = 17;
    await db.pendencias.put(p);

    await svc.manterMinha(p);

    const fila = await db.outbox.toArray();
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ seq: 17, op: 'UPSERT', baseVersion: 4, dados: { nome: 'Minha' }, enviando: false });
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

  it('usar cadastro existente numa atualização restaura a cópia do servidor do próprio agregado', async () => {
    await db.clientes.put(paraClienteLocal('c1', 1, dados('Editado localmente')));
    const p = pendencia({ tipo: 'REJEITADO', erro: { codigo: 'DOCUMENTO_DUPLICADO', mensagem: 'x', idExistente: 'c9' } });
    await db.pendencias.put(p);

    const promessa = svc.usarExistente(p);
    (await vi.waitFor(() => http.expectOne('/api/sync/agregado/cliente/c9')))
      .flush({ entidade: 'cliente', id: 'c9', version: 3, deleted: false, dados: dados('Original', '11144477735') });
    (await vi.waitFor(() => http.expectOne('/api/sync/agregado/cliente/c1')))
      .flush({ entidade: 'cliente', id: 'c1', version: 2, deleted: false, dados: dados('Do servidor', '39053344705') });

    expect(await promessa).toBe('c9');
    expect(await db.clientes.get('c1')).toMatchObject({ nome: 'Do servidor', version: 2 });
    expect(await db.clientes.get('c9')).toMatchObject({ nome: 'Original', version: 3 });
    expect(await db.pendencias.count()).toBe(0);
  });

  it('descartar edição com falha de rede mantém pendência e registro local', async () => {
    await db.clientes.put(paraClienteLocal('c1', 1, dados('Minha')));
    const p = pendencia({ tipo: 'REJEITADO', erro: { codigo: 'VALIDACAO', mensagem: 'x' } });
    await db.pendencias.put(p);
    await db.outbox.add({ ...p.mutacao, mutationId: 'm2' });

    const promessa = svc.descartar(p);
    const rejeitou = expect(promessa).rejects.toBeDefined();
    (await vi.waitFor(() => http.expectOne('/api/sync/agregado/cliente/c1'))).error(new ProgressEvent('error'), { status: 0 });
    await rejeitou;

    expect(await db.pendencias.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    expect((await db.clientes.get('c1'))?.nome).toBe('Minha');
  });

  it('usar cadastro existente com 404 rejeita e preserva o duplicado e a pendência', async () => {
    await db.clientes.put(paraClienteLocal('c1', null, dados('Duplicado')));
    const p = pendencia({ tipo: 'REJEITADO', erro: { codigo: 'DOCUMENTO_DUPLICADO', mensagem: 'x', idExistente: 'c9' } });
    p.mutacao.baseVersion = null;
    await db.pendencias.put(p);

    const promessa = svc.usarExistente(p);
    const rejeitou = expect(promessa).rejects.toThrow('O cadastro existente não foi encontrado no servidor.');
    (await vi.waitFor(() => http.expectOne('/api/sync/agregado/cliente/c9')))
      .flush({ codigo: 'NAO_ENCONTRADO' }, { status: 404, statusText: 'Not Found' });
    await rejeitou;

    expect(await db.clientes.get('c1')).toBeDefined();
    expect(await db.pendencias.count()).toBe(1);
  });

  it('usar a do servidor com erro 500 rejeita e mantém a pendência', async () => {
    await db.clientes.put(paraClienteLocal('c1', 1, dados('Minha')));
    const p = pendencia({ tipo: 'CONFLITO', versionServidor: 4, dadosServidor: dados('Servidor') });
    await db.pendencias.put(p);

    const promessa = svc.usarServidor(p);
    const rejeitou = expect(promessa).rejects.toBeDefined();
    (await vi.waitFor(() => http.expectOne('/api/sync/agregado/cliente/c1')))
      .flush({}, { status: 500, statusText: 'Erro' });
    await rejeitou;

    expect(await db.pendencias.count()).toBe(1);
    expect((await db.clientes.get('c1'))?.nome).toBe('Minha');
  });

  it('manter a minha com o registro local excluído enfileira DELETE sobre a versão do servidor', async () => {
    const p = pendencia({ tipo: 'CONFLITO', versionServidor: 4, dadosServidor: dados('Servidor') });
    await db.pendencias.put(p);

    await svc.manterMinha(p);

    const fila = await db.outbox.toArray();
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ op: 'DELETE', baseVersion: 4 });
    expect(await db.pendencias.count()).toBe(0);
  });

  describe('propostas e documentos', () => {
    const prop = (clienteId: string | null): PropostaDados => ({
      codigoProvisorio: 'PROV-0Z9XY7', tipo: 'VENDA', status: 'RASCUNHO', responsavelId: 'u1', dataEmissao: '2026-10-01',
      descontoGeralPercentual: 0, itens: [], clienteId,
    });
    const mutProposta = (mutationId: string, agregadoId: string, clienteId: string | null) => ({
      mutationId, entidade: 'proposta' as const, agregadoId, op: 'UPSERT' as const, baseVersion: null, dados: prop(clienteId), criadaEm: '',
    });

    it('usar cadastro existente também troca o clienteId nas propostas locais e na outbox, na mesma transação', async () => {
      await db.clientes.put(paraClienteLocal('c1', null, dados('Duplicado')));
      const p = pendencia({ tipo: 'REJEITADO', erro: { codigo: 'DOCUMENTO_DUPLICADO', mensagem: 'x', idExistente: 'c9' } });
      p.mutacao.baseVersion = null;
      await db.pendencias.put(p);
      await db.propostas.bulkPut([paraPropostaLocal('p1', null, prop('c1')), paraPropostaLocal('p2', 2, prop('c5'))]);
      await db.outbox.bulkAdd([mutProposta('mp1', 'p1', 'c1'), mutProposta('mp2', 'p2', 'c5'), { ...mutProposta('mp3', 'p1', 'c1'), enviando: true }]);
      const transacao = vi.spyOn(db, 'transaction');

      const promessa = svc.usarExistente(p);
      (await vi.waitFor(() => http.expectOne('/api/sync/agregado/cliente/c9')))
        .flush({ entidade: 'cliente', id: 'c9', version: 3, deleted: false, dados: dados('Original') });
      expect(await promessa).toBe('c9');

      expect((await db.propostas.get('p1'))?.clienteId).toBe('c9');
      expect((await db.propostas.get('p2'))?.clienteId).toBe('c5');
      const fila = await db.outbox.orderBy('seq').toArray();
      expect(fila.map((m) => [m.agregadoId, (m.dados as PropostaDados).clienteId])).toEqual([['p1', 'c9'], ['p2', 'c5'], ['p1', 'c9']]);
      // reescrita = outra mutação (a em voo não pode ter o resultado aplicado por cima)
      expect(fila[0].mutationId).not.toBe('mp1');
      expect(fila[2]).toMatchObject({ enviando: false });
      expect(fila[2].mutationId).not.toBe('mp3');
      expect(fila[1].mutationId).toBe('mp2');
      const juntas = transacao.mock.calls.filter((args) =>
        [db.clientes, db.propostas, db.outbox, db.pendencias].every((t) => args.some((a) => Array.isArray(a) && a.includes(t))));
      expect(juntas).toHaveLength(1);
    });

    it('usar cadastro existente numa atualização não troca o cliente das propostas (o próprio continua existindo)', async () => {
      await db.clientes.put(paraClienteLocal('c1', 1, dados('Editado')));
      const p = pendencia({ tipo: 'REJEITADO', erro: { codigo: 'DOCUMENTO_DUPLICADO', mensagem: 'x', idExistente: 'c9' } });
      await db.pendencias.put(p);
      await db.propostas.put(paraPropostaLocal('p1', 1, prop('c1')));
      await db.outbox.add(mutProposta('mp1', 'p1', 'c1'));

      const promessa = svc.usarExistente(p);
      (await vi.waitFor(() => http.expectOne('/api/sync/agregado/cliente/c9')))
        .flush({ entidade: 'cliente', id: 'c9', version: 3, deleted: false, dados: dados('Original', '11144477735') });
      (await vi.waitFor(() => http.expectOne('/api/sync/agregado/cliente/c1')))
        .flush({ entidade: 'cliente', id: 'c1', version: 2, deleted: false, dados: dados('Do servidor', '39053344705') });
      await promessa;

      expect((await db.propostas.get('p1'))?.clienteId).toBe('c1');
      expect((await db.outbox.toArray())[0]).toMatchObject({ mutationId: 'mp1', dados: { clienteId: 'c1' } });
    });

    it('descartar upload rejeitado apaga o PDF não enviado e libera a proposta, sem tocar nela', async () => {
      await db.propostas.put(paraPropostaLocal('p1', 3, prop('c1')));
      await db.documentos.put({
        id: 'd1', propostaId: 'p1', revisao: 1, codigoExibido: 'PROV-0Z9XY7', sha256: 'a'.repeat(64), geradoEm: '',
        geradoPor: 'u1', bytes: null, enviado: false, arquivoId: null,
      });
      await db.outbox.add(mutProposta('mp1', 'p1', 'c1'));
      const p: Pendencia = {
        mutationId: 'up1', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', tipo: 'REJEITADO', criadaEm: '',
        erro: { codigo: 'REVISAO_INVALIDA', mensagem: 'x' },
        mutacao: { mutationId: 'up1', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', op: 'UPLOAD', baseVersion: null, dados: { documentoId: 'd1' }, criadaEm: '' },
      };
      await db.pendencias.put(p);

      await svc.descartar(p);

      expect(await db.pendencias.count()).toBe(0);
      expect(await db.documentos.get('d1')).toBeUndefined();
      expect(await db.propostas.get('p1')).toBeDefined();
      expect((await db.outbox.toArray()).map((m) => m.mutationId)).toEqual(['mp1']);
      expect(TestBed.inject(SyncService).sincronizar).toHaveBeenCalled();
    });

    const doc = (id: string, enviado: boolean) => ({
      id, propostaId: 'p1', revisao: 1, codigoExibido: 'PROV-0Z9XY7', sha256: 'a'.repeat(64), geradoEm: '',
      geradoPor: 'u1', bytes: null, enviado, arquivoId: enviado ? `a-${id}` : null,
    });
    const upload = (mutationId: string, documentoId: string) => ({
      mutationId, entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', op: 'UPLOAD' as const, baseVersion: null,
      dados: { documentoId }, separada: true, criadaEm: '',
    });
    const pendenciaProposta = (p: Partial<Pendencia> & Pick<Pendencia, 'tipo'>): Pendencia => ({
      mutationId: 'mp1', entidade: 'proposta', agregadoId: 'p1', criadaEm: '',
      mutacao: { ...mutProposta('mp1', 'p1', 'c1'), baseVersion: 3 },
      ...p,
    });

    it('P4b-R14: descartar a pendência da proposta apaga os PDFs não enviados cujos uploads saem da fila', async () => {
      await db.propostas.put(paraPropostaLocal('p1', 3, prop('c1')));
      await db.documentos.bulkPut([doc('d1', false), doc('d2', true), doc('d3', false)]);
      await db.outbox.bulkAdd([upload('up1', 'd1'), upload('up2', 'd2')]);
      const p = pendenciaProposta({ tipo: 'REJEITADO', erro: { codigo: 'TRANSICAO_INVALIDA', mensagem: 'x' } });
      await db.pendencias.put(p);

      const promessa = svc.descartar(p);
      (await vi.waitFor(() => http.expectOne('/api/sync/agregado/proposta/p1')))
        .flush({ entidade: 'proposta', id: 'p1', version: 3, deleted: false, dados: prop('c1') });
      await promessa;

      expect(await db.outbox.count()).toBe(0);
      expect(await db.pendencias.count()).toBe(0);
      // d1: upload saiu da fila, não enviado → apagado; d2: já enviado → fica; d3: sem upload na fila → fica
      expect((await db.documentos.toArray()).map((d) => d.id).sort()).toEqual(['d2', 'd3']);
    });

    it('P4b-R14: descartar a criação rejeitada da proposta também apaga o PDF não enviado da fila', async () => {
      await db.propostas.put(paraPropostaLocal('p1', null, prop('c1')));
      await db.documentos.put(doc('d1', false));
      await db.outbox.add(upload('up1', 'd1'));
      const p = pendenciaProposta({ tipo: 'REJEITADO', erro: { codigo: 'VALIDACAO', mensagem: 'x' } });
      p.mutacao.baseVersion = null;
      await db.pendencias.put(p);

      await svc.descartar(p);

      expect(await db.propostas.get('p1')).toBeUndefined();
      expect(await db.documentos.count()).toBe(0);
      expect(await db.outbox.count()).toBe(0);
    });

    it('P4b-R17: manter a minha rebaseia no lugar — [E1 CONFLITO, T ENVIADA, UPLOAD d1, T APROVADA]', async () => {
      await db.propostas.put(paraPropostaLocal('p1', 3, prop('c1')));
      await db.documentos.put(doc('d1', false));
      const e1 = { ...mutProposta('e1', 'p1', 'c1'), baseVersion: 3 };
      const t1 = { ...mutProposta('t1', 'p1', 'c1'), baseVersion: 3, dados: { ...prop('c1'), status: 'ENVIADA' }, separada: true };
      const t2 = { ...mutProposta('t2', 'p1', 'c1'), baseVersion: 3, dados: { ...prop('c1'), status: 'APROVADA' }, separada: true };
      const [seqE1] = await db.outbox.bulkAdd([e1, t1, upload('up1', 'd1'), t2], { allKeys: true });
      // E1 voltou CONFLITO: saiu da fila para a pendência (com o seq dela)
      const mutacao = (await db.outbox.get(seqE1))!;
      await db.outbox.delete(seqE1);
      const p: Pendencia = {
        mutationId: 'e1', entidade: 'proposta', agregadoId: 'p1', tipo: 'CONFLITO', criadaEm: '', versionServidor: 5,
        dadosServidor: prop('c2'), mutacao,
      };
      await db.pendencias.put(p);

      await svc.manterMinha(p);

      const fila = await db.outbox.orderBy('seq').toArray();
      expect(fila.map((m) => m.mutationId).slice(1)).toEqual(['t1', 'up1', 't2']);
      expect(fila[0]).toMatchObject({ seq: seqE1, entidade: 'proposta', baseVersion: 5, dados: { status: 'RASCUNHO' }, enviando: false });
      expect(fila[0].mutationId).not.toBe('e1');
      expect(fila[1]).toMatchObject({ baseVersion: 3, separada: true });
      expect(await db.documentos.get('d1')).toBeDefined();
      expect(await db.pendencias.count()).toBe(0);
    });

    it('manter a minha duas vezes ao mesmo tempo (toque duplo) devolve E1 uma vez só, a partir da pendência gravada', async () => {
      await db.propostas.put(paraPropostaLocal('p1', 3, prop('c1')));
      const e1 = { ...mutProposta('e1', 'p1', 'c1'), seq: 5, baseVersion: 3 };
      await db.outbox.add({ ...mutProposta('t1', 'p1', 'c1'), seq: 6, separada: true });
      const gravada: Pendencia = {
        mutationId: 'e1', entidade: 'proposta', agregadoId: 'p1', tipo: 'CONFLITO', criadaEm: '', versionServidor: 5, mutacao: e1,
      };
      await db.pendencias.put(gravada);
      // a cópia da tela pode estar velha: vale a gravada
      const daTela: Pendencia = { ...gravada, versionServidor: 1, mutacao: { ...e1, dados: prop('velho') } };

      await Promise.all([svc.manterMinha(daTela), svc.manterMinha(daTela)]);

      const fila = await db.outbox.orderBy('seq').toArray();
      expect(fila).toHaveLength(2);
      expect(fila[0]).toMatchObject({ seq: 5, baseVersion: 5, dados: { clienteId: 'c1' } });
      expect(fila[1].mutationId).toBe('t1');
      expect(await db.pendencias.count()).toBe(0);
    });

    it('ações sobre pendência que já não existe não fazem nada', async () => {
      await db.propostas.put(paraPropostaLocal('p1', 3, prop('c1')));
      await db.outbox.add(mutProposta('t1', 'p1', 'c1'));
      const sumiu = pendenciaProposta({ tipo: 'REJEITADO', erro: { codigo: 'VALIDACAO', mensagem: 'x' } });

      await svc.manterMinha({ ...sumiu, tipo: 'CONFLITO', versionServidor: 4 });
      await svc.descartar(sumiu);
      await svc.usarServidor(sumiu);

      expect((await db.outbox.toArray()).map((m) => m.mutationId)).toEqual(['t1']);
      expect(await db.propostas.get('p1')).toBeDefined();
      http.expectNone(() => true);
    });

    it('P4b-R17: a mutação separada devolvida à fila continua separada', async () => {
      const t = { ...mutProposta('t1', 'p1', 'c1'), seq: 9, baseVersion: 3, dados: { ...prop('c1'), status: 'ENVIADA' }, separada: true };
      await db.propostas.put(paraPropostaLocal('p1', 3, prop('c1')));
      const p: Pendencia = { mutationId: 't1', entidade: 'proposta', agregadoId: 'p1', tipo: 'CONFLITO', criadaEm: '', versionServidor: 6, mutacao: t };
      await db.pendencias.put(p);

      await svc.manterMinha(p);

      expect((await db.outbox.toArray())[0]).toMatchObject({ seq: 9, separada: true, baseVersion: 6, dados: { status: 'ENVIADA' } });
    });

    it('manter a minha ou usar a do servidor não valem para upload', async () => {
      const p: Pendencia = {
        mutationId: 'up1', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', tipo: 'REJEITADO', criadaEm: '',
        mutacao: { mutationId: 'up1', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', op: 'UPLOAD', baseVersion: null, dados: { documentoId: 'd1' }, criadaEm: '' },
      };
      await expect(svc.manterMinha(p)).rejects.toThrow();
      await expect(svc.usarServidor(p)).rejects.toThrow();
    });
  });

  describe('item do catálogo', () => {
    const item = (nome: string): ItemCatalogoDados => ({
      natureza: 'PRODUTO', codigo: 'PNL', nome, descricao: null, unidade: 'un', precoVenda: 1,
      locavel: false, fotoArquivoId: null, ativo: true,
    });
    const pendenciaItem = (p: Partial<Pendencia> & Pick<Pendencia, 'tipo'>): Pendencia => ({
      mutationId: 'mi', entidade: 'item_catalogo', agregadoId: 'i1', criadaEm: '',
      mutacao: { mutationId: 'mi', entidade: 'item_catalogo', agregadoId: 'i1', op: 'UPSERT', baseVersion: 1, dados: item('Meu'), criadaEm: '' },
      ...p,
    });

    it('manter a minha reenfileira o item local sobre a versão do servidor', async () => {
      await db.itens.put(paraItemLocal('i1', 1, item('Meu')));
      const p = pendenciaItem({ tipo: 'CONFLITO', versionServidor: 6, dadosServidor: item('Servidor') });
      await db.pendencias.put(p);

      await svc.manterMinha(p);

      const fila = await db.outbox.toArray();
      expect(fila).toHaveLength(1);
      expect(fila[0]).toMatchObject({ entidade: 'item_catalogo', op: 'UPSERT', baseVersion: 6, dados: { nome: 'Meu' } });
      expect((await db.itens.get('i1'))?.version).toBe(6);
      expect(await db.pendencias.count()).toBe(0);
    });

    it('usar a do servidor busca o item atual e grava na tabela de itens', async () => {
      await db.itens.put(paraItemLocal('i1', 1, item('Meu')));
      const p = pendenciaItem({ tipo: 'CONFLITO', versionServidor: 6, dadosServidor: item('Servidor') });
      await db.pendencias.put(p);

      const promessa = svc.usarServidor(p);
      (await vi.waitFor(() => http.expectOne('/api/sync/agregado/item_catalogo/i1')))
        .flush({ entidade: 'item_catalogo', id: 'i1', version: 7, deleted: false, dados: item('Servidor atual') });
      await promessa;

      expect(await db.itens.get('i1')).toMatchObject({ nome: 'Servidor atual', version: 7 });
      expect(await db.pendencias.count()).toBe(0);
    });

    it('descartar criação rejeitada (código duplicado) apaga o item local', async () => {
      await db.itens.put(paraItemLocal('i1', null, item('Novo')));
      const p = pendenciaItem({ tipo: 'REJEITADO', erro: { codigo: 'CODIGO_DUPLICADO', mensagem: 'x' } });
      p.mutacao.baseVersion = null;
      await db.pendencias.put(p);
      await db.outbox.add({ ...p.mutacao, mutationId: 'mi2' });

      await svc.descartar(p);

      expect(await db.itens.get('i1')).toBeUndefined();
      expect(await db.outbox.count()).toBe(0);
      expect(await db.pendencias.count()).toBe(0);
    });
  });
});
