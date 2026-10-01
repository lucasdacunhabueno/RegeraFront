import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';
import type { UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { RegeraDb } from '../../core/db/regera-db';
import type { EntradaPdf } from '../../core/pdf/pdf-models';
import { PdfService } from '../../core/pdf/pdf-service';
import { Pendencia, TIPO_UPLOAD_DOCUMENTO } from '../../core/sync/sync-models';
import { SyncService } from '../../core/sync/sync-service';
import { ErroCampo } from '../../core/util/erro-campo';
import { ItemCatalogoDados, paraItemLocal } from '../catalogo/item-models';
import { ClienteDados, paraClienteLocal } from '../clientes/cliente-models';
import { ID_EMPRESA, paraEmpresaLocal } from '../empresa/empresa-models';
import { blocosIniciais, paraTemplateLocal } from '../templates/template-models';
import { calcular } from './calculo';
import { codigoProvisorioValido } from './codigo-provisorio';
import { DocumentoLocal, ItemPropostaLocal, PropostaDados, PropostaLocal, StatusProposta } from './proposta-models';
import { ErroProposta, hojeEmSaoPaulo, PropostasRepo, somarDias } from './propostas-repo';

const COMERCIAL: UsuarioSessao = { id: 'u-com', nome: 'Carla Comercial', email: 'carla@regera.com', perfil: 'COMERCIAL', ativo: true };
const OUTRO_COMERCIAL: UsuarioSessao = { id: 'u-com2', nome: 'Beto', email: 'beto@regera.com', perfil: 'COMERCIAL', ativo: true };
const ADMIN: UsuarioSessao = { id: 'u-adm', nome: 'Ana Admin', email: 'ana@regera.com', perfil: 'ADMIN', ativo: true };
const TECNICO: UsuarioSessao = { id: 'u-tec', nome: 'Téo Técnico', email: 'teo@regera.com', perfil: 'TECNICO', ativo: true };

/** 2026-10-02 01:30 em UTC ainda é 2026-10-01 em São Paulo (UTC−3). */
const AGORA = new Date('2026-10-02T01:30:00Z');

const item = (codigo: string, p: Partial<ItemCatalogoDados> = {}): ItemCatalogoDados => ({
  natureza: 'PRODUTO', codigo, nome: `Item ${codigo}`, descricao: `Descrição ${codigo}`, unidade: 'un', precoCusto: 50,
  precoVenda: 123.45, locavel: false, precoLocacaoMensal: null, fotoArquivoId: null, ativo: true, ...p,
});

const cliente: ClienteDados = {
  tipo: 'PJ', documento: '11444777000161', nome: 'Cliente Ltda', nomeFantasia: null, inscricaoEstadual: null,
  inscricaoMunicipal: null, email: 'compras@cliente.com', telefone: '11988887777', whatsapp: null, contatoNome: 'Maria',
  observacoes: null,
  enderecos: [
    { tipo: 'COBRANCA', cep: '01000000', logradouro: 'Rua B', numero: '2', complemento: null, bairro: null, cidade: 'Santos', uf: 'SP' },
    { tipo: 'PRINCIPAL', cep: '01310100', logradouro: 'Av. Paulista', numero: '1000', complemento: 'cj 1', bairro: 'Bela Vista',
      cidade: 'São Paulo', uf: 'SP' },
  ],
};

const pendencia = (entidade: Pendencia['entidade'], agregadoId: string, mutationId = `m-${entidade}`): Pendencia => ({
  mutationId, entidade, agregadoId, tipo: 'REJEITADO', criadaEm: '',
  mutacao: { mutationId, entidade, agregadoId, op: 'UPSERT', baseVersion: 1, dados: null, criadaEm: '' },
});

/** Bytes de "abc": SHA-256 conhecido. */
const ABC = new TextEncoder().encode('abc');
const SHA_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('datas da proposta', () => {
  it('hoje é a data civil de São Paulo, não a do UTC', () => {
    expect(hojeEmSaoPaulo(new Date('2026-10-02T01:30:00Z'))).toBe('2026-10-01');
    expect(hojeEmSaoPaulo(new Date('2026-10-02T03:00:00Z'))).toBe('2026-10-02');
  });

  it('somarDias é aritmética de calendário pura (virada de mês, de ano e bissexto)', () => {
    expect(somarDias('2026-10-01', 15)).toBe('2026-10-16');
    expect(somarDias('2026-12-25', 10)).toBe('2027-01-04');
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
    expect(somarDias('2027-02-28', 1)).toBe('2027-03-01');
    expect(somarDias('2026-10-01', 0)).toBe('2026-10-01');
  });
});

describe('PropostasRepo', () => {
  let repo: PropostasRepo;
  let db: RegeraDb;
  let sincronizar: ReturnType<typeof vi.spyOn>;
  const usuario = signal<UsuarioSessao | null>(COMERCIAL);
  const pdf = { logoDataUrl: vi.fn() };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
    usuario.set(COMERCIAL);
    pdf.logoDataUrl.mockReset().mockResolvedValue('data:image/png;base64,AAAA');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { autenticado: () => true, sessaoExpirada: () => false, usuario } },
        { provide: ConectividadeService, useValue: { online: signal(false) } },
        { provide: PdfService, useValue: pdf },
      ],
    });
    repo = TestBed.inject(PropostasRepo);
    db = TestBed.inject(RegeraDb);
    sincronizar = vi.spyOn(TestBed.inject(SyncService), 'sincronizar').mockResolvedValue();
    await db.empresa.put(paraEmpresaLocal(ID_EMPRESA, 3, {
      razaoSocial: 'Regera Energia Ltda', cnpj: '11222333000181', endereco: 'Rua A, 1', telefone: '1133334444',
      email: 'contato@regera.com', logoArquivoId: 'logo-1', corPrimaria: '#123456', validadePadraoDias: 10,
      condicoesPagamentoPadrao: '30/60/90',
    }));
    await db.templates.bulkPut([
      paraTemplateLocal('t-venda', 1, { nome: 'Venda', tipoProposta: 'VENDA', padrao: true, ativo: true, blocos: blocosIniciais() }),
      paraTemplateLocal('t-venda-2', 1, { nome: 'Venda B', tipoProposta: 'VENDA', padrao: false, ativo: true, blocos: [] }),
      paraTemplateLocal('t-loc', 1, { nome: 'Locação', tipoProposta: 'LOCACAO', padrao: true, ativo: true, blocos: blocosIniciais() }),
    ]);
    await db.clientes.put(paraClienteLocal('c1', 2, cliente));
    await db.itens.bulkPut([
      paraItemLocal('i-venda', 1, item('P-1')),
      paraItemLocal('i-loc', 1, item('L-1', { locavel: true, precoLocacaoMensal: 4500, precoVenda: 90000 })),
      paraItemLocal('i-inativo', 1, item('X-1', { ativo: false })),
      paraItemLocal('i-sem-preco', 1, item('S-1', { natureza: 'SERVICO', precoVenda: null, precoCusto: null, descricao: null })),
    ]);
    await db.usuarios.bulkPut([
      { id: COMERCIAL.id, nome: COMERCIAL.nome, email: COMERCIAL.email, perfil: 'COMERCIAL' },
      { id: OUTRO_COMERCIAL.id, nome: OUTRO_COMERCIAL.nome, email: OUTRO_COMERCIAL.email, perfil: 'COMERCIAL' },
      { id: ADMIN.id, nome: ADMIN.nome, email: ADMIN.email, perfil: 'ADMIN' },
      { id: TECNICO.id, nome: TECNICO.nome, email: TECNICO.email, perfil: 'TECNICO' },
    ]);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await db.limparTudo();
    TestBed.resetTestingModule();
  });

  async function erroDe(p: Promise<unknown>): Promise<ErroProposta> {
    const e = await p.then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(ErroProposta);
    expect(e).toBeInstanceOf(ErroCampo);
    return e as ErroProposta;
  }

  /** Proposta já sincronizada (version 4) num status qualquer, com uma linha. */
  async function existente(status: StatusProposta, p: Partial<PropostaLocal> = {}): Promise<PropostaLocal> {
    const linha: ItemPropostaLocal = {
      id: 'l1', itemCatalogoId: 'i-venda', codigo: 'P-1', nome: 'Item P-1', descricao: null, unidade: 'un', natureza: 'PRODUTO',
      precoCustoCentavos: null, quantidadeMilesimos: 2000, precoUnitarioCentavos: 10000, descontoCentesimos: 0, meses: null,
      subtotalCentavos: 20000, ordem: 0,
    };
    const proposta: PropostaLocal = {
      id: 'p1', version: 4, codigoProvisorio: 'PROV-ABCDEF', numero: null, revisao: 1, tipo: 'VENDA', status,
      clienteId: 'c1', templateId: 't-venda', responsavelId: COMERCIAL.id, tecnicoId: null, dataEmissao: '2026-09-20',
      validadeAte: '2026-09-30', condicoesPagamento: 'À vista', prazoExecucao: '10 dias', observacoes: null,
      descontoGeralCentesimos: 0, totalItensCentavos: 20000, totalDescontosCentavos: 0, totalCentavos: 20000,
      motivoEncerramento: null, itens: [linha], historico: [], documentos: [], atualizadoEm: '2026-09-20T10:00:00Z', ...p,
    };
    await db.propostas.put(proposta);
    return proposta;
  }

  const fila = async () => db.outbox.orderBy('seq').toArray();

  describe('criar', () => {
    it('cria RASCUNHO com os padrões da empresa e do template, o usuário como responsável e enfileira o UPSERT', async () => {
      const id = await repo.criar('VENDA', 'c1');
      const p = (await db.propostas.get(id))!;
      expect(codigoProvisorioValido(p.codigoProvisorio)).toBe(true);
      expect(p).toMatchObject({
        version: null, status: 'RASCUNHO', tipo: 'VENDA', clienteId: 'c1', numero: null, revisao: 1,
        responsavelId: COMERCIAL.id, tecnicoId: null, templateId: 't-venda', dataEmissao: '2026-10-01',
        validadeAte: '2026-10-11', condicoesPagamento: '30/60/90', descontoGeralCentesimos: 0, totalItensCentavos: 0,
        totalDescontosCentavos: 0, totalCentavos: 0, itens: [], historico: [], documentos: [], motivoEncerramento: null,
      });
      const [m] = await fila();
      expect(m).toMatchObject({ entidade: 'proposta', agregadoId: id, op: 'UPSERT', baseVersion: null });
      expect(m.separada).toBeFalsy();
      expect(m.dados).toMatchObject({ status: 'RASCUNHO', responsavelId: COMERCIAL.id, descontoGeralPercentual: 0, itens: [] });
      expect(sincronizar).toHaveBeenCalled();
    });

    it('usa o template padrão do tipo e aceita criar sem cliente', async () => {
      const id = await repo.criar('LOCACAO');
      expect(await db.propostas.get(id)).toMatchObject({ tipo: 'LOCACAO', templateId: 't-loc', clienteId: null });
    });

    it('sem empresa nem template padrão: validade de 15 dias, sem condições e sem template', async () => {
      await db.empresa.clear();
      const id = await repo.criar('SERVICO');
      expect(await db.propostas.get(id)).toMatchObject({ validadeAte: '2026-10-16', condicoesPagamento: null, templateId: null });
    });

    it('ADMIN também fica como responsável', async () => {
      usuario.set(ADMIN);
      const id = await repo.criar('VENDA');
      expect((await db.propostas.get(id))!.responsavelId).toBe(ADMIN.id);
    });

    it('TECNICO e sessão ausente não criam', async () => {
      usuario.set(TECNICO);
      expect((await erroDe(repo.criar('VENDA'))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(null);
      expect((await erroDe(repo.criar('VENDA'))).codigo).toBe('ACESSO_NEGADO');
      expect(await db.propostas.count()).toBe(0);
      expect(await db.outbox.count()).toBe(0);
    });
  });

  describe('adicionarItem', () => {
    it('copia o snapshot do catálogo, usa o preço de venda e recalcula os totais; a edição coalesce na criação', async () => {
      const id = await repo.criar('VENDA', 'c1');
      const linhaId = await repo.adicionarItem(id, (await db.itens.get('i-venda'))!);
      const p = (await db.propostas.get(id))!;
      expect(p.itens).toEqual([{
        id: linhaId, itemCatalogoId: 'i-venda', codigo: 'P-1', nome: 'Item P-1', descricao: 'Descrição P-1', unidade: 'un',
        natureza: 'PRODUTO', precoCustoCentavos: 5000, quantidadeMilesimos: 1000, precoUnitarioCentavos: 12345,
        descontoCentesimos: 0, meses: null, subtotalCentavos: 12345, ordem: 0,
      }]);
      expect(p).toMatchObject({ totalItensCentavos: 12345, totalDescontosCentavos: 0, totalCentavos: 12345 });
      const m = await fila();
      expect(m).toHaveLength(1);
      expect((m[0].dados as PropostaDados).itens).toMatchObject([{ id: linhaId, itemCatalogoId: 'i-venda', quantidade: 1, precoUnitario: 123.45 }]);
    });

    it('em LOCACAO com item locável: preço mensal e meses = 1; item não locável usa o preço de venda, sem meses', async () => {
      const id = await repo.criar('LOCACAO', 'c1');
      await repo.adicionarItem(id, (await db.itens.get('i-loc'))!);
      await repo.adicionarItem(id, (await db.itens.get('i-venda'))!);
      const p = (await db.propostas.get(id))!;
      expect(p.itens.map((i) => [i.precoUnitarioCentavos, i.meses, i.ordem])).toEqual([[450000, 1, 0], [12345, null, 1]]);
      expect(p.totalCentavos).toBe(462345);
    });

    it('item locável fora de LOCACAO usa o preço de venda; item sem preço visível entra com 0', async () => {
      const id = await repo.criar('VENDA', 'c1');
      await repo.adicionarItem(id, (await db.itens.get('i-loc'))!);
      await repo.adicionarItem(id, (await db.itens.get('i-sem-preco'))!);
      const p = (await db.propostas.get(id))!;
      expect(p.itens.map((i) => [i.precoUnitarioCentavos, i.meses, i.precoCustoCentavos])).toEqual([[9000000, null, 5000], [0, null, null]]);
    });

    it('recusa item inativo e proposta fora de RASCUNHO', async () => {
      const id = await repo.criar('VENDA', 'c1');
      expect((await erroDe(repo.adicionarItem(id, (await db.itens.get('i-inativo'))!))).campo).toBe('itens');
      await existente('ENVIADA');
      const e = await erroDe(repo.adicionarItem('p1', (await db.itens.get('i-venda'))!));
      expect(e.codigo).toBe('PROPOSTA_NAO_EDITAVEL');
      expect((await db.propostas.get('p1'))!.itens).toHaveLength(1);
      expect((await db.propostas.get(id))!.itens).toHaveLength(0);
    });
  });

  describe('salvarRascunho', () => {
    it('grava as alterações, recalcula os totais em BigInt (dízimas) e usa a versão carregada como base', async () => {
      await existente('RASCUNHO');
      const atual = (await db.propostas.get('p1'))!;
      const linhas = [
        { ...atual.itens[0], quantidadeMilesimos: 1333, precoUnitarioCentavos: 7, descontoCentesimos: 3333 },
        { ...atual.itens[0], id: 'l2', quantidadeMilesimos: 3000, precoUnitarioCentavos: 199999, descontoCentesimos: 1250 },
      ];
      await repo.salvarRascunho('p1', {
        itens: linhas, descontoGeralCentesimos: 1250, observacoes: '  Entregar pela manhã ', prazoExecucao: '   ',
      }, 3);
      const esperado = calcular(linhas.map((l) => ({
        quantidadeMilesimos: BigInt(l.quantidadeMilesimos), precoUnitarioCentavos: BigInt(l.precoUnitarioCentavos),
        descontoCentesimos: BigInt(l.descontoCentesimos), meses: l.meses,
      })), 1250n, false);
      const p = (await db.propostas.get('p1'))!;
      expect(p.itens.map((i) => i.subtotalCentavos)).toEqual(esperado.subtotaisCentavos.map(Number));
      expect(p.itens.map((i) => i.ordem)).toEqual([0, 1]);
      expect(p).toMatchObject({
        totalItensCentavos: Number(esperado.totalItensCentavos), totalDescontosCentavos: Number(esperado.totalDescontosCentavos),
        totalCentavos: Number(esperado.totalCentavos), observacoes: 'Entregar pela manhã', prazoExecucao: null,
        condicoesPagamento: 'À vista', version: 3,
      });
      const [m] = await fila();
      expect(m).toMatchObject({ entidade: 'proposta', op: 'UPSERT', baseVersion: 3 });
      expect((m.dados as PropostaDados).itens.map((i) => i.quantidade)).toEqual([1.333, 3]);
      expect(sincronizar).toHaveBeenCalled();
    });

    it('sem versão carregada, a base é a versão local; apaga a rejeição anterior da proposta', async () => {
      await existente('RASCUNHO');
      await db.pendencias.bulkPut([pendencia('proposta', 'p1'), pendencia(TIPO_UPLOAD_DOCUMENTO, 'p1')]);
      await repo.salvarRascunho('p1', { clienteId: null });
      expect((await fila())[0].baseVersion).toBe(4);
      expect((await db.pendencias.toArray()).map((x) => x.entidade)).toEqual([TIPO_UPLOAD_DOCUMENTO]);
    });

    it('recusa fora de RASCUNHO, sem gravar nem enfileirar', async () => {
      for (const status of ['ENVIADA', 'APROVADA', 'CANCELADA'] as StatusProposta[]) {
        await existente(status);
        const e = await erroDe(repo.salvarRascunho('p1', { observacoes: 'x' }));
        expect(e.codigo).toBe('PROPOSTA_NAO_EDITAVEL');
        expect((await db.propostas.get('p1'))!.observacoes).toBeNull();
      }
      expect(await db.outbox.count()).toBe(0);
    });

    it('recusa comercial que não é o responsável, técnico e proposta inexistente', async () => {
      await existente('RASCUNHO');
      usuario.set(OUTRO_COMERCIAL);
      expect((await erroDe(repo.salvarRascunho('p1', { observacoes: 'x' }))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(TECNICO);
      expect((await erroDe(repo.salvarRascunho('p1', { observacoes: 'x' }))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(COMERCIAL);
      expect((await erroDe(repo.salvarRascunho('nao-existe', {}))).codigo).toBe('NAO_ENCONTRADA');
      expect(await db.outbox.count()).toBe(0);
    });

    it('valida os limites das linhas e do desconto geral (campos como no servidor)', async () => {
      const p = await existente('RASCUNHO');
      const l = p.itens[0];
      const casos: [Partial<ItemPropostaLocal>, string][] = [
        [{ quantidadeMilesimos: 0 }, 'itens[0].quantidade'],
        [{ quantidadeMilesimos: 1_000_000_000 }, 'itens[0].quantidade'],
        [{ quantidadeMilesimos: 1.5 }, 'itens[0].quantidade'],
        [{ precoUnitarioCentavos: -1 }, 'itens[0].precoUnitario'],
        [{ precoUnitarioCentavos: 100_000_000_000_000 }, 'itens[0].precoUnitario'],
        [{ descontoCentesimos: 10001 }, 'itens[0].descontoPercentual'],
        [{ meses: 0 }, 'itens[0].meses'],
      ];
      for (const [mudanca, campo] of casos) {
        expect((await erroDe(repo.salvarRascunho('p1', { itens: [{ ...l, ...mudanca }] }))).campo).toBe(campo);
      }
      expect((await erroDe(repo.salvarRascunho('p1', { descontoGeralCentesimos: -1 }))).campo).toBe('descontoGeralPercentual');
      expect((await erroDe(repo.salvarRascunho('p1', { itens: [l, { ...l }] }))).campo).toBe('itens[1].id');
      expect(await db.outbox.count()).toBe(0);
    });

    it('meses: obrigatório em LOCACAO com item locável, proibido no item não locável', async () => {
      const id = await repo.criar('LOCACAO', 'c1');
      await repo.adicionarItem(id, (await db.itens.get('i-loc'))!);
      const p = (await db.propostas.get(id))!;
      expect((await erroDe(repo.salvarRascunho(id, { itens: [{ ...p.itens[0], meses: null }] }))).campo).toBe('itens[0].meses');
      const venda = { ...p.itens[0], id: 'nova', itemCatalogoId: 'i-venda', meses: 3 };
      expect((await erroDe(repo.salvarRascunho(id, { itens: [p.itens[0], venda] }))).campo).toBe('itens[1].meses');
      await repo.salvarRascunho(id, { itens: [{ ...p.itens[0], meses: 6 }] });
      expect((await db.propostas.get(id))!.totalCentavos).toBe(2700000);
    });

    it('m1: o limite do total também vale para o total de descontos (como Totais.excedeLimite do servidor)', async () => {
      const p = await existente('RASCUNHO');
      // subtotal 0 (100% de desconto), mas o desconto passa de 99.999.999.999.999,99
      const linha = { ...p.itens[0], quantidadeMilesimos: 999_999_999, precoUnitarioCentavos: 99_999_999_999_999, descontoCentesimos: 10_000 };
      const e = await erroDe(repo.salvarRascunho('p1', { itens: [linha] }));
      expect(e.codigo).toBe('VALIDACAO');
      expect(e.campo).toBe('itens');
      expect(await db.outbox.count()).toBe(0);
    });

    it('m5: data impossível (2026-02-30, mês 13) é recusada no próprio campo, com VALIDACAO', async () => {
      await existente('RASCUNHO');
      for (const [edicao, campo] of [
        [{ validadeAte: '2026-02-30' }, 'validadeAte'],
        [{ validadeAte: '2027-02-29' }, 'validadeAte'],
        [{ dataEmissao: '2026-13-01' }, 'dataEmissao'],
        [{ dataEmissao: '2026-04-31' }, 'dataEmissao'],
      ] as const) {
        const e = await erroDe(repo.salvarRascunho('p1', edicao));
        expect(e.codigo).toBe('VALIDACAO');
        expect(e.campo).toBe(campo);
      }
      expect(await db.outbox.count()).toBe(0);
      await repo.salvarRascunho('p1', { validadeAte: '2028-02-29', dataEmissao: '2026-12-31' });
      expect(await db.propostas.get('p1')).toMatchObject({ validadeAte: '2028-02-29', dataEmissao: '2026-12-31' });
    });

    it('o responsável troca o técnico no rascunho', async () => {
      await existente('RASCUNHO');
      await repo.salvarRascunho('p1', { tecnicoId: TECNICO.id });
      expect((await db.propostas.get('p1'))!.tecnicoId).toBe(TECNICO.id);
    });
  });

  describe('transicionar', () => {
    it('registra cada transição como mutação separada, em ordem', async () => {
      await existente('ENVIADA');
      await repo.transicionar('p1', 'APROVADA');
      await repo.transicionar('p1', 'EM_EXECUCAO');
      const m = await fila();
      expect(m.map((x) => [(x.dados as PropostaDados).status, x.separada, x.baseVersion])).toEqual([
        ['APROVADA', true, 4], ['EM_EXECUCAO', true, 4],
      ]);
      expect((await db.propostas.get('p1'))!.status).toBe('EM_EXECUCAO');
      expect(sincronizar).toHaveBeenCalled();
    });

    it('espaços das pontas como o String.strip() do Java: o espaço não separável (U+00A0) fica', async () => {
      await existente('ENVIADA');
      // NBSP + "ab": 3 caracteres no servidor (strip não tira o NBSP); o trim() do JS deixaria 2 e recusaria
      await repo.transicionar('p1', 'RECUSADA', ' \u00A0ab\t');
      expect((await db.propostas.get('p1'))!.motivoEncerramento).toBe('\u00A0ab');
      await existente('ENVIADA');
      expect((await erroDe(repo.transicionar('p1', 'RECUSADA', '\u2003ab\u3000'))).campo).toBe('motivoEncerramento');
      await existente('RASCUNHO');
      await repo.salvarRascunho('p1', { observacoes: '\u00A0Obs\u2007 ', prazoExecucao: '\u2028 \u3000', condicoesPagamento: '\u00A0' });
      expect(await db.propostas.get('p1')).toMatchObject({
        observacoes: '\u00A0Obs\u2007', prazoExecucao: null, condicoesPagamento: '\u00A0',
      });
    });

    it('RECUSADA e CANCELADA exigem motivo; o motivo vai sem os espaços das pontas', async () => {
      await existente('ENVIADA');
      expect((await erroDe(repo.transicionar('p1', 'RECUSADA'))).campo).toBe('motivoEncerramento');
      expect((await erroDe(repo.transicionar('p1', 'RECUSADA', ' ok '))).campo).toBe('motivoEncerramento');
      await repo.transicionar('p1', 'RECUSADA', '  Preço alto  ');
      expect(await db.propostas.get('p1')).toMatchObject({ status: 'RECUSADA', motivoEncerramento: 'Preço alto' });
      expect((await fila()).map((x) => (x.dados as PropostaDados).motivoEncerramento)).toEqual(['Preço alto']);
    });

    it('ENVIADA → RASCUNHO abre a revisão seguinte no local (o servidor confirma)', async () => {
      await existente('ENVIADA', { revisao: 2 });
      await repo.transicionar('p1', 'RASCUNHO');
      expect(await db.propostas.get('p1')).toMatchObject({ status: 'RASCUNHO', revisao: 3 });
    });

    it('recusa o que transicoesPermitidas não oferece ao usuário', async () => {
      await existente('EM_EXECUCAO');
      expect((await erroDe(repo.transicionar('p1', 'CANCELADA', 'Desistiu'))).codigo).toBe('ACESSO_NEGADO');
      expect((await erroDe(repo.transicionar('p1', 'APROVADA'))).codigo).toBe('TRANSICAO_INVALIDA');
      usuario.set(OUTRO_COMERCIAL);
      expect((await erroDe(repo.transicionar('p1', 'FINALIZADA'))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(TECNICO);
      expect((await erroDe(repo.transicionar('p1', 'FINALIZADA'))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(ADMIN);
      await repo.transicionar('p1', 'CANCELADA', 'Cliente desistiu');
      expect((await db.propostas.get('p1'))!.status).toBe('CANCELADA');
      expect(await db.outbox.count()).toBe(1);
    });

    it('RASCUNHO → ENVIADA só pelo enviar (que gera o PDF oficial)', async () => {
      await existente('RASCUNHO');
      expect((await erroDe(repo.transicionar('p1', 'ENVIADA'))).codigo).toBe('USE_ENVIAR');
      expect(await db.outbox.count()).toBe(0);
    });
  });

  describe('atribuir', () => {
    it('ADMIN troca o responsável e o técnico fora do rascunho; comercial responsável só o técnico', async () => {
      await existente('APROVADA');
      await repo.atribuir('p1', { tecnicoId: TECNICO.id });
      expect((await erroDe(repo.atribuir('p1', { responsavelId: OUTRO_COMERCIAL.id }))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(ADMIN);
      await repo.atribuir('p1', { responsavelId: OUTRO_COMERCIAL.id, tecnicoId: null });
      expect(await db.propostas.get('p1')).toMatchObject({ responsavelId: OUTRO_COMERCIAL.id, tecnicoId: null, status: 'APROVADA' });
      expect((await fila()).map((x) => x.op)).toEqual(['UPSERT']);
    });

    it('recusa em status terminal e técnico que não é TECNICO', async () => {
      await existente('APROVADA');
      expect((await erroDe(repo.atribuir('p1', { tecnicoId: COMERCIAL.id }))).campo).toBe('tecnicoId');
      await db.usuarios.bulkPut([
        { id: 'u-tec-inativo', nome: 'Ex', email: null, perfil: 'TECNICO', ativo: false },
        { id: 'u-com-inativo', nome: 'Ex C', email: null, perfil: 'COMERCIAL', ativo: false },
      ]);
      expect((await erroDe(repo.atribuir('p1', { tecnicoId: 'u-tec-inativo' }))).campo).toBe('tecnicoId');
      usuario.set(ADMIN);
      expect((await erroDe(repo.atribuir('p1', { responsavelId: 'u-com-inativo' }))).campo).toBe('responsavelId');
      usuario.set(COMERCIAL);
      await existente('FINALIZADA');
      usuario.set(ADMIN);
      expect((await erroDe(repo.atribuir('p1', { tecnicoId: TECNICO.id }))).codigo).toBe('PROPOSTA_NAO_EDITAVEL');
      expect(await db.outbox.count()).toBe(0);
    });
  });

  describe('duplicar', () => {
    it('novo RASCUNHO: mesmo cliente, itens com ids novos, novo código, mesmo responsável, datas de hoje', async () => {
      await existente('RECUSADA', {
        numero: 280, revisao: 3, motivoEncerramento: 'Caro', tecnicoId: TECNICO.id, descontoGeralCentesimos: 500,
        historico: [{ statusDe: 'ENVIADA', statusPara: 'RECUSADA', usuarioId: COMERCIAL.id, em: '2026-09-25T10:00:00Z', observacao: 'Caro' }],
        documentos: [{ id: 'd', revisao: 3, codigoExibido: '000280-R3', arquivoId: 'a', sha256: 'x', geradoEm: '', geradoPor: '' }],
      });
      usuario.set(ADMIN);
      const { id: novo, linhasDescartadas } = await repo.duplicar('p1');
      expect(linhasDescartadas).toBe(0);
      const original = (await db.propostas.get('p1'))!;
      const p = (await db.propostas.get(novo))!;
      expect(novo).not.toBe('p1');
      expect(p.codigoProvisorio).not.toBe(original.codigoProvisorio);
      expect(codigoProvisorioValido(p.codigoProvisorio)).toBe(true);
      expect(p).toMatchObject({
        version: null, status: 'RASCUNHO', numero: null, revisao: 1, clienteId: 'c1', responsavelId: COMERCIAL.id,
        tipo: 'VENDA', templateId: 't-venda', tecnicoId: TECNICO.id, dataEmissao: '2026-10-01', validadeAte: '2026-10-11',
        condicoesPagamento: 'À vista', prazoExecucao: '10 dias', descontoGeralCentesimos: 500, motivoEncerramento: null,
        historico: [], documentos: [],
      });
      expect(p.itens).toHaveLength(1);
      expect(p.itens[0].id).not.toBe('l1');
      expect(p.itens[0]).toMatchObject({ itemCatalogoId: 'i-venda', quantidadeMilesimos: 2000, precoUnitarioCentavos: 10000, ordem: 0 });
      expect(p.totalCentavos).toBe(19000);
      const [m] = await fila();
      expect(m).toMatchObject({ entidade: 'proposta', agregadoId: novo, op: 'UPSERT', baseVersion: null });
      expect(sincronizar).toHaveBeenCalled();
    });

    it('duplicar confere o catálogo e o técnico de hoje: tira linhas inativas/ausentes, acerta meses, tira técnico inativo', async () => {
      await db.itens.bulkPut([
        paraItemLocal('i-ex-locavel', 1, item('L-2', { locavel: false, precoLocacaoMensal: null })),
        paraItemLocal('i-novo-locavel', 1, item('L-3', { locavel: true, precoLocacaoMensal: 10 })),
      ]);
      await db.usuarios.put({ id: 'u-tec-inativo', nome: 'Ex', email: 'ex@regera.com', perfil: 'TECNICO', ativo: false });
      const original = await existente('CANCELADA', { tipo: 'LOCACAO', tecnicoId: 'u-tec-inativo' });
      const l = original.itens[0];
      await db.propostas.put({
        ...original,
        itens: [
          { ...l, id: 'a', itemCatalogoId: 'i-loc', meses: 6 },
          { ...l, id: 'b', itemCatalogoId: 'i-inativo', meses: null },
          { ...l, id: 'c', itemCatalogoId: 'i-ex-locavel', meses: 3 },
          { ...l, id: 'd', itemCatalogoId: 'sumiu', meses: null },
          { ...l, id: 'e', itemCatalogoId: 'i-novo-locavel', meses: null },
          { ...l, id: 'f', itemCatalogoId: 'i-venda', meses: null, precoUnitarioCentavos: 777 },
        ],
      });
      const r = await repo.duplicar('p1');
      // a tela avisa: "2 itens inativos não foram copiados"
      expect(r.linhasDescartadas).toBe(2);
      const p = (await db.propostas.get(r.id))!;
      expect(p.itens.map((i) => [i.itemCatalogoId, i.meses, i.ordem])).toEqual([
        ['i-loc', 6, 0], ['i-ex-locavel', null, 1], ['i-novo-locavel', 1, 2], ['i-venda', null, 3],
      ]);
      expect(p.itens[3].precoUnitarioCentavos).toBe(777); // o preço da proposta original é mantido
      expect(p.tecnicoId).toBeNull();
      expect((await fila())[0].dados).toMatchObject({ tecnicoId: null });
    });

    it('técnico e comercial de outra proposta não duplicam', async () => {
      await existente('RECUSADA');
      usuario.set(TECNICO);
      expect((await erroDe(repo.duplicar('p1'))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(OUTRO_COMERCIAL);
      expect((await erroDe(repo.duplicar('p1'))).codigo).toBe('ACESSO_NEGADO');
      expect(await db.propostas.count()).toBe(1);
    });
  });

  describe('enviar', () => {
    const gerar = () => vi.fn<(e: EntradaPdf) => Promise<Blob>>(async () => new Blob([ABC], { type: 'application/pdf' }));

    it('valida antes de gerar o PDF: cliente, template e pelo menos um item', async () => {
      const g = gerar();
      await existente('RASCUNHO', { itens: [], clienteId: null, templateId: null });
      const e = await erroDe(repo.enviar('p1', g));
      expect(e.codigo).toBe('VALIDACAO');
      expect(e.campos).toEqual({ clienteId: 'Informe o cliente.', templateId: 'Informe o template.', itens: 'Inclua pelo menos um item.' });
      await existente('RASCUNHO', { clienteId: 'nao-baixado' });
      expect((await erroDe(repo.enviar('p1', g))).campo).toBe('clienteId');
      await existente('RASCUNHO', { templateId: 'nao-baixado' });
      expect((await erroDe(repo.enviar('p1', g))).campo).toBe('templateId');
      await existente('CANCELADA');
      expect((await erroDe(repo.enviar('p1', g))).codigo).toBe('TRANSICAO_INVALIDA');
      usuario.set(OUTRO_COMERCIAL);
      await existente('ENVIADA');
      expect((await erroDe(repo.enviar('p1', g))).codigo).toBe('ACESSO_NEGADO');
      await existente('RASCUNHO');
      expect((await erroDe(repo.enviar('p1', g))).codigo).toBe('ACESSO_NEGADO');
      expect(g).not.toHaveBeenCalled();
      expect(await db.outbox.count()).toBe(0);
      expect(await db.documentos.count()).toBe(0);
    });

    it('gera o PDF oficial, grava o documento com SHA-256 e snapshot, e enfileira ENVIADA e depois o UPLOAD', async () => {
      const id = await repo.criar('VENDA', 'c1');
      await repo.adicionarItem(id, (await db.itens.get('i-venda'))!);
      const g = gerar();
      const blob = await repo.enviar(id, g);

      const p = (await db.propostas.get(id))!;
      expect(g).toHaveBeenCalledTimes(1);
      const entrada = g.mock.calls[0][0];
      expect(entrada).toMatchObject({
        previa: false,
        logoDataUrl: 'data:image/png;base64,AAAA',
        empresa: { razaoSocial: 'Regera Energia Ltda', cnpj: '11222333000181', corPrimaria: '#123456' },
        cliente: {
          nome: 'Cliente Ltda', documento: '11444777000161', contato: 'Maria', telefone: '11988887777', email: 'compras@cliente.com',
          endereco: 'Av. Paulista, 1000 - cj 1 - Bela Vista - São Paulo/SP - CEP 01310-100',
        },
        proposta: {
          codigoExibido: p.codigoProvisorio, referenciaProvisoria: null, revisao: 1, tipo: 'VENDA', dataEmissao: '2026-10-01',
          validadeAte: '2026-10-11', condicoesPagamento: '30/60/90', totalItensCentavos: 12345, totalDescontosCentavos: 0,
          totalCentavos: 12345, responsavelNome: COMERCIAL.nome, responsavelEmail: COMERCIAL.email,
        },
        itens: [{ codigo: 'P-1', nome: 'Item P-1', descricao: 'Descrição P-1', unidade: 'un', natureza: 'PRODUTO', quantidade: 1,
          precoUnitarioCentavos: 12345, descontoPercentual: 0, meses: null, subtotalCentavos: 12345 }],
        blocos: (await db.templates.get('t-venda'))!.blocos,
      });
      expect(pdf.logoDataUrl).toHaveBeenCalledWith(expect.objectContaining({ logoArquivoId: 'logo-1' }));

      const [doc] = await db.documentos.toArray();
      expect(doc).toMatchObject({
        propostaId: id, revisao: 1, codigoExibido: p.codigoProvisorio, sha256: SHA_ABC, geradoEm: AGORA.toISOString(),
        geradoPor: COMERCIAL.id, enviado: false, arquivoId: null,
      });
      expect(Array.from(new Uint8Array(doc.bytes!))).toEqual(Array.from(ABC));
      // snapshot = a entrada do PDF, sem a logo em data URL (vai a referência do arquivo)
      expect(doc.snapshot).toEqual({ ...JSON.parse(JSON.stringify({ ...entrada, logoDataUrl: undefined })), logoArquivoId: 'logo-1' });
      expect(doc.snapshot).not.toHaveProperty('logoDataUrl');

      expect(p.status).toBe('ENVIADA');
      const m = await fila();
      expect(m.map((x) => [x.entidade, x.op, x.separada ?? false])).toEqual([
        ['proposta', 'UPSERT', false], ['proposta', 'UPSERT', true], [TIPO_UPLOAD_DOCUMENTO, 'UPLOAD', true],
      ]);
      expect((m[0].dados as PropostaDados).status).toBe('RASCUNHO');
      expect((m[1].dados as PropostaDados).status).toBe('ENVIADA');
      expect(m[2]).toMatchObject({ agregadoId: id, dados: { documentoId: doc.id } });
      expect(sincronizar).toHaveBeenCalled();
      expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual(Array.from(ABC));
    });

    it('com número: exibe o número (com -R na revisão > 1) e referencia o PROV de um documento provisório anterior', async () => {
      await existente('RASCUNHO', {
        numero: 277, revisao: 2,
        documentos: [{ id: 'd0', revisao: 1, codigoExibido: 'PROV-ABCDEF', arquivoId: 'a0', sha256: 'x', geradoEm: '', geradoPor: '' }],
      });
      const g = gerar();
      await repo.enviar('p1', g);
      expect(g.mock.calls[0][0].proposta).toMatchObject({ codigoExibido: '000277', revisao: 2, referenciaProvisoria: 'PROV-ABCDEF' });
      expect((await db.documentos.toArray())[0]).toMatchObject({ codigoExibido: '000277-R2', revisao: 2 });
    });

    it('referência PROV também vem de documento local ainda não enviado; sem PROV anterior, não há referência', async () => {
      await existente('RASCUNHO', { numero: 277 });
      const local: DocumentoLocal = {
        id: 'dl', propostaId: 'p1', revisao: 1, codigoExibido: 'PROV-ABCDEF', sha256: 'x', geradoEm: '', geradoPor: null,
        bytes: null, enviado: false, arquivoId: null,
      };
      const g = gerar();
      await repo.enviar('p1', g);
      expect(g.mock.calls[0][0].proposta.referenciaProvisoria).toBeNull();
      await db.outbox.clear();
      await db.documentos.clear();
      await existente('RASCUNHO', { numero: 277, revisao: 2 });
      await db.documentos.put(local);
      await repo.enviar('p1', g);
      expect(g.mock.calls[1][0].proposta).toMatchObject({ codigoExibido: '000277', referenciaProvisoria: 'PROV-ABCDEF' });
    });

    it('P4b-R20: o e-mail do responsável vem da lista de usuários quando ele não é o usuário atual', async () => {
      usuario.set(ADMIN);
      await existente('RASCUNHO');
      const g = gerar();
      await repo.enviar('p1', g);
      expect(g.mock.calls[0][0].proposta).toMatchObject({ responsavelNome: COMERCIAL.nome, responsavelEmail: COMERCIAL.email });
    });

    it('PROV na revisão 2: o documento leva o sufixo; sem empresa nem logo, o PDF sai mesmo assim', async () => {
      await db.empresa.clear();
      pdf.logoDataUrl.mockResolvedValue(null);
      await existente('RASCUNHO', { revisao: 2 });
      const g = gerar();
      await repo.enviar('p1', g);
      expect(g.mock.calls[0][0]).toMatchObject({ logoDataUrl: null, empresa: { razaoSocial: '' }, proposta: { codigoExibido: 'PROV-ABCDEF' } });
      expect((await db.documentos.toArray())[0].codigoExibido).toBe('PROV-ABCDEF-R2');
    });

    it('P4b-R21: o retorno do push chega durante a geração: refaz o PDF, agora com o número', async () => {
      await existente('RASCUNHO', { version: null });
      const g = vi.fn<(e: EntradaPdf) => Promise<Blob>>(async () => {
        if (g.mock.calls.length === 1) {
          // o que o SyncService faz com o OK do UPSERT de criação
          const p = (await db.propostas.get('p1'))!;
          await db.propostas.put({ ...p, version: 0, numero: 277, atualizadoEm: '2026-10-02T01:29:59.123456Z' });
        }
        return new Blob([ABC]);
      });
      await repo.enviar('p1', g);
      expect(g).toHaveBeenCalledTimes(2);
      expect(g.mock.calls[0][0].proposta.codigoExibido).toBe('PROV-ABCDEF');
      expect(g.mock.calls[1][0].proposta.codigoExibido).toBe('000277');
      const docs = await db.documentos.toArray();
      expect(docs.map((d) => d.codigoExibido)).toEqual(['000277']);
      expect((docs[0].snapshot as { proposta: { codigoExibido: string } }).proposta.codigoExibido).toBe('000277');
      const m = await fila();
      expect(m.map((x) => [x.op, x.baseVersion])).toEqual([['UPSERT', 0], ['UPLOAD', null]]);
      expect(await db.propostas.get('p1')).toMatchObject({ status: 'ENVIADA', numero: 277, version: 0 });
    });

    it('P4b-R21: a proposta muda a cada tentativa: PROPOSTA_ALTERADA depois da 3ª, nada é gravado', async () => {
      await existente('RASCUNHO');
      const g = vi.fn<(e: EntradaPdf) => Promise<Blob>>(async () => {
        await db.propostas.update('p1', { observacoes: `editada ${g.mock.calls.length}` });
        return new Blob([ABC]);
      });
      expect((await erroDe(repo.enviar('p1', g))).codigo).toBe('PROPOSTA_ALTERADA');
      expect(g).toHaveBeenCalledTimes(3);
      expect(await db.documentos.count()).toBe(0);
      expect(await db.outbox.count()).toBe(0);
      expect((await db.propostas.get('p1'))!.status).toBe('RASCUNHO');
    });

    it('P4b-R21: toque duplo (dois envios ao mesmo tempo): o segundo recebe PROPOSTA_JA_ENVIADA, um documento só', async () => {
      await existente('RASCUNHO');
      const g = gerar();
      const r = await Promise.allSettled([repo.enviar('p1', g), repo.enviar('p1', g)]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const recusa = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
      expect(recusa.reason).toBeInstanceOf(ErroProposta);
      expect((recusa.reason as ErroProposta).codigo).toBe('PROPOSTA_JA_ENVIADA');
      expect((recusa.reason as ErroProposta).message).toBe('Esta proposta já foi enviada.');
      expect(await db.documentos.count()).toBe(1);
      expect((await fila()).map((x) => x.op)).toEqual(['UPSERT', 'UPLOAD']);
    });

    it('dois envios seguidos: o segundo recebe PROPOSTA_JA_ENVIADA já na primeira tentativa, sem gerar outro PDF', async () => {
      await existente('RASCUNHO');
      const g = gerar();
      await repo.enviar('p1', g);
      const e = await erroDe(repo.enviar('p1', g));
      expect(e.codigo).toBe('PROPOSTA_JA_ENVIADA');
      expect(e.message).toBe('Esta proposta já foi enviada.');
      expect(g).toHaveBeenCalledTimes(1);
      expect(await db.documentos.count()).toBe(1);
      // depois do envio, em qualquer status seguinte, é a mesma resposta
      for (const status of ['APROVADA', 'EM_EXECUCAO', 'FINALIZADA', 'RECUSADA'] as StatusProposta[]) {
        await existente(status);
        expect((await erroDe(repo.enviar('p1', g))).codigo).toBe('PROPOSTA_JA_ENVIADA');
      }
      // cancelada depois de enviada (tem documento) também
      await existente('CANCELADA', {
        documentos: [{ id: 'd', revisao: 1, codigoExibido: '000277', arquivoId: 'a', sha256: 'x', geradoEm: '', geradoPor: '' }],
      });
      expect((await erroDe(repo.enviar('p1', g))).codigo).toBe('PROPOSTA_JA_ENVIADA');
      expect(g).toHaveBeenCalledTimes(1);
    });

    it('m2: PDF acima de 10 MB (limite do servidor) é recusado com PDF_GRANDE, sem gravar nem enfileirar', async () => {
      await existente('RASCUNHO');
      const g = vi.fn(async () => new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'application/pdf' }));
      const e = await erroDe(repo.enviar('p1', g));
      expect(e.codigo).toBe('PDF_GRANDE');
      expect(e.message).toBe('O PDF passou de 10 MB. Reduza imagens do template.');
      expect(await db.documentos.count()).toBe(0);
      expect(await db.outbox.count()).toBe(0);
      expect((await db.propostas.get('p1'))!.status).toBe('RASCUNHO');
      // exatamente 10 MB passa (o servidor recusa só acima)
      await repo.enviar('p1', async () => new Blob([new Uint8Array(10 * 1024 * 1024)]));
      expect((await db.propostas.get('p1'))!.status).toBe('ENVIADA');
    });

    it('snapshot acima de 512 KB é recusado antes de gerar o PDF', async () => {
      const grande = { id: 'b', tipo: 'TEXTO', config: { conteudo: { type: 'doc', content: [{ type: 'text', text: 'x'.repeat(600 * 1024) }] } } };
      await db.templates.put(paraTemplateLocal('t-venda', 1, {
        nome: 'Venda', tipoProposta: 'VENDA', padrao: true, ativo: true, blocos: [grande] as never,
      }));
      await existente('RASCUNHO');
      const g = gerar();
      expect((await erroDe(repo.enviar('p1', g))).codigo).toBe('SNAPSHOT_GRANDE');
      expect(g).not.toHaveBeenCalled();
    });

    it('falha ao gerar o PDF não grava nem enfileira nada', async () => {
      await existente('RASCUNHO');
      const g = vi.fn(async () => {
        throw new Error('sem fonte');
      });
      await expect(repo.enviar('p1', g)).rejects.toThrow('sem fonte');
      expect(await db.documentos.count()).toBe(0);
      expect(await db.outbox.count()).toBe(0);
      expect((await db.propostas.get('p1'))!.status).toBe('RASCUNHO');
    });
  });

  describe('excluir (P4b-R25)', () => {
    const gerar = () => vi.fn<(e: EntradaPdf) => Promise<Blob>>(async () => new Blob([ABC], { type: 'application/pdf' }));

    it('offline: criar, enviar, Nova revisão e excluir — sem documento órfão (R15) e sem nada na fila do agregado', async () => {
      const id = await repo.criar('VENDA', 'c1');
      await repo.adicionarItem(id, (await db.itens.get('i-venda'))!);
      await repo.enviar(id, gerar());
      await repo.transicionar(id, 'RASCUNHO');
      expect(await db.documentos.where('propostaId').equals(id).count()).toBe(1);
      expect((await fila()).map((m) => m.op)).toEqual(['UPSERT', 'UPSERT', 'UPLOAD', 'UPSERT']);

      await repo.excluir(id);

      expect(await db.propostas.get(id)).toBeUndefined();
      expect(await db.documentos.where('propostaId').equals(id).count()).toBe(0);
      expect(await db.outbox.where('agregadoId').equals(id).count()).toBe(0);
      expect(sincronizar).toHaveBeenCalled();
    });

    it('rascunho que o servidor já conhece (sem número): DELETE sobre a versão local; os documentos locais saem junto', async () => {
      await existente('RASCUNHO');
      await db.documentos.put({
        id: 'dl', propostaId: 'p1', revisao: 1, codigoExibido: 'PROV-ABCDEF', sha256: 'x', geradoEm: '', geradoPor: null,
        bytes: ABC.buffer as ArrayBuffer, enviado: true, arquivoId: 'a1',
      });
      await db.documentos.put({
        id: 'outra', propostaId: 'p9', revisao: 1, codigoExibido: 'PROV-ZZZZZZ', sha256: 'x', geradoEm: '', geradoPor: null,
        bytes: null, enviado: true, arquivoId: 'a9',
      });
      await db.pendencias.put(pendencia('proposta', 'p1'));
      await repo.excluir('p1');
      expect(await db.propostas.get('p1')).toBeUndefined();
      expect((await db.documentos.toArray()).map((d) => d.id)).toEqual(['outra']);
      expect((await fila()).map((m) => [m.agregadoId, m.op, m.baseVersion, m.dados])).toEqual([['p1', 'DELETE', 4, null]]);
      // a exclusão substitui a rejeição anterior (como a edição do rascunho)
      expect(await db.pendencias.count()).toBe(0);
    });

    it('recusa fora do rascunho, rascunho numerado, quem não edita e envio em voo, sem apagar nada', async () => {
      await existente('ENVIADA');
      expect((await erroDe(repo.excluir('p1'))).codigo).toBe('PROPOSTA_NAO_EDITAVEL');
      await existente('RASCUNHO', { numero: 277 });
      const numerada = await erroDe(repo.excluir('p1'));
      expect(numerada.codigo).toBe('PROPOSTA_NUMERADA');
      expect(numerada.message).toBe('Uma proposta numerada não pode ser excluída. Cancele-a.');
      await existente('RASCUNHO');
      usuario.set(OUTRO_COMERCIAL);
      expect((await erroDe(repo.excluir('p1'))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(TECNICO);
      expect((await erroDe(repo.excluir('p1'))).codigo).toBe('ACESSO_NEGADO');
      usuario.set(COMERCIAL);
      expect((await erroDe(repo.excluir('nao-existe'))).codigo).toBe('NAO_ENCONTRADA');
      // a criação está no servidor agora (sem resposta): a resposta traz o número, e aí só cancelando
      await existente('RASCUNHO', { version: null });
      await db.outbox.add({
        mutationId: 'm1', entidade: 'proposta', agregadoId: 'p1', op: 'UPSERT', baseVersion: null, dados: null, enviando: true,
        criadaEm: '',
      });
      expect((await erroDe(repo.excluir('p1'))).codigo).toBe('PROPOSTA_SINCRONIZANDO');
      expect(await db.propostas.get('p1')).toBeDefined();
      expect((await fila()).map((m) => m.mutationId)).toEqual(['m1']);
    });
  });

  describe('entradaPrevia (P4b-R25)', () => {
    it('mesma montagem do PDF oficial, com previa = true, em qualquer status, sem gravar nada', async () => {
      const id = await repo.criar('VENDA', 'c1');
      await repo.adicionarItem(id, (await db.itens.get('i-venda'))!);
      const previa = await repo.entradaPrevia(id);
      const g = vi.fn<(e: EntradaPdf) => Promise<Blob>>(async () => new Blob([ABC]));
      await repo.enviar(id, g);
      expect(previa).toEqual({ ...g.mock.calls[0][0], previa: true });
      expect(previa.previa).toBe(true);

      // ENVIADA (qualquer status): a prévia continua disponível e não escreve
      const antes = { docs: await db.documentos.count(), fila: await db.outbox.count(), p: await db.propostas.get(id) };
      const depois = await repo.entradaPrevia(id);
      expect(depois).toMatchObject({ previa: true, proposta: { codigoExibido: previa.proposta.codigoExibido } });
      expect({ docs: await db.documentos.count(), fila: await db.outbox.count(), p: await db.propostas.get(id) }).toEqual(antes);
    });

    it('rascunho sem cliente mostra o cliente em branco; sem template ou com dado fora do aparelho, recusa no campo', async () => {
      await existente('RASCUNHO', { clienteId: null });
      expect((await repo.entradaPrevia('p1')).cliente).toEqual({
        nome: '', documento: '', endereco: null, contato: null, telefone: null, email: null,
      });
      await existente('RASCUNHO', { templateId: null });
      expect((await erroDe(repo.entradaPrevia('p1'))).campo).toBe('templateId');
      await existente('RASCUNHO', { clienteId: 'nao-baixado' });
      expect((await erroDe(repo.entradaPrevia('p1'))).campo).toBe('clienteId');
    });

    it('o técnico não vê prévia (o PDF tem valores)', async () => {
      await existente('ENVIADA', { tecnicoId: TECNICO.id });
      usuario.set(TECNICO);
      expect((await erroDe(repo.entradaPrevia('p1'))).codigo).toBe('ACESSO_NEGADO');
    });
  });

  describe('documentos (P4b-R25)', () => {
    const local = (d: Partial<DocumentoLocal> & Pick<DocumentoLocal, 'id'>): DocumentoLocal => ({
      propostaId: 'p1', revisao: 1, codigoExibido: 'PROV-ABCDEF', sha256: 'x', geradoEm: '2026-09-20T10:00:00Z',
      geradoPor: COMERCIAL.id, bytes: null, enviado: false, arquivoId: null, ...d,
    });

    it('observarDocumentos junta os do servidor e os locais, por revisão desc e data desc, com enviado e bytes locais', async () => {
      await existente('ENVIADA', {
        revisao: 2,
        documentos: [
          { id: 'd1', revisao: 1, codigoExibido: 'PROV-ABCDEF', arquivoId: 'a1', sha256: 'x', geradoEm: '2026-09-20T10:00:00Z', geradoPor: COMERCIAL.id },
          { id: 'd2', revisao: 2, codigoExibido: 'PROV-ABCDEF-R2', arquivoId: 'a2', sha256: 'x', geradoEm: '2026-09-21T10:00:00Z', geradoPor: COMERCIAL.id },
        ],
      });
      await db.documentos.bulkPut([
        // d2: enviado e com os bytes no aparelho; d3: ainda não enviado, mais novo na mesma revisão
        local({ id: 'd2', revisao: 2, codigoExibido: 'PROV-ABCDEF-R2', geradoEm: '2026-09-21T10:00:00Z', bytes: ABC.buffer as ArrayBuffer, enviado: true, arquivoId: 'a2' }),
        local({ id: 'd3', revisao: 2, codigoExibido: 'PROV-ABCDEF-R2', geradoEm: '2026-09-21T10:00:00.5Z', bytes: ABC.buffer as ArrayBuffer }),
        local({ id: 'x', propostaId: 'outra' }),
      ]);
      const docs = await firstValueFrom(repo.observarDocumentos('p1'));
      expect(docs).toEqual([
        { id: 'd3', revisao: 2, codigoExibido: 'PROV-ABCDEF-R2', geradoEm: '2026-09-21T10:00:00.5Z', enviado: false, temBytes: true, arquivoId: null },
        { id: 'd2', revisao: 2, codigoExibido: 'PROV-ABCDEF-R2', geradoEm: '2026-09-21T10:00:00Z', enviado: true, temBytes: true, arquivoId: 'a2' },
        { id: 'd1', revisao: 1, codigoExibido: 'PROV-ABCDEF', geradoEm: '2026-09-20T10:00:00Z', enviado: true, temBytes: false, arquivoId: 'a1' },
      ]);
    });

    it('o técnico não recebe documentos; blobDoDocumento devolve o PDF local ou null', async () => {
      await existente('ENVIADA');
      await db.documentos.bulkPut([local({ id: 'd1', bytes: ABC.buffer as ArrayBuffer }), local({ id: 'd2' })]);
      const blob = (await repo.blobDoDocumento('d1'))!;
      expect(blob.type).toBe('application/pdf');
      expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual(Array.from(ABC));
      expect(await repo.blobDoDocumento('d2')).toBeNull();
      expect(await repo.blobDoDocumento('nao-existe')).toBeNull();
      usuario.set(TECNICO);
      expect(await firstValueFrom(repo.observarDocumentos('p1'))).toEqual([]);
      expect(await repo.blobDoDocumento('d1')).toBeNull();
    });
  });

  describe('consultas', () => {
    it('observarTodas, observarDoCliente e observarDoTecnico, por atualizadoEm desc (sem data por último)', async () => {
      const base = await existente('RASCUNHO');
      await db.propostas.delete('p1');
      await db.propostas.bulkPut([
        { ...base, id: 'a', clienteId: 'c1', tecnicoId: TECNICO.id, atualizadoEm: '2026-09-01T10:00:00.000001Z' },
        { ...base, id: 'b', clienteId: 'c2', tecnicoId: null, atualizadoEm: '2026-09-30T08:00:00Z' },
        { ...base, id: 'c', clienteId: 'c1', tecnicoId: TECNICO.id, atualizadoEm: null },
        { ...base, id: 'd', clienteId: 'c1', tecnicoId: TECNICO.id, atualizadoEm: '2026-09-02T00:00:00Z' },
      ]);
      expect((await firstValueFrom(repo.observarTodas())).map((p) => p.id)).toEqual(['b', 'd', 'a', 'c']);
      expect((await firstValueFrom(repo.observarDoCliente('c1'))).map((p) => p.id)).toEqual(['d', 'a', 'c']);
      expect((await firstValueFrom(repo.observarDoTecnico(TECNICO.id))).map((p) => p.id)).toEqual(['d', 'a', 'c']);
    });

    it('P4b-R19: toda escrita local marca atualizadoEm = agora (o servidor sobrescreve no retorno)', async () => {
      const agora = AGORA.toISOString();
      const id = await repo.criar('VENDA', 'c1');
      expect((await db.propostas.get(id))!.atualizadoEm).toBe(agora);
      for (const passo of [
        () => repo.salvarRascunho('p1', { observacoes: 'x' }),
        () => repo.adicionarItem('p1', { ...paraItemLocal('i-venda', 1, item('P-1')) }),
        () => repo.transicionar('p1', 'CANCELADA', 'Desistiu'),
        () => repo.atribuir('p1', { tecnicoId: TECNICO.id }),
        () => repo.enviar('p1', async () => new Blob([ABC])),
      ]) {
        await existente('RASCUNHO');
        await passo();
        expect((await db.propostas.get('p1'))!.atualizadoEm).toBe(agora);
      }
      const dup = await repo.duplicar('p1');
      expect((await db.propostas.get(dup.id))!.atualizadoEm).toBe(agora);
    });

    it('buscar, temPendencia e observarNaoSincronizados', async () => {
      await existente('RASCUNHO');
      expect((await repo.buscar('p1'))!.id).toBe('p1');
      expect(await repo.temPendencia('p1')).toBe(false);
      await db.pendencias.put(pendencia('proposta', 'p1'));
      expect(await repo.temPendencia('p1')).toBe(true);
      expect([...(await firstValueFrom(repo.observarNaoSincronizados()))]).toEqual(['p1']);
    });
  });
});
