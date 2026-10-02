import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';
import { ItemCatalogoDados, paraItemLocal } from '../../features/catalogo/item-models';
import { ClienteDados, paraClienteLocal } from '../../features/clientes/cliente-models';
import { AnexoOsLocal, OsDados, paraOsLocal } from '../../features/os/os-models';
import { OsRepo } from '../../features/os/os-repo';
import { PdfService } from '../pdf/pdf-service';
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
        assinantePapel: null, revisaoOs: null, codigoExibido: null,
        miniatura: new ArrayBuffer(2), enviado, arquivoId: enviado ? `a-${id}` : null,
      });
      /** Os metadados em `anexosOs` e, no não enviado, os bytes em `anexosOsBytes` (M2P2-R16). */
      const gravarAnexos = async (...xs: (AnexoOsLocal | AnexoOsLocal[])[]) => {
        for (const a of xs.flat()) {
          await db.anexosOs.put(a);
          if (!a.enviado) await db.anexosOsBytes.put({ id: a.id, bytes: new ArrayBuffer(3) });
        }
      };
      const comBytes = async () => ((await db.anexosOsBytes.toCollection().primaryKeys()) as string[]).sort();
      const uploadOs = (mutationId: string, anexoId: string): MutacaoLocal => ({
        mutationId, entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', op: 'UPLOAD', baseVersion: null,
        dados: { anexoId }, separada: true, criadaEm: '',
      });

      it('descartar o upload recusado de um anexo apaga só esse anexo não enviado e libera a OS', async () => {
        await db.os.put(paraOsLocal('o1', 3, { ...osDados, itens: [], notas: [] }));
        await gravarAnexos([anexo('f1', 'o1', false), anexo('f2', 'o1', false), anexo('f0', 'o1', true)]);
        await db.outbox.add(uploadOs('up2', 'f2'));
        const p: Pendencia = {
          mutationId: 'up1', entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', tipo: 'REJEITADO', criadaEm: '',
          erro: { codigo: 'LIMITE_FOTOS', mensagem: 'x' }, mutacao: uploadOs('up1', 'f1'),
        };
        await db.pendencias.put(p);

        await svc.descartar(p);

        expect(await db.pendencias.count()).toBe(0);
        expect((await db.anexosOs.toArray()).map((a) => a.id).sort()).toEqual(['f0', 'f2']);
        expect(await comBytes()).toEqual(['f2']);
        expect((await db.outbox.toArray()).map((m) => m.mutationId)).toEqual(['up2']);
        expect(await db.os.get('o1')).toBeDefined();
        expect(TestBed.inject(SyncService).sincronizar).toHaveBeenCalled();
      });

      it('descartar a criação recusada da OS apaga a local, os anexos dela e os uploads da fila', async () => {
        await db.os.put(paraOsLocal('o1', null, { ...osDados, itens: [], notas: [] }));
        await gravarAnexos([anexo('f1', 'o1', false), anexo('f0', 'o1', true), anexo('f9', 'o9', true)]);
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
        expect(await comBytes()).toEqual([]);
        expect(await db.outbox.count()).toBe(0);
        expect(await db.pendencias.count()).toBe(0);
      });

      describe('"Manter a minha" (M2P1-R19)', () => {
        const TEC = 'u-tec';
        /** O servidor: o escritório mudou a data, a descrição, o endereço, as linhas e o resumo enquanto o técnico estava offline. */
        const doServidor = (extra: Partial<OsDados> = {}): OsDados => ({
          codigoProvisorio: 'OSP-0Z9XY7', numero: 123, revisao: 1, propostaId: 'p1', clienteId: 'c1', tipo: 'INSTALACAO',
          status: 'EM_ANDAMENTO', responsavelId: 'u1', tecnicoId: TEC, dataPrevista: '2026-10-09', urgente: true,
          concluiProposta: true, descricao: 'Do escritório', enderecoLogradouro: 'Av. Nova', resumoExecucao: 'Do escritório',
          assinaturaRecusada: false,
          itens: [{ id: 'l1', itemCatalogoId: 'i1', codigo: 'P-1', nome: 'Painel', unidade: 'un', natureza: 'PRODUTO', quantidadePrevista: 3, ordem: 0 }],
          notas: [{ id: 'n0', texto: 'Do escritório', autorId: 'u-adm', criadaEm: '2026-10-01T10:00:00Z' }],
          anexos: [], historico: [], atualizadoEm: '2026-10-01T10:00:00Z', ...extra,
        });
        /** O que o aparelho conhecia e mandou (o `paraEnvio`: `responsavelId` null na OS de proposta). */
        const doAparelho = (extra: Partial<OsDados> = {}): OsDados => ({
          ...doServidor(), dataPrevista: '2026-10-05', urgente: false, descricao: 'Antiga', enderecoLogradouro: 'Av. Velha',
          resumoExecucao: null, responsavelId: null, notas: [], atualizadoEm: '2026-09-30T10:00:00Z',
          itens: [{ id: 'l1', itemCatalogoId: 'i1', codigo: 'P-1', nome: 'Painel', unidade: 'un', natureza: 'PRODUTO', quantidadePrevista: 2, ordem: 0 }],
          ...extra,
        });
        const nota = (id: string, texto: string) => ({ id, texto, autorId: null, criadaEm: null });
        const mutOs = (mutationId: string, seq: number, dados: OsDados, extra: Partial<MutacaoLocal> = {}): MutacaoLocal => ({
          seq, mutationId, entidade: 'os', agregadoId: 'o1', op: 'UPSERT', baseVersion: 4, dados, criadaEm: '', ...extra,
        });
        const CABECALHO_DO_SERVIDOR = {
          dataPrevista: '2026-10-09', urgente: true, descricao: 'Do escritório', enderecoLogradouro: 'Av. Nova', tecnicoId: TEC,
        };

        /**
         * A fila offline do técnico: N (nota e resumo, seq 5) voltou CONFLITO (o ADMIN mexeu no resumo); atrás dela, a foto
         * f1 (seq 6) e o concluir (seq 7, separada). A OS local tem o cabeçalho antigo.
         */
        async function cenario(): Promise<Pendencia> {
          usuarioAtual = { id: TEC, nome: 'Téo', email: 'teo@regera.com', perfil: 'TECNICO', ativo: true };
          const n = doAparelho({ resumoExecucao: 'Meu resumo', notas: [nota('n1', 'Cheguei')] });
          const c = doAparelho({ status: 'CONCLUIDA', resumoExecucao: 'Meu resumo', assinaturaRecusada: true, motivoRecusa: 'Ausente',
            notas: [nota('n1', 'Cheguei'), nota('n2', 'Saí')] });
          await db.os.put({
            ...paraOsLocal('o1', 4, { ...c, responsavelId: 'u1' }), iniciadaLocalEm: '2026-10-01T09:00:00Z',
            notas: [{ ...nota('n1', 'Cheguei'), autorLocalId: TEC, criadaLocalEm: '2026-10-01T09:10:00Z' },
              { ...nota('n2', 'Saí'), autorLocalId: TEC, criadaLocalEm: '2026-10-01T11:00:00Z' }],
          });
          await gravarAnexos(anexo('f1', 'o1', false));
          await db.outbox.bulkAdd([uploadOs('up1', 'f1'), mutOs('c1', 7, c, { separada: true })].map((m, i) => ({ ...m, seq: 6 + i })));
          const p: Pendencia = {
            mutationId: 'n', entidade: 'os', agregadoId: 'o1', tipo: 'CONFLITO', criadaEm: '', versionServidor: 7,
            dadosServidor: doServidor(), mutacao: mutOs('n', 5, n),
          };
          await db.pendencias.put(p);
          return p;
        }

        it('rebaseia no lugar a do conflito, as seguintes e a OS local: o que o técnico não edita vem do servidor', async () => {
          const p = await cenario();

          await svc.manterMinha(p);

          expect(await db.pendencias.count()).toBe(0);
          const f = await db.outbox.orderBy('seq').toArray();
          expect(f.map((m) => [m.seq, m.entidade, m.op])).toEqual([[5, 'os', 'UPSERT'], [6, TIPO_UPLOAD_ANEXO_OS, 'UPLOAD'], [7, 'os', 'UPSERT']]);
          expect(f[0]).toMatchObject({ baseVersion: 7, enviando: false, dados: {
            ...CABECALHO_DO_SERVIDOR, status: 'EM_ANDAMENTO', resumoExecucao: 'Meu resumo', responsavelId: null,
          } });
          expect(f[0].mutationId).not.toBe('n');
          const n = f[0].dados as OsDados;
          expect(n.itens[0].quantidadePrevista).toBe(3);
          expect(n.notas.map((x) => x.id)).toEqual(['n0', 'n1']);
          // a seguinte: o cabeçalho que ela trazia era o mesmo da do conflito, então também passa a ser o do servidor
          expect(f[2]).toMatchObject({ separada: true, dados: {
            ...CABECALHO_DO_SERVIDOR, status: 'CONCLUIDA', resumoExecucao: 'Meu resumo', assinaturaRecusada: true, motivoRecusa: 'Ausente',
          } });
          expect((f[2].dados as OsDados).notas.map((x) => x.id)).toEqual(['n0', 'n1', 'n2']);
          expect(f[1]).toMatchObject({ mutationId: 'up1', dados: { anexoId: 'f1' } });
          const local = (await db.os.get('o1'))!;
          // o responsável continua o da OS (a mutação manda null, que é "manter")
          expect(local).toMatchObject({ ...CABECALHO_DO_SERVIDOR, version: 7, status: 'CONCLUIDA', resumoExecucao: 'Meu resumo',
            iniciadaLocalEm: '2026-10-01T09:00:00Z', responsavelId: 'u1' });
          expect(local.notas.map((x) => [x.id, x.autorLocalId ?? null])).toEqual([['n0', null], ['n1', TEC], ['n2', TEC]]);
          expect(await db.anexosOs.get('f1')).toMatchObject({ enviado: false });
        });

        it('com o SyncService real: o servidor aceita a do conflito, a foto e o concluir, e nada volta para as pendências', async () => {
          const p = await cenario();
          await svc.manterMinha(p);
          const sync = TestBed.inject(SyncService);
          vi.mocked(sync.sincronizar).mockRestore();
          (TestBed.inject(ConectividadeService).online as WritableSignal<boolean>).set(true);
          const ok = (req: TestRequest, version: number, d: unknown) =>
            req.flush({ resultados: [{ mutationId: req.request.body.mutacoes[0].mutationId, status: 'OK', version, dados: d }] });

          const rodada = sync.sincronizar();
          const push1 = await vi.waitFor(() => http.expectOne('/api/sync/push'));
          const enviado1 = push1.request.body.mutacoes[0];
          expect(enviado1).toMatchObject({ entidade: 'os', id: 'o1', baseVersion: 7, dados: { ...CABECALHO_DO_SERVIDOR, responsavelId: null } });
          const aceito = doServidor({ resumoExecucao: 'Meu resumo', notas: [...doServidor().notas,
            { id: 'n1', texto: 'Cheguei', autorId: TEC, criadaEm: '2026-10-01T15:00:00Z' }] });
          ok(push1, 8, aceito);
          (await vi.waitFor(() => http.expectOne('/api/os/o1/anexos'))).flush({
            anexo: { id: 'f1', tipo: 'FOTO', arquivoId: 'af1', sha256: 'b'.repeat(64), autorId: TEC, criadoEm: '2026-10-01T15:01:00Z' },
            versaoOs: 9,
          }, { status: 201, statusText: 'Created' });
          const push2 = await vi.waitFor(() => http.expectOne('/api/sync/push'));
          expect(push2.request.body.mutacoes[0]).toMatchObject({
            baseVersion: 9, dados: { ...CABECALHO_DO_SERVIDOR, status: 'CONCLUIDA', responsavelId: null, resumoExecucao: 'Meu resumo' },
          });
          ok(push2, 10, { ...aceito, status: 'CONCLUIDA', assinaturaRecusada: true, motivoRecusa: 'Ausente' });
          (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull')))
            .flush({ cursor: 1, temMais: false, mudancas: [], usuarios: [] });
          await rodada;

          expect(await db.pendencias.count()).toBe(0);
          expect(await db.outbox.count()).toBe(0);
          expect(await db.os.get('o1')).toMatchObject({ version: 10, status: 'CONCLUIDA', dataPrevista: '2026-10-09' });
          http.expectNone('/api/sync/push');
        });

        it('M2P2-R11: com a OS reaberta lá (V1) e uma nota atrás, a OS local passa à revisão 2: o PDF da nova conclusão sai -R2', async () => {
          usuarioAtual = { id: TEC, nome: 'Téo', email: 'teo@regera.com', perfil: 'TECNICO', ativo: true };
          const n1 = doAparelho({ resumoExecucao: 'Meu resumo', notas: [nota('n1', 'Cheguei')] });
          const n2 = doAparelho({ resumoExecucao: 'Meu resumo', notas: [nota('n1', 'Cheguei'), nota('n2', 'Saí')] });
          await db.os.put(paraOsLocal('o1', 4, { ...n2, responsavelId: 'u1' }));
          await db.outbox.add(mutOs('m2', 6, n2));
          // o escritório concluiu e reabriu: revisão 2, e a conclusão anterior saiu
          const servidor = doServidor({ revisao: 2, concluidaEm: null });
          const p: Pendencia = {
            mutationId: 'n', entidade: 'os', agregadoId: 'o1', tipo: 'CONFLITO', criadaEm: '', versionServidor: 9,
            dadosServidor: servidor, mutacao: mutOs('n', 5, n1),
          };
          await db.pendencias.put(p);

          await svc.manterMinha(p);

          const [primeira, segunda] = await db.outbox.orderBy('seq').toArray();
          expect(primeira.dados).toMatchObject({ revisao: 2, status: 'EM_ANDAMENTO' });
          expect(segunda.dados).toMatchObject({ revisao: 2, status: 'EM_ANDAMENTO' });
          expect(await db.os.get('o1')).toMatchObject({ revisao: 2, numero: 123, status: 'EM_ANDAMENTO' });

          // o técnico conclui de novo, ainda com a nota na fila: o PDF é o da revisão 2
          vi.spyOn(TestBed.inject(PdfService), 'logoDataUrl').mockResolvedValue(null);
          await TestBed.inject(OsRepo).recusarAssinatura('o1', 'Cliente ausente');
          const { codigoExibido } = await TestBed.inject(OsRepo).concluir('o1', 'Feito', async () => new Blob(['%PDF-1.7']));
          expect(codigoExibido).toBe('OS-000123-R2');
          const pdf = (await db.anexosOs.toArray()).find((a) => a.tipo === 'DOCUMENTO');
          expect(pdf).toMatchObject({ revisaoOs: 2, codigoExibido: 'OS-000123-R2' });
        });

        it('M2P2-R11: o número do servidor entra na OS local que ainda não o tinha', async () => {
          await cenario();
          await db.os.update('o1', { numero: null });
          await db.outbox.update(7, { dados: { ...((await db.outbox.get(7))!.dados as OsDados), numero: null } });
          await svc.manterMinha((await db.pendencias.get('n'))!);
          expect((await db.os.get('o1'))!.numero).toBe(123);
          expect(((await db.outbox.get(7))!.dados as OsDados).numero).toBe(123);
        });

        it('M2: notas que o perfil não acrescenta no status do servidor (ADMIN na cancelada) saem, e o resultado avisa', async () => {
          const p = await cenario();
          expect(await svc.manterMinha(p)).toEqual({ notasDescartadas: false });

          await db.outbox.clear();
          await cenario();
          usuarioAtual = { id: 'u-adm', nome: 'Ana', email: 'ana@regera.com', perfil: 'ADMIN', ativo: true };
          const cancelada = { ...(await db.pendencias.get('n'))!, dadosServidor: doServidor({ status: 'CANCELADA' }) };
          await db.pendencias.put(cancelada);
          expect(await svc.manterMinha(cancelada)).toEqual({ notasDescartadas: true });
          expect(((await db.outbox.get(5))!.dados as OsDados).notas.map((x) => x.id)).toEqual(['n0']);
        });

        it('M3/M1: perdaDaOs diz o que a ação levaria: as notas, a foto, a recusa, a conclusão e o resumo da fila', async () => {
          const p = await cenario();
          expect(await svc.perdaDaOs(p)).toEqual(['notas', 'fotos', 'recusa', 'conclusao', 'resumo']);
          await db.anexosOs.clear();
          await db.outbox.delete(6);
          expect(await svc.perdaDaOs(p)).toEqual(['notas', 'recusa', 'conclusao', 'resumo']);
          expect(await svc.descartaEnvio(p)).toBe(true);
          // as notas que o servidor já tem não contam
          await db.outbox.clear();
          const semNova = { ...p, mutacao: { ...p.mutacao, dados: doAparelho({ notas: [{ id: 'n0', texto: 'Do escritório', autorId: 'u-adm', criadaEm: 'x' }] }) } };
          await db.pendencias.put(semNova);
          expect(await svc.perdaDaOs(semNova)).toEqual([]);
          await db.pendencias.put(p);
          // nem o resumo que o servidor já tem
          const jaLa = { ...p, dadosServidor: doServidor({ resumoExecucao: 'Meu resumo', notas: [{ id: 'n1', texto: 'Cheguei', autorId: TEC, criadaEm: 'y' }] }) };
          expect(await svc.perdaDaOs(jaLa)).toEqual([]);
          expect(await svc.descartaEnvio(jaLa)).toBe(false);
        });

        describe('M1: o resto do trabalho de campo na fila também conta', () => {
          const conflitoCom = (dados: OsDados, extra: Partial<Pendencia> = {}, mutacao: Partial<MutacaoLocal> = {}): Pendencia => ({
            mutationId: 'n', entidade: 'os', agregadoId: 'o1', tipo: 'CONFLITO', criadaEm: '', versionServidor: 7,
            dadosServidor: doServidor(), mutacao: mutOs('n', 5, dados, mutacao), ...extra,
          });
          const rejeitadaSemServidor = (dados: OsDados, mutacao: Partial<MutacaoLocal> = {}) => conflitoCom(dados,
            { tipo: 'REJEITADO', dadosServidor: undefined, versionServidor: undefined, erro: { codigo: 'VALIDACAO', mensagem: 'x' } }, mutacao);

          it('só um recusarAssinatura na fila: a recusa da assinatura (a mesma que o servidor já tem não conta)', async () => {
            const p = conflitoCom(doAparelho({ resumoExecucao: null, assinaturaRecusada: true, motivoRecusa: 'Cliente ausente' }));
            await db.pendencias.put(p);
            expect(await svc.perdaDaOs(p)).toEqual(['recusa']);
            expect(await svc.descartaEnvio(p)).toBe(true);
            expect(await svc.perdaDaOs({ ...p, dadosServidor: doServidor({ assinaturaRecusada: true, motivoRecusa: 'Cliente ausente' }) })).toEqual([]);
          });

          it('o "Precisa voltar" (concluiProposta desmarcado aqui); desmarcado também no servidor, não', async () => {
            const p = conflitoCom(doAparelho({ concluiProposta: false }));
            await db.pendencias.put(p);
            expect(await svc.perdaDaOs(p)).toEqual(['precisaVoltar']);
            expect(await svc.perdaDaOs({ ...p, dadosServidor: doServidor({ concluiProposta: false }) })).toEqual([]);
          });

          it('um iniciar sozinho, recusado (sem o estado do servidor): o início', async () => {
            const p = rejeitadaSemServidor(doAparelho({ status: 'EM_ANDAMENTO' }), { separada: true });
            await db.pendencias.put(p);
            expect(await svc.perdaDaOs(p)).toEqual(['inicio']);
            // a mesma transição que o servidor já tem não é trabalho a perder (o status nunca volta, M2P1-R30 V2)
            expect(await svc.perdaDaOs({ ...p, dadosServidor: doServidor({ status: 'EM_ANDAMENTO' }) })).toEqual([]);
          });

          it('o concluir com "Precisa voltar" e o PDF, sem o estado do servidor: a conclusão, o resumo, o "Precisa voltar" e o PDF', async () => {
            const p = rejeitadaSemServidor(doAparelho({ status: 'CONCLUIDA', resumoExecucao: 'Falta peça', concluiProposta: false }), { separada: true });
            await db.pendencias.put(p);
            await gravarAnexos({ ...anexo('d1', 'o1', false), tipo: 'DOCUMENTO' });
            await db.outbox.add(uploadOs('up-d1', 'd1'));
            expect(await svc.perdaDaOs(p)).toEqual(['precisaVoltar', 'conclusao', 'resumo', 'pdf']);
          });

          it('as do escritório: a reabertura e o cancelamento', async () => {
            const reabrir = conflitoCom(doAparelho({ status: 'EM_ANDAMENTO', motivoReabertura: 'Faltou um item' }),
              { dadosServidor: doServidor({ status: 'CONCLUIDA' }) }, { separada: true });
            expect(await svc.perdaDaOs(reabrir)).toEqual(['reabertura']);
            const cancelar = conflitoCom(doAparelho({ status: 'CANCELADA', motivoCancelamento: 'Desistiu' }), {}, { separada: true });
            expect(await svc.perdaDaOs(cancelar)).toEqual(['cancelamento']);
            // o aceite do trabalho não é transição
            expect(await svc.perdaDaOs(conflitoCom(doAparelho({ aceitarTrabalho: true }), {}, { separada: true }))).toEqual([]);
          });

          it('I1 (T5): a correção feita na OS atrás da recusa (cabeçalho, técnico) conta, e o Descartar pede confirmação', async () => {
            const p = rejeitadaSemServidor(doAparelho());
            await db.pendencias.put(p);
            expect(await svc.perdaDaOs(p)).toEqual([]);
            // a reatribuição feita depois da recusa (a edição fica retida atrás dela)
            await db.outbox.add(mutOs('a1', 6, doAparelho({ tecnicoId: 'u-tec2' })));
            expect(await svc.perdaDaOs(p)).toEqual(['atribuicao']);
            expect(await svc.descartaEnvio(p)).toBe(true);
            // e a data, a descrição, o endereço ou as linhas
            await db.outbox.add(mutOs('a2', 7, doAparelho({ tecnicoId: 'u-tec2', dataPrevista: '2026-10-20' })));
            expect(await svc.perdaDaOs(p)).toEqual(['cabecalho', 'atribuicao']);
            await db.outbox.clear();
            const linhas = doAparelho().itens.map((l) => ({ ...l, quantidadePrevista: 5 }));
            await db.outbox.add(mutOs('a3', 6, doAparelho({ itens: linhas })));
            expect(await svc.perdaDaOs(p)).toEqual(['cabecalho']);
          });

          it('I1 (T5): o cabeçalho da própria mutação em conflito, diferente do servidor (mudado lá), não conta como perda daqui', async () => {
            const p = conflitoCom(doAparelho());
            expect(await svc.perdaDaOs(p)).toEqual([]);
          });

          it('I1 (T5): a criação recusada leva a OS inteira: "a OS criada neste aparelho"', async () => {
            const p = rejeitadaSemServidor(doAparelho({ status: 'ABERTA' }), { baseVersion: null });
            await db.pendencias.put(p);
            expect(await svc.perdaDaOs(p)).toEqual(['criacao']);
            expect(await svc.descartaEnvio(p)).toBe(true);
          });

          it('a assinatura colhida e a nota numa mutação separada (o teto de notas) depois do iniciar: um início só', async () => {
            const p = rejeitadaSemServidor(doAparelho({ status: 'EM_ANDAMENTO' }), { separada: true });
            await db.pendencias.put(p);
            await db.outbox.add(mutOs('n2', 6, doAparelho({ status: 'EM_ANDAMENTO', notas: [nota('n1', 'Cheguei')] }), { separada: true }));
            await gravarAnexos({ ...anexo('s1', 'o1', false), tipo: 'ASSINATURA' });
            expect(await svc.perdaDaOs(p)).toEqual(['inicio', 'notas', 'assinatura']);
          });
        });

        it('a do conflito sem os dados do servidor (excluída lá) ou um DELETE seguem a regra comum', async () => {
          await cenario();
          const p = { ...(await db.pendencias.get('n'))!, dadosServidor: undefined };
          await db.pendencias.put(p);
          await svc.manterMinha(p);
          const [primeira] = await db.outbox.orderBy('seq').toArray();
          expect(primeira).toMatchObject({ seq: 5, baseVersion: 7, dados: { dataPrevista: '2026-10-05', resumoExecucao: 'Meu resumo' } });
        });
      });

      it('P4c-R15 (M1): descartaEnvio da OS diz se a ação levaria fotos, assinatura ou PDF ainda não enviados', async () => {
        await db.os.put(paraOsLocal('o1', 3, { ...osDados, itens: [], notas: [] }));
        const conflitoOs: Pendencia = {
          mutationId: 'mo', entidade: 'os', agregadoId: 'o1', tipo: 'CONFLITO', criadaEm: '', versionServidor: 5,
          dadosServidor: osDados,
          mutacao: { mutationId: 'mo', entidade: 'os', agregadoId: 'o1', op: 'UPSERT', baseVersion: 3, dados: osDados, criadaEm: '' },
        };
        await db.pendencias.put(conflitoOs);
        // anexos já enviados (cópia do servidor) e de outra OS não contam
        await gravarAnexos([anexo('f0', 'o1', true), anexo('f9', 'o9', false)]);
        expect(await svc.descartaEnvio(conflitoOs)).toBe(false);

        // o upload de um anexo na fila (o anexo dele, gravado aqui e ainda não enviado)
        const u = await db.outbox.add(uploadOs('up1', 'f1'));
        await gravarAnexos(anexo('f1', 'o1', false));
        expect(await svc.perdaDaOs(conflitoOs)).toEqual(['fotos']);
        await db.outbox.delete(u);
        await db.anexosOs.delete('f1');

        // o upload recusado de um anexo, nas pendências
        const recusado: Pendencia = {
          mutationId: 'up2', entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', tipo: 'REJEITADO', criadaEm: '',
          erro: { codigo: 'LIMITE_FOTOS', mensagem: 'x' }, mutacao: uploadOs('up2', 'f2'),
        };
        await db.pendencias.put(recusado);
        await gravarAnexos({ ...anexo('f2', 'o1', false), tipo: 'ASSINATURA' });
        expect(await svc.perdaDaOs(conflitoOs)).toEqual(['assinatura']);
        await db.pendencias.delete('up2');
        await db.anexosOs.delete('f2');

        // uma foto, a assinatura ou o PDF gravados aqui e ainda não enviados
        for (const [tipo, item] of [['FOTO', 'fotos'], ['ASSINATURA', 'assinatura'], ['DOCUMENTO', 'pdf']] as const) {
          await gravarAnexos({ ...anexo('f3', 'o1', false), tipo });
          expect(await svc.descartaEnvio(conflitoOs)).toBe(true);
          expect(await svc.perdaDaOs(conflitoOs)).toEqual([item]);
          await db.anexosOs.delete('f3');
        }
        expect(await svc.descartaEnvio(conflitoOs)).toBe(false);
        // a recusa da criação da OS também (o Descartar apaga a OS e os anexos dela)
        await gravarAnexos(anexo('f4', 'o1', false));
        expect(await svc.descartaEnvio({ ...conflitoOs, tipo: 'REJEITADO', mutacao: { ...conflitoOs.mutacao, baseVersion: null } })).toBe(true);
        // o próprio upload recusado descarta só o anexo dele: não pergunta
        expect(await svc.descartaEnvio({ ...recusado })).toBe(false);
      });

      it('observarOsDasPendencias: as OS e o tipo dos anexos das pendências, sem ler os bytes de outras', async () => {
        await db.os.bulkPut([paraOsLocal('o1', 3, { ...osDados, numero: 123, itens: [], notas: [] }), paraOsLocal('o9', 1, { ...osDados, itens: [], notas: [] })]);
        await gravarAnexos([{ ...anexo('s1', 'o1', false), tipo: 'ASSINATURA' }, anexo('f9', 'o9', false)]);
        await db.pendencias.put({
          mutationId: 'up1', entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', tipo: 'REJEITADO', criadaEm: '',
          erro: { codigo: 'ACESSO_NEGADO', mensagem: 'x' }, mutacao: uploadOs('up1', 's1'),
        });
        const contexto = await firstValueFrom(svc.observarOsDasPendencias());
        expect([...contexto.os.keys()]).toEqual(['o1']);
        expect(contexto.os.get('o1')?.numero).toBe(123);
        expect([...contexto.tiposDeAnexo.entries()]).toEqual([['s1', 'ASSINATURA']]);
        expect([...contexto.revisoesDosPdfs.entries()]).toEqual([]);
      });

      it('observarOsDasPendencias: a revisão de cada PDF com upload pendente (sem revisão, a 1): o "Gerar PDF novamente"', async () => {
        await db.os.put(paraOsLocal('o1', 3, { ...osDados, numero: 123, revisao: 2, itens: [], notas: [] }));
        await gravarAnexos([
          { ...anexo('d1', 'o1', false), tipo: 'DOCUMENTO', revisaoOs: 1, codigoExibido: 'OS-000123' },
          { ...anexo('d2', 'o1', false), tipo: 'DOCUMENTO', revisaoOs: 2, codigoExibido: 'OS-000123-R2' },
          { ...anexo('d3', 'o1', false), tipo: 'DOCUMENTO' },
          anexo('f1', 'o1', false),
        ]);
        await db.pendencias.bulkPut(['d1', 'd2', 'd3', 'f1'].map((id) => ({
          mutationId: `up-${id}`, entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', tipo: 'REJEITADO' as const, criadaEm: '',
          erro: { codigo: 'CODIGO_EXIBIDO_INVALIDO', mensagem: 'x' }, mutacao: uploadOs(`up-${id}`, id),
        })));
        const contexto = await firstValueFrom(svc.observarOsDasPendencias());
        expect([...contexto.revisoesDosPdfs.entries()].sort()).toEqual([['d1', 1], ['d2', 2], ['d3', 1]]);
      });

      describe('M2P2-R13: a pendência que libera a OS a relê do servidor', () => {
        const TEC = 'u-tec';
        const URL = '/api/sync/agregado/os/o1';
        const online = () => TestBed.inject(ConectividadeService).online as WritableSignal<boolean>;
        const doServidor = (extra: Partial<OsDados> = {}): OsDados => ({
          ...osDados, numero: 123, revisao: 1, tecnicoId: TEC, responsavelId: 'u1', itens: [], notas: [], ...extra,
        });
        const documento = (id: string, revisaoOs = 1): AnexoOsLocal => ({
          ...anexo(id, 'o1', false), tipo: 'DOCUMENTO', revisaoOs, codigoExibido: 'OS-000123',
        });
        const recusa = (mutationId: string, anexoId: string, codigo: string): Pendencia => ({
          mutationId, entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', tipo: 'REJEITADO', criadaEm: '',
          erro: { codigo, mensagem: 'x' }, mutacao: uploadOs(mutationId, anexoId),
        });
        const marcas = async () => (await db.lerMeta<string[]>('relerAoDesproteger')) ?? [];

        beforeEach(() => {
          usuarioAtual = { id: TEC, nome: 'Téo', email: 'teo@regera.com', perfil: 'TECNICO', ativo: true };
          online().set(true);
        });

        it('cenário 1: o PDF recusado da OS reaberta lá; depois do Descartar ela volta em andamento (rev 2) e concluir de novo funciona', async () => {
          await db.os.put(paraOsLocal('o1', 5, doServidor({ status: 'CONCLUIDA', resumoExecucao: 'Feito', assinaturaRecusada: true, motivoRecusa: 'Ausente' })));
          await gravarAnexos(documento('d1'));
          const p = recusa('up1', 'd1', 'STATUS_INVALIDO');
          await db.pendencias.put(p);

          const descarte = svc.descartar(p);
          (await vi.waitFor(() => http.expectOne(URL))).flush({
            entidade: 'os', id: 'o1', version: 7, deleted: false,
            dados: doServidor({ status: 'EM_ANDAMENTO', revisao: 2, resumoExecucao: 'Feito', assinaturaRecusada: true, motivoRecusa: 'Ausente' }),
          });
          await descarte;

          expect(await db.os.get('o1')).toMatchObject({ status: 'EM_ANDAMENTO', revisao: 2, version: 7 });
          expect(await db.anexosOs.get('d1')).toBeUndefined();
          expect(await comBytes()).toEqual([]);
          expect(await marcas()).toEqual([]);
          vi.spyOn(TestBed.inject(PdfService), 'logoDataUrl').mockResolvedValue(null);
          const { codigoExibido } = await TestBed.inject(OsRepo).concluir('o1', 'Feito de novo', async () => new Blob(['%PDF-1.7']));
          expect(codigoExibido).toBe('OS-000123-R2');
          expect((await db.outbox.orderBy('seq').toArray()).map((m) => [m.entidade, m.baseVersion])).toEqual([['os', 7], [TIPO_UPLOAD_ANEXO_OS, null]]);
        });

        it('cenário 2 (M2-R3): o PDF de quem perdeu a OS (403); depois do Descartar a OS sai do aparelho, com as miniaturas', async () => {
          await db.os.put(paraOsLocal('o1', 5, doServidor({ status: 'EM_ANDAMENTO', tecnicoId: 'u-outro' })));
          await gravarAnexos([anexo('f0', 'o1', true), documento('d1')]);
          const p = recusa('up1', 'd1', 'ACESSO_NEGADO');
          await db.pendencias.put(p);

          const descarte = svc.descartar(p);
          (await vi.waitFor(() => http.expectOne(URL))).flush({ codigo: 'NAO_ENCONTRADO' }, { status: 404, statusText: 'Not Found' });
          await descarte;

          expect(await db.os.get('o1')).toBeUndefined();
          expect(await db.anexosOs.count()).toBe(0);
          expect(await comBytes()).toEqual([]);
          expect(await marcas()).toEqual([]);
        });

        it('com mais da OS na fila, não relê ainda: o agregado fica marcado e é relido quando ficar livre', async () => {
          await db.os.put(paraOsLocal('o1', 5, doServidor({ status: 'EM_ANDAMENTO' })));
          await gravarAnexos([anexo('f1', 'o1', false), anexo('f2', 'o1', false)]);
          await db.outbox.add(uploadOs('up2', 'f2'));
          await db.pendencias.put(recusa('up1', 'f1', 'LIMITE_FOTOS'));

          await svc.descartar((await db.pendencias.get('up1'))!);
          http.expectNone(URL);
          expect(await marcas()).toEqual(['os:o1']);

          await db.outbox.clear();
          const releitura = TestBed.inject(SyncService).relerDesprotegidos();
          (await vi.waitFor(() => http.expectOne(URL))).flush({ entidade: 'os', id: 'o1', version: 8, deleted: false, dados: doServidor({ status: 'EM_ANDAMENTO', urgente: true }) });
          await releitura;
          expect(await db.os.get('o1')).toMatchObject({ version: 8, urgente: true });
          expect(await marcas()).toEqual([]);
        });

        it('offline: o Descartar do upload marca a OS, e ela é relida na próxima sincronização', async () => {
          online().set(false);
          await db.os.put(paraOsLocal('o1', 5, doServidor({ status: 'CONCLUIDA' })));
          await gravarAnexos(documento('d1'));
          const p = recusa('up1', 'd1', 'STATUS_INVALIDO');
          await db.pendencias.put(p);

          await svc.descartar(p);
          http.expectNone(URL);
          expect(await db.pendencias.count()).toBe(0);
          expect(await marcas()).toEqual(['os:o1']);
          expect(await db.os.get('o1')).toMatchObject({ status: 'CONCLUIDA', version: 5 });

          online().set(true);
          const sync = TestBed.inject(SyncService);
          vi.mocked(sync.sincronizar).mockRestore();
          const rodada = sync.sincronizar();
          (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull'))).flush({ cursor: 1, temMais: false, mudancas: [], usuarios: [] });
          (await vi.waitFor(() => http.expectOne(URL))).flush({ entidade: 'os', id: 'o1', version: 7, deleted: false, dados: doServidor({ status: 'EM_ANDAMENTO', revisao: 2 }) });
          await rodada;
          expect(await db.os.get('o1')).toMatchObject({ status: 'EM_ANDAMENTO', revisao: 2, version: 7 });
          expect(await marcas()).toEqual([]);
        });

        it('offline: "Usar a do servidor" aplica o que a pendência guardou e marca para reler', async () => {
          online().set(false);
          await db.os.put(paraOsLocal('o1', 4, doServidor({ status: 'EM_ANDAMENTO' })));
          const p: Pendencia = {
            mutationId: 'c', entidade: 'os', agregadoId: 'o1', tipo: 'CONFLITO', criadaEm: '', versionServidor: 6,
            dadosServidor: doServidor({ status: 'EM_ANDAMENTO', urgente: true }),
            mutacao: { mutationId: 'c', entidade: 'os', agregadoId: 'o1', op: 'UPSERT', baseVersion: 4, dados: doServidor({ status: 'EM_ANDAMENTO' }), criadaEm: '' },
          };
          await db.pendencias.put(p);
          const usar = svc.usarServidor(p);
          (await vi.waitFor(() => http.expectOne(URL))).error(new ProgressEvent('error'), { status: 0 });
          await usar;
          expect(await db.os.get('o1')).toMatchObject({ version: 6, urgente: true });
          expect(await marcas()).toEqual(['os:o1']);
        });

        it('depois de 7 dias (404 OS_NAO_ENCONTRADA no upload): um Descartar só leva a OS inteira, em vez de um por foto', async () => {
          await db.os.put(paraOsLocal('o1', 5, doServidor({ status: 'EM_ANDAMENTO' })));
          await gravarAnexos([anexo('f0', 'o1', true), anexo('f1', 'o1', false), anexo('f2', 'o1', false), anexo('f3', 'o1', false)]);
          await db.outbox.bulkAdd([uploadOs('up2', 'f2'), uploadOs('up3', 'f3'),
            { mutationId: 'n', entidade: 'os', agregadoId: 'o1', op: 'UPSERT', baseVersion: 5,
              dados: doServidor({ status: 'EM_ANDAMENTO', notas: [{ id: 'n1', texto: 'Cheguei', autorId: null, criadaEm: null }] }), criadaEm: '' }]);
          const p = recusa('up1', 'f1', 'OS_NAO_ENCONTRADA');
          await db.pendencias.put(p);
          // o que vai junto (fora a foto do próprio upload) é avisado antes (P4c-R15)
          expect(await svc.perdaDaOs(p)).toEqual(['notas', 'fotos']);
          expect(await svc.descartaEnvio(p)).toBe(true);

          const descarte = svc.descartar(p);
          (await vi.waitFor(() => http.expectOne(URL))).flush({ codigo: 'NAO_ENCONTRADO' }, { status: 404, statusText: 'Not Found' });
          await descarte;

          expect(await db.os.get('o1')).toBeUndefined();
          expect(await db.outbox.count()).toBe(0);
          expect(await db.pendencias.count()).toBe(0);
          expect(await db.anexosOs.count()).toBe(0);
          expect(await comBytes()).toEqual([]);
        });

        it('o upload da OS que não existe mais, sozinho: o Descartar não pergunta (só a foto dele vai)', async () => {
          await gravarAnexos(anexo('f1', 'o1', false));
          const p = recusa('up1', 'f1', 'OS_NAO_ENCONTRADA');
          await db.pendencias.put(p);
          expect(await svc.perdaDaOs(p)).toEqual([]);
          expect(await svc.descartaEnvio(p)).toBe(false);
        });
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
