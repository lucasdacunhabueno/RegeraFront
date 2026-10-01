import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';
import { ArquivosService } from '../../core/arquivos/arquivos-service';
import type { UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { RegeraDb } from '../../core/db/regera-db';
import { PdfService } from '../../core/pdf/pdf-service';
import { MutacaoLocal, Pendencia, RespostaAnexoOs, TIPO_UPLOAD_ANEXO_OS } from '../../core/sync/sync-models';
import { SyncService } from '../../core/sync/sync-service';
import { tipoUploadDe } from '../../core/sync/tipos-upload';
import { ErroCampo } from '../../core/util/erro-campo';
import { paraItemLocal } from '../catalogo/item-models';
import { ClienteDados, paraClienteLocal } from '../clientes/cliente-models';
import { ID_EMPRESA, paraEmpresaLocal } from '../empresa/empresa-models';
import type { ItemPropostaLocal, PropostaLocal, StatusProposta } from '../propostas/proposta-models';
import { codigoProvisorioOsValido } from './codigo-provisorio-os';
import { ErroOs } from './erro-os';
import type { FotoPreparada } from './foto-os';
import {
  AnexoOsDados, AnexoOsLocal, dadosDaOs, NotaOsLocal, OsDados, OsLocal, paraAnexoOsServidor, paraOsLocal, StatusOs,
} from './os-models';
import {
  EntradaPdfOs, MINIATURA_FOTO, montarEntradaOs, ordenarParaTecnico, OsRepo, PREPARAR_FOTO,
} from './os-repo';

const ADMIN: UsuarioSessao = { id: 'u-adm', nome: 'Ana Admin', email: 'ana@regera.com', perfil: 'ADMIN', ativo: true };
const COMERCIAL: UsuarioSessao = { id: 'u-com', nome: 'Carla Comercial', email: 'carla@regera.com', perfil: 'COMERCIAL', ativo: true };
const OUTRO_COMERCIAL: UsuarioSessao = { id: 'u-com2', nome: 'Beto', email: 'beto@regera.com', perfil: 'COMERCIAL', ativo: true };
const TECNICO: UsuarioSessao = { id: 'u-tec', nome: 'Téo Técnico', email: 'teo@regera.com', perfil: 'TECNICO', ativo: true };
const OUTRO_TECNICO: UsuarioSessao = { id: 'u-tec2', nome: 'Rui Técnico', email: 'rui@regera.com', perfil: 'TECNICO', ativo: true };

const AGORA = new Date('2026-10-01T15:00:00Z');
const VALOR = /preco|custo|valor|total|desconto|subtotal/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const cliente: ClienteDados = {
  tipo: 'PJ', documento: '11444777000161', nome: 'Cliente Ltda', nomeFantasia: null, inscricaoEstadual: null,
  inscricaoMunicipal: null, email: 'compras@cliente.com', telefone: '11988887777', whatsapp: null, contatoNome: 'Maria',
  observacoes: null,
  enderecos: [
    { tipo: 'COBRANCA', cep: '01000000', logradouro: 'Rua B', numero: '2', complemento: null, bairro: null, cidade: 'Santos', uf: 'SP' },
    { tipo: 'PRINCIPAL', cep: '01310100', logradouro: ' Av. Paulista ', numero: '1000', complemento: 'cj 1', bairro: 'Bela Vista',
      cidade: 'São Paulo', uf: 'sp' },
  ],
};

/** A OS como o servidor a manda: numerada, da proposta p1, do COMERCIAL, com o TECNICO atribuído. */
const osDados = (status: StatusOs, extra: Partial<OsDados> = {}): OsDados => ({
  codigoProvisorio: 'OSP-0Z9XY7', numero: 123, revisao: 1, propostaId: 'p1', propostaNumero: 277,
  propostaCodigoExibido: '000277', clienteId: 'c1', tipo: 'INSTALACAO', status, responsavelId: COMERCIAL.id,
  tecnicoId: TECNICO.id, dataPrevista: '2026-10-05', urgente: false, concluiProposta: true, descricao: 'Instalar o quadro',
  enderecoCep: '01310100', enderecoLogradouro: 'Av. Paulista', enderecoNumero: '1000', enderecoCidade: 'São Paulo',
  enderecoUf: 'SP', assinaturaRecusada: false,
  itens: [{ id: 'l1', itemCatalogoId: 'i1', codigo: 'P-1', nome: 'Painel', unidade: 'un', natureza: 'PRODUTO', quantidadePrevista: 2, ordem: 0 }],
  notas: [], anexos: [], historico: [], atualizadoEm: '2026-10-01T10:00:00Z', ...extra,
});

const anexoServidor = (extra: Partial<AnexoOsDados> = {}): AnexoOsDados => ({
  id: 'fs1', tipo: 'FOTO', arquivoId: 'a-fs1', sha256: 'c'.repeat(64), legenda: null, momento: null,
  tiradaEm: '2026-10-01T11:00:00Z', autorId: TECNICO.id, criadoEm: '2026-10-01T11:00:05Z', ...extra,
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer as ArrayBuffer;
const SHA_PNG = 'd'.repeat(64);
const PDF = '%PDF-1.7 os';

describe('ordenarParaTecnico', () => {
  it('data prevista ascendente, sem data no fim; no mesmo dia, as urgentes primeiro', () => {
    const os = (id: string, dataPrevista: string | null, urgente = false, atualizadoEm: string | null = null) =>
      ({ id, dataPrevista, urgente, atualizadoEm });
    const lista = [
      os('a', null), os('b', '2026-10-03'), os('c', '2026-10-02'), os('d', '2026-10-03', true), os('e', null, true),
      os('f', '2026-10-02', false, '2026-10-01T12:00:00Z'),
    ];
    expect(ordenarParaTecnico(lista).map((x) => x.id)).toEqual(['f', 'c', 'd', 'b', 'e', 'a']);
  });
});

describe('montarEntradaOs', () => {
  const base = () => paraOsLocal('o1', 3, osDados('CONCLUIDA', {
    resumoExecucao: 'Feito', assinaturaRecusada: true, motivoRecusa: 'Cliente ausente',
    notas: [{ id: 'n1', texto: 'Cheguei', autorId: TECNICO.id, criadaEm: '2026-10-01T12:00:00Z' }],
  }));

  it('monta a OS sem nenhum campo de valor, sem o CPF/CNPJ do cliente (R8), com o técnico, o início local e as notas', () => {
    const os: OsLocal = { ...base(), iniciadaLocalEm: '2026-10-01T11:30:00Z', notas: [...base().notas, { id: 'n2', texto: 'Saí',
      autorId: null, criadaEm: null, autorLocalId: TECNICO.id, criadaLocalEm: '2026-10-01T13:00:00Z' }] };
    const e = montarEntradaOs({
      os, cliente: paraClienteLocal('c1', 1, cliente), empresa: null, logoDataUrl: null,
      usuarios: [{ id: TECNICO.id, nome: TECNICO.nome, perfil: 'TECNICO' }, { id: COMERCIAL.id, nome: COMERCIAL.nome, perfil: 'COMERCIAL' }],
      fotos: [], assinatura: null, emitidaEm: '2026-10-01T14:00:00Z',
    });
    expect(e.os).toMatchObject({
      codigoExibido: 'OS-000123', revisao: 1, tipo: 'INSTALACAO', rotuloTipo: 'Instalação', propostaNumero: 277,
      propostaCodigoExibido: '000277', resumoExecucao: 'Feito', concluidaEm: '2026-10-01T14:00:00Z',
      iniciadaEm: '2026-10-01T11:30:00Z',
      endereco: 'Av. Paulista, 1000 - São Paulo/SP - CEP 01310-100', emitidaEm: '2026-10-01T14:00:00Z',
    });
    expect(e.cliente).toMatchObject({ nome: 'Cliente Ltda', documento: null, endereco: 'Av. Paulista, 1000 - cj 1 - Bela Vista - São Paulo/sp - CEP 01310-100' });
    expect(e.tecnicoNome).toBe(TECNICO.nome);
    expect(e.responsavelNome).toBe(COMERCIAL.nome);
    expect(e.itens).toEqual([{ codigo: 'P-1', nome: 'Painel', unidade: 'un', natureza: 'PRODUTO', quantidade: 2 }]);
    expect(e.notas).toEqual([
      { texto: 'Cheguei', autorNome: TECNICO.nome, criadaEm: '2026-10-01T12:00:00Z' },
      { texto: 'Saí', autorNome: TECNICO.nome, criadaEm: '2026-10-01T13:00:00Z' },
    ]);
    expect(e.recusaAssinatura).toBe('Cliente ausente');
    expect(e.empresa.razaoSocial).toBe('');
    const chaves = (v: unknown): string[] => (v && typeof v === 'object'
      ? Object.entries(v).flatMap(([k, x]) => [k, ...chaves(x)]) : []);
    expect(chaves(e).filter((k) => VALOR.test(k))).toEqual([]);
    expect(JSON.stringify(e)).not.toContain('11444777000161');
    // o do servidor vence o local
    expect(montarEntradaOs({
      os: { ...os, iniciadaEm: '2026-10-01T11:31:00Z' }, cliente: null, empresa: null, logoDataUrl: null, usuarios: [], fotos: [],
      assinatura: null, emitidaEm: '2026-10-01T14:00:00Z',
    }).os.iniciadaEm).toBe('2026-10-01T11:31:00Z');
  });

  it('com assinatura, a recusa não sai; sem cliente no aparelho, o bloco do cliente fica nulo', () => {
    const assinatura = { anexoId: 's1', imagem: 'data:image/png;base64,AA', nome: 'Maria', papel: null, assinadaEm: '2026-10-01T13:00:00Z' };
    const e = montarEntradaOs({
      os: base(), cliente: null, empresa: null, logoDataUrl: null, usuarios: [], fotos: [], assinatura,
      emitidaEm: '2026-10-01T14:00:00Z',
    });
    expect(e.assinatura).toEqual(assinatura);
    expect(e.recusaAssinatura).toBeNull();
    expect(e.cliente).toBeNull();
    expect(e.tecnicoNome).toBeNull();
  });
});

describe('OsRepo', () => {
  let repo: OsRepo;
  let db: RegeraDb;
  let sync: SyncService;
  let http: HttpTestingController;
  const usuario = signal<UsuarioSessao | null>(TECNICO);
  const online = signal(false);
  const pdf = { logoDataUrl: vi.fn() };
  const arquivos = {
    obterDataUrl: vi.fn(), obterBlob: vi.fn(), limpar: vi.fn(), geracaoAtual: () => 0, garantirCache: vi.fn(async () => undefined),
  };
  let nFoto = 0;
  const preparar = vi.fn<(arquivo: Blob) => Promise<FotoPreparada>>();
  const gerarPdf = vi.fn<(e: EntradaPdfOs) => Promise<Blob>>();
  const reduzir = vi.fn<(imagem: Blob) => Promise<ArrayBuffer>>();

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
    usuario.set(TECNICO);
    online.set(false);
    nFoto = 0;
    pdf.logoDataUrl.mockReset().mockResolvedValue('data:image/png;base64,TE9HTw==');
    arquivos.obterDataUrl.mockReset().mockResolvedValue(null);
    arquivos.obterBlob.mockReset().mockResolvedValue(null);
    reduzir.mockReset().mockResolvedValue(new Uint8Array([0xff, 0xd8, 0x99]).buffer as ArrayBuffer);
    preparar.mockReset().mockImplementation(async () => {
      const n = ++nFoto;
      return {
        bytes: new Uint8Array([0xff, 0xd8, n]).buffer as ArrayBuffer, miniatura: new Uint8Array([0xff, 0xd8, 0x10 + n]).buffer as ArrayBuffer,
        sha256: String(n).padStart(64, '0'), largura: 1600, altura: 1200,
      };
    });
    gerarPdf.mockReset().mockImplementation(async () => new Blob([PDF], { type: 'application/pdf' }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { autenticado: () => true, sessaoExpirada: () => false, usuario } },
        { provide: ConectividadeService, useValue: { online } },
        { provide: PdfService, useValue: pdf },
        { provide: ArquivosService, useValue: arquivos },
        { provide: PREPARAR_FOTO, useValue: preparar },
        { provide: MINIATURA_FOTO, useValue: reduzir },
      ],
    });
    repo = TestBed.inject(OsRepo);
    db = TestBed.inject(RegeraDb);
    sync = TestBed.inject(SyncService);
    http = TestBed.inject(HttpTestingController);
    await db.empresa.put(paraEmpresaLocal(ID_EMPRESA, 3, {
      razaoSocial: 'Regera Energia Ltda', cnpj: '11222333000181', endereco: 'Rua A, 1', telefone: '1133334444',
      email: 'contato@regera.com', logoArquivoId: 'logo-1', corPrimaria: '#123456',
    }));
    await db.clientes.put(paraClienteLocal('c1', 2, cliente));
    await db.itens.bulkPut([
      paraItemLocal('i1', 1, { natureza: 'PRODUTO', codigo: 'P-1', nome: 'Painel', descricao: null, unidade: 'un', precoVenda: 10, locavel: false, fotoArquivoId: null, ativo: true }),
      paraItemLocal('i-inativo', 1, { natureza: 'SERVICO', codigo: 'S-9', nome: 'Velho', descricao: null, unidade: 'h', precoVenda: 10, locavel: false, fotoArquivoId: null, ativo: false }),
    ]);
    await db.usuarios.bulkPut([
      { id: ADMIN.id, nome: ADMIN.nome, email: ADMIN.email, perfil: 'ADMIN' },
      { id: COMERCIAL.id, nome: COMERCIAL.nome, email: COMERCIAL.email, perfil: 'COMERCIAL' },
      { id: OUTRO_COMERCIAL.id, nome: OUTRO_COMERCIAL.nome, email: OUTRO_COMERCIAL.email, perfil: 'COMERCIAL' },
      { id: TECNICO.id, nome: TECNICO.nome, email: TECNICO.email, perfil: 'TECNICO' },
      { id: OUTRO_TECNICO.id, nome: OUTRO_TECNICO.nome, email: OUTRO_TECNICO.email, perfil: 'TECNICO' },
      { id: 'u-tec-inativo', nome: 'Inativo', email: null, perfil: 'TECNICO', ativo: false },
    ]);
  });

  afterEach(async () => {
    await sync.aguardarOciosa();
    http.verify();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await db.limparTudo();
    TestBed.resetTestingModule();
  });

  async function erroDe(p: Promise<unknown>): Promise<ErroOs> {
    const e = await p.then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(ErroOs);
    expect(e).toBeInstanceOf(ErroCampo);
    return e as ErroOs;
  }

  async function noAparelho(status: StatusOs, extra: Partial<OsDados> = {}, version = 2): Promise<OsLocal> {
    const os = paraOsLocal('o1', version, osDados(status, extra));
    await db.os.put(os);
    return os;
  }

  async function proposta(status: StatusProposta, p: Partial<PropostaLocal> = {}): Promise<PropostaLocal> {
    const linha = (id: string, extra: Partial<ItemPropostaLocal> = {}): ItemPropostaLocal => ({
      id, itemCatalogoId: 'i1', codigo: 'P-1', nome: 'Painel', descricao: 'Painel solar', unidade: 'un', natureza: 'PRODUTO',
      precoCustoCentavos: 5000, quantidadeMilesimos: 2500, precoUnitarioCentavos: 10000, descontoCentesimos: 1000, meses: null,
      subtotalCentavos: 22500, ordem: 0, ...extra,
    });
    const x: PropostaLocal = {
      id: 'p1', version: 7, codigoProvisorio: 'PROV-ABCDEF', numero: 277, revisao: 1, tipo: 'VENDA', status,
      clienteId: 'c1', templateId: 't1', responsavelId: COMERCIAL.id, tecnicoId: null, dataEmissao: '2026-09-20',
      validadeAte: '2026-09-30', condicoesPagamento: '30 dias', prazoExecucao: '10 dias úteis', observacoes: 'Ligar antes.',
      descontoGeralCentesimos: 0, totalItensCentavos: 25000, totalDescontosCentavos: 2500, totalCentavos: 22500,
      motivoEncerramento: null, historico: [], documentos: [], atualizadoEm: '2026-09-20T10:00:00Z',
      itens: [linha('l1'), linha('l2', { itemCatalogoId: 'i-inativo', codigo: 'S-9', nome: 'Velho', unidade: 'h', natureza: 'SERVICO', quantidadeMilesimos: 1000, ordem: 1 })],
      ...p,
    };
    await db.propostas.put(x);
    return x;
  }

  const fila = () => db.outbox.orderBy('seq').toArray();
  const dadosDe = (m: MutacaoLocal) => m.dados as OsDados;
  const conflito = (agregadoId = 'o1'): Pendencia => ({
    mutationId: 'mc', entidade: 'os', agregadoId, tipo: 'CONFLITO', criadaEm: '',
    mutacao: { mutationId: 'mc', entidade: 'os', agregadoId, op: 'UPSERT', baseVersion: 1, dados: null, criadaEm: '' },
  });
  const arquivo = () => new File([new Uint8Array([1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' });
  const chaves = (v: unknown): string[] => (v && typeof v === 'object'
    ? Object.entries(v).flatMap(([k, x]) => [k, ...chaves(x)]) : []);

  // ------------------------------------------------------------------ leitura

  describe('leitura', () => {
    beforeEach(async () => {
      await db.os.bulkPut([
        paraOsLocal('a', 1, osDados('ABERTA', { codigoProvisorio: 'OSP-AAAAAA', dataPrevista: '2026-10-03', atualizadoEm: '2026-10-01T09:00:00Z' })),
        paraOsLocal('b', 1, osDados('EM_ANDAMENTO', { codigoProvisorio: 'OSP-BBBBBB', dataPrevista: '2026-10-03', urgente: true, atualizadoEm: '2026-10-01T08:00:00Z' })),
        paraOsLocal('c', 1, osDados('ABERTA', { codigoProvisorio: 'OSP-CCCCCC', dataPrevista: null, responsavelId: OUTRO_COMERCIAL.id, tecnicoId: OUTRO_TECNICO.id, propostaId: 'p2', atualizadoEm: '2026-10-01T11:00:00Z' })),
      ]);
    });

    it('observarTodas: ADMIN vê todas, COMERCIAL as dele, TECNICO as atribuídas, por atualizadoEm desc', async () => {
      usuario.set(ADMIN);
      expect((await firstValueFrom(repo.observarTodas())).map((o) => o.id)).toEqual(['c', 'a', 'b']);
      usuario.set(COMERCIAL);
      expect((await firstValueFrom(repo.observarTodas())).map((o) => o.id)).toEqual(['a', 'b']);
      usuario.set(TECNICO);
      expect((await firstValueFrom(repo.observarTodas())).map((o) => o.id)).toEqual(['a', 'b']);
      usuario.set(null);
      expect(await firstValueFrom(repo.observarTodas())).toEqual([]);
    });

    it('observarDoTecnico: por data prevista, urgentes primeiro no mesmo dia; observarDaProposta; observarOs e buscar', async () => {
      expect((await firstValueFrom(repo.observarDoTecnico(TECNICO.id))).map((o) => o.id)).toEqual(['b', 'a']);
      expect((await firstValueFrom(repo.observarDaProposta('p1'))).map((o) => o.id)).toEqual(['a', 'b']);
      expect((await firstValueFrom(repo.observarOs('c')))?.codigoProvisorio).toBe('OSP-CCCCCC');
      expect(await repo.buscar('x')).toBeUndefined();
    });

    it('observarAnexos junta os do servidor e os do aparelho, com miniatura, enviado e temBytes; blobDoAnexo', async () => {
      await noAparelho('EM_ANDAMENTO', { anexos: [anexoServidor(), anexoServidor({ id: 'f2', arquivoId: 'a-f2', tiradaEm: '2026-10-01T12:00:00Z' })] });
      const local = (extra: Partial<AnexoOsLocal>): AnexoOsLocal => ({
        id: 'f2', osId: 'o1', tipo: 'FOTO', sha256: 'c'.repeat(64), legenda: 'Quadro', momento: 'ANTES',
        tiradaEm: '2026-10-01T12:00:00Z', assinanteNome: null, assinantePapel: null, revisaoOs: null, codigoExibido: null,
        bytes: null, miniatura: new Uint8Array([9]).buffer as ArrayBuffer, enviado: true, arquivoId: 'a-f2', ...extra,
      });
      await db.anexosOs.bulkPut([
        local({}),
        local({ id: 's1', tipo: 'ASSINATURA', legenda: null, momento: null, tiradaEm: '2026-10-01T13:00:00Z', assinanteNome: 'Maria',
          bytes: PNG, miniatura: PNG, enviado: false, arquivoId: null }),
        local({ id: 'x', osId: 'outra' }),
      ]);
      const vistos = await firstValueFrom(repo.observarAnexos('o1'));
      expect(vistos.map((a) => [a.id, a.tipo, a.enviado, a.temBytes, a.arquivoId])).toEqual([
        ['fs1', 'FOTO', true, false, 'a-fs1'], ['f2', 'FOTO', true, false, 'a-f2'], ['s1', 'ASSINATURA', false, true, null],
      ]);
      expect(vistos[0].miniatura).toBeNull();
      expect(vistos[1].miniatura?.type).toBe('image/jpeg');
      expect(vistos[1].legenda).toBe('Quadro');
      expect(vistos[2].miniatura?.type).toBe('image/png');
      expect(vistos[2].assinanteNome).toBe('Maria');
      const blob = await repo.blobDoAnexo('s1');
      expect(blob?.type).toBe('image/png');
      expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array(PNG));
      expect(await repo.blobDoAnexo('f2')).toBeNull();
    });

    it('observarEstadoSync: na fila, com pendência e com CONFLITO', async () => {
      await db.outbox.add({ mutationId: 'm1', entidade: 'os', agregadoId: 'a', op: 'UPSERT', baseVersion: 1, dados: null, criadaEm: '' });
      await db.pendencias.put(conflito('b'));
      const estado = await firstValueFrom(repo.observarEstadoSync());
      expect([...estado.naOutbox]).toEqual(['a']);
      expect([...estado.comPendencia]).toEqual(['b']);
      expect([...estado.comConflito]).toEqual(['b']);
      expect((await firstValueFrom(repo.observarPendencias('b'))).map((p) => p.tipo)).toEqual(['CONFLITO']);
      expect(await firstValueFrom(repo.observarPendencias('a'))).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ criação

  describe('gerarDaProposta', () => {
    it('copia os itens sem nenhum campo de valor e com UUID novo, o endereço padrão, a descrição e o tipo derivado', async () => {
      usuario.set(COMERCIAL);
      await proposta('APROVADA');
      const id = await repo.gerarDaProposta('p1', { tecnicoId: TECNICO.id, dataPrevista: '2026-10-05', urgente: true });
      const os = (await db.os.get(id))!;
      expect(id).toMatch(UUID);
      expect(codigoProvisorioOsValido(os.codigoProvisorio)).toBe(true);
      expect(os).toMatchObject({
        version: null, numero: null, revisao: 1, propostaId: 'p1', propostaNumero: null, propostaCodigoExibido: null,
        clienteId: 'c1', tipo: 'ENTREGA', status: 'ABERTA', responsavelId: COMERCIAL.id, tecnicoId: TECNICO.id,
        dataPrevista: '2026-10-05', urgente: true, concluiProposta: true,
        descricao: 'Ligar antes.\n\nPrazo de execução: 10 dias úteis',
        enderecoCep: '01310100', enderecoLogradouro: 'Av. Paulista', enderecoNumero: '1000', enderecoComplemento: 'cj 1',
        enderecoBairro: 'Bela Vista', enderecoCidade: 'São Paulo', enderecoUf: 'SP', notas: [], anexos: [],
      });
      expect(os.itens.map((i) => i.id)).not.toContain('l1');
      expect(new Set(os.itens.map((i) => i.id)).size).toBe(2);
      os.itens.forEach((i) => expect(i.id).toMatch(UUID));
      // o item inativo no catálogo vai como linha livre (o servidor recusaria o vínculo de linha nova)
      expect(os.itens.map((i) => Object.fromEntries(Object.entries(i).filter(([k]) => k !== 'id')))).toEqual([
        { itemCatalogoId: 'i1', codigo: 'P-1', nome: 'Painel', unidade: 'un', natureza: 'PRODUTO', quantidadePrevistaMilesimos: 2500, ordem: 0 },
        { itemCatalogoId: null, codigo: 'S-9', nome: 'Velho', unidade: 'h', natureza: 'SERVICO', quantidadePrevistaMilesimos: 1000, ordem: 1 },
      ]);
      const [m] = await fila();
      expect(m).toMatchObject({ entidade: 'os', agregadoId: id, op: 'UPSERT', baseVersion: null });
      expect(m.separada).toBeFalsy();
      const d = dadosDe(m);
      expect(d).toMatchObject({ status: 'ABERTA', propostaId: 'p1', clienteId: 'c1', responsavelId: null, concluiProposta: true });
      expect(d.itens.map((i) => i.quantidadePrevista)).toEqual([2.5, 1]);
      expect(chaves(os).filter((k) => VALOR.test(k))).toEqual([]);
      expect(chaves(d).filter((k) => VALOR.test(k))).toEqual([]);
    });

    it('linha com item fora do catálogo do aparelho ou inativo vai sem vínculo; a natureza ausente vem do catálogo', async () => {
      usuario.set(ADMIN);
      const base = await proposta('APROVADA');
      await proposta('APROVADA', { itens: [
        { ...base.itens[0], id: 'l3', itemCatalogoId: 'i-sumiu', natureza: null },
        { ...base.itens[1], id: 'l4', natureza: null },
        { ...base.itens[0], id: 'l5', natureza: null },
      ] });
      const os = (await db.os.get(await repo.gerarDaProposta('p1')))!;
      expect(os.itens.map((i) => [i.itemCatalogoId, i.natureza])).toEqual([[null, 'PRODUTO'], [null, 'SERVICO'], ['i1', 'PRODUTO']]);
    });

    it.each([
      ['VENDA', 'ENTREGA'], ['SERVICO', 'SERVICO'], ['MANUTENCAO', 'MANUTENCAO'], ['LOCACAO', 'ENTREGA'],
    ] as const)('tipo derivado: %s → %s; o parâmetro troca o tipo e o concluiProposta', async (tipoProposta, tipoOs) => {
      usuario.set(ADMIN);
      await proposta('EM_EXECUCAO', { tipo: tipoProposta });
      expect((await db.os.get(await repo.gerarDaProposta('p1')))!.tipo).toBe(tipoOs);
      const outra = (await db.os.get(await repo.gerarDaProposta('p1', { tipo: 'CORRETIVA', concluiProposta: false })))!;
      expect(outra).toMatchObject({ tipo: 'CORRETIVA', concluiProposta: false, tecnicoId: null, urgente: false });
    });

    it('perfil: TECNICO e COMERCIAL de outra proposta recebem ACESSO_NEGADO; status da proposta, técnico e ausência', async () => {
      await proposta('APROVADA');
      usuario.set(TECNICO);
      expect((await erroDe(repo.gerarDaProposta('p1', { tecnicoId: TECNICO.id }))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(OUTRO_COMERCIAL);
      expect((await erroDe(repo.gerarDaProposta('p1'))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(COMERCIAL);
      const inativo = await erroDe(repo.gerarDaProposta('p1', { tecnicoId: 'u-tec-inativo' }));
      expect([inativo.codigo, inativo.campo]).toEqual(['VALIDACAO', 'tecnicoId']);
      expect((await erroDe(repo.gerarDaProposta('p1', { dataPrevista: '2026-02-30' }))).campo).toBe('dataPrevista');
      for (const status of ['RASCUNHO', 'ENVIADA', 'FINALIZADA', 'CANCELADA'] as const) {
        await proposta(status);
        const e = await erroDe(repo.gerarDaProposta('p1'));
        expect([e.codigo, e.campo, e.message]).toEqual(['VALIDACAO', 'propostaId', 'A proposta precisa estar aprovada ou em execução.']);
      }
      expect((await erroDe(repo.gerarDaProposta('nao-existe'))).codigo).toBe('NAO_ENCONTRADA');
      expect(await db.os.count()).toBe(0);
      expect(await db.outbox.count()).toBe(0);
    });
  });

  describe('criarAvulsa', () => {
    it('COMERCIAL cria a OS sem proposta: ele é o responsável, endereço escolhido do cliente, e o responsável vai na criação', async () => {
      usuario.set(COMERCIAL);
      const id = await repo.criarAvulsa({ clienteId: 'c1', tipo: 'CORRETIVA', descricao: '  Disjuntor desarmando  ', enderecoId: 0, urgente: true });
      const os = (await db.os.get(id))!;
      expect(os).toMatchObject({
        propostaId: null, clienteId: 'c1', tipo: 'CORRETIVA', status: 'ABERTA', responsavelId: COMERCIAL.id, tecnicoId: null,
        descricao: 'Disjuntor desarmando', urgente: true, enderecoLogradouro: 'Rua B', enderecoCidade: 'Santos', itens: [],
      });
      expect(dadosDe((await fila())[0])).toMatchObject({ responsavelId: COMERCIAL.id, propostaId: null, clienteId: 'c1' });
      // sem enderecoId: o principal
      expect((await db.os.get(await repo.criarAvulsa({ clienteId: 'c1', tipo: 'SERVICO', descricao: null })))!.enderecoLogradouro).toBe('Av. Paulista');
    });

    it('recusa TECNICO, cliente fora do aparelho, endereço inexistente e descrição grande', async () => {
      expect((await erroDe(repo.criarAvulsa({ clienteId: 'c1', tipo: 'SERVICO', descricao: null }))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(ADMIN);
      expect((await erroDe(repo.criarAvulsa({ clienteId: 'cx', tipo: 'SERVICO', descricao: null }))).campo).toBe('clienteId');
      expect((await erroDe(repo.criarAvulsa({ clienteId: 'c1', tipo: 'SERVICO', descricao: null, enderecoId: 5 }))).campo).toBe('enderecoId');
      const grande = await erroDe(repo.criarAvulsa({ clienteId: 'c1', tipo: 'SERVICO', descricao: '😀'.repeat(4001) }));
      expect([grande.codigo, grande.campo]).toEqual(['VALIDACAO', 'descricao']);
      expect(await db.os.count()).toBe(0);
    });
  });

  // ------------------------------------------------------------------ edição

  describe('salvarCabecalho', () => {
    it('COMERCIAL responsável em ABERTA altera tipo, descrição, itens, endereço e conclui-proposta', async () => {
      usuario.set(COMERCIAL);
      await noAparelho('ABERTA');
      await repo.salvarCabecalho('o1', {
        tipo: 'MANUTENCAO', descricao: ' Nova ', concluiProposta: false,
        endereco: { cep: '01000000', logradouro: 'Rua C', numero: '3', complemento: null, bairro: null, cidade: 'Santos', uf: 'sp' },
        itens: [{ id: 'l9', itemCatalogoId: null, codigo: 'X', nome: 'Avulso', unidade: 'm', natureza: 'PRODUTO', quantidadePrevistaMilesimos: 1500 }],
      });
      const os = (await db.os.get('o1'))!;
      expect(os).toMatchObject({ tipo: 'MANUTENCAO', descricao: 'Nova', concluiProposta: false, enderecoLogradouro: 'Rua C', enderecoUf: 'SP' });
      expect(os.itens).toEqual([{ id: 'l9', itemCatalogoId: null, codigo: 'X', nome: 'Avulso', unidade: 'm', natureza: 'PRODUTO', quantidadePrevistaMilesimos: 1500, ordem: 0 }]);
      const [m] = await fila();
      expect(m).toMatchObject({ baseVersion: 2 });
      expect(dadosDe(m)).toMatchObject({ tipo: 'MANUTENCAO', responsavelId: null, itens: [{ id: 'l9', quantidadePrevista: 1.5 }] });
    });

    it('em andamento, só data, urgência e técnico; o tipo dá OS_NAO_EDITAVEL; base = versão carregada', async () => {
      usuario.set(COMERCIAL);
      await noAparelho('EM_ANDAMENTO');
      const e = await erroDe(repo.salvarCabecalho('o1', { tipo: 'MANUTENCAO' }));
      expect([e.codigo, e.campo, e.message]).toEqual(['OS_NAO_EDITAVEL', 'tipo', 'Não pode ser alterado com a OS em andamento.']);
      await repo.salvarCabecalho('o1', { dataPrevista: '2026-10-09', urgente: true, tecnicoId: OUTRO_TECNICO.id }, 1);
      expect((await fila())[0]).toMatchObject({ baseVersion: 1 });
      expect(await db.os.get('o1')).toMatchObject({ dataPrevista: '2026-10-09', urgente: true, tecnicoId: OUTRO_TECNICO.id, version: 1 });
      const semTecnico = await erroDe(repo.salvarCabecalho('o1', { tecnicoId: null }));
      expect([semTecnico.codigo, semTecnico.campo]).toEqual(['VALIDACAO', 'tecnicoId']);
    });

    it('Q21: em andamento, o técnico atribuído desmarca "conclui a proposta"; o COMERCIAL, não', async () => {
      await noAparelho('EM_ANDAMENTO');
      usuario.set(COMERCIAL);
      const com = await erroDe(repo.salvarCabecalho('o1', { concluiProposta: false }));
      expect([com.codigo, com.campo]).toEqual(['OS_NAO_EDITAVEL', 'concluiProposta']);
      usuario.set(TECNICO);
      await repo.salvarCabecalho('o1', { concluiProposta: false });
      expect(dadosDe((await fila())[0])).toMatchObject({ status: 'EM_ANDAMENTO', concluiProposta: false });
      expect((await db.os.get('o1'))!.concluiProposta).toBe(false);
    });

    it('TECNICO não altera o cabeçalho; comercial de outra OS recebe ACESSO_NEGADO; técnico inativo e item recusados', async () => {
      await noAparelho('ABERTA');
      const tec = await erroDe(repo.salvarCabecalho('o1', { dataPrevista: '2026-10-09' }));
      expect([tec.codigo, tec.campo, tec.message]).toEqual(['OS_NAO_EDITAVEL', 'dataPrevista', 'Você não altera este campo.']);
      usuario.set(OUTRO_COMERCIAL);
      expect((await erroDe(repo.salvarCabecalho('o1', { urgente: true }))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(ADMIN);
      expect((await erroDe(repo.salvarCabecalho('o1', { tecnicoId: 'u-tec-inativo' }))).message).toBe('Técnico inválido: escolha um técnico ativo.');
      const item = await erroDe(repo.salvarCabecalho('o1', {
        itens: [{ id: 'l9', itemCatalogoId: 'i-inativo', codigo: ' ', nome: 'X', unidade: 'un', natureza: 'PRODUTO', quantidadePrevistaMilesimos: 0 }],
      }));
      expect(item.campos).toEqual({
        'itens[0].codigo': 'Informe o código.', 'itens[0].quantidadePrevista': 'A quantidade vai de 0,001 a 999.999,999.',
        'itens[0].itemCatalogoId': 'Item do catálogo inativo ou não encontrado.',
      });
      expect(await db.outbox.count()).toBe(0);
    });
  });

  describe('atribuir', () => {
    it('ADMIN troca o técnico; o responsável da OS de proposta segue o da proposta (R18)', async () => {
      usuario.set(ADMIN);
      await noAparelho('ABERTA');
      await repo.atribuir('o1', { tecnicoId: OUTRO_TECNICO.id });
      expect(dadosDe((await fila())[0])).toMatchObject({ tecnicoId: OUTRO_TECNICO.id, responsavelId: null });
      const r18 = await erroDe(repo.atribuir('o1', { responsavelId: ADMIN.id }));
      expect([r18.codigo, r18.campo, r18.message]).toEqual(['VALIDACAO', 'responsavelId', 'O responsável segue o da proposta.']);
    });

    it('na avulsa, só o ADMIN troca o responsável (por ADMIN ou COMERCIAL ativo), e ele vai na mutação', async () => {
      await noAparelho('ABERTA', { propostaId: null, propostaNumero: null, propostaCodigoExibido: null });
      usuario.set(COMERCIAL);
      const com = await erroDe(repo.atribuir('o1', { responsavelId: OUTRO_COMERCIAL.id }));
      expect([com.codigo, com.campo]).toEqual(['OS_NAO_EDITAVEL', 'responsavelId']);
      usuario.set(ADMIN);
      expect((await erroDe(repo.atribuir('o1', { responsavelId: TECNICO.id }))).campo).toBe('responsavelId');
      await repo.atribuir('o1', { responsavelId: OUTRO_COMERCIAL.id }, 1);
      const [m] = await fila();
      expect(m).toMatchObject({ baseVersion: 1 });
      expect(dadosDe(m).responsavelId).toBe(OUTRO_COMERCIAL.id);
      // sem mudança, nada é enfileirado
      await repo.atribuir('o1', { responsavelId: OUTRO_COMERCIAL.id });
      expect(await db.outbox.count()).toBe(1);
    });

    it('TECNICO não atribui; COMERCIAL responsável troca o técnico; desatribuir em andamento é recusado', async () => {
      await noAparelho('EM_ANDAMENTO');
      expect((await erroDe(repo.atribuir('o1', { tecnicoId: OUTRO_TECNICO.id }))).codigo).toBe('OS_NAO_EDITAVEL');
      usuario.set(COMERCIAL);
      expect((await erroDe(repo.atribuir('o1', { tecnicoId: null }))).campo).toBe('tecnicoId');
      await repo.atribuir('o1', { tecnicoId: OUTRO_TECNICO.id });
      expect((await db.os.get('o1'))!.tecnicoId).toBe(OUTRO_TECNICO.id);
    });
  });

  // ------------------------------------------------------------------ execução

  describe('iniciar', () => {
    it('o técnico atribuído inicia: mutação separada; ADMIN sem técnico recebe tecnicoId', async () => {
      await noAparelho('ABERTA');
      await repo.iniciar('o1');
      const [m] = await fila();
      expect(m).toMatchObject({ separada: true, baseVersion: 2 });
      expect(dadosDe(m).status).toBe('EM_ANDAMENTO');
      // o início fica no aparelho para o PDF offline (iniciadaEm é [srv]) e não vai para a rede
      expect(await db.os.get('o1')).toMatchObject({ status: 'EM_ANDAMENTO', iniciadaEm: null, iniciadaLocalEm: AGORA.toISOString() });
      expect(chaves(m.dados)).not.toContain('iniciadaLocalEm');
      expect(dadosDe(m).iniciadaEm).toBeNull();
      await db.os.put(paraOsLocal('o2', 1, osDados('ABERTA', { codigoProvisorio: 'OSP-222222', tecnicoId: null })));
      usuario.set(ADMIN);
      const e = await erroDe(repo.iniciar('o2'));
      expect([e.codigo, e.campo, e.message]).toEqual(['VALIDACAO', 'tecnicoId', 'Atribua um técnico antes de iniciar.']);
    });

    it('outro técnico, COMERCIAL e OS que não está aberta são recusados', async () => {
      await noAparelho('ABERTA');
      usuario.set(OUTRO_TECNICO);
      expect((await erroDe(repo.iniciar('o1'))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(COMERCIAL);
      expect((await erroDe(repo.iniciar('o1'))).message).toBe('Só o técnico atribuído ou o administrador inicia a OS.');
      for (const status of ['EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'] as const) {
        await noAparelho(status);
        usuario.set(ADMIN);
        expect((await erroDe(repo.iniciar('o1'))).codigo).toBe('TRANSICAO_INVALIDA');
      }
      expect(await db.outbox.count()).toBe(0);
    });
  });

  describe('adicionarNota', () => {
    it('só acrescenta, sem autor nem data para o servidor; no aparelho mostra quem e quando', async () => {
      await noAparelho('EM_ANDAMENTO', { notas: [{ id: 'n0', texto: 'Antiga', autorId: COMERCIAL.id, criadaEm: '2026-10-01T09:00:00Z' }] });
      const id = await repo.adicionarNota('o1', '  Cheguei no local  ');
      const os = (await db.os.get('o1'))!;
      expect(os.notas.at(-1)).toEqual<NotaOsLocal>({
        id, texto: 'Cheguei no local', autorId: null, criadaEm: null, autorLocalId: TECNICO.id, criadaLocalEm: AGORA.toISOString(),
      });
      const [m] = await fila();
      expect(m.separada).toBeFalsy();
      expect(dadosDe(m).notas).toEqual([
        { id: 'n0', texto: 'Antiga', autorId: COMERCIAL.id, criadaEm: '2026-10-01T09:00:00Z' },
        { id, texto: 'Cheguei no local', autorId: null, criadaEm: null },
      ]);
      // a segunda coalesce na primeira
      await repo.adicionarNota('o1', 'Saí');
      expect(await fila()).toHaveLength(1);
      expect(dadosDe((await fila())[0]).notas).toHaveLength(3);
    });

    it('de 1 a 2000 code points depois do strip; perfis e status da matriz (R26: o técnico também com a OS encerrada)', async () => {
      await noAparelho('EM_ANDAMENTO');
      expect((await erroDe(repo.adicionarNota('o1', ' 　 '))).campos).toEqual({ 'notas[0].texto': 'Escreva a nota.' });
      expect((await erroDe(repo.adicionarNota('o1', '😀'.repeat(2001)))).message).toBe('Máximo de 2000 caracteres.');
      await repo.adicionarNota('o1', '😀'.repeat(2000));
      for (const status of ['CONCLUIDA', 'CANCELADA'] as const) {
        await noAparelho(status);
        await repo.adicionarNota('o1', 'Evidência');
      }
      usuario.set(ADMIN);
      expect((await erroDe(repo.adicionarNota('o1', 'x'))).codigo).toBe('OS_NAO_EDITAVEL'); // CANCELADA: só o técnico
      usuario.set(COMERCIAL);
      await noAparelho('ABERTA');
      await repo.adicionarNota('o1', 'Ligar antes');
      await noAparelho('CONCLUIDA');
      expect((await erroDe(repo.adicionarNota('o1', 'x'))).codigo).toBe('OS_NAO_EDITAVEL');
      usuario.set(OUTRO_TECNICO);
      expect((await erroDe(repo.adicionarNota('o1', 'x'))).codigo).toBe('ACESSO_NEGADO');
    });

    it('no máximo 200 notas novas por envio: a 201ª vai numa mutação nova, e as seguintes voltam a coalescer', async () => {
      const pendentes = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, texto: `nota ${i}` }));
      const os = await noAparelho('EM_ANDAMENTO', { notas: pendentes });
      await sync.registrar('os', 'o1', 'UPSERT', osDados('EM_ANDAMENTO', { notas: pendentes }), 2);
      expect(os.notas).toHaveLength(200);
      await repo.adicionarNota('o1', 'a 201ª');
      await repo.adicionarNota('o1', 'a 202ª');
      await repo.adicionarNota('o1', 'a 203ª');
      const m = await fila();
      expect(m.map((x) => [dadosDe(x).notas.length, !!x.separada])).toEqual([[200, false], [201, true], [203, false]]);
    });
  });

  describe('adicionarFoto', () => {
    it('grava o anexo e o upload na mesma transação, atrás do iniciar; o técnico atribuído e o ADMIN', async () => {
      await noAparelho('ABERTA');
      await repo.iniciar('o1');
      const id = await repo.adicionarFoto('o1', arquivo(), { legenda: ' Quadro antigo ', momento: 'ANTES' });
      const a = (await db.anexosOs.get(id))!;
      expect(a).toMatchObject({
        osId: 'o1', tipo: 'FOTO', sha256: '1'.padStart(64, '0'), legenda: 'Quadro antigo', momento: 'ANTES',
        tiradaEm: AGORA.toISOString(), enviado: false, arquivoId: null, revisaoOs: null, codigoExibido: null,
      });
      expect(new Uint8Array(a.bytes!)).toEqual(new Uint8Array([0xff, 0xd8, 1]));
      expect(new Uint8Array(a.miniatura!)).toEqual(new Uint8Array([0xff, 0xd8, 0x11]));
      expect((await fila()).map((m) => [m.entidade, m.op, m.dados])).toEqual([
        ['os', 'UPSERT', expect.objectContaining({ status: 'EM_ANDAMENTO' })], [TIPO_UPLOAD_ANEXO_OS, 'UPLOAD', { anexoId: id }],
      ]);
      usuario.set(ADMIN);
      await repo.adicionarFoto('o1', arquivo());
      expect(await db.anexosOs.count()).toBe(2);
    });

    it('R26: o técnico atribuído também com a OS concluída ou cancelada; o ADMIN, não', async () => {
      for (const status of ['CONCLUIDA', 'CANCELADA'] as const) {
        await noAparelho(status);
        usuario.set(TECNICO);
        await repo.adicionarFoto('o1', arquivo());
        usuario.set(ADMIN);
        expect((await erroDe(repo.adicionarFoto('o1', arquivo()))).codigo).toBe('STATUS_INVALIDO');
      }
      expect(await db.anexosOs.count()).toBe(2);
    });

    it('recusa COMERCIAL, outro técnico, OS aberta, legenda grande e a 21ª foto, sem preparar a foto', async () => {
      await noAparelho('ABERTA');
      expect((await erroDe(repo.adicionarFoto('o1', arquivo()))).message).toBe('Fotos e assinatura só com a OS em andamento.');
      await noAparelho('EM_ANDAMENTO', { anexos: Array.from({ length: 15 }, (_, i) => anexoServidor({ id: `fs${i}` })) });
      usuario.set(COMERCIAL);
      expect((await erroDe(repo.adicionarFoto('o1', arquivo()))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(OUTRO_TECNICO);
      expect((await erroDe(repo.adicionarFoto('o1', arquivo()))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(TECNICO);
      expect((await erroDe(repo.adicionarFoto('o1', arquivo(), { legenda: 'x'.repeat(201) }))).campo).toBe('legenda');
      expect(preparar).not.toHaveBeenCalled();
      for (let i = 0; i < 5; i++) await repo.adicionarFoto('o1', arquivo());
      const limite = await erroDe(repo.adicionarFoto('o1', arquivo()));
      expect([limite.codigo, limite.message]).toEqual(['LIMITE_FOTOS', 'Esta OS já tem o máximo de 20 fotos.']);
      expect(preparar).toHaveBeenCalledTimes(5);
    });

    it('o erro do prepararFoto chega como está; uma foto de cada vez, mesmo com chamadas simultâneas', async () => {
      await noAparelho('EM_ANDAMENTO');
      preparar.mockRejectedValueOnce(new ErroOs('FOTO_TIPO', 'foto', 'Escolha uma imagem.'));
      expect((await erroDe(repo.adicionarFoto('o1', arquivo()))).codigo).toBe('FOTO_TIPO');
      let emCurso = 0;
      let pico = 0;
      preparar.mockImplementation(async () => {
        pico = Math.max(pico, ++emCurso);
        await new Promise((r) => setTimeout(r, 5));
        emCurso--;
        return { bytes: new ArrayBuffer(3), miniatura: new ArrayBuffer(1), sha256: 'e'.repeat(64), largura: 1, altura: 1 };
      });
      await Promise.all([repo.adicionarFoto('o1', arquivo()), repo.adicionarFoto('o1', arquivo()), repo.adicionarFoto('o1', arquivo())]);
      expect(pico).toBe(1);
      expect(await db.anexosOs.count()).toBe(3);
    });

    it('QuotaExceededError ao gravar: "Pouco espaço no aparelho para mais fotos.", sem anexo nem upload', async () => {
      await noAparelho('EM_ANDAMENTO');
      vi.spyOn(db.anexosOs, 'add').mockRejectedValue(new DOMException('cheio', 'QuotaExceededError'));
      const e = await erroDe(repo.adicionarFoto('o1', arquivo()));
      expect([e.codigo, e.campo, e.message]).toEqual(['SEM_ESPACO', 'foto', 'Pouco espaço no aparelho para mais fotos.']);
      expect(await db.anexosOs.count()).toBe(0);
      expect(await db.outbox.count()).toBe(0);
    });
  });

  describe('assinar e recusarAssinatura', () => {
    it('assinar grava a ASSINATURA (com o PNG como miniatura) e o upload, e zera a recusa local sem espelhar a aceita', async () => {
      await noAparelho('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      const id = await repo.assinar('o1', { png: { bytes: PNG, sha256: SHA_PNG }, nome: ' Maria ', papel: 'Síndica' });
      const a = (await db.anexosOs.get(id))!;
      expect(a).toMatchObject({ tipo: 'ASSINATURA', assinanteNome: 'Maria', assinantePapel: 'Síndica', tiradaEm: AGORA.toISOString(), sha256: SHA_PNG });
      expect(new Uint8Array(a.miniatura!)).toEqual(new Uint8Array(PNG));
      expect((await fila()).map((m) => m.entidade)).toEqual([TIPO_UPLOAD_ANEXO_OS]);
      expect(await db.os.get('o1')).toMatchObject({ assinaturaRecusada: false, motivoRecusa: null, assinaturaAnexoId: null, assinanteNome: null });
    });

    it('M6/R26: com a OS encerrada, a assinatura do técnico é só evidência: o registro da OS não muda', async () => {
      const antes = await noAparelho('CONCLUIDA', { assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      await repo.assinar('o1', { png: { bytes: PNG, sha256: SHA_PNG }, nome: 'Maria', papel: null });
      expect(await db.os.get('o1')).toEqual(antes);
      expect(await db.outbox.count()).toBe(1);
    });

    it('assinar: nome de 2 a 120, papel até 60, PNG até 512 KB, no máximo 10; o COMERCIAL não assina', async () => {
      await noAparelho('EM_ANDAMENTO', { anexos: Array.from({ length: 10 }, (_, i) => anexoServidor({ id: `s${i}`, tipo: 'ASSINATURA' })) });
      const png = { bytes: PNG, sha256: SHA_PNG };
      expect((await erroDe(repo.assinar('o1', { png, nome: 'M' }))).campos).toEqual({ assinanteNome: 'O nome tem de 2 a 120 caracteres.' });
      expect((await erroDe(repo.assinar('o1', { png, nome: '' }))).campos).toEqual({ assinanteNome: 'Informe o nome de quem assina.' });
      expect((await erroDe(repo.assinar('o1', { png, nome: 'Maria', papel: 'x'.repeat(61) }))).campo).toBe('assinantePapel');
      expect((await erroDe(repo.assinar('o1', { png: { bytes: new ArrayBuffer(512 * 1024 + 1), sha256: SHA_PNG }, nome: 'Maria' }))).codigo).toBe('ASSINATURA_GRANDE');
      expect((await erroDe(repo.assinar('o1', { png, nome: 'Maria' }))).codigo).toBe('LIMITE_ASSINATURAS');
      usuario.set(COMERCIAL);
      expect((await erroDe(repo.assinar('o1', { png, nome: 'Maria' }))).codigo).toBe('ACESSO_NEGADO');
      expect(await db.anexosOs.count()).toBe(0);
    });

    it('QuotaExceededError ao gravar a assinatura: SEM_ESPACO, sem anexo, upload nem mudança na recusa', async () => {
      await noAparelho('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      vi.spyOn(db.anexosOs, 'add').mockRejectedValue(new DOMException('cheio', 'QuotaExceededError'));
      const e = await erroDe(repo.assinar('o1', { png: { bytes: PNG, sha256: SHA_PNG }, nome: 'Maria' }));
      expect([e.codigo, e.campo, e.message]).toEqual(['SEM_ESPACO', 'assinatura', 'Pouco espaço no aparelho para gravar a assinatura.']);
      expect(await db.outbox.count()).toBe(0);
      expect(await db.os.get('o1')).toMatchObject({ assinaturaRecusada: true, motivoRecusa: 'Ausente' });
    });

    it('recusarAssinatura: UPSERT com a recusa e o motivo; recusada se já há assinatura; motivo de 3 a 500', async () => {
      await noAparelho('EM_ANDAMENTO');
      expect((await erroDe(repo.recusarAssinatura('o1', 'ab'))).campos).toEqual({ motivoRecusa: 'O motivo da recusa tem de 3 a 500 caracteres.' });
      await repo.recusarAssinatura('o1', ' Cliente ausente ');
      expect(dadosDe((await fila())[0])).toMatchObject({ assinaturaRecusada: true, motivoRecusa: 'Cliente ausente' });
      usuario.set(COMERCIAL);
      expect((await erroDe(repo.recusarAssinatura('o1', 'Ausente'))).codigo).toBe('OS_NAO_EDITAVEL');
      usuario.set(TECNICO);
      await repo.assinar('o1', { png: { bytes: PNG, sha256: SHA_PNG }, nome: 'Maria' });
      expect((await erroDe(repo.recusarAssinatura('o1', 'Ausente'))).codigo).toBe('ASSINATURA_COLHIDA');
      await noAparelho('EM_ANDAMENTO', { assinaturaAnexoId: 's9' });
      expect((await erroDe(repo.recusarAssinatura('o1', 'Ausente'))).codigo).toBe('ASSINATURA_COLHIDA');
    });
  });

  describe('concluir', () => {
    it('sem assinatura e sem recusa: erro no campo assinatura, e nada é gravado nem gerado', async () => {
      await noAparelho('EM_ANDAMENTO');
      const e = await erroDe(repo.concluir('o1', 'Serviço feito', gerarPdf));
      expect([e.codigo, e.campo, e.message]).toEqual(['VALIDACAO', 'assinatura', 'Colete a assinatura ou registre a recusa com o motivo.']);
      expect((await erroDe(repo.concluir('o1', 'ab', gerarPdf))).campos?.['resumoExecucao']).toContain('resumo');
      expect(gerarPdf).not.toHaveBeenCalled();
      expect(await db.outbox.count()).toBe(0);
    });

    it('com a recusa: UPSERT separado CONCLUIDA, o PDF da OS e o upload dele, numa transação, depois da geração', async () => {
      await noAparelho('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Cliente ausente', revisao: 2 }, 5);
      const { blob, codigoExibido } = await repo.concluir('o1', ' Serviço feito ', gerarPdf);
      expect(codigoExibido).toBe('OS-000123-R2');
      expect(await blob.text()).toBe(PDF);
      const entrada = gerarPdf.mock.calls[0][0];
      expect(entrada.os).toMatchObject({ codigoExibido: 'OS-000123-R2', revisao: 2, resumoExecucao: 'Serviço feito' });
      expect(entrada.recusaAssinatura).toBe('Cliente ausente');
      expect(entrada.logoDataUrl).toBe('data:image/png;base64,TE9HTw==');
      const m = await fila();
      expect(m.map((x) => [x.entidade, x.op, !!x.separada])).toEqual([['os', 'UPSERT', true], [TIPO_UPLOAD_ANEXO_OS, 'UPLOAD', true]]);
      expect(m[0]).toMatchObject({ baseVersion: 5 });
      expect(dadosDe(m[0])).toMatchObject({ status: 'CONCLUIDA', resumoExecucao: 'Serviço feito', concluiProposta: true, responsavelId: null });
      const doc = (await db.anexosOs.get((m[1].dados as { anexoId: string }).anexoId))!;
      expect(doc).toMatchObject({ tipo: 'DOCUMENTO', revisaoOs: 2, codigoExibido: 'OS-000123-R2', enviado: false });
      expect(new TextDecoder().decode(doc.bytes!)).toBe(PDF);
      expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(doc.snapshot).toMatchObject({ os: { codigoExibido: 'OS-000123-R2' }, logoArquivoId: 'logo-1' });
      expect(doc.snapshot!['logoDataUrl']).toBeUndefined();
      expect((await db.os.get('o1'))!.status).toBe('CONCLUIDA');
    });

    it('"Precisa voltar" (Q21): concluiProposta=false na própria mutação do concluir; sem ele, fica o valor da OS', async () => {
      await noAparelho('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      await repo.concluir('o1', 'Falta peça', gerarPdf, { precisaVoltar: true });
      expect(dadosDe((await fila())[0])).toMatchObject({ status: 'CONCLUIDA', concluiProposta: false });
      await db.outbox.clear();
      await noAparelho('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente', concluiProposta: false });
      await repo.concluir('o1', 'Feito', gerarPdf);
      expect(dadosDe((await fila())[0]).concluiProposta).toBe(false);
    });

    it('a assinatura do aparelho e as fotos (miniaturas) vão para o PDF, sem imagens no snapshot', async () => {
      await noAparelho('EM_ANDAMENTO', { anexos: [
        anexoServidor({ legenda: 'Do servidor' }),
        anexoServidor({ id: 'fs2', arquivoId: 'a-fs2', legenda: 'Fora do cache', tiradaEm: '2026-10-01T11:01:00Z' }),
        anexoServidor({ id: 'fs3', arquivoId: 'a-fs3', legenda: 'Ilegível', tiradaEm: '2026-10-01T11:02:00Z' }),
      ] });
      const cheia = new Blob([new Uint8Array(2_000_000)], { type: 'image/jpeg' });
      const ilegivel = new Blob([new Uint8Array(1)], { type: 'image/jpeg' });
      arquivos.obterBlob.mockImplementation(async (id: string) => (id === 'a-fs1' ? cheia : id === 'a-fs3' ? ilegivel : null));
      reduzir.mockImplementation(async (b: Blob) => {
        if (b === ilegivel) throw new Error('decodificador');
        return new Uint8Array([0xff, 0xd8, 0x99]).buffer as ArrayBuffer;
      });
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await repo.adicionarFoto('o1', arquivo(), { legenda: 'Depois', momento: 'DEPOIS' });
      await repo.assinar('o1', { png: { bytes: PNG, sha256: SHA_PNG }, nome: 'Maria', papel: 'Síndica' });
      await repo.concluir('o1', 'Feito', gerarPdf);
      const e = gerarPdf.mock.calls[0][0];
      // M2P2-R10: a foto que só o servidor tem entra reduzida à miniatura, nunca em tamanho cheio
      expect(e.fotos.map((f) => [f.legenda, f.imagem])).toEqual([
        ['Do servidor', 'data:image/jpeg;base64,/9iZ'], ['Fora do cache', null], ['Ilegível', null],
        ['Depois', 'data:image/jpeg;base64,/9gR'],
      ]);
      expect(reduzir).toHaveBeenCalledWith(cheia);
      expect(arquivos.obterDataUrl).not.toHaveBeenCalled();
      expect(e.assinatura).toMatchObject({ nome: 'Maria', papel: 'Síndica', assinadaEm: AGORA.toISOString(), imagem: 'data:image/png;base64,iVBORwECAw==' });
      expect(e.recusaAssinatura).toBeNull();
      const doc = (await db.anexosOs.toArray()).find((a) => a.tipo === 'DOCUMENTO')!;
      expect(JSON.stringify(doc.snapshot)).not.toContain('base64');
      // fila: foto, assinatura, concluir, PDF
      expect((await fila()).map((m) => m.op)).toEqual(['UPLOAD', 'UPLOAD', 'UPSERT', 'UPLOAD']);
    });

    it('P4b-R21: a OS mudou durante a geração (o número chegou): gera de novo; na 3ª mudança, OS_ALTERADA', async () => {
      await noAparelho('EM_ANDAMENTO', { numero: null, assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      gerarPdf.mockImplementationOnce(async () => {
        await db.os.update('o1', { numero: 124, version: 3 });
        return new Blob(['velho']);
      });
      const { codigoExibido } = await repo.concluir('o1', 'Feito', gerarPdf);
      expect(gerarPdf).toHaveBeenCalledTimes(2);
      expect(gerarPdf.mock.calls[0][0].os.codigoExibido).toBe('OSP-0Z9XY7');
      expect(codigoExibido).toBe('OS-000124');
      expect((await fila())[0]).toMatchObject({ baseVersion: 3 });
      expect((await db.anexosOs.toArray()).filter((a) => a.tipo === 'DOCUMENTO')).toHaveLength(1);

      await db.outbox.clear();
      await db.anexosOs.clear();
      await noAparelho('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      let n = 0;
      gerarPdf.mockImplementation(async () => {
        await db.os.update('o1', { urgente: ++n % 2 === 1 });
        return new Blob([PDF]);
      });
      expect((await erroDe(repo.concluir('o1', 'Feito', gerarPdf))).codigo).toBe('OS_ALTERADA');
      expect(await db.outbox.count()).toBe(0);
      expect(await db.anexosOs.count()).toBe(0);
    });

    it('M2P2-R9: um upload aceito durante a geração não muda o PDF: grava de primeira, sobre a versão nova', async () => {
      const os = await noAparelho('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente' }, 3);
      const f1 = await repo.adicionarFoto('o1', arquivo(), { legenda: 'Quadro' });
      gerarPdf.mockImplementationOnce(async () => {
        // o que o aplicarUpload do SyncService faz com a foto aceita
        const a = (await db.anexosOs.get(f1))!;
        await db.anexosOs.put({ ...a, enviado: true, arquivoId: `a-${f1}`, bytes: null });
        await db.os.update('o1', { version: 4, anexos: [...os.anexos, paraAnexoOsServidor(anexoServidor({ id: f1, arquivoId: `a-${f1}`, legenda: 'Quadro' }))] });
        return new Blob([PDF]);
      });
      await repo.concluir('o1', 'Feito', gerarPdf);
      expect(gerarPdf).toHaveBeenCalledTimes(1);
      const concluir = (await fila()).find((m) => m.entidade === 'os')!;
      expect(concluir).toMatchObject({ baseVersion: 4, separada: true });
      expect(await db.os.get('o1')).toMatchObject({ version: 4, status: 'CONCLUIDA', anexos: [{ id: f1 }] });
    });

    it('M2P2-R9: a assinatura aceita e espelhada durante a geração (OS em andamento) não muda o PDF: gera uma vez, sobre a versão nova', async () => {
      await noAparelho('EM_ANDAMENTO', {}, 3);
      const s1 = await repo.assinar('o1', { png: { bytes: PNG, sha256: SHA_PNG }, nome: 'Maria', papel: 'Síndica' });
      gerarPdf.mockImplementationOnce(async () => {
        // o que o aplicarUpload do SyncService faz com a assinatura aceita: o anexo enviado e o espelho na OS (`noAgregado`)
        const a = (await db.anexosOs.get(s1))!;
        await db.anexosOs.put({ ...a, enviado: true, arquivoId: `a-${s1}`, bytes: null });
        const resp: RespostaAnexoOs = {
          anexo: {
            id: s1, tipo: 'ASSINATURA', arquivoId: `a-${s1}`, sha256: SHA_PNG, assinanteNome: 'Maria', assinantePapel: 'Síndica',
            tiradaEm: a.tiradaEm, autorId: TECNICO.id, criadoEm: AGORA.toISOString(),
          },
          versaoOs: 4,
        };
        const local = (await db.os.get('o1'))!;
        await db.os.put({ ...local, ...tipoUploadDe(TIPO_UPLOAD_ANEXO_OS)!.noAgregado(local, resp, 4) } as OsLocal);
        expect(await db.os.get('o1')).toMatchObject({ version: 4, assinaturaAnexoId: s1, assinanteNome: 'Maria', assinantePapel: 'Síndica' });
        return new Blob([PDF]);
      });
      await repo.concluir('o1', 'Feito', gerarPdf);
      expect(gerarPdf).toHaveBeenCalledTimes(1);
      const concluir = (await fila()).find((m) => m.entidade === 'os' && dadosDe(m).status === 'CONCLUIDA')!;
      expect(concluir).toMatchObject({ baseVersion: 4, separada: true, dados: { assinaturaAnexoId: s1 } });
      expect(await db.os.get('o1')).toMatchObject({ version: 4, status: 'CONCLUIDA', assinaturaAnexoId: s1, anexos: [{ id: s1 }] });
    });

    it('uma foto gravada durante a geração faz gerar de novo, já com ela', async () => {
      await noAparelho('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      gerarPdf.mockImplementationOnce(async () => {
        await db.anexosOs.put({
          id: 'f9', osId: 'o1', tipo: 'FOTO', sha256: 'c'.repeat(64), legenda: 'Tarde', momento: null, tiradaEm: AGORA.toISOString(),
          assinanteNome: null, assinantePapel: null, revisaoOs: null, codigoExibido: null, bytes: new ArrayBuffer(1),
          miniatura: new ArrayBuffer(1), enviado: false, arquivoId: null,
        });
        return new Blob(['velho']);
      });
      await repo.concluir('o1', 'Feito', gerarPdf);
      expect(gerarPdf).toHaveBeenCalledTimes(2);
      expect(gerarPdf.mock.calls[0][0].fotos).toHaveLength(0);
      expect(gerarPdf.mock.calls[1][0].fotos.map((f) => f.legenda)).toEqual(['Tarde']);
    });

    it('um CONFLITO que chega durante a geração trava na transação: nada é gravado', async () => {
      await noAparelho('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      gerarPdf.mockImplementationOnce(async () => {
        await db.pendencias.put(conflito());
        return new Blob([PDF]);
      });
      expect((await erroDe(repo.concluir('o1', 'Feito', gerarPdf))).codigo).toBe('RESOLVA_A_PENDENCIA');
      expect(await db.outbox.count()).toBe(0);
      expect(await db.anexosOs.count()).toBe(0);
      expect((await db.os.get('o1'))!.status).toBe('EM_ANDAMENTO');
    });

    it('M2P2-R8: o PDF nunca leva o CPF/CNPJ do cliente, nem quando o ADMIN conclui (nem no snapshot); o CNPJ da empresa fica', async () => {
      usuario.set(ADMIN);
      await noAparelho('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      expect((await db.clientes.get('c1'))!.documento).toBe('11444777000161');
      await repo.concluir('o1', 'Feito', gerarPdf);
      const e = gerarPdf.mock.calls[0][0];
      expect(e.cliente).toMatchObject({ nome: 'Cliente Ltda', documento: null });
      expect(JSON.stringify(e)).not.toContain('11444777000161');
      expect(e.empresa.cnpj).toBe('11222333000181');
      const doc = (await db.anexosOs.toArray()).find((a) => a.tipo === 'DOCUMENTO')!;
      expect(JSON.stringify(doc.snapshot)).not.toContain('11444777000161');
      expect(JSON.stringify(doc.snapshot)).toContain('11222333000181');
    });

    it('QuotaExceededError ao gravar o PDF: SEM_ESPACO, sem a conclusão na fila', async () => {
      await noAparelho('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      vi.spyOn(db.anexosOs, 'add').mockRejectedValue(new DOMException('cheio', 'QuotaExceededError'));
      const e = await erroDe(repo.concluir('o1', 'Feito', gerarPdf));
      expect([e.codigo, e.message]).toEqual(['SEM_ESPACO', 'Pouco espaço no aparelho para gravar o PDF.']);
      expect(await db.outbox.count()).toBe(0);
      expect((await db.os.get('o1'))!.status).toBe('EM_ANDAMENTO');
    });

    it('perfis e status: COMERCIAL e outro técnico não concluem; já concluída; snapshot e PDF grandes', async () => {
      await noAparelho('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      usuario.set(COMERCIAL);
      expect((await erroDe(repo.concluir('o1', 'Feito', gerarPdf))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(OUTRO_TECNICO);
      expect((await erroDe(repo.concluir('o1', 'Feito', gerarPdf))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(TECNICO);
      gerarPdf.mockResolvedValueOnce(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]));
      expect((await erroDe(repo.concluir('o1', 'Feito', gerarPdf))).codigo).toBe('PDF_GRANDE');
      const notas = Array.from({ length: 70 }, (_, i) => ({ id: `n${i}`, texto: '😀'.repeat(2000) }));
      await noAparelho('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente', notas });
      expect((await erroDe(repo.concluir('o1', 'Feito', gerarPdf))).codigo).toBe('SNAPSHOT_GRANDE');
      await noAparelho('CONCLUIDA');
      expect((await erroDe(repo.concluir('o1', 'Feito', gerarPdf))).codigo).toBe('OS_JA_CONCLUIDA');
      expect(await db.outbox.count()).toBe(0);
    });
  });

  // ------------------------------------------------------------------ encerramento

  describe('cancelar, reabrir, aceitarTrabalho e excluir', () => {
    it('cancelar: COMERCIAL responsável em ABERTA, ADMIN em andamento; o motivo vai na mutação separada', async () => {
      usuario.set(COMERCIAL);
      await noAparelho('ABERTA');
      expect((await erroDe(repo.cancelar('o1', 'ab'))).campo).toBe('motivoCancelamento');
      await repo.cancelar('o1', ' Cliente desistiu ');
      const [m] = await fila();
      expect(m.separada).toBe(true);
      expect(dadosDe(m)).toMatchObject({ status: 'CANCELADA', motivoCancelamento: 'Cliente desistiu' });
      await noAparelho('EM_ANDAMENTO');
      expect((await erroDe(repo.cancelar('o1', 'Desistiu'))).message).toBe('Só o administrador cancela uma OS em andamento.');
      usuario.set(TECNICO);
      expect((await erroDe(repo.cancelar('o1', 'Desistiu'))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(ADMIN);
      await repo.cancelar('o1', 'Desistiu');
      expect((await db.os.get('o1'))!.status).toBe('CANCELADA');
    });

    it('reabrir: só o ADMIN; motivoReabertura só na mutação, nunca no registro; a revisão sobe no aparelho', async () => {
      await noAparelho('CONCLUIDA', { concluidaEm: '2026-10-01T12:00:00Z' });
      usuario.set(COMERCIAL);
      expect((await erroDe(repo.reabrir('o1', 'Faltou algo'))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(ADMIN);
      expect((await erroDe(repo.reabrir('o1', 'ab'))).campo).toBe('motivoReabertura');
      await repo.reabrir('o1', ' Faltou o quadro ');
      const [m] = await fila();
      expect(m.separada).toBe(true);
      // os [srv] vão com o valor do servidor; a revisão nova e a conclusão zerada ficam só no aparelho
      expect(dadosDe(m)).toMatchObject({
        status: 'EM_ANDAMENTO', motivoReabertura: 'Faltou o quadro', revisao: 1, concluidaEm: '2026-10-01T12:00:00Z',
      });
      const os = (await db.os.get('o1'))!;
      expect(os).toMatchObject({ status: 'EM_ANDAMENTO', revisao: 2, concluidaEm: null });
      expect(chaves(os)).not.toContain('motivoReabertura');
    });

    it('reabrir só a OS concluída: em andamento e aberta (com técnico) dão TRANSICAO_INVALIDA, sem mexer em nada', async () => {
      usuario.set(ADMIN);
      for (const status of ['EM_ANDAMENTO', 'ABERTA'] as const) {
        const antes = await noAparelho(status);
        const e = await erroDe(repo.reabrir('o1', 'Faltou algo'));
        expect([e.codigo, e.message]).toEqual(['TRANSICAO_INVALIDA', 'Só uma OS concluída pode ser reaberta.']);
        expect(await db.os.get('o1')).toEqual(antes);
      }
      usuario.set(OUTRO_COMERCIAL);
      expect((await erroDe(repo.reabrir('o1', 'Faltou algo'))).codigo).toBe('ACESSO_NEGADO');
      expect(await db.outbox.count()).toBe(0);
    });

    it('cancelar a OS já cancelada é recusado antes de validar, sem mutação vazia', async () => {
      usuario.set(ADMIN);
      await noAparelho('CANCELADA', { motivoCancelamento: 'Desistiu' });
      const e = await erroDe(repo.cancelar('o1', ''));
      expect([e.codigo, e.message]).toEqual(['TRANSICAO_INVALIDA', 'Esta OS já está cancelada.']);
      usuario.set(OUTRO_COMERCIAL);
      expect((await erroDe(repo.cancelar('o1', 'Desistiu'))).codigo).toBe('ACESSO_NEGADO');
      expect(await db.outbox.count()).toBe(0);
    });

    it('aceitarTrabalho: só o ADMIN, com a proposta cancelada; o comando vai separado e não fica no registro', async () => {
      await noAparelho('CONCLUIDA');
      await proposta('CANCELADA');
      for (const u of [COMERCIAL, TECNICO]) {
        usuario.set(u);
        expect((await erroDe(repo.aceitarTrabalho('o1'))).codigo).toBe('ACESSO_NEGADO');
      }
      usuario.set(ADMIN);
      await repo.aceitarTrabalho('o1');
      const [m] = await fila();
      expect(m.separada).toBe(true);
      expect(dadosDe(m)).toMatchObject({ status: 'CONCLUIDA', aceitarTrabalho: true });
      expect(chaves(await db.os.get('o1'))).not.toContain('aceitarTrabalho');
      await repo.adicionarNota('o1', 'Depois do aceite');
      expect(await fila()).toHaveLength(2); // a nota não coalesce no comando
      // sem efeito no servidor: proposta não cancelada (RECUSADA nunca tem OS), OS avulsa e OS cancelada
      for (const status of ['APROVADA', 'RECUSADA'] as const) {
        await proposta(status);
        expect((await erroDe(repo.aceitarTrabalho('o1'))).codigo).toBe('PROPOSTA_NAO_CANCELADA');
      }
      await noAparelho('CONCLUIDA', { propostaId: null });
      expect((await erroDe(repo.aceitarTrabalho('o1'))).codigo).toBe('PROPOSTA_NAO_CANCELADA');
      await proposta('CANCELADA');
      await noAparelho('CANCELADA');
      const cancelada = await erroDe(repo.aceitarTrabalho('o1'));
      expect([cancelada.codigo, cancelada.message]).toEqual(['OS_CANCELADA', 'Esta OS foi cancelada: não há trabalho dela a aceitar.']);
      expect(await fila()).toHaveLength(2);
    });

    it('excluir: só ABERTA sem técnico, pelo ADMIN ou pelo COMERCIAL responsável; apaga os anexos locais', async () => {
      usuario.set(COMERCIAL);
      await noAparelho('ABERTA');
      expect((await erroDe(repo.excluir('o1'))).message).toBe('Cancele a OS em vez de excluir.');
      await noAparelho('EM_ANDAMENTO', { tecnicoId: null });
      expect((await erroDe(repo.excluir('o1'))).message).toBe('Só uma OS aberta pode ser excluída.');
      await noAparelho('ABERTA', { tecnicoId: null });
      usuario.set(TECNICO);
      expect((await erroDe(repo.excluir('o1'))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(OUTRO_COMERCIAL);
      expect((await erroDe(repo.excluir('o1'))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(COMERCIAL);
      await db.anexosOs.put({
        id: 'd1', osId: 'o1', tipo: 'DOCUMENTO', sha256: 'f'.repeat(64), legenda: null, momento: null, tiradaEm: null,
        assinanteNome: null, assinantePapel: null, revisaoOs: 1, codigoExibido: 'OS-000123', bytes: new ArrayBuffer(1),
        miniatura: null, enviado: true, arquivoId: 'a-d1',
      });
      await db.pendencias.put({ ...conflito(), tipo: 'REJEITADO' });
      await repo.excluir('o1');
      expect(await db.os.get('o1')).toBeUndefined();
      expect(await db.anexosOs.count()).toBe(0);
      expect(await db.pendencias.count()).toBe(0);
      expect((await fila()).map((m) => [m.op, m.baseVersion])).toEqual([['DELETE', 2]]);
    });

    it('excluir a OS criada offline só esvazia a fila; com mutação em voo, OS_SINCRONIZANDO', async () => {
      usuario.set(ADMIN);
      const id = await repo.criarAvulsa({ clienteId: 'c1', tipo: 'SERVICO', descricao: null });
      await repo.excluir(id);
      expect(await db.outbox.count()).toBe(0);
      const id2 = await repo.criarAvulsa({ clienteId: 'c1', tipo: 'SERVICO', descricao: null });
      await db.outbox.toCollection().modify({ enviando: true });
      expect((await erroDe(repo.excluir(id2))).codigo).toBe('OS_SINCRONIZANDO');
      expect(await db.os.get(id2)).toBeDefined();
    });
  });

  describe('M2P2-R12: a edição é aplicada sobre o registro relido na transação', () => {
    const ESCRITORIO = { dataPrevista: '2026-10-09', descricao: 'Do escritório', enderecoLogradouro: 'Av. Nova' };

    /**
     * A fila do técnico: A (em voo) e B (uma nota, que recebe a próxima por coalescência). O OK de A traz o cabeçalho do
     * escritório (R30), e o `aplicarResultado` rebaseia B e a OS local enquanto a tela grava outra edição.
     */
    async function okDuranteAEdicao(editar: () => Promise<unknown>): Promise<void> {
      const os = await noAparelho('EM_ANDAMENTO', {}, 4);
      const enviado = { ...dadosDaOs(os), responsavelId: null };
      const seqA = await db.outbox.add({
        mutationId: 'a', entidade: 'os', agregadoId: 'o1', op: 'UPSERT', baseVersion: 4, dados: enviado, separada: true,
        enviando: true, criadaEm: '',
      });
      await db.outbox.add({
        mutationId: 'b', entidade: 'os', agregadoId: 'o1', op: 'UPSERT', baseVersion: 4, criadaEm: '',
        dados: { ...enviado, notas: [{ id: 'n1', texto: 'Cheguei', autorId: null, criadaEm: null }] },
      });
      await db.os.put({ ...os, notas: [{ id: 'n1', texto: 'Cheguei', autorId: null, criadaEm: null }] });
      const a = (await db.outbox.get(seqA))!;
      const aplicar = (sync as unknown as { aplicarResultado(m: MutacaoLocal, r: unknown): Promise<void> }).aplicarResultado;
      // a edição começa primeiro (no código antigo, ela lê a OS antes do OK e grava depois dele)
      const edicao = editar();
      const ok = aplicar.call(sync, a, { mutationId: 'a', status: 'OK', version: 8, dados: osDados('EM_ANDAMENTO', ESCRITORIO) });
      await Promise.all([edicao, ok]);
    }

    it.each([
      ['adicionarNota', () => repo.adicionarNota('o1', 'Mais uma')],
      ['recusarAssinatura', () => repo.recusarAssinatura('o1', 'Cliente ausente')],
    ])('%s: a mutação da fila e a OS local ficam com o cabeçalho do escritório', async (_, editar) => {
      await okDuranteAEdicao(editar);
      const f = await fila();
      expect(f.map((m) => m.mutationId)).toHaveLength(1);
      expect(dadosDe(f[0])).toMatchObject(ESCRITORIO);
      expect(dadosDe(f[0]).notas.map((n) => n.id)).toContain('n1');
      expect(await db.os.get('o1')).toMatchObject(ESCRITORIO);
    });

    it('salvarCabecalho do ADMIN: a validação e a edição usam o registro relido', async () => {
      usuario.set(ADMIN);
      await okDuranteAEdicao(() => repo.salvarCabecalho('o1', { urgente: true }));
      const [b] = await fila();
      expect(dadosDe(b)).toMatchObject({ ...ESCRITORIO, urgente: true });
      expect(await db.os.get('o1')).toMatchObject({ ...ESCRITORIO, urgente: true });
    });
  });

  describe('CONFLITO na OS (P4c-R15)', () => {
    it('iniciar, concluir, cancelar, reabrir, atribuir e aceitarTrabalho: RESOLVA_A_PENDENCIA; notas e cabeçalho continuam', async () => {
      await db.pendencias.put(conflito());
      await proposta('CANCELADA');
      const casos: [UsuarioSessao, StatusOs, Partial<OsDados>, () => Promise<unknown>][] = [
        [TECNICO, 'ABERTA', {}, () => repo.iniciar('o1')],
        [TECNICO, 'EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente' }, () => repo.concluir('o1', 'Feito', gerarPdf)],
        [ADMIN, 'ABERTA', {}, () => repo.cancelar('o1', 'Desistiu')],
        [ADMIN, 'CONCLUIDA', {}, () => repo.reabrir('o1', 'Faltou algo')],
        [ADMIN, 'ABERTA', {}, () => repo.atribuir('o1', { tecnicoId: OUTRO_TECNICO.id })],
        [ADMIN, 'CONCLUIDA', {}, () => repo.aceitarTrabalho('o1')],
      ];
      for (const [u, status, extra, acao] of casos) {
        usuario.set(u);
        await noAparelho(status, extra);
        const e = await erroDe(acao());
        expect([e.codigo, e.campo]).toEqual(['RESOLVA_A_PENDENCIA', 'os']);
      }
      expect(gerarPdf).not.toHaveBeenCalled();
      expect(await db.outbox.count()).toBe(0);
      usuario.set(TECNICO);
      await noAparelho('EM_ANDAMENTO');
      await repo.adicionarNota('o1', 'Ainda posso anotar');
      usuario.set(COMERCIAL);
      await repo.salvarCabecalho('o1', { urgente: true });
      expect(await db.outbox.count()).toBe(1);
    });
  });

  // ------------------------------------------------------------------ sync real

  describe('com o SyncService real', () => {
    const push = () => vi.waitFor(() => http.expectOne('/api/sync/push'));
    const upload = () => vi.waitFor(() => http.expectOne('/api/os/o1/anexos'));
    const ok = (req: TestRequest, version: number, d: OsDados) =>
      req.flush({ resultados: [{ mutationId: req.request.body.mutacoes[0].mutationId, status: 'OK', version, dados: d }] });
    const metadados = async (req: TestRequest) =>
      JSON.parse(await ((req.request.body as FormData).get('metadados') as Blob).text()) as Record<string, unknown>;
    const pull = (cursor: number, mudancas: unknown[] = [], novo = cursor) =>
      vi.waitFor(() => http.expectOne((r) => r.url === '/api/sync/pull' && r.params.get('cursor') === String(cursor)))
        .then((req) => req.flush({ cursor: novo, temMais: false, mudancas, usuarios: [] }));
    const aceito = (req: TestRequest, anexoId: string, versaoOs: number, extra: Partial<AnexoOsDados> = {}) =>
      req.flush({ anexo: anexoServidor({ id: anexoId, arquivoId: `a-${anexoId}`, ...extra }), versaoOs }, { status: 201, statusText: 'Created' });

    async function voltarOnline() {
      await sync.aguardarOciosa();
      online.set(true);
      return sync.sincronizar();
    }

    it('Review Focus 1: iniciar → 2 notas → 3 fotos → assinatura → concluir offline; a ordem exata, o rebase e o PDF por último', async () => {
      await noAparelho('ABERTA');
      await repo.iniciar('o1');
      const n1 = await repo.adicionarNota('o1', 'Cheguei');
      const n2 = await repo.adicionarNota('o1', 'Troquei o disjuntor');
      const fotos = [];
      for (const momento of ['ANTES', 'DURANTE', 'DEPOIS'] as const) fotos.push(await repo.adicionarFoto('o1', arquivo(), { momento }));
      const s1 = await repo.assinar('o1', { png: { bytes: PNG, sha256: SHA_PNG }, nome: 'Maria', papel: 'Síndica' });
      const { codigoExibido } = await repo.concluir('o1', 'Serviço feito', gerarPdf);
      expect(codigoExibido).toBe('OS-000123');

      const m = await fila();
      const anexoDe = (x: MutacaoLocal) => (x.dados as { anexoId: string }).anexoId;
      const doc = anexoDe(m[7]);
      expect(m.map((x) => (x.entidade === 'os' ? `${dadosDe(x).status}${x.separada ? '*' : ''}` : anexoDe(x)))).toEqual([
        'EM_ANDAMENTO*', 'EM_ANDAMENTO', ...fotos, s1, 'CONCLUIDA*', doc,
      ]);
      expect(dadosDe(m[1]).notas.map((n) => n.id)).toEqual([n1, n2]);
      expect(dadosDe(m[6])).toMatchObject({ resumoExecucao: 'Serviço feito', assinaturaRecusada: false });

      // de volta online: cada mutação na ordem, cada upload depois da certa, rebase pela versaoOs
      const p = voltarOnline();
      const visto: string[] = [];
      const pushI = await push();
      expect(pushI.request.body.mutacoes[0]).toMatchObject({ baseVersion: 2, dados: { status: 'EM_ANDAMENTO', notas: [] } });
      http.expectNone('/api/os/o1/anexos');
      ok(pushI, 3, osDados('EM_ANDAMENTO'));
      visto.push('iniciar');
      const pushN = await push();
      expect(pushN.request.body.mutacoes[0]).toMatchObject({ baseVersion: 3 });
      ok(pushN, 4, osDados('EM_ANDAMENTO', { notas: [{ id: n1, texto: 'Cheguei' }, { id: n2, texto: 'Troquei o disjuntor' }] }));
      visto.push('notas');
      let versao = 4;
      for (const id of [...fotos, s1]) {
        const up = await upload();
        expect((await fila())[0]).toMatchObject({ op: 'UPLOAD', baseVersion: versao });
        const meta = await metadados(up);
        expect(meta['anexoId']).toBe(id);
        aceito(up, id, ++versao, id === s1
          ? { tipo: 'ASSINATURA', assinanteNome: 'Maria', assinantePapel: 'Síndica', tiradaEm: AGORA.toISOString() } : {});
        visto.push(meta['tipo'] as string);
      }
      const pushC = await push();
      expect(pushC.request.body.mutacoes[0]).toMatchObject({ baseVersion: 8, dados: { status: 'CONCLUIDA' } });
      http.expectNone('/api/os/o1/anexos');
      ok(pushC, 9, osDados('CONCLUIDA', { resumoExecucao: 'Serviço feito', assinaturaAnexoId: s1 }));
      visto.push('concluir');
      const upPdf = await upload();
      expect(await metadados(upPdf)).toMatchObject({ anexoId: doc, tipo: 'DOCUMENTO', revisaoOs: 1, codigoExibido: 'OS-000123' });
      expect(((upPdf.request.body as FormData).get('arquivo') as File).name).toBe('OS-000123.pdf');
      aceito(upPdf, doc, 10, { tipo: 'DOCUMENTO', revisaoOs: 1, codigoExibido: 'OS-000123', tiradaEm: null });
      visto.push('DOCUMENTO');
      await pull(0);
      await p;

      expect(visto).toEqual(['iniciar', 'notas', 'FOTO', 'FOTO', 'FOTO', 'ASSINATURA', 'concluir', 'DOCUMENTO']);
      expect(await db.outbox.count()).toBe(0);
      expect(await db.pendencias.count()).toBe(0);
      expect((await db.os.get('o1'))!).toMatchObject({ version: 10, status: 'CONCLUIDA' });
      const anexos = await db.anexosOs.toArray();
      expect(anexos.every((a) => a.enviado)).toBe(true);
      expect(anexos.filter((a) => a.tipo !== 'DOCUMENTO').every((a) => a.bytes === null && a.miniatura !== null)).toBe(true);
      expect(anexos.find((a) => a.tipo === 'DOCUMENTO')!.bytes).not.toBeNull();
    });

    it('Review Focus 2: técnico perde a atribuição durante o envio; o tombstone espera a fila, e nada não enviado se perde', async () => {
      await noAparelho('EM_ANDAMENTO', {}, 3);
      const n1 = await repo.adicionarNota('o1', 'Cheguei');
      const f1 = await repo.adicionarFoto('o1', arquivo());

      const p = voltarOnline();
      // M2-R3: a nota é aceita e o push volta OK com o estado do servidor (outro técnico)
      ok(await push(), 4, osDados('EM_ANDAMENTO', { tecnicoId: OUTRO_TECNICO.id, notas: [{ id: n1, texto: 'Cheguei' }] }));
      (await upload()).flush({}, { status: 503, statusText: 'Indisponível' });
      // o tombstone chega com o upload ainda na fila: não é aplicado
      await pull(0, [{ entidade: 'os', id: 'o1', version: 5, deleted: true, dados: null }], 10);
      await p;
      expect(await db.os.get('o1')).toBeDefined();
      const guardado = (await db.anexosOs.get(f1))!;
      expect(guardado.enviado).toBe(false);
      expect(guardado.bytes).not.toBeNull();
      expect((await fila()).map((m) => m.op)).toEqual(['UPLOAD']);

      // a foto sobe (janela de 7 dias) e, com a fila vazia, o tombstone seguinte tira a OS e os anexos enviados
      const p2 = sync.sincronizar();
      const up = await upload();
      expect((await fila())[0].baseVersion).toBe(4);
      aceito(up, f1, 5);
      await pull(10, [{ entidade: 'os', id: 'o1', version: 6, deleted: true, dados: null }], 11);
      await p2;
      expect(await db.os.get('o1')).toBeUndefined();
      expect(await db.anexosOs.count()).toBe(0);
      expect(await db.pendencias.count()).toBe(0);
    });

    it('notas sem conflito: a nota escrita durante o envio vai depois, rebaseada, e as notas de outros ficam (união)', async () => {
      await noAparelho('EM_ANDAMENTO', {}, 3);
      const n1 = await repo.adicionarNota('o1', 'Primeira');
      const p = voltarOnline();
      const push1 = await push();
      // em voo: a segunda nota não coalesce na primeira
      const n2 = await repo.adicionarNota('o1', 'Segunda');
      expect(await fila()).toHaveLength(2);
      const doComercial = { id: 'nc', texto: 'Cliente pediu urgência', autorId: COMERCIAL.id, criadaEm: '2026-10-01T14:00:00Z' };
      ok(push1, 4, osDados('EM_ANDAMENTO', { notas: [doComercial, { id: n1, texto: 'Primeira', autorId: TECNICO.id, criadaEm: '2026-10-01T15:00:00Z' }] }));
      const push2 = await push();
      expect(push2.request.body.mutacoes[0]).toMatchObject({ baseVersion: 4 });
      const finais = [doComercial, { id: n1, texto: 'Primeira', autorId: TECNICO.id, criadaEm: '2026-10-01T15:00:00Z' },
        { id: n2, texto: 'Segunda', autorId: TECNICO.id, criadaEm: '2026-10-01T15:00:01Z' }];
      ok(push2, 5, osDados('EM_ANDAMENTO', { notas: finais }));
      await pull(0);
      await p;
      expect(await db.pendencias.count()).toBe(0);
      expect((await db.os.get('o1'))!.notas.map((n) => n.id)).toEqual(['nc', n1, n2]);
    });
  });
});
