import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { ArquivosService, ErroDownload } from '../../core/arquivos/arquivos-service';
import type { UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import type { EntradaPdf } from '../../core/pdf/pdf-models';
import { PdfService } from '../../core/pdf/pdf-service';
import { Pendencia, TIPO_UPLOAD_DOCUMENTO, UsuarioResumo } from '../../core/sync/sync-models';
import { Toasts } from '../../shared/ui/toasts';
import { ClienteLocal, paraClienteLocal } from '../clientes/cliente-models';
import { ClientesRepo } from '../clientes/clientes-repo';
import { OsRepo } from '../os/os-repo';
import { ItemPropostaLocal, PropostaDados, PropostaLocal, StatusProposta } from './proposta-models';
import { DocumentoDaProposta, ErroProposta, EstadoSync, PropostasRepo } from './propostas-repo';
import { PropostaDetalhePage } from './proposta-detalhe-page';

const ADMIN: UsuarioSessao = { id: 'u-adm', nome: 'Ana Admin', email: 'ana@regera.com', perfil: 'ADMIN', ativo: true };
const COMERCIAL: UsuarioSessao = { id: 'u-com', nome: 'Carla Comercial', email: 'carla@regera.com', perfil: 'COMERCIAL', ativo: true };
const OUTRO_COMERCIAL: UsuarioSessao = { id: 'u-com2', nome: 'Caio Comercial', email: 'caio@regera.com', perfil: 'COMERCIAL', ativo: true };
const TECNICO: UsuarioSessao = { id: 'u-tec', nome: 'Téo Técnico', email: 'teo@regera.com', perfil: 'TECNICO', ativo: true };

const USUARIOS: UsuarioResumo[] = [
  { id: ADMIN.id, nome: ADMIN.nome, perfil: 'ADMIN' },
  { id: COMERCIAL.id, nome: COMERCIAL.nome, perfil: 'COMERCIAL' },
  { id: OUTRO_COMERCIAL.id, nome: OUTRO_COMERCIAL.nome, perfil: 'COMERCIAL' },
  { id: TECNICO.id, nome: TECNICO.nome, perfil: 'TECNICO' },
  { id: 'u-tec2', nome: 'Tina Técnica', perfil: 'TECNICO' },
  { id: 'u-tec-off', nome: 'Tito Inativo', perfil: 'TECNICO', ativo: false },
  { id: 'u-com-off', nome: 'Cris Inativa', perfil: 'COMERCIAL', ativo: false },
];

/** 2026-10-02 01:30 UTC ainda é 2026-10-01 em São Paulo. */
const AGORA = new Date('2026-10-02T01:30:00Z');

const CLIENTE: ClienteLocal = paraClienteLocal('c1', 1, {
  tipo: 'PJ', documento: '11444777000161', nome: 'Padaria São João', nomeFantasia: null, inscricaoEstadual: null,
  inscricaoMunicipal: null, email: null, telefone: '11988887777', whatsapp: null, contatoNome: null, observacoes: null,
  enderecos: [
    { tipo: 'PRINCIPAL', cep: '01310100', logradouro: 'Av. Paulista', numero: '1000', complemento: null, bairro: 'Bela Vista',
      cidade: 'São Paulo', uf: 'SP' },
  ],
});

function linha(id: string, l: Partial<ItemPropostaLocal> = {}): ItemPropostaLocal {
  return {
    id, itemCatalogoId: 'i1', codigo: 'PNL-550', nome: 'Painel Solar', descricao: 'Monocristalino 550 W', unidade: 'un',
    natureza: 'PRODUTO', precoCustoCentavos: 80000, quantidadeMilesimos: 1500, precoUnitarioCentavos: 123456, descontoCentesimos: 1000,
    meses: null, subtotalCentavos: 166666, ordem: 0, ...l,
  };
}

function proposta(p: Partial<PropostaLocal> = {}): PropostaLocal {
  return {
    id: 'p1', version: 3, codigoProvisorio: 'PROV-ABC123', numero: 277, revisao: 1, tipo: 'VENDA', status: 'ENVIADA',
    clienteId: 'c1', templateId: 't1', responsavelId: COMERCIAL.id, tecnicoId: TECNICO.id, dataEmissao: '2026-09-20',
    validadeAte: '2026-10-05', condicoesPagamento: '50% na assinatura', prazoExecucao: '30 dias', observacoes: 'Telhado de laje',
    descontoGeralCentesimos: 0, totalItensCentavos: 185184, totalDescontosCentavos: 18518, totalCentavos: 166666,
    motivoEncerramento: null, itens: [linha('l1')],
    historico: [
      { statusDe: null, statusPara: 'RASCUNHO', usuarioId: COMERCIAL.id, em: '2026-09-20T13:00:00Z', observacao: null },
      { statusDe: 'RASCUNHO', statusPara: 'ENVIADA', usuarioId: COMERCIAL.id, em: '2026-09-20T17:30:00Z', observacao: null },
    ],
    documentos: [], atualizadoEm: '2026-09-20T17:30:00Z', origem: null, ...p,
  };
}

const documento = (d: Partial<DocumentoDaProposta> = {}): DocumentoDaProposta => ({
  id: 'd1', revisao: 1, codigoExibido: '000277', geradoEm: '2026-09-20T17:30:00Z', enviado: true, temBytes: true, arquivoId: 'a1', ...d,
});

const recusaDeDados = (codigo = 'VALIDACAO'): Pendencia => ({
  mutationId: 'e1', entidade: 'proposta', agregadoId: 'p1', tipo: 'REJEITADO', criadaEm: '2026-10-01T10:00:00Z',
  erro: { codigo, mensagem: 'Dados inválidos.', campos: { prazoExecucao: 'Máximo de 200 caracteres.' } },
  mutacao: {
    seq: 5, mutationId: 'e1', entidade: 'proposta', agregadoId: 'p1', op: 'UPSERT', baseVersion: null, criadaEm: '',
    dados: { status: 'RASCUNHO' } as PropostaDados,
  },
});

const recusaDoUpload = (): Pendencia => ({
  mutationId: 'up1', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', tipo: 'REJEITADO', criadaEm: '2026-10-01T10:00:00Z',
  erro: { codigo: 'CODIGO_EXIBIDO_INVALIDO', mensagem: 'O PDF PROV-AAAAAA não foi aceito. O código da proposta mudou. Gere o PDF de novo e reenvie.' },
  mutacao: { mutationId: 'up1', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', op: 'UPLOAD', baseVersion: null, dados: { documentoId: 'd0' }, criadaEm: '' },
});

const conflito = (): Pendencia => ({
  mutationId: 'c1', entidade: 'proposta', agregadoId: 'p1', tipo: 'CONFLITO', criadaEm: '2026-10-01T10:00:00Z',
  mutacao: { mutationId: 'c1', entidade: 'proposta', agregadoId: 'p1', op: 'UPSERT', baseVersion: 2, dados: null, criadaEm: '' },
});

interface Opcoes {
  usuario?: UsuarioSessao;
  proposta?: PropostaLocal | undefined;
  documentos?: DocumentoDaProposta[];
  pendencias?: Pendencia[];
  estado?: EstadoSync;
  online?: boolean;
}

async function montar(o: Opcoes = {}) {
  const p = 'proposta' in o ? o.proposta : proposta();
  const pdfBlob = new Blob(['%PDF-local'], { type: 'application/pdf' });
  const repo = {
    proposta$: new BehaviorSubject<PropostaLocal | undefined>(p),
    documentos$: new BehaviorSubject<DocumentoDaProposta[]>(o.documentos ?? [documento()]),
    pendencias$: new BehaviorSubject<Pendencia[]>(o.pendencias ?? []),
    observarProposta: vi.fn(() => repo.proposta$.asObservable()),
    observarDocumentos: vi.fn(() => repo.documentos$.asObservable()),
    observarPendencias: vi.fn(() => repo.pendencias$.asObservable()),
    observarEstadoSync: () => of(o.estado ?? { naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() }),
    observarUsuarios: () => of(USUARIOS),
    transicionar: vi.fn<(id: string, para: StatusProposta, motivo?: string | null) => Promise<void>>(async () => undefined),
    atribuir: vi.fn<(id: string, m: { responsavelId?: string; tecnicoId?: string | null }) => Promise<void>>(async () => undefined),
    duplicar: vi.fn<(id: string) => Promise<{ id: string; linhasDescartadas: number }>>(async () => ({ id: 'dup-1', linhasDescartadas: 0 })),
    excluir: vi.fn<(id: string) => Promise<void>>(async () => undefined),
    entradaPrevia: vi.fn<(id: string) => Promise<EntradaPdf>>(async () => ({ previa: true }) as EntradaPdf),
    blobDoDocumento: vi.fn<(id: string) => Promise<Blob | null>>(async () => pdfBlob),
    regerarDocumento: vi.fn<(id: string, gerar: (e: EntradaPdf) => Promise<Blob>) => Promise<{ blob: Blob; codigoExibido: string }>>(
      async (_, gerar) => ({ blob: await gerar({ previa: false } as EntradaPdf), codigoExibido: '000277' }),
    ),
  };
  const gerado = new Blob(['%PDF-gerado'], { type: 'application/pdf' });
  const pdf = { gerarBlob: vi.fn<(e: EntradaPdf) => Promise<Blob>>(async () => gerado) };
  const remoto = new Blob(['%PDF-remoto'], { type: 'application/pdf' });
  const arquivos = { baixarSemCache: vi.fn<(id: string) => Promise<Blob>>(async () => remoto) };
  const online = signal(o.online ?? true);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { usuario: signal(o.usuario ?? COMERCIAL) } },
      { provide: PropostasRepo, useValue: repo },
      { provide: ClientesRepo, useValue: { observarTodos: () => of([CLIENTE]) } },
      // M2-P3: a seção "Ordens de serviço" (os-da-proposta.spec cobre a lista e o "Gerar OS")
      {
        provide: OsRepo,
        useValue: { observarDaProposta: vi.fn(() => of([])), observarEstadoSync: () => of({ naOutbox: new Set(), comPendencia: new Set(), comConflito: new Set() }) },
      },
      { provide: PdfService, useValue: pdf },
      { provide: ArquivosService, useValue: arquivos },
      { provide: ConectividadeService, useValue: { online } },
    ],
  });
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const toast = vi.spyOn(TestBed.inject(Toasts), 'mostrar');
  const toastErro = vi.spyOn(TestBed.inject(Toasts), 'erro');
  const fixture = TestBed.createComponent(PropostaDetalhePage);
  fixture.componentRef.setInput('id', 'p1');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  await ate(fixture, () => expect(el.querySelector('[data-testid=carregando]')).toBeNull());
  return { fixture, el, repo, pdf, arquivos, online, navegar, toast, toastErro, pdfBlob, gerado, remoto };
}

async function ate(fixture: ComponentFixture<unknown>, verificar: () => void) {
  await vi.waitFor(() => {
    fixture.detectChanges();
    verificar();
  });
}

const acoes = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLButtonElement>('[data-testid=acoes] button')].map((b) => b.textContent!.trim());
const botao = (el: HTMLElement, texto: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === texto);
const texto = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');

function digitar(fixture: ComponentFixture<unknown>, campo: HTMLTextAreaElement | HTMLInputElement, valor: string) {
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

/** PDF no iframe (desktop com mouse) e URLs de blob falsas. */
function comoDesktop() {
  const largura = window.innerWidth;
  const criar = URL.createObjectURL;
  const revogar = URL.revokeObjectURL;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  URL.createObjectURL = vi.fn(() => 'blob:pdf');
  URL.revokeObjectURL = vi.fn();
  return () => {
    URL.createObjectURL = criar;
    URL.revokeObjectURL = revogar;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: largura });
  };
}

/** Sem Web Share: compartilhar baixa por `<a download>` (o clique é interceptado). */
function semShare() {
  const nav = navigator as Navigator & { share?: unknown; canShare?: unknown };
  const originais = { share: nav.share, canShare: nav.canShare };
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: undefined });
  Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: undefined });
  const criar = URL.createObjectURL;
  const criarUrl = vi.fn<(b: Blob) => string>(() => 'blob:baixar');
  URL.createObjectURL = criarUrl;
  const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return {
    clique,
    criarUrl,
    restaurar() {
      URL.createObjectURL = criar;
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: originais.share });
      Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: originais.canShare });
    },
  };
}

describe('PropostaDetalhePage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('cabeçalho, itens, condições e histórico', () => {
    it('código com (ref. PROV-…) quando numerada com documento PROV; status, tipo, cliente (link), responsável e técnico', async () => {
      const { el } = await montar({ documentos: [documento({ id: 'd0', codigoExibido: 'PROV-ABC123' })] });
      expect(el.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('000277 (ref. PROV-ABC123)');
      const status = el.querySelector('[data-status]')!;
      expect(status.textContent?.trim()).toBe('Enviada');
      expect(status.className).toContain('bg-sky-100');
      expect(texto(el)).toContain('Venda');
      const cliente = el.querySelector<HTMLAnchorElement>('a[data-testid=cliente]')!;
      expect(cliente.textContent?.trim()).toBe('Padaria São João');
      expect(cliente.getAttribute('href')).toBe('/clientes/c1');
      expect(texto(el)).toContain('Av. Paulista, 1000 - Bela Vista - São Paulo/SP - CEP 01310-100');
      expect(texto(el)).toContain('(11) 98888-7777');
      expect(el.querySelector('[data-testid=responsavel]')?.textContent).toContain('Carla Comercial');
      expect(el.querySelector('[data-testid=tecnico]')?.textContent).toContain('Téo Técnico');
    });

    it('sem documento PROV, só o número; selos Expirada, Não sincronizada e Pendência', async () => {
      const { el } = await montar({
        proposta: proposta({ validadeAte: '2026-09-30' }),
        estado: { naOutbox: new Set(['p1']), comPendencia: new Set(['p1']), comConflito: new Set() },
        pendencias: [conflito()],
      });
      expect(el.querySelector('h1')?.textContent?.trim()).toBe('000277');
      expect([...el.querySelectorAll('[data-selo]')].map((s) => s.textContent?.trim())).toEqual(['Expirada', 'Não sincronizada', 'Pendência']);
    });

    it('itens: cards no celular e tabela a partir do lg, com código, nome, descrição, quantidade, unidade, preço, desconto e subtotal', async () => {
      const { el } = await montar({ proposta: proposta({ tipo: 'LOCACAO', itens: [linha('l1', { meses: 12 })] }) });
      const cards = el.querySelector('[data-testid=itens-cards]')!;
      const tabela = el.querySelector('table[data-testid=itens-tabela]')!;
      expect(cards.className).toContain('lg:hidden');
      expect(tabela.className).toContain('hidden');
      expect(tabela.className).toContain('lg:table');
      for (const parte of [cards, tabela]) {
        const t = texto(parte as HTMLElement);
        for (const v of ['PNL-550', 'Painel Solar', 'Monocristalino 550 W', '1,5', 'un', 'R$ 1.234,56', '10%', '12', 'R$ 1.666,66']) expect(t).toContain(v);
        // o comercial não vê o custo
        expect(t).not.toContain('R$ 800,00');
      }
      const totais = [...el.querySelectorAll('[data-testid=totais] tr')].map((tr) =>
        [...tr.querySelectorAll('th, td')].map((c) => c.textContent!.trim()));
      expect(totais).toEqual([['Subtotal', 'R$ 1.851,84'], ['Descontos', '-R$ 185,18'], ['Total', 'R$ 1.666,66']]);
    });

    it('o ADMIN vê o custo da linha', async () => {
      const { el } = await montar({ usuario: ADMIN });
      expect(texto(el.querySelector('[data-testid=itens-tabela]')!)).toContain('R$ 800,00');
      expect(texto(el.querySelector('[data-testid=itens-cards]')!)).toContain('Custo: R$ 800,00');
    });

    it('condições (validade, pagamento, prazo, observações), motivo de encerramento e histórico com usuário e data e hora', async () => {
      const { el } = await montar({
        proposta: proposta({
          status: 'RECUSADA', motivoEncerramento: 'Cliente achou caro',
          historico: [
            ...proposta().historico,
            { statusDe: 'ENVIADA', statusPara: 'RECUSADA', usuarioId: ADMIN.id, em: '2026-09-25T12:05:00Z', observacao: 'Cliente achou caro' },
          ],
        }),
      });
      const condicoes = texto(el.querySelector('[data-testid=condicoes]')!);
      for (const v of ['05/10/2026', '50% na assinatura', '30 dias', 'Telhado de laje', 'Cliente achou caro']) expect(condicoes).toContain(v);
      const historico = [...el.querySelectorAll('[data-testid=historico] li')].map((li) => texto(li as HTMLElement).trim());
      expect(historico[0]).toContain('Criada como Rascunho');
      expect(historico[0]).toContain('Carla Comercial');
      expect(historico[0]).toContain('20/09/2026 10:00');
      expect(historico[1]).toContain('Rascunho → Enviada');
      expect(historico[1]).toContain('20/09/2026 14:30');
      expect(historico[2]).toContain('Enviada → Recusada');
      expect(historico[2]).toContain('Ana Admin');
      expect(historico[2]).toContain('25/09/2026 09:05');
    });

    it('proposta fora do aparelho: avisa, com o caminho de volta', async () => {
      const { el } = await montar({ proposta: undefined });
      expect(texto(el)).toContain('Proposta não encontrada neste aparelho.');
      expect(el.querySelector('a[href="/propostas"]')).not.toBeNull();
    });
  });

  describe('técnico (§10)', () => {
    it('vê só código, cliente (nome, endereço, telefone), tipo, status, técnico, validade, prazo e os itens sem valores', async () => {
      const { el, repo } = await montar({
        usuario: TECNICO,
        proposta: proposta({ tipo: 'LOCACAO', itens: [linha('l1', { meses: 6 })], status: 'APROVADA' }),
        pendencias: [conflito()],
      });
      const t = texto(el);
      for (const v of ['000277', 'Padaria São João', 'Av. Paulista, 1000', '(11) 98888-7777', 'Locação', 'Aprovada', 'Téo Técnico',
        '05/10/2026', '30 dias', 'PNL-550', 'Painel Solar', 'Monocristalino 550 W', '1,5', 'un', '6']) {
        expect(t).toContain(v);
      }
      expect(t).not.toMatch(/R\$/);
      expect(t).not.toContain('%');
      expect(t).not.toContain('50% na assinatura');
      expect(t).not.toContain('Telhado de laje');
      expect(el.querySelector('[data-testid=totais]')).toBeNull();
      expect(el.querySelector('[data-testid=documentos]')).toBeNull();
      expect(el.querySelector('[data-testid=historico]')).toBeNull();
      expect(el.querySelector('[data-testid=acoes]')).toBeNull();
      expect(el.querySelectorAll('button')).toHaveLength(0);
      // sem link para o cadastro (o técnico não o edita) e sem faixa de pendência
      expect(el.querySelector('a[data-testid=cliente]')).toBeNull();
      expect(el.querySelector('[data-testid=pendencia]')).toBeNull();
      expect(repo.observarDocumentos).not.toHaveBeenCalled();
      // M2-P3: nem as OS (o técnico as vê em Minhas OS)
      expect(el.querySelector('[data-testid=os-da-proposta]')).toBeNull();
    });
  });

  describe('M2-P3: "Ordens de serviço"', () => {
    it('a seção das OS da proposta, para o escritório, com o "Gerar OS" na aprovada do responsável', async () => {
      const { el } = await montar({ proposta: proposta({ status: 'APROVADA' }) });
      const secao = el.querySelector('[data-testid=os-da-proposta]')!;
      expect(secao.querySelector('h2')!.textContent).toContain('Ordens de serviço');
      expect([...secao.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Gerar OS']);
      expect(TestBed.inject(OsRepo).observarDaProposta).toHaveBeenCalledWith('p1');
    });

    it('M1: com CONFLITO da proposta, "Gerar OS" desabilitado', async () => {
      const { el } = await montar({ proposta: proposta({ status: 'APROVADA' }), pendencias: [conflito()] });
      const b = [...el.querySelectorAll<HTMLButtonElement>('[data-testid=os-da-proposta] button')].find((x) => x.textContent?.trim() === 'Gerar OS')!;
      expect(b.disabled).toBe(true);
    });

    it('sem "Gerar OS" fora de APROVADA e EM_EXECUCAO; a lista continua', async () => {
      const { el } = await montar({ usuario: ADMIN, proposta: proposta({ status: 'FINALIZADA' }) });
      const secao = el.querySelector('[data-testid=os-da-proposta]')!;
      expect(secao.querySelectorAll('button')).toHaveLength(0);
      expect(secao.textContent).toContain('Nenhuma OS para esta proposta.');
    });
  });

  describe('ações por status e perfil (§8, §10, P4b-R3)', () => {
    const TODAS: Record<StatusProposta, string[]> = {
      // v1: a principal primeiro (Enviar, no rascunho), as outras na ordem de sempre
      RASCUNHO: ['Enviar', 'Editar', 'Cancelar proposta', 'Ver prévia', 'Duplicar', 'Excluir rascunho'],
      ENVIADA: ['Aprovar', 'Recusar', 'Nova revisão', 'Cancelar proposta', 'Ver prévia', 'Duplicar'],
      APROVADA: ['Iniciar execução', 'Cancelar proposta', 'Ver prévia', 'Duplicar'],
      EM_EXECUCAO: ['Finalizar', 'Cancelar proposta', 'Ver prévia', 'Duplicar'],
      FINALIZADA: ['Ver prévia', 'Duplicar'],
      RECUSADA: ['Ver prévia', 'Duplicar'],
      CANCELADA: ['Ver prévia', 'Duplicar'],
    };
    const NAO_TERMINAIS: StatusProposta[] = ['RASCUNHO', 'ENVIADA', 'APROVADA', 'EM_EXECUCAO'];
    const casos: [StatusProposta, UsuarioSessao, string[], boolean][] = [];
    for (const status of Object.keys(TODAS) as StatusProposta[]) {
      const atribui = NAO_TERMINAIS.includes(status);
      casos.push([status, ADMIN, TODAS[status], atribui]);
      // EM_EXECUCAO → CANCELADA só o ADMIN
      casos.push([status, COMERCIAL, TODAS[status].filter((a) => status !== 'EM_EXECUCAO' || a !== 'Cancelar proposta'), atribui]);
      casos.push([status, OUTRO_COMERCIAL, ['Ver prévia'], false]);
    }

    it.each(casos)('%s, %s', async (status, usuario, esperadas, atribui) => {
      const { el } = await montar({ usuario: usuario as UsuarioSessao, proposta: proposta({ status: status as StatusProposta, numero: null }) });
      expect(acoes(el)).toEqual(esperadas);
      expect(!!botao(el, 'Trocar técnico')).toBe(atribui);
      // SO-P6 (P4b-R3): o responsável, só o ADMIN e fora dos terminais
      expect(!!botao(el, 'Trocar responsável')).toBe(atribui && usuario === ADMIN);
    });

    it('v1: resumo (cliente, total, validade, selos) antes das ações; a principal em largura total, as outras em duas colunas', async () => {
      const { el } = await montar({ estado: { naOutbox: new Set(['p1']), comPendencia: new Set(), comConflito: new Set() } });
      const resumo = el.querySelector<HTMLElement>('[data-testid=resumo]')!;
      const acoesEl = el.querySelector<HTMLElement>('[data-testid=acoes]')!;
      expect(resumo.compareDocumentPosition(acoesEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(resumo.querySelector('a[data-testid=cliente]')?.textContent?.trim()).toBe('Padaria São João');
      expect(resumo.querySelector('[data-testid=total-resumo]')?.textContent?.trim()).toBe('R$ 1.666,66');
      expect(texto(resumo)).toContain('Validade: 05/10/2026');
      expect(resumo.querySelector('[data-selo=nao-sincronizada]')).not.toBeNull();
      const principal = acoesEl.querySelector<HTMLButtonElement>('button[data-principal]')!;
      expect(principal.textContent?.trim()).toBe('Aprovar');
      expect(principal.className).toContain('w-full');
      expect(principal.className).toContain('bg-blue-600');
      const grade = acoesEl.querySelector<HTMLElement>('[data-testid=acoes-secundarias]')!;
      expect(grade.className).toContain('grid-cols-2');
      expect([...grade.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
        'Recusar', 'Nova revisão', 'Cancelar proposta', 'Ver prévia', 'Duplicar',
      ]);
      for (const b of acoesEl.querySelectorAll('button')) expect(b.className).toMatch(/\b(min-)?h-12\b/);
      expect(botao(el, 'Cancelar proposta')!.className).toContain('text-red-700');
      expect(botao(el, 'Recusar')!.className).toContain('text-red-700');
    });

    it('v1: o técnico tem o resumo sem o total', async () => {
      const { el } = await montar({ usuario: TECNICO });
      const resumo = el.querySelector<HTMLElement>('[data-testid=resumo]')!;
      expect(texto(resumo)).toContain('Padaria São João');
      expect(resumo.querySelector('[data-testid=total-resumo]')).toBeNull();
    });

    it('rascunho numerado não se exclui (cancela-se)', async () => {
      const { el } = await montar({ proposta: proposta({ status: 'RASCUNHO', numero: 277 }) });
      expect(acoes(el)).not.toContain('Excluir rascunho');
      expect(acoes(el)).toContain('Cancelar proposta');
    });
  });

  describe('executar as ações', () => {
    it('Aprovar, Iniciar execução e Finalizar transicionam direto e avisam', async () => {
      for (const [status, rotulo, para, aviso] of [
        ['ENVIADA', 'Aprovar', 'APROVADA', 'Proposta aprovada.'],
        ['APROVADA', 'Iniciar execução', 'EM_EXECUCAO', 'Execução iniciada.'],
        ['EM_EXECUCAO', 'Finalizar', 'FINALIZADA', 'Proposta finalizada.'],
      ] as const) {
        TestBed.resetTestingModule();
        const { el, repo, toast } = await montar({ proposta: proposta({ status }) });
        botao(el, rotulo)!.click();
        await vi.waitFor(() => expect(repo.transicionar).toHaveBeenCalledWith('p1', para));
        await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(aviso));
        expect(el.querySelector('[aria-modal]')).toBeNull();
      }
    });

    it('Recusar pede o motivo (obrigatório); cancelar o diálogo não muda nada', async () => {
      const { fixture, el, repo, toast } = await montar();
      botao(el, 'Recusar')!.click();
      fixture.detectChanges();
      const dialogo = el.querySelector<HTMLElement>('[aria-modal=true]')!;
      expect(dialogo.textContent).toContain('Recusar proposta');
      botao(el, 'Cancelar')!.click();
      fixture.detectChanges();
      expect(el.querySelector('[aria-modal]')).toBeNull();
      expect(repo.transicionar).not.toHaveBeenCalled();

      botao(el, 'Recusar')!.click();
      fixture.detectChanges();
      const confirmar = () => [...el.querySelectorAll<HTMLButtonElement>('[aria-modal] button')].find((b) => b.textContent?.trim() === 'Recusar')!;
      confirmar().click();
      fixture.detectChanges();
      expect(texto(el)).toContain('Informe o motivo (de 3 a 500 caracteres).');
      expect(repo.transicionar).not.toHaveBeenCalled();
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('[aria-modal] textarea')!, '  Cliente achou caro  ');
      confirmar().click();
      await vi.waitFor(() => expect(repo.transicionar).toHaveBeenCalledWith('p1', 'RECUSADA', 'Cliente achou caro'));
      await ate(fixture, () => expect(el.querySelector('[aria-modal]')).toBeNull());
      expect(toast).toHaveBeenCalledWith('Proposta recusada.');
    });

    it('Cancelar proposta pede o motivo; a recusa do repositório aparece e o diálogo fica', async () => {
      const { fixture, el, repo, toastErro } = await montar({ usuario: ADMIN, proposta: proposta({ status: 'EM_EXECUCAO' }) });
      repo.transicionar.mockRejectedValueOnce(new ErroProposta('ACESSO_NEGADO', 'proposta', 'Só o administrador cancela uma proposta em execução.'));
      botao(el, 'Cancelar proposta')!.click();
      fixture.detectChanges();
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('[aria-modal] textarea')!, 'Obra suspensa');
      [...el.querySelectorAll<HTMLButtonElement>('[aria-modal] button')].find((b) => b.textContent?.trim() === 'Cancelar proposta')!.click();
      await vi.waitFor(() => expect(repo.transicionar).toHaveBeenCalledWith('p1', 'CANCELADA', 'Obra suspensa'));
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('Só o administrador cancela uma proposta em execução.'));
      expect(el.querySelector('[aria-modal]')).not.toBeNull();
    });

    it('Nova revisão transiciona para RASCUNHO e abre o editar', async () => {
      const { el, repo, navegar } = await montar();
      botao(el, 'Nova revisão')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1', 'editar']));
      expect(repo.transicionar).toHaveBeenCalledWith('p1', 'RASCUNHO');
    });

    it('Editar abre o wizard; Enviar abre direto o passo 4', async () => {
      const { el, navegar } = await montar({ proposta: proposta({ status: 'RASCUNHO', numero: null }) });
      botao(el, 'Editar')!.click();
      expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1', 'editar']);
      botao(el, 'Enviar')!.click();
      expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1', 'editar'], { queryParams: { passo: 4 } });
    });

    it('Duplicar abre o rascunho novo e avisa das linhas que ficaram de fora', async () => {
      const { el, repo, navegar, toast } = await montar();
      repo.duplicar.mockResolvedValueOnce({ id: 'dup-1', linhasDescartadas: 2 });
      botao(el, 'Duplicar')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'dup-1', 'editar']));
      expect(toast).toHaveBeenCalledWith('2 itens inativos não foram copiados.');
      repo.duplicar.mockResolvedValueOnce({ id: 'dup-2', linhasDescartadas: 1 });
      botao(el, 'Duplicar')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'dup-2', 'editar']));
      expect(toast).toHaveBeenCalledWith('1 item inativo não foi copiado.');
    });

    it('Excluir rascunho pede confirmação; confirmado, exclui e volta à lista', async () => {
      const { fixture, el, repo, navegar, toast } = await montar({ proposta: proposta({ status: 'RASCUNHO', numero: null }) });
      botao(el, 'Excluir rascunho')!.click();
      fixture.detectChanges();
      expect(el.querySelector('[aria-modal]')?.getAttribute('role')).toBe('alertdialog');
      botao(el, 'Cancelar')!.click();
      fixture.detectChanges();
      expect(repo.excluir).not.toHaveBeenCalled();
      botao(el, 'Excluir rascunho')!.click();
      fixture.detectChanges();
      [...el.querySelectorAll<HTMLButtonElement>('[aria-modal] button')].find((b) => b.textContent?.trim() === 'Excluir')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas']));
      expect(repo.excluir).toHaveBeenCalledWith('p1');
      expect(toast).toHaveBeenCalledWith('Rascunho excluído.');
    });

    it('Trocar técnico: só técnicos ativos (e "Nenhum"); grava por atribuir', async () => {
      const { fixture, el, repo, toast } = await montar();
      botao(el, 'Trocar técnico')!.click();
      fixture.detectChanges();
      const select = el.querySelector<HTMLSelectElement>('#tecnico-atribuir')!;
      expect(el.querySelector('label[for=tecnico-atribuir]')).not.toBeNull();
      expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['Nenhum', 'Téo Técnico', 'Tina Técnica']);
      select.value = 'u-tec2';
      select.dispatchEvent(new Event('change'));
      botao(el, 'Salvar técnico')!.click();
      await vi.waitFor(() => expect(repo.atribuir).toHaveBeenCalledWith('p1', { tecnicoId: 'u-tec2' }));
      await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Técnico atualizado.'));
    });

    it('Ver prévia usa entradaPrevia e o PdfService, em qualquer status', async () => {
      const restaurar = comoDesktop();
      try {
        const { fixture, el, repo, pdf } = await montar({ proposta: proposta({ status: 'FINALIZADA' }) });
        botao(el, 'Ver prévia')!.click();
        await ate(fixture, () => expect(el.querySelector('iframe[title="Prévia do PDF"]')).not.toBeNull());
        expect(repo.entradaPrevia).toHaveBeenCalledWith('p1');
        expect(pdf.gerarBlob).toHaveBeenCalledWith({ previa: true });
      } finally {
        restaurar();
      }
    });
  });

  describe('SO-P6: "Trocar responsável" (ADMIN, P4b-R3)', () => {
    const opcoes = (el: HTMLElement) =>
      [...el.querySelectorAll<HTMLOptionElement>('#responsavel-proposta option')].map((x) => x.textContent?.trim());
    const escolher = (fixture: ComponentFixture<unknown>, el: HTMLElement, id: string) => {
      const select = el.querySelector<HTMLSelectElement>('#responsavel-proposta')!;
      select.value = id;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };

    it('lista os ADMIN e COMERCIAL ativos (o atual escolhido); salvar chama atribuir só com o responsável', async () => {
      const { fixture, el, repo, toast } = await montar({ usuario: ADMIN, proposta: proposta({ status: 'APROVADA' }) });
      const trocar = botao(el, 'Trocar responsável')!;
      expect(trocar.className).toMatch(/\bh-12\b/);
      trocar.click();
      fixture.detectChanges();
      const select = el.querySelector<HTMLSelectElement>('#responsavel-proposta')!;
      expect(el.querySelector('label[for=responsavel-proposta]')!.textContent).toContain('Responsável da proposta');
      expect(document.getElementById(select.getAttribute('aria-describedby')!)!.textContent).toContain('As ordens de serviço');
      await ate(fixture, () => expect(document.activeElement).toBe(select));
      expect(opcoes(el)).toEqual(['Ana Admin', 'Caio Comercial', 'Carla Comercial']);
      expect(select.value).toBe(COMERCIAL.id);
      escolher(fixture, el, OUTRO_COMERCIAL.id);
      botao(el, 'Salvar responsável')!.click();
      await vi.waitFor(() => expect(repo.atribuir).toHaveBeenCalledExactlyOnceWith('p1', { responsavelId: OUTRO_COMERCIAL.id }));
      await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Responsável atualizado.'));
      await ate(fixture, () => expect(el.querySelector('#responsavel-proposta')).toBeNull());
      await ate(fixture, () => expect(document.activeElement).toBe(botao(el, 'Trocar responsável')));
    });

    it('a do SIGEM (do admin) também passa a um comercial', async () => {
      const { fixture, el, repo } = await montar({
        usuario: ADMIN, proposta: proposta({ status: 'APROVADA', origem: 'SIGEM', responsavelId: ADMIN.id, tecnicoId: null }),
      });
      botao(el, 'Trocar responsável')!.click();
      fixture.detectChanges();
      expect(el.querySelector<HTMLSelectElement>('#responsavel-proposta')!.value).toBe(ADMIN.id);
      escolher(fixture, el, COMERCIAL.id);
      botao(el, 'Salvar responsável')!.click();
      await vi.waitFor(() => expect(repo.atribuir).toHaveBeenCalledExactlyOnceWith('p1', { responsavelId: COMERCIAL.id }));
    });

    it('o responsável atual inativo aparece marcado; salvar o mesmo só fecha, sem gravar, e o foco volta ao botão', async () => {
      const { fixture, el, repo, toast } = await montar({ usuario: ADMIN, proposta: proposta({ responsavelId: 'u-com-off' }) });
      botao(el, 'Trocar responsável')!.click();
      fixture.detectChanges();
      expect(opcoes(el)).toEqual(['Ana Admin', 'Caio Comercial', 'Carla Comercial', 'Cris Inativa (inativo)']);
      expect(el.querySelector<HTMLSelectElement>('#responsavel-proposta')!.value).toBe('u-com-off');
      botao(el, 'Salvar responsável')!.click();
      fixture.detectChanges();
      expect(repo.atribuir).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
      expect(el.querySelector('#responsavel-proposta')).toBeNull();
      await ate(fixture, () => expect(document.activeElement).toBe(botao(el, 'Trocar responsável')));
    });

    it('Cancelar fecha sem gravar e devolve o foco ao botão', async () => {
      const { fixture, el, repo } = await montar({ usuario: ADMIN });
      botao(el, 'Trocar responsável')!.click();
      fixture.detectChanges();
      escolher(fixture, el, ADMIN.id);
      const editor = el.querySelector('#responsavel-proposta')!.closest('div')!;
      [...editor.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancelar')!.click();
      fixture.detectChanges();
      expect(el.querySelector('#responsavel-proposta')).toBeNull();
      expect(repo.atribuir).not.toHaveBeenCalled();
      await ate(fixture, () => expect(document.activeElement).toBe(botao(el, 'Trocar responsável')));
    });

    it('trava do CONFLITO: desabilitado com "Resolva a pendência primeiro."', async () => {
      const { el } = await montar({ usuario: ADMIN, pendencias: [conflito()] });
      const trocar = botao(el, 'Trocar responsável')!;
      expect(trocar.disabled).toBe(true);
      expect(document.getElementById(trocar.getAttribute('aria-describedby')!)!.textContent).toContain('Resolva a pendência primeiro.');
    });

    it('o CONFLITO que chega com o editor aberto desabilita o "Salvar responsável"', async () => {
      const { fixture, el, repo } = await montar({ usuario: ADMIN });
      botao(el, 'Trocar responsável')!.click();
      fixture.detectChanges();
      repo.pendencias$.next([conflito()]);
      await ate(fixture, () => expect(botao(el, 'Salvar responsável')!.disabled).toBe(true));
    });

    it('a recusa vira toast pelo mensagemErroProposta; o editor fica aberto e o foco volta a "Salvar responsável"', async () => {
      const { fixture, el, repo, toastErro } = await montar({ usuario: ADMIN });
      repo.atribuir.mockRejectedValueOnce(ErroProposta.de({
        codigo: 'VALIDACAO', mensagem: 'Dados inválidos.',
        campos: { responsavelId: 'O responsável tem de ser um administrador ou comercial ativo.' },
      }));
      botao(el, 'Trocar responsável')!.click();
      fixture.detectChanges();
      escolher(fixture, el, ADMIN.id);
      const salvar = botao(el, 'Salvar responsável')!;
      salvar.focus();
      salvar.click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('O responsável tem de ser um administrador ou comercial ativo.'));
      await ate(fixture, () => expect(document.activeElement).toBe(botao(el, 'Salvar responsável')));
      expect(el.querySelector('#responsavel-proposta')).not.toBeNull();
    });

    it('um toque só: o segundo "Salvar responsável" com a gravação em curso não grava de novo', async () => {
      const { fixture, el, repo } = await montar({ usuario: ADMIN });
      let liberar!: () => void;
      repo.atribuir.mockImplementationOnce(() => new Promise<void>((r) => (liberar = r)));
      botao(el, 'Trocar responsável')!.click();
      fixture.detectChanges();
      escolher(fixture, el, ADMIN.id);
      const salvar = botao(el, 'Salvar responsável')!;
      salvar.click();
      salvar.click();
      await vi.waitFor(() => expect(repo.atribuir).toHaveBeenCalledTimes(1));
      fixture.detectChanges();
      expect(salvar.disabled).toBe(true);
      liberar();
      await fixture.whenStable();
      expect(repo.atribuir).toHaveBeenCalledTimes(1);
    });

    it('um editor de cada vez: abrir o do responsável fecha o do técnico, e o contrário', async () => {
      const { fixture, el } = await montar({ usuario: ADMIN });
      botao(el, 'Trocar técnico')!.click();
      fixture.detectChanges();
      botao(el, 'Trocar responsável')!.click();
      fixture.detectChanges();
      expect(el.querySelector('#tecnico-atribuir')).toBeNull();
      expect(el.querySelector('#responsavel-proposta')).not.toBeNull();
      botao(el, 'Trocar técnico')!.click();
      fixture.detectChanges();
      expect(el.querySelector('#responsavel-proposta')).toBeNull();
      expect(el.querySelector('#tecnico-atribuir')).not.toBeNull();
    });

    it('a troca que termina com outra proposta aberta não escreve nela (sucesso ou recusa); o editor não passa para ela', async () => {
      for (const falha of [false, true]) {
        const { fixture, el, repo, toast, toastErro } = await montar({ usuario: ADMIN });
        let liberar!: () => void;
        let recusar!: (e: unknown) => void;
        repo.atribuir.mockImplementationOnce(() => new Promise<void>((r, x) => ((liberar = r), (recusar = x))));
        botao(el, 'Trocar responsável')!.click();
        fixture.detectChanges();
        escolher(fixture, el, ADMIN.id);
        botao(el, 'Salvar responsável')!.click();
        await vi.waitFor(() => expect(repo.atribuir).toHaveBeenCalledWith('p1', { responsavelId: ADMIN.id }));
        fixture.componentRef.setInput('id', 'p2');
        repo.proposta$.next(proposta({ id: 'p2' }));
        fixture.detectChanges();
        if (falha) recusar(new ErroProposta('VALIDACAO', 'responsavelId', 'Recusada.'));
        else liberar();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(toast).not.toHaveBeenCalled();
        expect(toastErro).not.toHaveBeenCalled();
        expect(el.querySelector('#responsavel-proposta')).toBeNull();
        expect(botao(el, 'Trocar responsável')!.disabled).toBe(false);
        TestBed.resetTestingModule();
      }
    });
  });

  describe('pendências (§11.5)', () => {
    it('CONFLITO: faixa com link para Pendências; as transições ficam desabilitadas com a dica', async () => {
      const { el } = await montar({ pendencias: [conflito()] });
      const faixa = el.querySelector('[data-testid=pendencia]')!;
      expect(faixa.querySelector('a')?.getAttribute('href')).toBe('/pendencias');
      for (const rotulo of ['Aprovar', 'Recusar', 'Nova revisão', 'Cancelar proposta', 'Trocar técnico']) {
        const b = botao(el, rotulo)!;
        expect(b.disabled).toBe(true);
        expect(document.getElementById(b.getAttribute('aria-describedby')!)?.textContent).toContain('Resolva a pendência primeiro');
      }
      for (const rotulo of ['Ver prévia', 'Duplicar']) expect(botao(el, rotulo)!.disabled).toBe(false);
    });

    it('CONFLITO num rascunho: "Editar" e "Enviar" também ficam desabilitados com a dica (P4c-R15)', async () => {
      const { el, navegar } = await montar({
        proposta: proposta({ status: 'RASCUNHO', numero: null, historico: [] }), documentos: [], pendencias: [conflito()],
      });
      for (const rotulo of ['Enviar', 'Editar', 'Cancelar proposta']) {
        const b = botao(el, rotulo)!;
        expect(b.disabled).toBe(true);
        expect(document.getElementById(b.getAttribute('aria-describedby')!)?.textContent?.trim()).toBe('Resolva a pendência primeiro.');
        b.click();
      }
      expect(navegar).not.toHaveBeenCalled();
      for (const rotulo of ['Ver prévia', 'Duplicar', 'Excluir rascunho']) expect(botao(el, rotulo)!.disabled).toBe(false);
    });

    it('CONFLITO com o PDF da revisão faltando: "Gerar PDF novamente" fica desabilitado com a dica (P4c-R15)', async () => {
      const { el, repo } = await montar({ documentos: [], pendencias: [conflito()] });
      const b = botao(el, 'Gerar PDF novamente')!;
      expect(b.disabled).toBe(true);
      expect(document.getElementById(b.getAttribute('aria-describedby')!)?.textContent?.trim()).toBe('Resolva a pendência primeiro.');
      b.click();
      expect(repo.regerarDocumento).not.toHaveBeenCalled();
    });

    it('REJEITADO corrigível: "O servidor recusou: <mensagem>" e "Corrigir e reenviar" abre a correção', async () => {
      const { el, navegar } = await montar({ pendencias: [recusaDeDados()] });
      const faixa = texto(el.querySelector('[data-testid=pendencia]')!);
      expect(faixa).toContain('O servidor recusou: Dados inválidos.');
      // o campo pelo rótulo da tela
      expect(faixa).toContain('Prazo de execução: Máximo de 200 caracteres.');
      botao(el, 'Corrigir e reenviar')!.click();
      expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1', 'corrigir']);
      // as transições continuam (vão atrás e entram na correção)
      expect(botao(el, 'Aprovar')!.disabled).toBe(false);
    });

    it('REJEITADO que não se corrige editando: só a faixa com o link', async () => {
      const { el } = await montar({ pendencias: [recusaDeDados('TRANSICAO_INVALIDA')] });
      expect(texto(el.querySelector('[data-testid=pendencia]')!)).toContain('O servidor recusou: Dados inválidos.');
      expect(botao(el, 'Corrigir e reenviar')).toBeUndefined();
    });

    it('CODIGO_EXIBIDO_INVALIDO: "Gerar PDF novamente" chama regerarDocumento com o PdfService e compartilha (sem share: baixa)', async () => {
      const share = semShare();
      try {
        const { el, repo, pdf, toast, gerado } = await montar({
          pendencias: [recusaDoUpload()], documentos: [documento({ id: 'd2', codigoExibido: '000277', enviado: false })],
        });
        expect(texto(el.querySelector('[data-testid=pendencia]')!)).toContain('O código da proposta mudou');
        botao(el, 'Gerar PDF novamente')!.click();
        await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('PDF baixado: Proposta-000277.pdf'));
        expect(repo.regerarDocumento).toHaveBeenCalledWith('p1', expect.any(Function));
        expect(pdf.gerarBlob).toHaveBeenCalledWith({ previa: false });
        expect(share.clique).toHaveBeenCalled();
        // o que baixou é o PDF que o regerarDocumento acabou de gerar
        expect(share.criarUrl).toHaveBeenCalledWith(gerado);
      } finally {
        share.restaurar();
      }
    });

    it('"Gerar PDF novamente" sem gesto (share recusado): o painel "PDF pronto" pede o toque', async () => {
      const nav = navigator as Navigator & { share?: unknown; canShare?: unknown };
      const originais = { share: nav.share, canShare: nav.canShare };
      const shareFn = vi.fn().mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' })).mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: shareFn });
      Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: () => true });
      try {
        const { fixture, el } = await montar({ pendencias: [recusaDoUpload()] });
        botao(el, 'Gerar PDF novamente')!.click();
        await ate(fixture, () => expect(el.querySelector('app-pdf-pronto')).not.toBeNull());
        [...el.querySelectorAll<HTMLButtonElement>('app-pdf-pronto button')].find((b) => b.textContent?.trim() === 'Compartilhar')!.click();
        await ate(fixture, () => expect(el.querySelector('app-pdf-pronto')).toBeNull());
        expect(shareFn).toHaveBeenCalledTimes(2);
        expect(shareFn.mock.calls[1][0].files[0]).toBe(shareFn.mock.calls[0][0].files[0]);
      } finally {
        Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: originais.share });
        Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: originais.canShare });
      }
    });

    it('sem documento da revisão atual (enviada): "Gerar PDF novamente" também aparece; com o documento, não', async () => {
      let { el } = await montar({ documentos: [] });
      expect(botao(el, 'Gerar PDF novamente')).toBeDefined();
      expect(texto(el)).toContain('O PDF desta revisão não está no aparelho nem no servidor.');
      expect(texto(el)).toContain('Se ele foi gerado em outro aparelho, sincronize esse aparelho antes.');
      TestBed.resetTestingModule();
      ({ el } = await montar());
      expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
    });

    it('rascunho com a recusa CODIGO_EXIBIDO_INVALIDO que sobrou (Nova revisão): manda descartar em Pendências, sem gerar', async () => {
      const { el } = await montar({ proposta: proposta({ status: 'RASCUNHO', revisao: 2 }), pendencias: [recusaDoUpload()] });
      const link = el.querySelector<HTMLAnchorElement>('[data-testid=descartar-pendencia]')!;
      expect(link.textContent?.trim()).toBe('Descarte esta pendência em Pendências.');
      expect(link.getAttribute('href')).toBe('/pendencias');
      expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
      TestBed.resetTestingModule();
      // enviada: o caminho é gerar de novo, não descartar
      const outra = await montar({ pendencias: [recusaDoUpload()] });
      expect(outra.el.querySelector('[data-testid=descartar-pendencia]')).toBeNull();
    });

    it('a recusa do regerarDocumento aparece no toast', async () => {
      const { el, repo, toastErro } = await montar({ pendencias: [recusaDoUpload()] });
      repo.regerarDocumento.mockRejectedValueOnce(new ErroProposta('PDF_GRANDE', 'proposta', 'O PDF passou de 10 MB. Reduza imagens do template.'));
      botao(el, 'Gerar PDF novamente')!.click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('O PDF passou de 10 MB. Reduza imagens do template.'));
    });
  });

  describe('proposta importada do SIGEM (origem)', () => {
    const HISTORICO_SIGEM = [
      { statusDe: null, statusPara: 'FINALIZADA' as StatusProposta, usuarioId: ADMIN.id, em: '2026-10-01T10:00:00Z', observacao: 'Importada do SIGEM' },
    ];
    const sigem = (p: Partial<PropostaLocal> = {}) =>
      proposta({ numero: 12, status: 'FINALIZADA', responsavelId: ADMIN.id, tecnicoId: null, origem: 'SIGEM', historico: HISTORICO_SIGEM, ...p });

    it('FINALIZADA: sem "Ver prévia", sem "Gerar PDF novamente", Documentos diz que não tem PDF e o selo SIGEM aparece', async () => {
      const { el } = await montar({ usuario: ADMIN, proposta: sigem(), documentos: [] });
      expect(acoes(el)).toEqual(['Duplicar']);
      expect(botao(el, 'Ver prévia')).toBeUndefined();
      expect(el.querySelector('[data-testid=regerar]')).toBeNull();
      expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
      const docs = texto(el.querySelector<HTMLElement>('[data-testid=documentos]')!);
      expect(docs).toContain('Importada do SIGEM: sem PDF.');
      expect(docs).not.toContain('Nenhum PDF ainda.');
      const selos = [...el.querySelectorAll('[data-testid=resumo] [data-selo]')];
      expect(selos.map((s) => [s.getAttribute('data-selo'), texto(s as HTMLElement).trim()])).toEqual([['sigem', 'Importada do SIGEM']]);
      expect(selos[0].querySelector('.sr-only')?.textContent).toBe('Importada do ');
    });

    it('APROVADA: segue o fluxo (Iniciar execução, Cancelar, Duplicar), só sem a prévia', async () => {
      const { el } = await montar({ usuario: ADMIN, proposta: sigem({ status: 'APROVADA' }), documentos: [] });
      expect(acoes(el)).toEqual(['Iniciar execução', 'Cancelar proposta', 'Duplicar']);
      expect(el.querySelector('[data-testid=regerar]')).toBeNull();
    });

    it('a nativa no mesmo estado continua igual: "Ver prévia", "Gerar PDF novamente" e "Nenhum PDF ainda."', async () => {
      const { el } = await montar({ usuario: ADMIN, proposta: sigem({ origem: null }), documentos: [] });
      expect(acoes(el)).toEqual(['Ver prévia', 'Duplicar']);
      expect(el.querySelector('[data-testid=regerar]')).not.toBeNull();
      const docs = texto(el.querySelector<HTMLElement>('[data-testid=documentos]')!);
      expect(docs).toContain('Nenhum PDF ainda. O PDF é gerado no envio.');
      expect(docs).not.toContain('SIGEM');
      expect(el.querySelector('[data-selo=sigem]')).toBeNull();
    });
  });

  describe('documentos', () => {
    const DOCS = [
      documento({ id: 'd2', revisao: 2, codigoExibido: '000277-R2', geradoEm: '2026-09-28T18:00:00Z', enviado: false, temBytes: true, arquivoId: null }),
      documento({ id: 'd1', revisao: 1, codigoExibido: '000277', temBytes: false, arquivoId: 'a1' }),
    ];

    it('lista de observarDocumentos por revisão, com o código, a data e se já foi enviado', async () => {
      const { el, repo } = await montar({ documentos: DOCS, proposta: proposta({ revisao: 2 }) });
      expect(repo.observarDocumentos).toHaveBeenCalledWith('p1');
      const linhas = [...el.querySelectorAll('[data-testid=documentos] li')].map((li) => texto(li as HTMLElement));
      expect(linhas[0]).toContain('000277-R2');
      expect(linhas[0]).toContain('Revisão 2');
      expect(linhas[0]).toContain('28/09/2026 15:00');
      expect(linhas[0]).toContain('Aguardando envio');
      expect(linhas[1]).toContain('000277');
      expect(linhas[1]).toContain('Enviado');
    });

    it('"Abrir" usa o PDF do aparelho; sem os bytes, baixa online sem cache', async () => {
      const restaurar = comoDesktop();
      try {
        const { fixture, el, repo, arquivos } = await montar({ documentos: DOCS, proposta: proposta({ revisao: 2 }) });
        el.querySelector<HTMLButtonElement>('button[aria-label="Abrir 000277-R2"]')!.click();
        await ate(fixture, () => expect(el.querySelector('iframe[title="PDF 000277-R2"]')).not.toBeNull());
        expect(repo.blobDoDocumento).toHaveBeenCalledWith('d2');
        expect(arquivos.baixarSemCache).not.toHaveBeenCalled();

        el.querySelector<HTMLButtonElement>('button[aria-label="Abrir 000277"]')!.click();
        await ate(fixture, () => expect(el.querySelector('iframe[title="PDF 000277"]')).not.toBeNull());
        expect(arquivos.baixarSemCache).toHaveBeenCalledWith('a1');
      } finally {
        restaurar();
      }
    });

    it('sem os bytes e sem internet (ou com falha no download): "Sem internet: este PDF não está no aparelho."', async () => {
      const { el, arquivos, online, toastErro } = await montar({ documentos: DOCS, online: false });
      const janela = vi.spyOn(window, 'open');
      el.querySelector<HTMLButtonElement>('button[aria-label="Abrir 000277"]')!.click();
      expect(toastErro).toHaveBeenCalledWith('Sem internet: este PDF não está no aparelho.');
      expect(arquivos.baixarSemCache).not.toHaveBeenCalled();
      expect(janela).not.toHaveBeenCalled();

      const restaurar = comoDesktop();
      try {
        // online: a falha não é "sem internet" (M1)
        online.set(true);
        arquivos.baixarSemCache.mockRejectedValueOnce(new Error('rede'));
        toastErro.mockClear();
        el.querySelector<HTMLButtonElement>('button[aria-label="Abrir 000277"]')!.click();
        await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('Não foi possível baixar o PDF. Tente de novo.'));
        // a sessão vencida diz para entrar de novo
        arquivos.baixarSemCache.mockRejectedValueOnce(new ErroDownload('SEM_SESSAO', 'Entre de novo para baixar o arquivo.'));
        el.querySelector<HTMLButtonElement>('button[aria-label="Compartilhar 000277"]')!.click();
        await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('Entre de novo para baixar o arquivo.'));
      } finally {
        restaurar();
      }
    });

    describe('celular (aba aberta no gesto, antes de qualquer espera)', () => {
      const janelaFalsa = () => ({ location: { href: '' }, close: vi.fn(), opener: {} as unknown, document: { title: '', body: { textContent: '' } } });
      let largura: number;
      let criar: typeof URL.createObjectURL;
      beforeEach(() => {
        largura = window.innerWidth;
        criar = URL.createObjectURL;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        URL.createObjectURL = vi.fn(() => 'blob:aba');
      });
      afterEach(() => {
        URL.createObjectURL = criar;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: largura });
      });

      function adiado<T>() {
        let liberar!: (v: T) => void;
        const promessa = new Promise<T>((r) => (liberar = r));
        return { promessa, liberar };
      }

      it('Abrir local e remoto: window.open no clique, antes do blobDoDocumento / baixarSemCache; a aba leva o título do PDF', async () => {
        const { el, repo, arquivos, pdfBlob, remoto } = await montar({ documentos: DOCS, proposta: proposta({ revisao: 2 }) });
        const local = adiado<Blob | null>();
        repo.blobDoDocumento.mockReturnValueOnce(local.promessa);
        let janela = janelaFalsa();
        const abrir = vi.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);
        el.querySelector<HTMLButtonElement>('button[aria-label="Abrir 000277-R2"]')!.click();
        expect(abrir).toHaveBeenCalledWith('', '_blank');
        expect(janela.document.title).toBe('PDF 000277-R2');
        expect(janela.location.href).toBe('');
        local.liberar(pdfBlob);
        await vi.waitFor(() => expect(janela.location.href).toBe('blob:aba'));

        const baixado = adiado<Blob>();
        arquivos.baixarSemCache.mockReturnValueOnce(baixado.promessa);
        janela = janelaFalsa();
        abrir.mockReturnValue(janela as unknown as Window);
        el.querySelector<HTMLButtonElement>('button[aria-label="Abrir 000277"]')!.click();
        expect(abrir).toHaveBeenCalledTimes(2);
        expect(janela.document.title).toBe('PDF 000277');
        await vi.waitFor(() => expect(arquivos.baixarSemCache).toHaveBeenCalledWith('a1'));
        expect(janela.location.href).toBe('');
        baixado.liberar(remoto);
        await vi.waitFor(() => expect(janela.location.href).toBe('blob:aba'));
      });

      it('Ver prévia: window.open no clique, antes do entradaPrevia', async () => {
        const { el, repo } = await montar();
        const entrada = adiado<EntradaPdf>();
        repo.entradaPrevia.mockReturnValueOnce(entrada.promessa);
        const janela = janelaFalsa();
        const abrir = vi.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);
        botao(el, 'Ver prévia')!.click();
        expect(abrir).toHaveBeenCalledWith('', '_blank');
        expect(janela.location.href).toBe('');
        entrada.liberar({ previa: true } as EntradaPdf);
        await vi.waitFor(() => expect(janela.location.href).toBe('blob:aba'));
      });
    });

    it('"Compartilhar" o documento (sem Web Share: baixa Proposta-<código>.pdf)', async () => {
      const share = semShare();
      try {
        const { el, repo, toast } = await montar({ documentos: DOCS, proposta: proposta({ revisao: 2 }) });
        el.querySelector<HTMLButtonElement>('button[aria-label="Compartilhar 000277-R2"]')!.click();
        await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('PDF baixado: Proposta-000277-R2.pdf'));
        expect(repo.blobDoDocumento).toHaveBeenCalledWith('d2');
      } finally {
        share.restaurar();
      }
    });
  });
});
