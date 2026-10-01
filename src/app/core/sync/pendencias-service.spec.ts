import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ItemCatalogoDados, paraItemLocal } from '../../features/catalogo/item-models';
import { ClienteDados, paraClienteLocal } from '../../features/clientes/cliente-models';
import { AnexoOsLocal, paraOsLocal } from '../../features/os/os-models';
import { paraPropostaLocal, PropostaDados } from '../../features/propostas/proposta-models';
import { ErroProposta, LinhaRascunho } from '../../features/propostas/propostas-repo';
import type { UsuarioSessao } from '../auth/auth-models';
import { AuthService } from '../auth/auth-service';
import { ConectividadeService } from '../conectividade/conectividade-service';
import { RegeraDb } from '../db/regera-db';
import { PendenciasService } from './pendencias-service';
import { MutacaoLocal, Pendencia, TIPO_UPLOAD_ANEXO_OS, TIPO_UPLOAD_DOCUMENTO } from './sync-models';
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
  let usuarioAtual: UsuarioSessao;

  beforeEach(() => {
    usuarioAtual = { id: 'u1', nome: 'Carla', email: 'carla@regera.com', perfil: 'COMERCIAL', ativo: true };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { autenticado: () => true, sessaoExpirada: () => false, usuario: () => usuarioAtual } },
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

    it('P4b-R30: descartar a criação recusada da proposta apaga a local e todos os PDFs dela, enviados ou não', async () => {
      await db.propostas.put(paraPropostaLocal('p1', null, prop('c1')));
      await db.documentos.bulkPut([doc('d1', false), doc('d2', true), { ...doc('d9', true), propostaId: 'p9' }]);
      const p = pendenciaProposta({ tipo: 'REJEITADO', erro: { codigo: 'VALIDACAO', mensagem: 'x' } });
      p.mutacao.baseVersion = null;
      await db.pendencias.put(p);

      await svc.descartar(p);

      expect(await db.propostas.get('p1')).toBeUndefined();
      expect((await db.documentos.toArray()).map((d) => d.id)).toEqual(['d9']);
    });

    it('P4b-R30: usar a do servidor quando o servidor não tem mais a proposta apaga a local e os PDFs enviados dela', async () => {
      await db.propostas.put(paraPropostaLocal('p1', 3, prop('c1')));
      await db.documentos.bulkPut([doc('d1', true), { ...doc('d9', true), propostaId: 'p9' }]);
      const p = pendenciaProposta({ tipo: 'CONFLITO', versionServidor: 4, dadosServidor: prop('c1') });
      await db.pendencias.put(p);

      const promessa = svc.usarServidor(p);
      (await vi.waitFor(() => http.expectOne('/api/sync/agregado/proposta/p1')))
        .flush({ codigo: 'NAO_ENCONTRADO' }, { status: 404, statusText: 'Not Found' });
      await promessa;

      expect(await db.propostas.get('p1')).toBeUndefined();
      expect((await db.documentos.toArray()).map((d) => d.id)).toEqual(['d9']);
      expect(await db.pendencias.count()).toBe(0);
    });

    describe('OS e anexos da OS', () => {
      const osDados = { codigoProvisorio: 'OSP-0Z9XY7', tipo: 'INSTALACAO', status: 'ABERTA', urgente: false, concluiProposta: true,
        assinaturaRecusada: false, itens: [], notas: [] } as const;
      const anexo = (id: string, osId: string, enviado: boolean): AnexoOsLocal => ({
        id, osId, tipo: 'FOTO', sha256: 'b'.repeat(64), legenda: null, momento: null, tiradaEm: null, assinanteNome: null,
        assinantePapel: null, revisaoOs: null, codigoExibido: null, bytes: enviado ? null : new ArrayBuffer(3),
        miniatura: new ArrayBuffer(2), enviado, arquivoId: enviado ? `a-${id}` : null,
      });
      const uploadOs = (mutationId: string, anexoId: string): MutacaoLocal => ({
        mutationId, entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', op: 'UPLOAD', baseVersion: null,
        dados: { anexoId }, separada: true, criadaEm: '',
      });

      it('descartar o upload recusado de um anexo apaga só esse anexo não enviado e libera a OS', async () => {
        await db.os.put(paraOsLocal('o1', 3, { ...osDados, itens: [], notas: [] }));
        await db.anexosOs.bulkPut([anexo('f1', 'o1', false), anexo('f2', 'o1', false), anexo('f0', 'o1', true)]);
        await db.outbox.add(uploadOs('up2', 'f2'));
        const p: Pendencia = {
          mutationId: 'up1', entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', tipo: 'REJEITADO', criadaEm: '',
          erro: { codigo: 'LIMITE_FOTOS', mensagem: 'x' }, mutacao: uploadOs('up1', 'f1'),
        };
        await db.pendencias.put(p);

        await svc.descartar(p);

        expect(await db.pendencias.count()).toBe(0);
        expect((await db.anexosOs.toArray()).map((a) => a.id).sort()).toEqual(['f0', 'f2']);
        expect((await db.outbox.toArray()).map((m) => m.mutationId)).toEqual(['up2']);
        expect(await db.os.get('o1')).toBeDefined();
        expect(TestBed.inject(SyncService).sincronizar).toHaveBeenCalled();
      });

      it('descartar a criação recusada da OS apaga a local, os anexos dela e os uploads da fila', async () => {
        await db.os.put(paraOsLocal('o1', null, { ...osDados, itens: [], notas: [] }));
        await db.anexosOs.bulkPut([anexo('f1', 'o1', false), anexo('f0', 'o1', true), anexo('f9', 'o9', true)]);
        await db.outbox.add(uploadOs('up1', 'f1'));
        const mutacao: MutacaoLocal = {
          mutationId: 'mo', entidade: 'os', agregadoId: 'o1', op: 'UPSERT', baseVersion: null, dados: osDados, criadaEm: '',
        };
        const p: Pendencia = {
          mutationId: 'mo', entidade: 'os', agregadoId: 'o1', tipo: 'REJEITADO', criadaEm: '',
          erro: { codigo: 'VALIDACAO', mensagem: 'x' }, mutacao,
        };
        await db.pendencias.put(p);

        await svc.descartar(p);

        expect(await db.os.get('o1')).toBeUndefined();
        expect((await db.anexosOs.toArray()).map((a) => a.id)).toEqual(['f9']);
        expect(await db.outbox.count()).toBe(0);
        expect(await db.pendencias.count()).toBe(0);
      });
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

    it('P4c-R15: descartaEnvio diz se "Usar a do servidor" levaria um envio ou um PDF feito neste aparelho', async () => {
      await db.propostas.put(paraPropostaLocal('p1', 3, prop('c1')));
      const conflito: Pendencia = {
        mutationId: 'e1', entidade: 'proposta', agregadoId: 'p1', tipo: 'CONFLITO', criadaEm: '', versionServidor: 5,
        dadosServidor: prop('c2'), mutacao: { ...mutProposta('e1', 'p1', 'c1'), baseVersion: 3 },
      };
      await db.pendencias.put(conflito);
      // só a edição em conflito (e uma atribuição atrás dela, que não é envio): nada a perder além dela
      await db.outbox.add({ ...mutProposta('a1', 'p1', 'c1'), baseVersion: 3, dados: { ...prop('c1'), status: 'ENVIADA' } });
      await db.documentos.put(doc('d0', true));
      expect(await svc.descartaEnvio(conflito)).toBe(false);

      // a transição para ENVIADA retida atrás do conflito
      const t1 = await db.outbox.add({ ...mutProposta('t1', 'p1', 'c1'), baseVersion: 3, dados: { ...prop('c1'), status: 'ENVIADA' }, separada: true });
      expect(await svc.descartaEnvio(conflito)).toBe(true);
      await db.outbox.delete(t1);

      // o UPLOAD de um PDF na fila
      const u = await db.outbox.add(upload('up1', 'd1'));
      expect(await svc.descartaEnvio(conflito)).toBe(true);
      await db.outbox.delete(u);

      // um PDF gerado aqui que ainda não foi enviado
      await db.documentos.put(doc('d1', false));
      expect(await svc.descartaEnvio(conflito)).toBe(true);
      await db.documentos.delete('d1');

      // o próprio envio em conflito
      const envioEmConflito: Pendencia = {
        ...conflito, mutacao: { ...conflito.mutacao, dados: { ...prop('c1'), status: 'ENVIADA' }, separada: true },
      };
      expect(await svc.descartaEnvio(envioEmConflito)).toBe(true);
      // outra entidade: nunca
      expect(await svc.descartaEnvio(pendencia({ tipo: 'CONFLITO' }))).toBe(false);
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


  describe('corrigirProposta (P4b-R23)', () => {
    const catalogo = (codigo: string, ativo = true): ItemCatalogoDados => ({
      natureza: 'PRODUTO', codigo, nome: codigo, descricao: null, unidade: 'un', precoVenda: 10, locavel: false,
      fotoArquivoId: null, ativo,
    });
    const linhaDados = (id: string, itemCatalogoId: string) => ({
      id, itemCatalogoId, codigo: itemCatalogoId, nome: itemCatalogoId, unidade: 'un', natureza: 'PRODUTO' as const,
      quantidade: 1, precoUnitario: 10, descontoPercentual: 0, meses: null,
    });
    const proposta = (status: PropostaDados['status'], extra: Partial<PropostaDados> = {}): PropostaDados => ({
      codigoProvisorio: 'PROV-0Z9XY7', tipo: 'VENDA', status, responsavelId: 'u1', dataEmissao: '2026-10-01',
      clienteId: 'c1', templateId: 't1', descontoGeralPercentual: 0, itens: [linhaDados('l1', 'i1')], ...extra,
    });
    const linhaNova: LinhaRascunho = {
      id: 'l2', itemCatalogoId: 'i2', codigo: 'i2', nome: 'i2', descricao: null, unidade: 'un', natureza: 'PRODUTO',
      precoCustoCentavos: null, quantidadeMilesimos: 2000, precoUnitarioCentavos: 1000, descontoCentesimos: 0, meses: null,
    };
    const mut = (mutationId: string, seq: number, dados: PropostaDados, extra: Partial<MutacaoLocal> = {}): MutacaoLocal => ({
      seq, mutationId, entidade: 'proposta', agregadoId: 'p1', op: 'UPSERT', baseVersion: 3, dados, criadaEm: '', ...extra,
    });

    async function cenario(): Promise<Pendencia> {
      await db.itens.bulkPut([paraItemLocal('i1', 2, catalogo('i1', false)), paraItemLocal('i2', 1, catalogo('i2'))]);
      // otimista: já ENVIADA no aparelho, com o PDF gerado (o cliente já recebeu)
      await db.propostas.put(paraPropostaLocal('p1', 3, proposta('ENVIADA')));
      await db.documentos.put({
        id: 'd1', propostaId: 'p1', revisao: 1, codigoExibido: 'PROV-0Z9XY7', sha256: 'a'.repeat(64), geradoEm: '',
        geradoPor: 'u1', bytes: null, enviado: false, arquivoId: null,
      });
      // E (seq 5) foi recusada; atrás dela: T (ENVIADA), o UPLOAD e A (APROVADA); seq 9 é de outra proposta
      await db.outbox.bulkAdd([
        mut('t1', 6, proposta('ENVIADA'), { separada: true }),
        { seq: 7, mutationId: 'up1', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', op: 'UPLOAD', baseVersion: null,
          dados: { documentoId: 'd1' }, separada: true, criadaEm: '' },
        mut('a1', 8, proposta('APROVADA'), { separada: true }),
        mut('o1', 9, proposta('RASCUNHO', { clienteId: 'c5' }), { agregadoId: 'p2' }),
      ]);
      const p: Pendencia = {
        mutationId: 'e1', entidade: 'proposta', agregadoId: 'p1', tipo: 'REJEITADO', criadaEm: '',
        erro: { codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { 'itens[0].itemCatalogoId': 'Item do catálogo inativo.' } },
        mutacao: mut('e1', 5, proposta('RASCUNHO')),
      };
      await db.pendencias.put(p);
      return p;
    }

    it('aplica a edição na recusada e nas retidas do agregado, devolve no seq dela e mantém o status otimista', async () => {
      await cenario();

      await svc.corrigirProposta('e1', { itens: [linhaNova], observacoes: '  Corrigida ' });

      expect(await db.pendencias.count()).toBe(0);
      const fila = await db.outbox.orderBy('seq').toArray();
      expect(fila.map((m) => m.seq)).toEqual([5, 6, 7, 8, 9]);
      for (const [i, status] of [[0, 'RASCUNHO'], [1, 'ENVIADA'], [3, 'APROVADA']] as const) {
        const d = fila[i].dados as PropostaDados;
        expect(d).toMatchObject({ status, observacoes: 'Corrigida', totalItens: 20, total: 20 });
        expect(d.itens).toMatchObject([{ id: 'l2', itemCatalogoId: 'i2', quantidade: 2, precoUnitario: 10, subtotal: 20, ordem: 0 }]);
        // reescrita = outra mutação, fora de voo; a transição continua separada
        expect(fila[i].enviando).toBe(false);
        expect(!!fila[i].separada).toBe(i !== 0);
      }
      expect(fila.map((m) => m.mutationId).filter((x) => ['e1', 't1', 'a1'].includes(x))).toEqual([]);
      // o upload e a outra proposta ficam como estavam
      expect(fila[2]).toMatchObject({ mutationId: 'up1', op: 'UPLOAD', dados: { documentoId: 'd1' } });
      expect(fila[4]).toMatchObject({ mutationId: 'o1', dados: { clienteId: 'c5', itens: [{ id: 'l1' }] } });
      expect(await db.propostas.get('p1')).toMatchObject({
        status: 'ENVIADA', version: 3, observacoes: 'Corrigida', totalCentavos: 2000, itens: [{ id: 'l2', subtotalCentavos: 2000 }],
      });
      expect(await db.documentos.get('d1')).toMatchObject({ enviado: false, codigoExibido: 'PROV-0Z9XY7' });
      expect(TestBed.inject(SyncService).sincronizar).toHaveBeenCalled();
    });

    it('a correção passa pela validação do rascunho: inválida é recusada no campo e nada muda', async () => {
      await cenario();
      const antes = await db.outbox.orderBy('seq').toArray();
      for (const [edicao, campo] of [
        [{ itens: [{ ...linhaNova, quantidadeMilesimos: 0 }] }, 'itens[0].quantidade'],
        [{ itens: [{ ...linhaNova, id: 'l3', itemCatalogoId: 'i1' }] }, 'itens[0].itemCatalogoId'],
        [{ validadeAte: '2026-02-30' }, 'validadeAte'],
        [{ tecnicoId: 'nao-e-tecnico' }, 'tecnicoId'],
      ] as const) {
        const e = await svc.corrigirProposta('e1', edicao).then(() => null, (x: unknown) => x);
        expect(e).toBeInstanceOf(ErroProposta);
        expect((e as ErroProposta).campo).toBe(campo);
      }
      expect(await db.outbox.orderBy('seq').toArray()).toEqual(antes);
      expect(await db.pendencias.count()).toBe(1);
      expect((await db.propostas.get('p1'))!.itens.map((l) => l.id)).toEqual(['l1']);
    });

    it('pendência que já não existe, que não é de proposta ou que não é recusa de dados: erro claro, nada muda', async () => {
      await cenario();
      const sumiu = await svc.corrigirProposta('nao-existe', { observacoes: 'x' }).then(() => null, (x: unknown) => x);
      expect(sumiu).toBeInstanceOf(ErroProposta);
      expect(sumiu).toMatchObject({ codigo: 'PENDENCIA_INEXISTENTE', message: 'Esta pendência já foi resolvida.' });

      await db.pendencias.bulkPut([
        pendencia({ mutationId: 'cli', tipo: 'REJEITADO', erro: { codigo: 'VALIDACAO', mensagem: 'x' } }),
        { ...(await db.pendencias.get('e1'))!, mutationId: 'conf', agregadoId: 'p3', tipo: 'CONFLITO', versionServidor: 4 },
        {
          mutationId: 'up', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p4', tipo: 'REJEITADO', criadaEm: '',
          mutacao: { mutationId: 'up', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p4', op: 'UPLOAD', baseVersion: null, dados: { documentoId: 'd1' }, criadaEm: '' },
        },
      ]);
      for (const id of ['cli', 'conf', 'up']) {
        const e = await svc.corrigirProposta(id, { observacoes: 'x' }).then(() => null, (x: unknown) => x);
        expect(e).toMatchObject({
          codigo: 'PENDENCIA_NAO_CORRIGIVEL', message: 'Só uma proposta recusada pelo servidor pode ser corrigida aqui.',
        });
      }
      expect(await db.pendencias.count()).toBe(4);
      expect((await db.outbox.toArray()).map((m) => m.mutationId)).toEqual(['t1', 'up1', 'a1', 'o1']);
    });

    it('P4b-R28: só corrige a recusa VALIDACAO de dados de rascunho; o resto é PENDENCIA_NAO_CORRIGIVEL', async () => {
      const p = await cenario();
      const recusas: Pendencia[] = [
        { ...p, erro: { codigo: 'TRANSICAO_INVALIDA', mensagem: 'Uma proposta nova começa como rascunho.' } },
        { ...p, erro: { codigo: 'ACESSO_NEGADO', mensagem: 'x' } },
        { ...p, mutacao: { ...p.mutacao, dados: proposta('APROVADA') } },
        { ...p, mutacao: { ...p.mutacao, dados: proposta('ENVIADA') } },
        // "Nova revisão" (ENVIADA → RASCUNHO, separada): campos editados nela o servidor recusa (fora do rascunho)
        { ...p, mutacao: { ...p.mutacao, separada: true } },
      ];
      for (const r of recusas) {
        await db.pendencias.put(r);
        const e = await svc.corrigirProposta('e1', { itens: [linhaNova] }).then(() => null, (x: unknown) => x);
        expect(e).toMatchObject({ codigo: 'PENDENCIA_NAO_CORRIGIVEL' });
      }
      expect(await db.pendencias.count()).toBe(1);
      expect((await db.outbox.toArray()).map((m) => m.mutationId)).toEqual(['t1', 'up1', 'a1', 'o1']);
    });

    it('P4b-R29: numa edição recusada, as linhas citadas na recusa são novas para o catálogo (as outras, não)', async () => {
      const p = await cenario();
      // a recusa cita a linha 0 (l1, item i1 inativo), que já está na cópia local otimista
      const e = await svc.corrigirProposta('e1', { observacoes: 'só isto' }).then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(ErroProposta);
      expect((e as ErroProposta).campo).toBe('itens[0].itemCatalogoId');
      expect(await db.pendencias.count()).toBe(1);

      // l9 (item i9, também inativo) não foi citada: continua "existente" e não é conferida; trocar l1 basta
      await db.itens.put(paraItemLocal('i9', 2, catalogo('i9', false)));
      const comL9 = proposta('RASCUNHO', { itens: [linhaDados('l1', 'i1'), linhaDados('l9', 'i9')] });
      await db.propostas.put(paraPropostaLocal('p1', 3, { ...comL9, status: 'ENVIADA' }));
      await db.pendencias.put({ ...p, mutacao: { ...p.mutacao, dados: comL9 } });
      const l9 = (await db.propostas.get('p1'))!.itens[1];
      await svc.corrigirProposta('e1', { itens: [linhaNova, l9] });
      expect(await db.pendencias.count()).toBe(0);
      expect(((await db.outbox.get(5))!.dados as PropostaDados).itens.map((l) => l.id)).toEqual(['l2', 'l9']);
    });

    it('o técnico e o comercial que não é o responsável não corrigem', async () => {
      await cenario();
      for (const u of [{ id: 'u-tec', perfil: 'TECNICO' }, { id: 'u2', perfil: 'COMERCIAL' }] as const) {
        usuarioAtual = { ...usuarioAtual, ...u };
        const e = await svc.corrigirProposta('e1', { observacoes: 'x' }).then(() => null, (x: unknown) => x);
        expect(e).toMatchObject({ codigo: 'ACESSO_NEGADO' });
      }
      expect(await db.pendencias.count()).toBe(1);
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
