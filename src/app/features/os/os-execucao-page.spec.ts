import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { ArquivosService } from '../../core/arquivos/arquivos-service';
import type { UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { RegeraDb } from '../../core/db/regera-db';
import { PdfService } from '../../core/pdf/pdf-service';
import { Pendencia, TIPO_UPLOAD_ANEXO_OS, UsuarioResumo } from '../../core/sync/sync-models';
import { SyncService } from '../../core/sync/sync-service';
import { gravarRascunhoOs, lerRascunhoOs } from '../../core/util/rascunho-os';
import { Toasts } from '../../shared/ui/toasts';
import { ClienteLocal, paraClienteLocal } from '../clientes/cliente-models';
import { ClientesRepo } from '../clientes/clientes-repo';
import type { PropostaLocal, StatusProposta } from '../propostas/proposta-models';
import { PropostasRepo } from '../propostas/propostas-repo';
import { AssinaturaCanvas } from './assinatura-canvas';
import { ErroOs } from './erro-os';
import type { FotoPreparada } from './foto-os';
import { OsDados, OsLocal, paraOsLocal, StatusOs } from './os-models';
import { AnexoOsVisivel, EntradaPdfOs, EstadoSync, OsRepo, PREPARAR_FOTO } from './os-repo';
import { motivoParaRegerarOs, OsExecucaoPage } from './os-execucao-page';

const ADMIN: UsuarioSessao = { id: 'u-adm', nome: 'Ana Admin', email: 'ana@regera.com', perfil: 'ADMIN', ativo: true };
const COMERCIAL: UsuarioSessao = { id: 'u-com', nome: 'Carla Comercial', email: 'carla@regera.com', perfil: 'COMERCIAL', ativo: true };
const OUTRO_COMERCIAL: UsuarioSessao = { id: 'u-com2', nome: 'Caio Comercial', email: 'caio@regera.com', perfil: 'COMERCIAL', ativo: true };
const TECNICO: UsuarioSessao = { id: 'u-tec', nome: 'Téo Técnico', email: 'teo@regera.com', perfil: 'TECNICO', ativo: true };
const OUTRO_TECNICO: UsuarioSessao = { id: 'u-tec2', nome: 'Rui Reparo', email: 'rui@regera.com', perfil: 'TECNICO', ativo: true };

const USUARIOS: UsuarioResumo[] = [
  { id: ADMIN.id, nome: ADMIN.nome, perfil: 'ADMIN' },
  { id: COMERCIAL.id, nome: COMERCIAL.nome, perfil: 'COMERCIAL' },
  { id: TECNICO.id, nome: TECNICO.nome, perfil: 'TECNICO' },
  { id: OUTRO_TECNICO.id, nome: OUTRO_TECNICO.nome, perfil: 'TECNICO' },
  { id: 'u-tec-off', nome: 'Tito Inativo', perfil: 'TECNICO', ativo: false },
  { id: 'u-com-off', nome: 'Cris Inativa', perfil: 'COMERCIAL', ativo: false },
];

/** 2026-10-02 01:30 UTC ainda é 2026-10-01 em São Paulo. */
const AGORA = new Date('2026-10-02T01:30:00Z');
const DOCUMENTO_CLIENTE = '11444777000161';

const CLIENTE: ClienteLocal = paraClienteLocal('c1', 1, {
  tipo: 'PJ', documento: DOCUMENTO_CLIENTE, nome: 'Padaria São João', nomeFantasia: null, inscricaoEstadual: null,
  inscricaoMunicipal: null, email: null, telefone: '11988887777', whatsapp: null, contatoNome: 'Maria', observacoes: null,
  enderecos: [],
});

function osDados(status: StatusOs, extra: Partial<OsDados> = {}): OsDados {
  return {
    codigoProvisorio: 'OSP-0Z9XY7', numero: 123, revisao: 1, propostaId: 'p1', propostaNumero: 277, propostaCodigoExibido: '000277',
    clienteId: 'c1', tipo: 'INSTALACAO', status, responsavelId: COMERCIAL.id, tecnicoId: TECNICO.id, dataPrevista: '2026-10-05',
    urgente: true, concluiProposta: true, descricao: 'Instalar o quadro\nLigar antes de ir', enderecoCep: '01310100',
    enderecoLogradouro: 'Av. Paulista', enderecoNumero: '1000', enderecoComplemento: 'cj 12', enderecoBairro: 'Bela Vista',
    enderecoCidade: 'São Paulo', enderecoUf: 'SP', assinaturaRecusada: false,
    itens: [
      { id: 'l1', itemCatalogoId: 'i1', codigo: 'PNL-550', nome: 'Painel Solar', unidade: 'un', natureza: 'PRODUTO', quantidadePrevista: 2, ordem: 0 },
      { id: 'l2', itemCatalogoId: 'i2', codigo: 'CAB-6', nome: 'Cabo 6 mm', unidade: 'm', natureza: 'PRODUTO', quantidadePrevista: 12.5, ordem: 1 },
    ],
    notas: [{ id: 'n1', texto: 'Cheguei no local', autorId: TECNICO.id, criadaEm: '2026-10-01T13:05:00Z' }],
    anexos: [],
    historico: [
      { statusDe: null, statusPara: 'ABERTA', usuarioId: COMERCIAL.id, em: '2026-09-30T12:00:00Z' },
    ],
    atualizadoEm: '2026-10-01T13:05:00Z',
    ...extra,
  };
}

const osLocal = (status: StatusOs, extra: Partial<OsDados> = {}): OsLocal => paraOsLocal('o1', 2, osDados(status, extra));

const anexo = (id: string, a: Partial<AnexoOsVisivel> = {}): AnexoOsVisivel => ({
  id, tipo: 'FOTO', legenda: null, momento: null, tiradaEm: '2026-10-01T13:10:00Z', assinanteNome: null, assinantePapel: null,
  revisaoOs: null, codigoExibido: null, enviado: true, temBytes: false, arquivoId: `arq-${id}`,
  miniatura: new Blob([id], { type: 'image/jpeg' }), ...a,
});
const assinaturaPendente = () =>
  anexo('as1', { tipo: 'ASSINATURA', assinanteNome: 'Maria Souza', assinantePapel: 'Cliente', enviado: false, temBytes: true, arquivoId: null,
    miniatura: new Blob(['png'], { type: 'image/png' }) });
const documentoPdf = (a: Partial<AnexoOsVisivel> = {}) =>
  anexo('d1', { tipo: 'DOCUMENTO', revisaoOs: 1, codigoExibido: 'OS-000123', temBytes: true, miniatura: null, enviado: false, arquivoId: null, ...a });

const conflito = (): Pendencia => ({
  mutationId: 'mc', entidade: 'os', agregadoId: 'o1', tipo: 'CONFLITO', criadaEm: '2026-10-01T10:00:00Z',
  mutacao: { mutationId: 'mc', entidade: 'os', agregadoId: 'o1', op: 'UPSERT', baseVersion: 1, dados: null, criadaEm: '' },
});
const recusaDoPdf = (codigo: string, anexoId = 'd1'): Pendencia => ({
  mutationId: 'up1', entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', tipo: 'REJEITADO', criadaEm: '2026-10-01T10:00:00Z',
  erro: { codigo, mensagem: 'O código impresso no PDF não é o desta OS.' },
  mutacao: { mutationId: 'up1', entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', op: 'UPLOAD', baseVersion: null, dados: { anexoId }, criadaEm: '' },
});
const recusaDaOs = (): Pendencia => ({
  mutationId: 'e1', entidade: 'os', agregadoId: 'o1', tipo: 'REJEITADO', criadaEm: '2026-10-01T10:00:00Z',
  erro: { codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { resumoExecucao: 'Máximo de 4000 caracteres.' } },
  mutacao: { mutationId: 'e1', entidade: 'os', agregadoId: 'o1', op: 'UPSERT', baseVersion: 1, dados: null, criadaEm: '' },
});

interface Opcoes {
  usuario?: UsuarioSessao;
  os?: OsLocal | undefined;
  anexos?: AnexoOsVisivel[];
  pendencias?: Pendencia[];
  estado?: EstadoSync;
  online?: boolean;
  clientes?: ClienteLocal[];
  /** O status da proposta da OS no aparelho (padrão EM_EXECUCAO); null = a proposta não está no aparelho. */
  propostaStatus?: StatusProposta | null;
}

const SEM_ESTADO: EstadoSync = { naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() };

async function montar(o: Opcoes = {}) {
  const inicial = 'os' in o ? o.os : osLocal('EM_ANDAMENTO');
  const pdfBlob = new Blob(['%PDF-local'], { type: 'application/pdf' });
  const gerado = new Blob(['%PDF-gerado'], { type: 'application/pdf' });
  const repo = {
    os$: new BehaviorSubject<OsLocal | undefined>(inicial),
    anexos$: new BehaviorSubject<AnexoOsVisivel[]>(o.anexos ?? []),
    pendencias$: new BehaviorSubject<Pendencia[]>(o.pendencias ?? []),
    observarOs: vi.fn(() => repo.os$.asObservable()),
    observarAnexos: vi.fn(() => repo.anexos$.asObservable()),
    observarPendencias: vi.fn(() => repo.pendencias$.asObservable()),
    observarEstadoSync: () => of(o.estado ?? SEM_ESTADO),
    iniciar: vi.fn<(id: string) => Promise<void>>(async () => undefined),
    adicionarNota: vi.fn<(id: string, texto: string) => Promise<string>>(async () => 'n-novo'),
    adicionarFoto: vi.fn<(id: string, arquivo: Blob, opcoes?: unknown) => Promise<string>>(async () => 'f-novo'),
    assinar: vi.fn<(id: string, a: unknown) => Promise<string>>(async () => 'as-novo'),
    recusarAssinatura: vi.fn<(id: string, motivo: string) => Promise<void>>(async () => undefined),
    concluir: vi.fn<(id: string, resumo: string, gerar: (e: EntradaPdfOs) => Promise<Blob>, opcoes?: { precisaVoltar?: boolean })
      => Promise<{ blob: Blob; codigoExibido: string }>>(async (_id, _r, gerar) => ({ blob: await gerar({} as EntradaPdfOs), codigoExibido: 'OS-000123' })),
    regerarPdf: vi.fn<(id: string, gerar: (e: EntradaPdfOs) => Promise<Blob>) => Promise<{ blob: Blob; codigoExibido: string }>>(
      async (_id, gerar) => ({ blob: await gerar({} as EntradaPdfOs), codigoExibido: 'OS-000123' }),
    ),
    blobDoAnexo: vi.fn<(id: string) => Promise<Blob | null>>(async () => pdfBlob),
    // M2-P3 T4: as ações do escritório
    atribuir: vi.fn<(id: string, m: { tecnicoId?: string | null }, v?: number | null) => Promise<void>>(async () => undefined),
    cancelar: vi.fn<(id: string, motivo: string) => Promise<void>>(async () => undefined),
    reabrir: vi.fn<(id: string, motivo: string) => Promise<void>>(async () => undefined),
    aceitarTrabalho: vi.fn<(id: string) => Promise<void>>(async () => undefined),
    excluir: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  };
  const statusProposta = o.propostaStatus === undefined ? 'EM_EXECUCAO' : o.propostaStatus;
  const propostas = {
    observarUsuarios: () => of(USUARIOS),
    observarProposta: vi.fn((id: string) => of(statusProposta === null ? undefined : ({ id, status: statusProposta } as PropostaLocal))),
  };
  const pdf = { gerarBlobOs: vi.fn<(e: EntradaPdfOs) => Promise<Blob>>(async () => gerado) };
  const remoto = new Blob(['%PDF-remoto'], { type: 'application/pdf' });
  const arquivos = { baixarSemCache: vi.fn<(id: string) => Promise<Blob>>(async () => remoto) };
  const online = signal(o.online ?? true);
  const usuario = signal(o.usuario ?? TECNICO);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { usuario } },
      { provide: OsRepo, useValue: repo },
      { provide: ClientesRepo, useValue: { observarTodos: () => of(o.clientes ?? [CLIENTE]) } },
      { provide: PropostasRepo, useValue: propostas },
      { provide: PdfService, useValue: pdf },
      { provide: ArquivosService, useValue: arquivos },
      { provide: ConectividadeService, useValue: { online } },
    ],
  });
  const toast = vi.spyOn(TestBed.inject(Toasts), 'mostrar');
  const toastErro = vi.spyOn(TestBed.inject(Toasts), 'erro');
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(OsExecucaoPage);
  fixture.componentRef.setInput('id', 'o1');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  await ate(fixture, () => expect(el.querySelector('[data-testid=carregando]')).toBeNull());
  return { fixture, el, repo, propostas, pdf, arquivos, online, usuario, toast, toastErro, navegar, pdfBlob, gerado, remoto };
}

type Montagem = Awaited<ReturnType<typeof montar>>;

async function ate(fixture: ComponentFixture<unknown>, verificar: () => void) {
  await vi.waitFor(() => {
    fixture.detectChanges();
    verificar();
  });
}

const botao = (el: HTMLElement, texto: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === texto);
const texto = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');
const anuncio = (el: HTMLElement) => el.querySelector('[role=status][aria-live=polite]')!.textContent!.trim();

function digitar(fixture: ComponentFixture<unknown>, campo: HTMLTextAreaElement | HTMLInputElement, valor: string) {
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function escolherFoto(fixture: ComponentFixture<unknown>, el: HTMLElement, arquivo: File, seletor = 'input[type=file][capture]') {
  const input = el.querySelector<HTMLInputElement>(seletor)!;
  Object.defineProperty(input, 'files', { configurable: true, value: [arquivo] });
  input.dispatchEvent(new Event('change'));
  fixture.detectChanges();
  return input;
}

const foto = () => new File([new Uint8Array([0xff, 0xd8, 1])], 'foto.jpg', { type: 'image/jpeg' });
const PNG = { bytes: new Uint8Array([137, 80, 78, 71]).buffer, sha256: 'ab'.repeat(32) };

/** Navigator com Web Share de arquivo: `share` falso que resolve (ou rejeita com `erro`). */
function comShare(erro?: string) {
  const share = vi.fn<(d: ShareData) => Promise<void>>(async () => {
    if (erro) throw Object.assign(new Error(erro), { name: erro });
  });
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
  Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: () => true });
  return share;
}
function semShareNoNavegador() {
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: undefined });
  Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: undefined });
}

/** O que a tela oferece para executar. */
function controles(el: HTMLElement) {
  return {
    iniciar: !!botao(el, 'Iniciar OS'),
    nota: !!el.querySelector('textarea[name=nota]'),
    foto: !!botao(el, 'Tirar foto'),
    fotoDepoisDeIniciar: texto(el).includes('Inicie a OS para tirar fotos.'),
    concluir: !!botao(el, 'Concluir e gerar PDF'),
    assinatura: !!botao(el, 'Colher assinatura'),
  };
}

describe('OsExecucaoPage', () => {
  let criarUrl: typeof URL.createObjectURL;
  let revogarUrl: typeof URL.revokeObjectURL;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
    criarUrl = URL.createObjectURL;
    revogarUrl = URL.revokeObjectURL;
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:t-${++n}`);
    URL.revokeObjectURL = vi.fn();
    semShareNoNavegador();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    URL.createObjectURL = criarUrl;
    URL.revokeObjectURL = revogarUrl;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------ cabeçalho

  describe('cabeçalho', () => {
    it('código, status, tipo, selos, cliente com telefone (tel:), endereço com o mapa (nova aba), descrição e itens sem valor', async () => {
      const { el } = await montar({ estado: { ...SEM_ESTADO, naOutbox: new Set(['o1']) } });
      expect(el.querySelector('h1')!.textContent!.trim()).toBe('OS-000123');
      expect(el.querySelector('[data-status]')!.textContent!.trim()).toBe('Em andamento');
      expect(texto(el)).toContain('Instalação');
      const selos = [...el.querySelectorAll('[data-selo]')].map((s) => s.textContent!.trim());
      expect(selos).toEqual(['Urgente', 'Não sincronizada']);
      expect(texto(el)).toContain('Padaria São João');
      const tel = el.querySelector<HTMLAnchorElement>('a[href^="tel:"]')!;
      expect(tel.getAttribute('href')).toBe('tel:+5511988887777');
      expect(tel.textContent!.trim()).toContain('(11) 98888-7777');
      const endereco = 'Av. Paulista, 1000 - cj 12 - Bela Vista - São Paulo/SP - CEP 01310-100';
      expect(texto(el)).toContain(endereco);
      const mapa = el.querySelector<HTMLAnchorElement>('[data-testid=mapa]')!;
      // o mapa procura sem o complemento
      const busca = 'Av. Paulista, 1000 - Bela Vista - São Paulo/SP - CEP 01310-100';
      expect(mapa.getAttribute('href')).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(busca)}`);
      expect(mapa.target).toBe('_blank');
      expect(mapa.rel).toContain('noopener');
      // o nome acessível contém o rótulo visível (WCAG 2.5.3)
      expect(mapa.textContent!.trim()).toBe('Abrir no mapa');
      expect(mapa.getAttribute('aria-label')).toBe('Abrir no mapa (nova aba)');
      expect(el.querySelector('[data-testid=descricao]')!.textContent).toContain('Instalar o quadro');
      const itens = [...el.querySelectorAll('[data-testid=itens] li')].map((l) =>
        ['[data-codigo]', '[data-nome]', '[data-quantidade]'].map((s) => l.querySelector(s)!.textContent!.trim()));
      expect(itens).toEqual([['PNL-550', 'Painel Solar', '2 un'], ['CAB-6', 'Cabo 6 mm', '12,5 m']]);
      expect(el.querySelector('[data-testid=prevista]')!.textContent!.trim()).toBe('05/10/2026');
    });

    it('sem telefone e sem endereço: sem os links', async () => {
      const semTelefone = paraClienteLocal('c1', 1, { ...CLIENTE, documento: null, telefone: null });
      const os = osLocal('EM_ANDAMENTO', {
        enderecoCep: null, enderecoLogradouro: null, enderecoNumero: null, enderecoComplemento: null, enderecoBairro: null,
        enderecoCidade: null, enderecoUf: null,
      });
      const { el } = await montar({ os, clientes: [semTelefone] });
      expect(el.querySelector('a[href^="tel:"]')).toBeNull();
      expect(el.querySelector('[data-testid=mapa]')).toBeNull();
      expect(texto(el)).toContain('Sem endereço');
    });

    it('OS que não está no aparelho', async () => {
      const { el } = await montar({ os: undefined });
      expect(texto(el)).toContain('OS não encontrada neste aparelho.');
      expect(el.querySelector('a[href="/os"]')).not.toBeNull();
    });

    it.each([TECNICO, ADMIN, COMERCIAL])('%s: nenhum CPF/CNPJ do cliente e nenhum valor em lugar nenhum da tela', async (usuario) => {
      for (const status of ['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'] as StatusOs[]) {
        TestBed.resetTestingModule();
        const { el } = await montar({
          usuario, os: osLocal(status, { motivoCancelamento: status === 'CANCELADA' ? 'Cliente desistiu' : null }),
          anexos: [anexo('f1', { legenda: 'Quadro' }), documentoPdf()],
        });
        const html = el.innerHTML;
        expect(html).not.toContain(DOCUMENTO_CLIENTE);
        expect(html).not.toContain('11.444.777/0001-61');
        expect(html).not.toContain('R$');
        expect(document.title).not.toContain(DOCUMENTO_CLIENTE);
      }
    });

    it('a cópia da OS no técnico: o código da proposta sem link; no escritório, o link para a proposta', async () => {
      let { el } = await montar({ usuario: TECNICO });
      expect(texto(el)).toContain('Proposta 000277');
      expect(el.querySelector('a[href="/propostas/p1"]')).toBeNull();
      TestBed.resetTestingModule();
      ({ el } = await montar({ usuario: COMERCIAL }));
      expect(el.querySelector<HTMLAnchorElement>('a[href="/propostas/p1"]')!.textContent).toContain('000277');
    });
  });

  // ------------------------------------------------------------------ ações por status e perfil

  describe('ações por status e perfil', () => {
    type Linha = [string, StatusOs, UsuarioSessao, ReturnType<typeof controles>];
    const nada = { iniciar: false, nota: false, foto: false, fotoDepoisDeIniciar: false, concluir: false, assinatura: false };
    const casos: Linha[] = [
      ['técnico atribuído', 'ABERTA', TECNICO, { ...nada, iniciar: true, nota: true, fotoDepoisDeIniciar: true }],
      ['ADMIN', 'ABERTA', ADMIN, { ...nada, iniciar: true, nota: true, fotoDepoisDeIniciar: true }],
      // T4: o COMERCIAL responsável acrescenta notas em ABERTA e EM_ANDAMENTO (a matriz); o resto ele só lê
      ['COMERCIAL responsável', 'ABERTA', COMERCIAL, { ...nada, nota: true }],
      ['outro técnico (só lê)', 'ABERTA', OUTRO_TECNICO, nada],
      ['técnico atribuído', 'EM_ANDAMENTO', TECNICO, { ...nada, nota: true, foto: true, concluir: true, assinatura: true }],
      ['ADMIN', 'EM_ANDAMENTO', ADMIN, { ...nada, nota: true, foto: true, concluir: true, assinatura: true }],
      ['COMERCIAL responsável', 'EM_ANDAMENTO', COMERCIAL, { ...nada, nota: true }],
      ['outro técnico (só lê)', 'EM_ANDAMENTO', OUTRO_TECNICO, nada],
      // M2P1-R26: a evidência depois do encerramento (nota: ADMIN e técnico; foto: só o técnico)
      ['técnico atribuído', 'CONCLUIDA', TECNICO, { ...nada, nota: true, foto: true }],
      ['ADMIN', 'CONCLUIDA', ADMIN, { ...nada, nota: true }],
      ['COMERCIAL (só lê)', 'CONCLUIDA', COMERCIAL, nada],
      // M2P3-R9: também na cancelada (a evidência do trabalho feito offline)
      ['técnico atribuído', 'CANCELADA', TECNICO, { ...nada, nota: true, foto: true }],
      ['ADMIN', 'CANCELADA', ADMIN, nada],
      ['COMERCIAL (só lê)', 'CANCELADA', COMERCIAL, nada],
    ];

    it.each(casos)('%s em %s', async (_quem, status, usuario, esperado) => {
      const { el } = await montar({ usuario, os: osLocal(status) });
      expect(controles(el)).toEqual(esperado);
      // FW-R1: a galeria vai junto com a câmera
      expect(!!botao(el, 'Escolher da galeria')).toBe(esperado.foto);
    });

    it('M2P3-R9: o técnico atribuído acrescenta nota e foto na OS cancelada', async () => {
      const { fixture, el, repo } = await montar({ os: osLocal('CANCELADA', { motivoCancelamento: 'Cliente desistiu' }) });
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('textarea[name=nota]')!, 'Material deixado no local');
      botao(el, 'Adicionar')!.click();
      await vi.waitFor(() => expect(repo.adicionarNota).toHaveBeenCalledWith('o1', 'Material deixado no local'));
      const arquivo = foto();
      escolherFoto(fixture, el, arquivo);
      await vi.waitFor(() => expect(repo.adicionarFoto).toHaveBeenCalledWith('o1', arquivo, { legenda: null, momento: null }));
      expect(controles(el).concluir).toBe(false);
      expect(controles(el).iniciar).toBe(false);
    });

    it('CANCELADA: só leitura, com o motivo', async () => {
      const { el } = await montar({ os: osLocal('CANCELADA', { motivoCancelamento: 'Cliente desistiu da instalação' }) });
      expect(el.querySelector('[data-testid=cancelada]')!.textContent).toContain('Cliente desistiu da instalação');
    });

    it('o escritório vê o técnico, o responsável e o histórico; o técnico, não', async () => {
      let { el } = await montar({ usuario: COMERCIAL });
      expect(el.querySelector('[data-testid=tecnico]')!.textContent).toContain(TECNICO.nome);
      expect(el.querySelector('[data-testid=responsavel]')!.textContent).toContain(COMERCIAL.nome);
      expect(el.querySelector('[data-testid=historico]')!.textContent).toContain('Criada como Aberta');
      TestBed.resetTestingModule();
      ({ el } = await montar({ usuario: TECNICO }));
      expect(el.querySelector('[data-testid=responsavel]')).toBeNull();
      expect(el.querySelector('[data-testid=historico]')).toBeNull();
    });
  });

  // ------------------------------------------------------------------ iniciar

  describe('iniciar', () => {
    it('chama o repositório, anuncia e leva o foco ao título', async () => {
      const { fixture, el, repo, toast } = await montar({ os: osLocal('ABERTA') });
      const iniciar = botao(el, 'Iniciar OS')!;
      iniciar.click();
      await vi.waitFor(() => expect(repo.iniciar).toHaveBeenCalledWith('o1'));
      repo.os$.next(osLocal('EM_ANDAMENTO'));
      await ate(fixture, () => expect(anuncio(el)).toBe('OS iniciada. Agora você pode tirar fotos.'));
      expect(toast).toHaveBeenCalledWith('OS iniciada. Agora você pode tirar fotos.');
      await ate(fixture, () => expect(document.activeElement).toBe(el.querySelector('h1')));
    });

    it('recusa do repositório vira toast pelo mensagemErroOs', async () => {
      const { el, repo, toastErro } = await montar({ os: osLocal('ABERTA', { tecnicoId: null }), usuario: ADMIN });
      repo.iniciar.mockRejectedValue(ErroOs.de({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { tecnicoId: 'Atribua um técnico antes de iniciar.' } }));
      botao(el, 'Iniciar OS')!.click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('Atribua um técnico antes de iniciar.'));
    });
  });

  // ------------------------------------------------------------------ trava do CONFLITO

  describe('CONFLITO da OS', () => {
    it('iniciar fica desabilitado com "Resolva a pendência primeiro"; a nota continua', async () => {
      const { el } = await montar({ os: osLocal('ABERTA'), pendencias: [conflito()] });
      const iniciar = botao(el, 'Iniciar OS')!;
      expect(iniciar.disabled).toBe(true);
      expect(el.querySelector(`#${iniciar.getAttribute('aria-describedby')}`)!.textContent).toContain('Resolva a pendência primeiro.');
      expect(botao(el, 'Adicionar')!.disabled).toBe(false);
      expect(el.querySelector('[data-testid=pendencia]')!.textContent).toContain('Conflito');
      expect(el.querySelector('[data-testid=pendencia] a[href="/pendencias"]')).not.toBeNull();
    });

    it('concluir fica desabilitado; a foto e a assinatura continuam', async () => {
      const { el } = await montar({ pendencias: [conflito()] });
      const concluir = botao(el, 'Concluir e gerar PDF')!;
      expect(concluir.disabled).toBe(true);
      expect(el.querySelector(`#${concluir.getAttribute('aria-describedby')}`)!.textContent).toContain('Resolva a pendência primeiro.');
      expect(botao(el, 'Tirar foto')!.disabled).toBe(false);
      expect(botao(el, 'Colher assinatura')!.disabled).toBe(false);
    });

    it('a recusa do servidor mostra a mensagem e os campos, com o link para Pendências', async () => {
      const { el } = await montar({ pendencias: [recusaDaOs()] });
      const faixa = el.querySelector('[data-testid=pendencia]')!;
      expect(faixa.textContent).toContain('O servidor recusou: Dados inválidos.');
      expect(faixa.textContent).toContain('Resumo da execução: Máximo de 4000 caracteres.');
    });
  });

  // ------------------------------------------------------------------ notas

  describe('notas', () => {
    it('lista com autor e hora; a pendente com "Não sincronizada"', async () => {
      const os = osLocal('EM_ANDAMENTO');
      os.notas.push({ id: 'n2', texto: 'Falta um disjuntor', autorId: null, criadaEm: null, autorLocalId: ADMIN.id, criadaLocalEm: '2026-10-01T14:20:00Z' });
      const { el } = await montar({ os });
      const notas = [...el.querySelectorAll('[data-testid=notas] li')];
      expect(notas).toHaveLength(2);
      expect(notas[0].textContent).toContain('Cheguei no local');
      expect(notas[0].textContent).toContain(TECNICO.nome);
      expect(notas[0].textContent).toContain('01/10/2026 10:05');
      expect(notas[0].textContent).not.toContain('Não sincronizada');
      expect(notas[1].textContent).toContain(ADMIN.nome);
      expect(notas[1].textContent).toContain('01/10/2026 11:20');
      expect(notas[1].textContent).toContain('Não sincronizada');
      // notas não se editam
      expect(notas[0].querySelector('button, textarea')).toBeNull();
    });

    it('Adicionar grava, limpa o campo, anuncia e mantém o foco no campo', async () => {
      const { fixture, el, repo } = await montar();
      const campo = el.querySelector<HTMLTextAreaElement>('textarea[name=nota]')!;
      expect(el.querySelector(`label[for="${campo.id}"]`)).not.toBeNull();
      digitar(fixture, campo, '  Troquei o disjuntor  ');
      botao(el, 'Adicionar')!.click();
      await vi.waitFor(() => expect(repo.adicionarNota).toHaveBeenCalledWith('o1', '  Troquei o disjuntor  '));
      await ate(fixture, () => expect(anuncio(el)).toBe('Nota adicionada.'));
      expect(campo.value).toBe('');
      expect(document.activeElement).toBe(campo);
    });

    it('nota vazia: erro no campo, sem gravar', async () => {
      const { fixture, el, repo } = await montar();
      const campo = el.querySelector<HTMLTextAreaElement>('textarea[name=nota]')!;
      digitar(fixture, campo, '   ');
      botao(el, 'Adicionar')!.click();
      fixture.detectChanges();
      expect(campo.getAttribute('aria-invalid')).toBe('true');
      expect(texto(el)).toContain('Escreva a nota.');
      expect(repo.adicionarNota).not.toHaveBeenCalled();
    });

    it('recusa do repositório aparece no campo', async () => {
      const { fixture, el, repo } = await montar();
      repo.adicionarNota.mockRejectedValue(ErroOs.de({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { 'notas[1].texto': 'Máximo de 2000 caracteres.' } }));
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('textarea[name=nota]')!, 'x');
      botao(el, 'Adicionar')!.click();
      await ate(fixture, () => expect(el.querySelector('[data-testid=erro-nota]')!.textContent).toContain('Máximo de 2000 caracteres.'));
    });
  });

  // ------------------------------------------------------------------ fotos

  describe('fotos (repositório falso)', () => {
    it('o input: câmera traseira, só imagem, uma por toque; "Tirar foto" abre o input', async () => {
      const { el } = await montar();
      const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
      expect(input.getAttribute('accept')).toBe('image/*');
      expect(input.getAttribute('capture')).toBe('environment');
      expect(input.multiple).toBe(false);
      const clique = vi.spyOn(input, 'click').mockImplementation(() => undefined);
      botao(el, 'Tirar foto')!.click();
      expect(clique).toHaveBeenCalledTimes(1);
    });

    it('grava com o momento e a legenda, limpa a legenda e anuncia o contador', async () => {
      const { fixture, el, repo } = await montar({ anexos: [anexo('f0')] });
      botao(el, 'Antes')!.click();
      fixture.detectChanges();
      expect(botao(el, 'Antes')!.getAttribute('aria-pressed')).toBe('true');
      const legenda = el.querySelector<HTMLInputElement>('input[name=legenda]')!;
      digitar(fixture, legenda, 'Quadro antigo');
      const arquivo = foto();
      const input = escolherFoto(fixture, el, arquivo);
      await vi.waitFor(() => expect(repo.adicionarFoto).toHaveBeenCalledWith('o1', arquivo, { legenda: 'Quadro antigo', momento: 'ANTES' }));
      repo.anexos$.next([anexo('f0'), anexo('f-novo', { enviado: false })]);
      await ate(fixture, () => expect(anuncio(el)).toBe('Foto gravada (2 de 20).'));
      expect(legenda.value).toBe('');
      expect(input.value).toBe('');
      expect(el.querySelector('[data-testid=contador-fotos]')!.textContent!.trim()).toBe('2/20');
    });

    it('legenda acima de 200: erro antes de abrir a câmera (a foto não se perde)', async () => {
      const { fixture, el, repo } = await montar();
      const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
      const clique = vi.spyOn(input, 'click').mockImplementation(() => undefined);
      const legenda = el.querySelector<HTMLInputElement>('input[name=legenda]')!;
      digitar(fixture, legenda, 'x'.repeat(201));
      expect(texto(el)).toContain('201/200');
      botao(el, 'Tirar foto')!.click();
      fixture.detectChanges();
      expect(clique).not.toHaveBeenCalled();
      expect(el.querySelector('[data-testid=erro-foto]')!.textContent).toContain('A legenda tem no máximo 200 caracteres.');
      expect(legenda.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(legenda);
      digitar(fixture, legenda, 'Quadro');
      expect(el.querySelector('[data-testid=erro-foto]')).toBeNull();
      botao(el, 'Tirar foto')!.click();
      expect(clique).toHaveBeenCalledTimes(1);
      expect(repo.adicionarFoto).not.toHaveBeenCalled();
    });

    it('sem momento: vai null; tocar no momento escolhido o desmarca', async () => {
      const { fixture, el, repo } = await montar();
      botao(el, 'Depois')!.click();
      fixture.detectChanges();
      botao(el, 'Depois')!.click();
      fixture.detectChanges();
      escolherFoto(fixture, el, foto());
      await vi.waitFor(() => expect(repo.adicionarFoto).toHaveBeenCalledWith('o1', expect.any(File), { legenda: null, momento: null }));
    });

    it('uma de cada vez: enquanto grava, "Tirar foto" fica desabilitado e outra escolha é ignorada', async () => {
      const { fixture, el, repo } = await montar();
      let terminar!: (id: string) => void;
      repo.adicionarFoto.mockImplementation(() => new Promise<string>((r) => (terminar = r)));
      escolherFoto(fixture, el, foto());
      await vi.waitFor(() => expect(repo.adicionarFoto).toHaveBeenCalledTimes(1));
      fixture.detectChanges();
      expect(botao(el, 'Gravando foto…')!.disabled).toBe(true);
      escolherFoto(fixture, el, foto());
      expect(repo.adicionarFoto).toHaveBeenCalledTimes(1);
      terminar('f1');
      await ate(fixture, () => expect(botao(el, 'Tirar foto')!.disabled).toBe(false));
    });

    it.each([
      [new ErroOs('FOTO_GRANDE', 'foto', 'A foto ficou grande demais.'), 'A foto ficou grande demais.'],
      [new ErroOs('SEM_ESPACO', 'foto', 'Pouco espaço no aparelho para mais fotos.'), 'Pouco espaço no aparelho para mais fotos.'],
      [new ErroOs('FOTO_ILEGIVEL', 'foto', 'Não foi possível abrir a foto. Escolha outra imagem.'), 'Não foi possível abrir a foto.'],
      [new ErroOs('LIMITE_FOTOS', 'foto', 'Esta OS já tem o máximo de 20 fotos.'), 'Esta OS já tem o máximo de 20 fotos.'],
      [new Error('QuotaExceededError interno'), 'Não foi possível gravar a foto. Tente de novo.'],
    ])('erro %#: mensagem clara no lugar da foto (alerta), sem toast técnico', async (erro, mensagem) => {
      const { fixture, el, repo } = await montar();
      repo.adicionarFoto.mockRejectedValue(erro);
      escolherFoto(fixture, el, foto());
      await ate(fixture, () => expect(el.querySelector('[data-testid=erro-foto]')?.textContent).toContain(mensagem));
      expect(el.querySelector('[data-testid=erro-foto]')!.getAttribute('role')).toBe('alert');
      expect(texto(el)).not.toContain('QuotaExceededError');
      expect(botao(el, 'Tirar foto')!.disabled).toBe(false);
    });

    it('M2: enquanto grava, o foco sai do botão desabilitado para o título da seção e volta a ele no fim', async () => {
      const { fixture, el, repo } = await montar();
      let terminar!: (id: string) => void;
      repo.adicionarFoto.mockImplementation(() => new Promise<string>((r) => (terminar = r)));
      const tirar = botao(el, 'Tirar foto')!;
      tirar.focus();
      escolherFoto(fixture, el, foto());
      fixture.detectChanges();
      expect(tirar.disabled).toBe(true);
      expect(document.activeElement).toBe(el.querySelector('#fotos-titulo'));
      terminar('f1');
      await ate(fixture, () => expect(document.activeElement).toBe(tirar));
      expect(tirar.disabled).toBe(false);
    });

    it('com 20 fotos: "Tirar foto" desabilitado, com o aviso do limite', async () => {
      const vinte = Array.from({ length: 20 }, (_, i) => anexo(`f${i}`));
      const { el } = await montar({ anexos: vinte });
      const tirar = botao(el, 'Tirar foto')!;
      expect(tirar.disabled).toBe(true);
      expect(el.querySelector(`#${tirar.getAttribute('aria-describedby')}`)!.textContent).toContain('20 fotos');
    });

    it('a galeria: só as FOTO, miniaturas e "Não sincronizada"', async () => {
      const { el } = await montar({ anexos: [anexo('f1', { enviado: false, momento: 'DURANTE' }), assinaturaPendente(), documentoPdf()] });
      const galeria = el.querySelector('app-galeria-os')!;
      expect(galeria.querySelectorAll('li')).toHaveLength(1);
      expect(galeria.querySelector('img')!.alt).toBe('Foto 1, Durante');
      expect(galeria.textContent).toContain('Não sincronizada');
    });

    it('"Ver foto": os bytes do aparelho na aba aberta dentro do toque', async () => {
      const janela = { opener: {}, document: { title: '', body: { textContent: '' } }, location: { href: '' }, close: vi.fn() };
      const abrir = vi.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);
      const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
      const { el, repo } = await montar({ anexos: [anexo('f1', { temBytes: true, enviado: false, arquivoId: null })] });
      repo.blobDoAnexo.mockResolvedValue(jpeg);
      botao(el, 'Ver foto')!.click();
      expect(abrir).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(janela.location.href).toMatch(/^blob:/));
      expect(repo.blobDoAnexo).toHaveBeenCalledWith('f1');
    });

    it('"Ver foto" da foto só do servidor: offline avisa sem abrir; online baixa sem cache', async () => {
      const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
      const { el, arquivos, online, toast, toastErro } = await montar({ anexos: [anexo('f1')], online: false });
      botao(el, 'Ver foto')!.click();
      expect(abrir).not.toHaveBeenCalled();
      expect(toastErro).toHaveBeenCalledWith('Sem internet: esta foto não está no aparelho.');
      online.set(true);
      botao(el, 'Ver foto')!.click();
      await vi.waitFor(() => expect(arquivos.baixarSemCache).toHaveBeenCalledWith('arq-f1'));
      // o popup bloqueado (window.open null): a foto é baixada, com o aviso
      await vi.waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
      const a = vi.mocked(HTMLAnchorElement.prototype.click).mock.contexts.at(-1) as HTMLAnchorElement;
      expect(a.download).toBe('OS-000123-foto-1.jpg');
      expect(toast).toHaveBeenCalledWith('O navegador bloqueou a nova aba. Foto baixada: OS-000123-foto-1.jpg');
    });
  });

  describe('fotos (OsRepo de verdade, prepararFoto falso)', () => {
    const preparar = vi.fn<(arquivo: Blob) => Promise<FotoPreparada>>();
    let db: RegeraDb;

    async function montarReal() {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: AuthService, useValue: { autenticado: () => true, sessaoExpirada: () => false, usuario: signal(TECNICO) } },
          { provide: ConectividadeService, useValue: { online: signal(false) } },
          { provide: PdfService, useValue: { gerarBlobOs: vi.fn(), logoDataUrl: vi.fn(async () => null) } },
          { provide: ArquivosService, useValue: { baixarSemCache: vi.fn(), obterDataUrl: vi.fn(), limpar: vi.fn(), geracaoAtual: () => 0 } },
          { provide: PREPARAR_FOTO, useValue: preparar },
        ],
      });
      db = TestBed.inject(RegeraDb);
      await db.os.put(osLocal('EM_ANDAMENTO'));
      await db.clientes.put(CLIENTE);
      const fixture = TestBed.createComponent(OsExecucaoPage);
      fixture.componentRef.setInput('id', 'o1');
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      await ate(fixture, () => expect(botao(el, 'Tirar foto')).toBeTruthy());
      return { fixture, el };
    }

    afterEach(async () => {
      await TestBed.inject(SyncService).aguardarOciosa();
      await db.limparTudo();
      TestBed.resetTestingModule();
    });

    it('a foto preparada entra na galeria como "Não sincronizada", com o upload na fila', async () => {
      preparar.mockReset().mockResolvedValue({
        bytes: new Uint8Array([0xff, 0xd8, 1]).buffer as ArrayBuffer, miniatura: new Uint8Array([0xff, 0xd8, 2]).buffer as ArrayBuffer,
        sha256: '1'.padStart(64, '0'), largura: 1600, altura: 1200,
      });
      const { fixture, el } = await montarReal();
      escolherFoto(fixture, el, foto());
      await ate(fixture, () => expect(el.querySelector('app-galeria-os li [data-nao-sincronizada]')).not.toBeNull());
      expect(preparar).toHaveBeenCalledTimes(1);
      expect(await db.anexosOs.count()).toBe(1);
      expect((await db.outbox.toArray()).filter((m) => m.entidade === TIPO_UPLOAD_ANEXO_OS)).toHaveLength(1);
    });

    it('foto grande demais: a mensagem e nada gravado pela metade', async () => {
      preparar.mockReset().mockRejectedValue(new ErroOs('FOTO_GRANDE', 'foto', 'A foto ficou grande demais.'));
      const { fixture, el } = await montarReal();
      escolherFoto(fixture, el, foto());
      await ate(fixture, () => expect(el.querySelector('[data-testid=erro-foto]')?.textContent).toContain('A foto ficou grande demais.'));
      expect(await db.anexosOs.count()).toBe(0);
      expect(await db.anexosOsBytes.count()).toBe(0);
      expect(await db.outbox.count()).toBe(0);
      expect(el.querySelector('app-galeria-os')!.textContent).toContain('Nenhuma foto ainda.');
    });
  });

  // ------------------------------------------------------------------ assinatura

  describe('assinatura', () => {
    it('"Colher assinatura" abre a tela cheia; confirmar grava, fecha, anuncia e devolve o foco', async () => {
      vi.spyOn(AssinaturaCanvas.prototype, 'paraPng').mockResolvedValue(PNG);
      vi.spyOn(AssinaturaCanvas.prototype, 'vazio').mockReturnValue(false);
      const { fixture, el, repo } = await montar();
      const colher = botao(el, 'Colher assinatura')!;
      colher.focus();
      colher.click();
      fixture.detectChanges();
      const tela = el.querySelector('app-assinatura-tela')!;
      expect(tela.querySelector('[role=dialog]')).not.toBeNull();
      // o quadro começa vazio para a tela; um traço o marca
      tela.querySelector('canvas')!.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), {
        pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, clientX: 10, clientY: 10,
      }));
      fixture.detectChanges();
      digitar(fixture, tela.querySelector<HTMLInputElement>('input[name=nome]')!, 'Maria Souza');
      botao(tela as HTMLElement, 'Confirmar')!.click();
      await vi.waitFor(() => expect(repo.assinar).toHaveBeenCalledWith('o1', { png: PNG, nome: 'Maria Souza', papel: 'Cliente' }));
      await ate(fixture, () => expect(el.querySelector('app-assinatura-tela')).toBeNull());
      expect(anuncio(el)).toBe('Assinatura colhida.');
      expect(document.activeElement).toBe(botao(el, 'Colher assinatura') ?? botao(el, 'Colher de novo'));
    });

    it('a recusa do repositório fica na tela, que continua aberta', async () => {
      vi.spyOn(AssinaturaCanvas.prototype, 'paraPng').mockResolvedValue(PNG);
      const { fixture, el, repo } = await montar();
      repo.assinar.mockRejectedValue(new ErroOs('SEM_ESPACO', 'assinatura', 'Pouco espaço no aparelho para gravar a assinatura.'));
      botao(el, 'Colher assinatura')!.click();
      fixture.detectChanges();
      const tela = el.querySelector<HTMLElement>('app-assinatura-tela')!;
      tela.querySelector('canvas')!.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), {
        pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, clientX: 10, clientY: 10,
      }));
      fixture.detectChanges();
      digitar(fixture, tela.querySelector<HTMLInputElement>('input[name=nome]')!, 'Maria');
      botao(tela, 'Confirmar')!.click();
      await ate(fixture, () => expect(tela.querySelector('[data-testid=erro-assinatura]')?.textContent).toContain('Pouco espaço'));
      expect(el.querySelector('app-assinatura-tela')).not.toBeNull();
    });

    it('a assinatura vazia não confirma', async () => {
      const { fixture, el, repo } = await montar();
      botao(el, 'Colher assinatura')!.click();
      fixture.detectChanges();
      const tela = el.querySelector<HTMLElement>('app-assinatura-tela')!;
      digitar(fixture, tela.querySelector<HTMLInputElement>('input[name=nome]')!, 'Maria');
      const confirmar = botao(tela, 'Confirmar')!;
      expect(confirmar.disabled).toBe(true);
      confirmar.click();
      await fixture.whenStable();
      expect(repo.assinar).not.toHaveBeenCalled();
    });

    it('colhida: mostra quem assinou e a imagem; "Cliente não pôde assinar" some', async () => {
      const { el } = await montar({ anexos: [assinaturaPendente()] });
      const bloco = el.querySelector('[data-testid=assinatura]')!;
      expect(bloco.textContent).toContain('Assinada por Maria Souza (Cliente)');
      expect(bloco.querySelector('img')!.alt).toContain('Maria Souza');
      expect(botao(el, 'Colher de novo')).toBeTruthy();
      expect(botao(el, 'Cliente não pôde assinar')).toBeUndefined();
    });

    it('"Cliente não pôde assinar": o motivo vai para o repositório e aparece na tela', async () => {
      const { fixture, el, repo } = await montar();
      botao(el, 'Cliente não pôde assinar')!.click();
      fixture.detectChanges();
      const dialogo = el.querySelector<HTMLElement>('app-dialogo-motivo')!;
      digitar(fixture, dialogo.querySelector('textarea')!, 'Cliente ausente, só o porteiro');
      botao(dialogo, 'Registrar')!.click();
      await vi.waitFor(() => expect(repo.recusarAssinatura).toHaveBeenCalledWith('o1', 'Cliente ausente, só o porteiro'));
      repo.os$.next(osLocal('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Cliente ausente, só o porteiro' }));
      await ate(fixture, () => expect(el.querySelector('app-dialogo-motivo')).toBeNull());
      expect(el.querySelector('[data-testid=assinatura]')!.textContent).toContain('Cliente não pôde assinar: Cliente ausente, só o porteiro');
      expect(anuncio(el)).toBe('Recusa registrada.');
    });
  });

  // ------------------------------------------------------------------ concluir

  describe('concluir', () => {
    const resumo = (el: HTMLElement) => el.querySelector<HTMLTextAreaElement>('textarea[name=resumo]')!;

    it('sem resumo: erro no campo, foco nele, nada gravado', async () => {
      const { fixture, el, repo } = await montar({ anexos: [assinaturaPendente()] });
      botao(el, 'Concluir e gerar PDF')!.click();
      fixture.detectChanges();
      expect(resumo(el).getAttribute('aria-invalid')).toBe('true');
      expect(texto(el)).toContain('Informe o resumo da execução (de 3 a 4000 caracteres).');
      expect(document.activeElement).toBe(resumo(el));
      expect(repo.concluir).not.toHaveBeenCalled();
    });

    it('sem assinatura e sem recusa: erro no campo da assinatura, com o foco em "Colher assinatura"', async () => {
      const { fixture, el, repo } = await montar();
      digitar(fixture, resumo(el), 'Quadro instalado e testado.');
      botao(el, 'Concluir e gerar PDF')!.click();
      fixture.detectChanges();
      const erro = el.querySelector('[data-testid=erro-assinatura-os]')!;
      expect(erro.textContent).toContain('Colha a assinatura ou registre que o cliente não pôde assinar.');
      expect(erro.getAttribute('role')).toBe('alert');
      const colher = botao(el, 'Colher assinatura')!;
      expect(colher.getAttribute('aria-describedby')).toContain(erro.id);
      expect(document.activeElement).toBe(colher);
      expect(repo.concluir).not.toHaveBeenCalled();
    });

    it('com assinatura: conclui (precisaVoltar false), gera o PDF da OS, compartilha OS-000123.pdf e avisa', async () => {
      const share = comShare();
      const { fixture, el, repo, pdf, gerado, toast } = await montar({ anexos: [assinaturaPendente()] });
      digitar(fixture, resumo(el), 'Quadro instalado e testado.');
      botao(el, 'Concluir e gerar PDF')!.click();
      await vi.waitFor(() => expect(share).toHaveBeenCalled());
      expect(repo.concluir).toHaveBeenCalledWith('o1', 'Quadro instalado e testado.', expect.any(Function), { precisaVoltar: false });
      expect(pdf.gerarBlobOs).toHaveBeenCalledTimes(1);
      const dados = share.mock.calls[0][0];
      expect(dados.files![0].name).toBe('OS-000123.pdf');
      expect(dados.files![0].type).toBe('application/pdf');
      expect(await dados.files![0].text()).toBe(await gerado.text());
      expect(toast).toHaveBeenCalledWith('OS concluída. A proposta será atualizada ao sincronizar.');
      await ate(fixture, () => expect(anuncio(el)).toBe('OS concluída. A proposta será atualizada ao sincronizar.'));
    });

    it('com a recusa registrada também conclui', async () => {
      comShare();
      const { fixture, el, repo } = await montar({ os: osLocal('EM_ANDAMENTO', { assinaturaRecusada: true, motivoRecusa: 'Ausente' }) });
      digitar(fixture, resumo(el), 'Feito.');
      botao(el, 'Concluir e gerar PDF')!.click();
      await vi.waitFor(() => expect(repo.concluir).toHaveBeenCalled());
    });

    it('"Precisa voltar" (Q21) vai no concluir e muda o aviso', async () => {
      comShare();
      const { fixture, el, repo, toast } = await montar({ anexos: [assinaturaPendente()] });
      const precisaVoltar = el.querySelector<HTMLInputElement>('input[type=checkbox][name=precisaVoltar]')!;
      expect(el.querySelector(`label[for="${precisaVoltar.id}"]`)!.textContent).toContain('Precisa voltar');
      precisaVoltar.click();
      fixture.detectChanges();
      digitar(fixture, resumo(el), 'Falta o disjuntor de 40 A.');
      botao(el, 'Concluir e gerar PDF')!.click();
      await vi.waitFor(() => expect(repo.concluir).toHaveBeenCalledWith('o1', 'Falta o disjuntor de 40 A.', expect.any(Function), { precisaVoltar: true }));
      await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('OS concluída. A proposta continua em execução para o retorno.'));
    });

    it('OS avulsa: sem "Precisa voltar" e o aviso sem a proposta', async () => {
      comShare();
      const { fixture, el, toast } = await montar({
        os: osLocal('EM_ANDAMENTO', { propostaId: null, propostaNumero: null, propostaCodigoExibido: null }), anexos: [assinaturaPendente()],
      });
      expect(el.querySelector('input[name=precisaVoltar]')).toBeNull();
      digitar(fixture, resumo(el), 'Feito.');
      botao(el, 'Concluir e gerar PDF')!.click();
      await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('OS concluída.'));
    });

    it('o escritório já disse que esta OS não conclui a proposta: sem a caixa, e o aviso do retorno', async () => {
      comShare();
      const { fixture, el, repo, toast } = await montar({ os: osLocal('EM_ANDAMENTO', { concluiProposta: false }), anexos: [assinaturaPendente()] });
      expect(el.querySelector('input[name=precisaVoltar]')).toBeNull();
      expect(texto(el)).toContain('Esta OS não conclui a proposta');
      digitar(fixture, resumo(el), 'Feito.');
      botao(el, 'Concluir e gerar PDF')!.click();
      await vi.waitFor(() => expect(repo.concluir).toHaveBeenCalledWith('o1', 'Feito.', expect.any(Function), { precisaVoltar: false }));
      await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('OS concluída. A proposta continua em execução para o retorno.'));
    });

    it('o navegador recusa o compartilhamento sem gesto: o painel "PDF pronto" espera o toque', async () => {
      const share = comShare('NotAllowedError');
      const { fixture, el } = await montar({ anexos: [assinaturaPendente()] });
      digitar(fixture, resumo(el), 'Feito.');
      botao(el, 'Concluir e gerar PDF')!.click();
      await ate(fixture, () => expect(el.querySelector('app-pdf-pronto')).not.toBeNull());
      expect(el.querySelector('app-pdf-pronto')!.textContent).toContain('OS-000123.pdf');
      share.mockResolvedValue(undefined);
      botao(el.querySelector('app-pdf-pronto') as HTMLElement, 'Compartilhar')!.click();
      await ate(fixture, () => expect(el.querySelector('app-pdf-pronto')).toBeNull());
      expect(share).toHaveBeenCalledTimes(2);
    });

    it('depois de concluir, o foco vai ao título; com o painel "PDF pronto", ao painel', async () => {
      let { fixture, el, repo } = await montar({ anexos: [assinaturaPendente()] });
      digitar(fixture, resumo(el), 'Feito.');
      botao(el, 'Concluir e gerar PDF')!.click();
      await vi.waitFor(() => expect(repo.concluir).toHaveBeenCalled());
      repo.os$.next(osLocal('CONCLUIDA', { resumoExecucao: 'Feito.' }));
      await ate(fixture, () => expect(document.activeElement).toBe(el.querySelector('h1')));
      TestBed.resetTestingModule();
      comShare('NotAllowedError');
      ({ fixture, el, repo } = await montar({ anexos: [assinaturaPendente()] }));
      digitar(fixture, resumo(el), 'Feito.');
      botao(el, 'Concluir e gerar PDF')!.click();
      await ate(fixture, () => expect(el.querySelector('app-pdf-pronto')).not.toBeNull());
      await ate(fixture, () => expect(document.activeElement).toBe(el.querySelector('app-pdf-pronto [role=dialog]')));
    });

    it('a recusa do concluir devolve o foco ao botão (ele se desabilitou com o foco nele)', async () => {
      const { fixture, el, repo } = await montar({ anexos: [assinaturaPendente()] });
      let recusar!: (e: unknown) => void;
      repo.concluir.mockImplementation(() => new Promise((_, rej) => (recusar = rej)));
      digitar(fixture, resumo(el), 'Feito.');
      const concluir = botao(el, 'Concluir e gerar PDF')!;
      concluir.focus();
      concluir.click();
      await ate(fixture, () => expect(botao(el, 'Gerando PDF…')!.disabled).toBe(true));
      // o navegador tira o foco do botão que se desabilita (o jsdom não, nem deixa o blur nele): simulado com um
      // elemento focado que sai da página
      const temporario = document.body.appendChild(document.createElement('button'));
      temporario.focus();
      temporario.remove();
      expect(document.activeElement).toBe(document.body);
      recusar(new ErroOs('OS_ALTERADA', 'os', 'A OS mudou enquanto o PDF era gerado. Conclua de novo.'));
      await ate(fixture, () => expect(document.activeElement).toBe(botao(el, 'Concluir e gerar PDF')));
    });

    it('durante a geração: o botão diz "Gerando PDF…", fica desabilitado e o anúncio avisa', async () => {
      const { fixture, el, repo } = await montar({ anexos: [assinaturaPendente()] });
      let terminar!: (r: { blob: Blob; codigoExibido: string }) => void;
      repo.concluir.mockImplementation(() => new Promise((r) => (terminar = r)));
      digitar(fixture, resumo(el), 'Feito.');
      botao(el, 'Concluir e gerar PDF')!.click();
      await ate(fixture, () => expect(botao(el, 'Gerando PDF…')!.disabled).toBe(true));
      expect(anuncio(el)).toBe('Gerando o PDF da OS…');
      terminar({ blob: new Blob(['x']), codigoExibido: 'OS-000123' });
      await fixture.whenStable();
    });

    it('a recusa VALIDACAO do repositório vai para os campos; outra recusa vira toast', async () => {
      const { fixture, el, repo, toastErro } = await montar({ anexos: [assinaturaPendente()] });
      repo.concluir.mockRejectedValueOnce(ErroOs.de({
        codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { resumoExecucao: 'Máximo de 4000 caracteres.' },
      }));
      digitar(fixture, resumo(el), 'Feito.');
      botao(el, 'Concluir e gerar PDF')!.click();
      await ate(fixture, () => expect(el.querySelector('[data-testid=erro-resumo]')?.textContent).toContain('Máximo de 4000 caracteres.'));
      repo.concluir.mockRejectedValueOnce(new ErroOs('RESOLVA_A_PENDENCIA', 'os', 'Resolva a pendência desta OS antes de concluí-la.'));
      botao(el, 'Concluir e gerar PDF')!.click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('Resolva a pendência desta OS antes de concluí-la.'));
    });

    it('o resumo de uma OS reaberta vem preenchido', async () => {
      const { el } = await montar({ os: osLocal('EM_ANDAMENTO', { revisao: 2, resumoExecucao: 'Primeira visita' }) });
      expect(resumo(el).value).toBe('Primeira visita');
    });
  });

  // ------------------------------------------------------------------ I1: concluir e as escritas de campo

  describe('I1: o concluir espera a foto, a nota e a assinatura em gravação', () => {
    const resumo = (el: HTMLElement) => el.querySelector<HTMLTextAreaElement>('textarea[name=resumo]')!;

    it('com uma foto gravando, "Concluir" fica desabilitado (com o aviso) e o toque não conclui; depois, conclui com ela', async () => {
      comShare();
      const { fixture, el, repo } = await montar({ anexos: [assinaturaPendente()] });
      let terminar!: (id: string) => void;
      repo.adicionarFoto.mockImplementation(() => new Promise<string>((r) => (terminar = r)));
      digitar(fixture, resumo(el), 'Quadro instalado.');
      escolherFoto(fixture, el, foto());
      await vi.waitFor(() => expect(repo.adicionarFoto).toHaveBeenCalledTimes(1));
      fixture.detectChanges();
      const concluir = botao(el, 'Concluir e gerar PDF')!;
      expect(concluir.disabled).toBe(true);
      expect(el.querySelector(`#${concluir.getAttribute('aria-describedby')}`)!.textContent).toContain('a foto ainda está sendo gravada');
      // mesmo que o clique chegue (o botão desabilitado não o recebe; a guarda vale para qualquer caminho)
      concluir.disabled = false;
      concluir.click();
      await fixture.whenStable();
      expect(repo.concluir).not.toHaveBeenCalled();
      // a foto gravou: a ordem é foto, depois concluir
      terminar('f1');
      repo.anexos$.next([assinaturaPendente(), anexo('f1', { enviado: false })]);
      await ate(fixture, () => expect(botao(el, 'Concluir e gerar PDF')!.disabled).toBe(false));
      botao(el, 'Concluir e gerar PDF')!.click();
      await vi.waitFor(() => expect(repo.concluir).toHaveBeenCalledTimes(1));
      expect(repo.adicionarFoto.mock.invocationCallOrder[0]).toBeLessThan(repo.concluir.mock.invocationCallOrder[0]);
    });

    it('com uma nota gravando, "Concluir" também espera', async () => {
      const { fixture, el, repo } = await montar({ anexos: [assinaturaPendente()] });
      repo.adicionarNota.mockImplementation(() => new Promise<string>(() => undefined));
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('textarea[name=nota]')!, 'Troquei o disjuntor');
      botao(el, 'Adicionar')!.click();
      fixture.detectChanges();
      const concluir = botao(el, 'Concluir e gerar PDF')!;
      expect(concluir.disabled).toBe(true);
      expect(el.querySelector(`#${concluir.getAttribute('aria-describedby')}`)!.textContent).toContain('a nota ainda está sendo gravada');
    });

    it('durante a geração do PDF: "Tirar foto" desabilitado (com o aviso) e a foto que chegar não é gravada, com a mensagem', async () => {
      const { fixture, el, repo } = await montar({ anexos: [assinaturaPendente()] });
      let terminar!: (r: { blob: Blob; codigoExibido: string }) => void;
      repo.concluir.mockImplementation(() => new Promise((r) => (terminar = r)));
      digitar(fixture, resumo(el), 'Feito.');
      botao(el, 'Concluir e gerar PDF')!.click();
      await ate(fixture, () => expect(botao(el, 'Gerando PDF…')).toBeTruthy());
      const tirar = botao(el, 'Tirar foto')!;
      expect(tirar.disabled).toBe(true);
      expect(el.querySelector(`#${tirar.getAttribute('aria-describedby')}`)!.textContent).toContain('Aguarde a conclusão');
      const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
      const clique = vi.spyOn(input, 'click').mockImplementation(() => undefined);
      tirar.disabled = false;
      tirar.click();
      expect(clique).not.toHaveBeenCalled();
      escolherFoto(fixture, el, foto());
      expect(repo.adicionarFoto).not.toHaveBeenCalled();
      expect(el.querySelector('[data-testid=erro-foto]')!.textContent).toContain('não foi gravada');
      terminar({ blob: new Blob(['x']), codigoExibido: 'OS-000123' });
      await fixture.whenStable();
    });

    it('a recusa da foto que chega com a OS já em outro status continua visível (ADMIN: sem o bloco de captura)', async () => {
      const { fixture, el, repo } = await montar({ usuario: ADMIN });
      let recusar!: (e: unknown) => void;
      repo.adicionarFoto.mockImplementation(() => new Promise<string>((_, rej) => (recusar = rej)));
      escolherFoto(fixture, el, foto());
      await vi.waitFor(() => expect(repo.adicionarFoto).toHaveBeenCalledTimes(1));
      // concluída em outro aparelho (o pull) enquanto a foto gravava: o ADMIN não fotografa a concluída
      repo.os$.next(osLocal('CONCLUIDA', { resumoExecucao: 'Feito.' }));
      await ate(fixture, () => expect(botao(el, 'Tirar foto')).toBeUndefined());
      recusar(new ErroOs('STATUS_INVALIDO', 'os', 'Fotos e assinatura só com a OS em andamento.'));
      await ate(fixture, () => expect(el.querySelector('[data-testid=erro-foto]')?.textContent).toContain('Fotos e assinatura só com a OS em andamento.'));
      expect(el.querySelector('[data-testid=erro-foto]')!.getAttribute('role')).toBe('alert');
    });
  });

  // ------------------------------------------------------------------ M4: troca de OS

  describe('M4: outra OS na mesma página', () => {
    it('os campos, erros, diálogos e o painel do PDF da OS anterior não passam para a nova', async () => {
      const { fixture, el } = await montar();
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('textarea[name=nota]')!, 'Rascunho de nota');
      digitar(fixture, el.querySelector<HTMLInputElement>('input[name=legenda]')!, 'Legenda');
      botao(el, 'Antes')!.click();
      el.querySelector<HTMLInputElement>('input[name=precisaVoltar]')!.click();
      botao(el, 'Concluir e gerar PDF')!.click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid=erro-resumo]')).not.toBeNull();
      botao(el, 'Colher assinatura')!.click();
      fixture.detectChanges();
      expect(el.querySelector('app-assinatura-tela')).not.toBeNull();
      fixture.componentRef.setInput('id', 'o2');
      await ate(fixture, () => expect(el.querySelector('[data-testid=carregando]')).toBeNull());
      expect(el.querySelector('app-assinatura-tela')).toBeNull();
      expect(el.querySelector<HTMLTextAreaElement>('textarea[name=nota]')!.value).toBe('');
      expect(el.querySelector<HTMLInputElement>('input[name=legenda]')!.value).toBe('');
      expect(botao(el, 'Antes')!.getAttribute('aria-pressed')).toBe('false');
      expect(el.querySelector<HTMLInputElement>('input[name=precisaVoltar]')!.checked).toBe(false);
      expect(el.querySelector('[data-testid=erro-resumo]')).toBeNull();
      expect(el.querySelector('[data-testid=erro-assinatura-os]')).toBeNull();
    });
  });

  // ------------------------------------------------------------------ concluída: PDF

  describe('CONCLUIDA', () => {
    const concluida = (extra: Partial<OsDados> = {}) =>
      osLocal('CONCLUIDA', { resumoExecucao: 'Quadro instalado.', assinaturaAnexoId: 'as1', assinanteNome: 'Maria Souza', assinantePapel: 'Cliente', ...extra });

    it('mostra o resumo e a assinatura; o PDF abre pelos bytes do aparelho e compartilha como OS-000123.pdf', async () => {
      const largura = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
      try {
        const { fixture, el, repo, pdfBlob } = await montar({ os: concluida(), anexos: [documentoPdf()] });
        expect(el.querySelector('[data-testid=conclusao]')!.textContent).toContain('Quadro instalado.');
        expect(el.querySelector('[data-testid=conclusao]')!.textContent).toContain('Assinada por Maria Souza (Cliente)');
        const docs = el.querySelector('[data-testid=documentos]')!;
        expect(docs.textContent).toContain('OS-000123');
        expect(docs.textContent).toContain('Aguardando envio');
        el.querySelector<HTMLButtonElement>('[aria-label="Abrir OS-000123"]')!.click();
        await vi.waitFor(() => expect(repo.blobDoAnexo).toHaveBeenCalledWith('d1'));
        await ate(fixture, () => expect(el.querySelector('iframe')).not.toBeNull());
        el.querySelector<HTMLButtonElement>('[aria-label="Compartilhar OS-000123"]')!.click();
        await vi.waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
        const a = vi.mocked(HTMLAnchorElement.prototype.click).mock.contexts.at(-1) as HTMLAnchorElement;
        expect(a.download).toBe('OS-000123.pdf');
        expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ size: pdfBlob.size }));
      } finally {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: largura });
      }
    });

    it('o PDF só do servidor: offline avisa; online baixa sem cache', async () => {
      const { el, arquivos, online, toastErro } = await montar({
        os: concluida(), anexos: [documentoPdf({ temBytes: false, enviado: true, arquivoId: 'arq-d1' })], online: false,
      });
      el.querySelector<HTMLButtonElement>('[aria-label="Compartilhar OS-000123"]')!.click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('Sem internet: este PDF não está no aparelho.'));
      expect(arquivos.baixarSemCache).not.toHaveBeenCalled();
      online.set(true);
      el.querySelector<HTMLButtonElement>('[aria-label="Compartilhar OS-000123"]')!.click();
      await vi.waitFor(() => expect(arquivos.baixarSemCache).toHaveBeenCalledWith('arq-d1'));
    });

    it('sem PDF desta revisão: "Gerar PDF novamente" chama o regerarPdf e compartilha', async () => {
      const share = comShare();
      const { fixture, el, repo, pdf, toast } = await montar({ os: concluida(), anexos: [] });
      const regerar = el.querySelector('[data-testid=regerar]')!;
      expect(regerar.textContent).toContain('O PDF desta OS não está no aparelho nem no servidor.');
      botao(el, 'Gerar PDF novamente')!.click();
      await vi.waitFor(() => expect(share).toHaveBeenCalled());
      expect(repo.regerarPdf).toHaveBeenCalledWith('o1', expect.any(Function));
      expect(pdf.gerarBlobOs).toHaveBeenCalled();
      expect(share.mock.calls[0][0].files![0].name).toBe('OS-000123.pdf');
      expect(toast).toHaveBeenCalledWith('PDF gerado de novo. Ele vai para o servidor na próxima sincronização.');
      fixture.detectChanges();
    });

    it('o PDF recusado com o código antigo (CODIGO_EXIBIDO_INVALIDO): "Gerar PDF novamente"', async () => {
      const { el } = await montar({ os: concluida(), anexos: [documentoPdf()], pendencias: [recusaDoPdf('CODIGO_EXIBIDO_INVALIDO')] });
      expect(el.querySelector('[data-testid=regerar]')!.textContent).toContain('Gere o PDF de novo');
      expect(botao(el, 'Gerar PDF novamente')).toBeTruthy();
    });

    it('com o PDF da revisão: não oferece; do COMERCIAL, também não', async () => {
      let { el } = await montar({ os: concluida(), anexos: [documentoPdf()] });
      expect(el.querySelector('[data-testid=regerar]')).toBeNull();
      TestBed.resetTestingModule();
      ({ el } = await montar({ usuario: COMERCIAL, os: concluida(), anexos: [] }));
      expect(el.querySelector('[data-testid=regerar]')).toBeNull();
    });

    it('com CONFLITO: "Gerar PDF novamente" desabilitado', async () => {
      const { el } = await montar({ os: concluida(), anexos: [], pendencias: [conflito()] });
      const b = botao(el, 'Gerar PDF novamente')!;
      expect(b.disabled).toBe(true);
      expect(el.querySelector(`#${b.getAttribute('aria-describedby')}`)!.textContent).toContain('Resolva a pendência primeiro.');
    });

    it('M3: depois do "Gerar PDF novamente", o foco vai ao título', async () => {
      const { fixture, el } = await montar({ os: concluida(), anexos: [] });
      botao(el, 'Gerar PDF novamente')!.click();
      await ate(fixture, () => expect(document.activeElement).toBe(el.querySelector('h1')));
    });

    it('"Gerar PDF novamente" sem gesto (precisa-toque): o painel "PDF pronto" com o foco', async () => {
      comShare('NotAllowedError');
      const { fixture, el } = await montar({ os: concluida(), anexos: [] });
      botao(el, 'Gerar PDF novamente')!.click();
      await ate(fixture, () => expect(el.querySelector('app-pdf-pronto')).not.toBeNull());
      expect(el.querySelector('app-pdf-pronto')!.textContent).toContain('OS-000123.pdf');
      await ate(fixture, () => expect(document.activeElement).toBe(el.querySelector('app-pdf-pronto [role=dialog]')));
    });

    it('"Compartilhar" do PDF sem gesto (precisa-toque): o painel "PDF pronto"', async () => {
      comShare('NotAllowedError');
      const { fixture, el } = await montar({ os: concluida(), anexos: [documentoPdf()] });
      el.querySelector<HTMLButtonElement>('[aria-label="Compartilhar OS-000123"]')!.click();
      await ate(fixture, () => expect(el.querySelector('app-pdf-pronto')).not.toBeNull());
      expect(el.querySelector('app-pdf-pronto')!.textContent).toContain('OS-000123.pdf');
    });

    it('no celular, "Abrir" abre a aba dentro do toque, antes de ler os bytes', async () => {
      const largura = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
      try {
        const janela = { opener: {}, document: { title: '', body: { textContent: '' } }, location: { href: '' }, close: vi.fn() };
        const abrir = vi.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);
        const { el, repo } = await montar({ os: concluida(), anexos: [documentoPdf()] });
        el.querySelector<HTMLButtonElement>('[aria-label="Abrir OS-000123"]')!.click();
        // síncrono: ainda no gesto, sem nenhum await antes
        expect(abrir).toHaveBeenCalledTimes(1);
        expect(abrir.mock.invocationCallOrder[0]).toBeLessThan(repo.blobDoAnexo.mock.invocationCallOrder[0]);
        await vi.waitFor(() => expect(janela.location.href).toMatch(/^blob:/));
      } finally {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: largura });
      }
    });

    it('a recusa da assinatura aparece no lugar dela', async () => {
      const { el } = await montar({ os: concluida({ assinaturaAnexoId: null, assinaturaRecusada: true, motivoRecusa: 'Cliente ausente' }) });
      expect(el.querySelector('[data-testid=conclusao]')!.textContent).toContain('Cliente não pôde assinar: Cliente ausente');
    });
  });

  describe('motivoParaRegerarOs', () => {
    const os = (status: StatusOs = 'CONCLUIDA', revisao = 1) => osLocal(status, { revisao });

    it('fora de CONCLUIDA, nunca', () => {
      expect(motivoParaRegerarOs(os('EM_ANDAMENTO'), [], [], ADMIN)).toBeNull();
    });

    it('sem DOCUMENTO da revisão atual (o de outra revisão não conta)', () => {
      expect(motivoParaRegerarOs(os(), [], [], ADMIN)).toBe('SEM_DOCUMENTO');
      expect(motivoParaRegerarOs(os('CONCLUIDA', 2), [documentoPdf({ revisaoOs: 1 })], [], ADMIN)).toBe('SEM_DOCUMENTO');
      expect(motivoParaRegerarOs(os('CONCLUIDA', 2), [documentoPdf({ revisaoOs: 2 })], [], ADMIN)).toBeNull();
    });

    it.each(['CODIGO_EXIBIDO_INVALIDO', 'ANEXO_AUSENTE'])('PDF desta revisão recusado com %s', (codigo) => {
      expect(motivoParaRegerarOs(os(), [documentoPdf()], [recusaDoPdf(codigo)], ADMIN)).toBe('RECUSADO');
    });

    it.each(['REVISAO_INVALIDA', 'STATUS_INVALIDO', 'OS_CONCLUIDA_POR_OUTRO'])('%s não se resolve gerando de novo', (codigo) => {
      expect(motivoParaRegerarOs(os(), [documentoPdf()], [recusaDoPdf(codigo)], ADMIN)).toBeNull();
    });

    it('a recusa de uma foto não conta', () => {
      expect(motivoParaRegerarOs(os(), [documentoPdf(), anexo('f1')], [recusaDoPdf('CODIGO_EXIBIDO_INVALIDO', 'f1')], ADMIN)).toBeNull();
    });

    it('a regra compartilhada (pdfRegeravel): o ADMIN e o técnico atribuído; o COMERCIAL e outro técnico, nunca', () => {
      expect(motivoParaRegerarOs(os(), [], [], TECNICO)).toBe('SEM_DOCUMENTO');
      expect(motivoParaRegerarOs(os(), [], [], COMERCIAL)).toBeNull();
      expect(motivoParaRegerarOs(os(), [], [], OUTRO_TECNICO)).toBeNull();
      expect(motivoParaRegerarOs(os(), [], [], null)).toBeNull();
    });

    it('o técnico, não depois que o servidor disse que outro concluiu (a pendência ou o histórico); o ADMIN, sim', () => {
      expect(motivoParaRegerarOs(os(), [documentoPdf()], [recusaDoPdf('CODIGO_EXIBIDO_INVALIDO'), recusaDoPdf('OS_CONCLUIDA_POR_OUTRO', 'd9')], TECNICO))
        .toBeNull();
      const porOutro = osLocal('CONCLUIDA', {
        concluidaEm: '2026-10-01T15:00:00Z',
        historico: [{ statusDe: 'EM_ANDAMENTO', statusPara: 'CONCLUIDA', usuarioId: ADMIN.id, em: '2026-10-01T15:00:00Z' }],
      });
      expect(motivoParaRegerarOs(porOutro, [], [], TECNICO)).toBeNull();
      expect(motivoParaRegerarOs(porOutro, [], [], ADMIN)).toBe('SEM_DOCUMENTO');
      // a conclusão deste aparelho ainda sem resposta do servidor (concluidaEm null): a última lá vai ser a dele
      expect(motivoParaRegerarOs({ ...porOutro, concluidaEm: null }, [], [], TECNICO)).toBe('SEM_DOCUMENTO');
    });
  });

  describe('acessibilidade', () => {
    it('região de anúncios, título focável e alvos de 48 px nos botões da execução', async () => {
      const { el } = await montar();
      expect(el.querySelector('[role=status][aria-live=polite]')).not.toBeNull();
      expect(el.querySelector('h1')!.getAttribute('tabindex')).toBe('-1');
      for (const b of el.querySelectorAll<HTMLButtonElement>('main button, section button')) {
        expect(b.className).toMatch(/\bh-12\b|\bmin-h-12\b/);
      }
      for (const campo of el.querySelectorAll<HTMLElement>('textarea, input:not([type=file]):not([type=checkbox])')) {
        expect(el.querySelector(`label[for="${campo.id}"]`)).not.toBeNull();
      }
    });
  });

  // ------------------------------------------------------------------ escritório (T4)

  describe('escritório: ações por status e perfil (T4)', () => {
    const acoesEscritorio = (el: HTMLElement) => ({
      editar: !!el.querySelector('a[href="/os/o1/editar"]'),
      atribuir: !!(botao(el, 'Atribuir técnico') ?? botao(el, 'Trocar técnico')),
      cancelar: !!botao(el, 'Cancelar OS'),
      reabrir: !!botao(el, 'Reabrir'),
      aceitar: !!botao(el, 'Aceitar o trabalho'),
      excluir: !!botao(el, 'Excluir OS'),
      responsavel: !!botao(el, 'Trocar responsável'),
    });
    const nada = { editar: false, atribuir: false, cancelar: false, reabrir: false, aceitar: false, excluir: false, responsavel: false };
    const avulsa = { propostaId: null, propostaNumero: null, propostaCodigoExibido: null };
    type Linha = [string, StatusOs, UsuarioSessao, Partial<OsDados>, StatusProposta, typeof nada];
    const sem = { tecnicoId: null };
    const casos: Linha[] = [
      ['ADMIN', 'ABERTA', ADMIN, {}, 'APROVADA', { ...nada, editar: true, atribuir: true, cancelar: true }],
      // excluir só sem técnico (com técnico, cancela-se: ele pode estar trabalhando offline)
      ['ADMIN, sem técnico', 'ABERTA', ADMIN, sem, 'APROVADA', { ...nada, editar: true, atribuir: true, cancelar: true, excluir: true }],
      ['COMERCIAL responsável', 'ABERTA', COMERCIAL, {}, 'APROVADA', { ...nada, editar: true, atribuir: true, cancelar: true }],
      ['COMERCIAL responsável, sem técnico', 'ABERTA', COMERCIAL, sem, 'APROVADA', { ...nada, editar: true, atribuir: true, cancelar: true, excluir: true }],
      ['ADMIN', 'EM_ANDAMENTO', ADMIN, {}, 'EM_EXECUCAO', { ...nada, editar: true, atribuir: true, cancelar: true }],
      // em andamento, o COMERCIAL não cancela (só o ADMIN)
      ['COMERCIAL responsável', 'EM_ANDAMENTO', COMERCIAL, {}, 'EM_EXECUCAO', { ...nada, editar: true, atribuir: true }],
      ['ADMIN', 'CONCLUIDA', ADMIN, {}, 'EM_EXECUCAO', { ...nada, reabrir: true }],
      ['COMERCIAL responsável', 'CONCLUIDA', COMERCIAL, {}, 'EM_EXECUCAO', nada],
      ['ADMIN', 'CANCELADA', ADMIN, {}, 'APROVADA', nada],
      ['COMERCIAL responsável', 'CANCELADA', COMERCIAL, {}, 'APROVADA', nada],
      ['técnico atribuído', 'ABERTA', TECNICO, sem, 'APROVADA', nada],
      ['técnico atribuído', 'EM_ANDAMENTO', TECNICO, {}, 'CANCELADA', nada],
      ['técnico atribuído', 'CONCLUIDA', TECNICO, {}, 'CANCELADA', nada],
      // M2-R4: "Aceitar o trabalho" para o ADMIN com a proposta cancelada e a OS não cancelada
      // FW-R3: com a OS ainda aberta não há trabalho a aceitar (a faixa sugere cancelar a OS)
      ['ADMIN, proposta cancelada', 'ABERTA', ADMIN, {}, 'CANCELADA', { ...nada, editar: true, atribuir: true, cancelar: true }],
      ['ADMIN, proposta cancelada', 'EM_ANDAMENTO', ADMIN, {}, 'CANCELADA', { ...nada, editar: true, atribuir: true, cancelar: true, aceitar: true }],
      ['ADMIN, proposta cancelada', 'CONCLUIDA', ADMIN, {}, 'CANCELADA', { ...nada, reabrir: true, aceitar: true }],
      ['ADMIN, proposta cancelada', 'CANCELADA', ADMIN, {}, 'CANCELADA', nada],
      ['COMERCIAL, proposta cancelada', 'EM_ANDAMENTO', COMERCIAL, {}, 'CANCELADA', { ...nada, editar: true, atribuir: true }],
      // a recusada não tem aceite (o servidor só reabre a cancelada)
      ['ADMIN, proposta recusada', 'EM_ANDAMENTO', ADMIN, {}, 'RECUSADA', { ...nada, editar: true, atribuir: true, cancelar: true }],
      // a avulsa não tem proposta a reabrir
      ['ADMIN, OS avulsa', 'EM_ANDAMENTO', ADMIN, avulsa, 'CANCELADA',
        { ...nada, editar: true, atribuir: true, cancelar: true, responsavel: true }],
      // FW-R4: só o ADMIN troca o responsável, só na avulsa, em ABERTA e EM_ANDAMENTO (a matriz)
      ['ADMIN, OS avulsa', 'ABERTA', ADMIN, avulsa, 'APROVADA', { ...nada, editar: true, atribuir: true, cancelar: true, responsavel: true }],
      ['ADMIN, OS avulsa', 'CONCLUIDA', ADMIN, avulsa, 'APROVADA', { ...nada, reabrir: true }],
      ['ADMIN, OS avulsa', 'CANCELADA', ADMIN, avulsa, 'APROVADA', nada],
      ['COMERCIAL responsável, OS avulsa', 'ABERTA', COMERCIAL, avulsa, 'APROVADA', { ...nada, editar: true, atribuir: true, cancelar: true }],
    ];

    it.each(casos)('%s em %s', async (_quem, status, usuario, extra, propostaStatus, esperado) => {
      const { el } = await montar({ usuario, os: osLocal(status, extra), propostaStatus });
      expect(acoesEscritorio(el)).toEqual(esperado);
    });

    it('a proposta fora do aparelho: sem "Aceitar o trabalho"', async () => {
      const { el } = await montar({ usuario: ADMIN, os: osLocal('EM_ANDAMENTO'), propostaStatus: null });
      expect(botao(el, 'Aceitar o trabalho')).toBeUndefined();
    });

    it('o COMERCIAL não vê a OS de outro comercial', async () => {
      const { el } = await montar({ usuario: OUTRO_COMERCIAL, os: osLocal('ABERTA') });
      expect(texto(el)).toContain('OS não encontrada neste aparelho.');
      expect(texto(el)).not.toContain('Instalar o quadro');
      expect(el.querySelector('[data-testid=acoes-os]')).toBeNull();
    });

    it('M2-R4: a faixa da proposta cancelada, para o escritório', async () => {
      let { el } = await montar({ usuario: ADMIN, os: osLocal('EM_ANDAMENTO'), propostaStatus: 'CANCELADA' });
      expect(el.querySelector('[data-testid=proposta-cancelada]')!.textContent).toContain('A proposta desta OS foi cancelada');
      TestBed.resetTestingModule();
      ({ el } = await montar({ usuario: COMERCIAL, os: osLocal('EM_ANDAMENTO'), propostaStatus: 'CANCELADA' }));
      expect(el.querySelector('[data-testid=proposta-cancelada]')!.textContent).toContain('Só o administrador aceita o trabalho');
      TestBed.resetTestingModule();
      ({ el } = await montar({ usuario: TECNICO, os: osLocal('EM_ANDAMENTO'), propostaStatus: 'CANCELADA' }));
      expect(el.querySelector('[data-testid=proposta-cancelada]')).toBeNull();
    });
  });

  describe('escritório: executar as ações (T4)', () => {
    const botaoEm = (raiz: Element, texto: string) =>
      [...raiz.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === texto)!;

    it('Cancelar OS: o motivo no diálogo, cancelar no repositório, aviso e foco no título', async () => {
      const { fixture, el, repo, toast } = await montar({ usuario: COMERCIAL, os: osLocal('ABERTA') });
      botao(el, 'Cancelar OS')!.click();
      fixture.detectChanges();
      const dialogo = el.querySelector<HTMLElement>('[role=dialog]')!;
      expect(dialogo.textContent).toContain('Cancelar OS');
      digitar(fixture, dialogo.querySelector('textarea')!, 'Cliente desistiu');
      botaoEm(dialogo, 'Cancelar OS').click();
      await vi.waitFor(() => expect(repo.cancelar).toHaveBeenCalledExactlyOnceWith('o1', 'Cliente desistiu'));
      await ate(fixture, () => expect(el.querySelector('[role=dialog]')).toBeNull());
      expect(toast).toHaveBeenCalledWith('OS cancelada.');
      await ate(fixture, () => expect(document.activeElement).toBe(el.querySelector('h1')));
    });

    it('Cancelar OS: motivo curto não confirma; a recusa do repositório fica no toast e o diálogo continua', async () => {
      const { fixture, el, repo, toastErro } = await montar({ usuario: ADMIN, os: osLocal('EM_ANDAMENTO') });
      botao(el, 'Cancelar OS')!.click();
      fixture.detectChanges();
      const dialogo = el.querySelector<HTMLElement>('[role=dialog]')!;
      digitar(fixture, dialogo.querySelector('textarea')!, 'x');
      botaoEm(dialogo, 'Cancelar OS').click();
      expect(repo.cancelar).not.toHaveBeenCalled();
      repo.cancelar.mockRejectedValueOnce(new ErroOs('RESOLVA_A_PENDENCIA', 'os', 'Resolva a pendência desta OS antes de cancelá-la.'));
      digitar(fixture, dialogo.querySelector('textarea')!, 'Cliente desistiu');
      botaoEm(dialogo, 'Cancelar OS').click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('Resolva a pendência desta OS antes de cancelá-la.'));
      fixture.detectChanges();
      expect(el.querySelector('[role=dialog]')).not.toBeNull();
    });

    it('Reabrir (ADMIN): o motivo e reabrir no repositório', async () => {
      const { fixture, el, repo, toast } = await montar({ usuario: ADMIN, os: osLocal('CONCLUIDA') });
      botao(el, 'Reabrir')!.click();
      fixture.detectChanges();
      const dialogo = el.querySelector<HTMLElement>('[role=dialog]')!;
      expect(dialogo.textContent).toContain('nova revisão');
      digitar(fixture, dialogo.querySelector('textarea')!, 'Faltou o aterramento');
      botaoEm(dialogo, 'Reabrir').click();
      await vi.waitFor(() => expect(repo.reabrir).toHaveBeenCalledExactlyOnceWith('o1', 'Faltou o aterramento'));
      await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('OS reaberta.'));
    });

    it('Aceitar o trabalho (M2-R4): pede confirmação e chama aceitarTrabalho', async () => {
      const { fixture, el, repo, toast } = await montar({ usuario: ADMIN, os: osLocal('CONCLUIDA'), propostaStatus: 'CANCELADA' });
      botao(el, 'Aceitar o trabalho')!.click();
      fixture.detectChanges();
      const dialogo = el.querySelector<HTMLElement>('[role=alertdialog]')!;
      expect(dialogo.textContent).toContain('reabre a proposta');
      expect(dialogo.querySelector('textarea')).toBeNull();
      expect(repo.aceitarTrabalho).not.toHaveBeenCalled();
      botaoEm(dialogo, 'Aceitar o trabalho').click();
      await vi.waitFor(() => expect(repo.aceitarTrabalho).toHaveBeenCalledExactlyOnceWith('o1'));
      await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Trabalho aceito. A proposta será reaberta ao sincronizar.'));
    });

    it('Aceitar o trabalho: Voltar não aceita; a recusa local (PROPOSTA_NAO_CANCELADA) vira toast', async () => {
      const { fixture, el, repo, toastErro } = await montar({ usuario: ADMIN, os: osLocal('EM_ANDAMENTO'), propostaStatus: 'CANCELADA' });
      botao(el, 'Aceitar o trabalho')!.click();
      fixture.detectChanges();
      botao(el, 'Voltar')!.click();
      fixture.detectChanges();
      expect(repo.aceitarTrabalho).not.toHaveBeenCalled();
      repo.aceitarTrabalho.mockRejectedValueOnce(new ErroOs('PROPOSTA_NAO_CANCELADA', 'os', ''));
      botao(el, 'Aceitar o trabalho')!.click();
      fixture.detectChanges();
      botaoEm(el.querySelector('[role=alertdialog]')!, 'Aceitar o trabalho').click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('Só há trabalho a aceitar quando a proposta desta OS está cancelada.'));
    });

    it('Excluir OS: confirmação, excluir e volta para a proposta', async () => {
      const { fixture, el, repo, navegar, toast } = await montar({ usuario: COMERCIAL, os: osLocal('ABERTA', { tecnicoId: null }) });
      botao(el, 'Excluir OS')!.click();
      fixture.detectChanges();
      const dialogo = el.querySelector<HTMLElement>('[role=alertdialog]')!;
      expect(dialogo.textContent).toContain('Não dá para desfazer');
      botaoEm(dialogo, 'Excluir').click();
      await vi.waitFor(() => expect(repo.excluir).toHaveBeenCalledExactlyOnceWith('o1'));
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1']));
      expect(toast).toHaveBeenCalledWith('OS excluída.');
    });

    it('Excluir a OS avulsa volta para a lista de OS', async () => {
      const { fixture, el, navegar } = await montar({
        usuario: ADMIN, os: osLocal('ABERTA', { tecnicoId: null, propostaId: null, propostaCodigoExibido: null }),
      });
      botao(el, 'Excluir OS')!.click();
      fixture.detectChanges();
      botaoEm(el.querySelector('[role=alertdialog]')!, 'Excluir').click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/os']));
    });

    it('Excluir OS: OS_SINCRONIZANDO fica no toast, sem navegar', async () => {
      const { fixture, el, repo, navegar, toastErro } = await montar({ usuario: ADMIN, os: osLocal('ABERTA', { tecnicoId: null }) });
      repo.excluir.mockRejectedValueOnce(new ErroOs('OS_SINCRONIZANDO', 'os', 'A OS está sendo sincronizada. Tente de novo em instantes.'));
      botao(el, 'Excluir OS')!.click();
      fixture.detectChanges();
      botaoEm(el.querySelector('[role=alertdialog]')!, 'Excluir').click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('A OS está sendo sincronizada. Tente de novo em instantes.'));
      expect(navegar).not.toHaveBeenCalled();
    });

    it('Atribuir técnico: os técnicos ativos, "Nenhum" na aberta; salvar chama atribuir', async () => {
      const { fixture, el, repo, toast } = await montar({ usuario: COMERCIAL, os: osLocal('ABERTA') });
      botao(el, 'Trocar técnico')!.click();
      fixture.detectChanges();
      const select = el.querySelector<HTMLSelectElement>('#tecnico-atribuir-os')!;
      expect(el.querySelector('label[for=tecnico-atribuir-os]')).not.toBeNull();
      expect([...select.options].map((x) => x.textContent?.trim())).toEqual(['Nenhum', 'Rui Reparo', 'Téo Técnico']);
      expect(select.value).toBe(TECNICO.id);
      select.value = OUTRO_TECNICO.id;
      select.dispatchEvent(new Event('change'));
      botao(el, 'Salvar técnico')!.click();
      await vi.waitFor(() => expect(repo.atribuir).toHaveBeenCalledExactlyOnceWith('o1', { tecnicoId: OUTRO_TECNICO.id }));
      await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Técnico atualizado.'));
      await ate(fixture, () => expect(el.querySelector('#tecnico-atribuir-os')).toBeNull());
    });

    it('Atribuir técnico em andamento: sem "Nenhum" (precisa de técnico); Cancelar fecha sem gravar', async () => {
      const { fixture, el, repo } = await montar({ usuario: ADMIN, os: osLocal('EM_ANDAMENTO') });
      botao(el, 'Trocar técnico')!.click();
      fixture.detectChanges();
      const opcoes = [...el.querySelectorAll<HTMLOptionElement>('#tecnico-atribuir-os option')].map((x) => x.textContent?.trim());
      expect(opcoes).toEqual(['Rui Reparo', 'Téo Técnico']);
      botao(el, 'Cancelar')!.click();
      fixture.detectChanges();
      expect(el.querySelector('#tecnico-atribuir-os')).toBeNull();
      expect(repo.atribuir).not.toHaveBeenCalled();
    });

    it('Atribuir técnico: a recusa do repositório vira toast pelo mensagemErroOs', async () => {
      const { fixture, el, repo, toastErro } = await montar({ usuario: ADMIN, os: osLocal('ABERTA') });
      repo.atribuir.mockRejectedValueOnce(ErroOs.de({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { tecnicoId: 'Técnico inválido: escolha um técnico ativo.' } }));
      botao(el, 'Trocar técnico')!.click();
      fixture.detectChanges();
      const select = el.querySelector<HTMLSelectElement>('#tecnico-atribuir-os')!;
      select.value = OUTRO_TECNICO.id;
      select.dispatchEvent(new Event('change'));
      botao(el, 'Salvar técnico')!.click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('Técnico inválido: escolha um técnico ativo.'));
    });

    it('trava do CONFLITO: atribuir, cancelar, reabrir e aceitar desabilitados com "Resolva a pendência primeiro"; editar e excluir não', async () => {
      let { el } = await montar({ usuario: ADMIN, os: osLocal('ABERTA', { tecnicoId: null }), pendencias: [conflito()], propostaStatus: 'CANCELADA' });
      for (const rotulo of ['Atribuir técnico', 'Cancelar OS']) {
        const b = botao(el, rotulo)!;
        expect(b.disabled, rotulo).toBe(true);
        expect(el.querySelector(`#${b.getAttribute('aria-describedby')}`)!.textContent).toContain('Resolva a pendência primeiro.');
      }
      expect(botao(el, 'Excluir OS')!.disabled).toBe(false);
      expect(el.querySelector('a[href="/os/o1/editar"]')).not.toBeNull();
      TestBed.resetTestingModule();
      ({ el } = await montar({ usuario: ADMIN, os: osLocal('CONCLUIDA'), pendencias: [conflito()], propostaStatus: 'CANCELADA' }));
      for (const rotulo of ['Reabrir', 'Aceitar o trabalho']) {
        const b = botao(el, rotulo)!;
        expect(b.disabled, rotulo).toBe(true);
        expect(el.querySelector(`#${b.getAttribute('aria-describedby')}`)!.textContent).toContain('Resolva a pendência primeiro.');
      }
    });

    it('o resultado de uma ação de outra OS não escreve nesta (a rota trocou de OS no meio)', async () => {
      const { fixture, el, repo, toast } = await montar({ usuario: ADMIN, os: osLocal('CONCLUIDA'), propostaStatus: 'CANCELADA' });
      let liberar!: () => void;
      repo.aceitarTrabalho.mockImplementationOnce(() => new Promise<void>((r) => (liberar = r)));
      botao(el, 'Aceitar o trabalho')!.click();
      fixture.detectChanges();
      botaoEm(el.querySelector('[role=alertdialog]')!, 'Aceitar o trabalho').click();
      await vi.waitFor(() => expect(repo.aceitarTrabalho).toHaveBeenCalled());
      fixture.componentRef.setInput('id', 'o2');
      fixture.detectChanges();
      liberar();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(toast).not.toHaveBeenCalledWith('Trabalho aceito. A proposta será reaberta ao sincronizar.');
    });
  });

  describe('fix round 1 (T4)', () => {
    const botaoEm = (raiz: Element, texto: string) =>
      [...raiz.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === texto)!;

    it('M2: depois do aceite, o botão sai e a faixa diz que a proposta reabre ao sincronizar (sem um segundo aceite)', async () => {
      const { fixture, el, repo } = await montar({ usuario: ADMIN, os: osLocal('CONCLUIDA'), propostaStatus: 'CANCELADA' });
      botao(el, 'Aceitar o trabalho')!.click();
      fixture.detectChanges();
      botaoEm(el.querySelector('[role=alertdialog]')!, 'Aceitar o trabalho').click();
      await vi.waitFor(() => expect(repo.aceitarTrabalho).toHaveBeenCalledTimes(1));
      await ate(fixture, () => expect(botao(el, 'Aceitar o trabalho')).toBeUndefined());
      expect(el.querySelector('[data-testid=proposta-cancelada]')!.textContent).toContain('Trabalho aceito: a proposta reabre ao sincronizar.');
      expect(el.querySelector('[data-testid=proposta-cancelada]')!.textContent).not.toContain('Aceite o trabalho');
    });

    it('N1: salvar o mesmo técnico só fecha o editor, sem gravar nem avisar', async () => {
      const { fixture, el, repo, toast } = await montar({ usuario: ADMIN, os: osLocal('ABERTA') });
      botao(el, 'Trocar técnico')!.click();
      fixture.detectChanges();
      botao(el, 'Salvar técnico')!.click();
      fixture.detectChanges();
      expect(repo.atribuir).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
      expect(el.querySelector('#tecnico-atribuir-os')).toBeNull();
    });

    it('T2 carry: o iniciar de uma OS que termina com outra aberta não avisa nem foca nesta', async () => {
      const { fixture, el, repo, toast } = await montar({ os: osLocal('ABERTA') });
      let liberar!: () => void;
      repo.iniciar.mockImplementationOnce(() => new Promise<void>((r) => (liberar = r)));
      botao(el, 'Iniciar OS')!.click();
      await vi.waitFor(() => expect(repo.iniciar).toHaveBeenCalledWith('o1'));
      fixture.componentRef.setInput('id', 'o2');
      fixture.detectChanges();
      liberar();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(toast).not.toHaveBeenCalled();
      expect(anuncio(el)).toBe('');
    });

    it('T2 carry: a nota de uma OS que termina com outra aberta não apaga o campo nem avisa nesta', async () => {
      const { fixture, el, repo, toast } = await montar();
      let liberar!: (id: string) => void;
      repo.adicionarNota.mockImplementationOnce(() => new Promise<string>((r) => (liberar = r)));
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('textarea[name=nota]')!, 'Da OS antiga');
      botao(el, 'Adicionar')!.click();
      await vi.waitFor(() => expect(repo.adicionarNota).toHaveBeenCalledWith('o1', 'Da OS antiga'));
      fixture.componentRef.setInput('id', 'o2');
      fixture.detectChanges();
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('textarea[name=nota]')!, 'Já da OS nova');
      liberar('n-x');
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector<HTMLTextAreaElement>('textarea[name=nota]')!.value).toBe('Já da OS nova');
      expect(toast).not.toHaveBeenCalled();
    });

    it('T2 carry: "Tirar foto" desabilitado durante o compartilhamento do PDF, com a dica ligada', async () => {
      const { fixture, el, repo } = await montar({ usuario: ADMIN, anexos: [documentoPdf()] });
      let liberar!: (b: Blob) => void;
      repo.blobDoAnexo.mockImplementationOnce(() => new Promise<Blob>((r) => (liberar = r)));
      botao(el, 'Compartilhar')!.click();
      fixture.detectChanges();
      const tirar = botao(el, 'Tirar foto')!;
      expect(tirar.disabled).toBe(true);
      expect(el.querySelector(`#${tirar.getAttribute('aria-describedby')}`)!.textContent).toContain('Aguarde o compartilhamento do PDF');
      liberar(new Blob(['%PDF'], { type: 'application/pdf' }));
      await ate(fixture, () => expect(botao(el, 'Tirar foto')!.disabled).toBe(false));
      expect(botao(el, 'Tirar foto')!.getAttribute('aria-describedby')).toBeNull();
    });

    it('T2 carry: e durante o registro da recusa da assinatura', async () => {
      const { fixture, el, repo } = await montar();
      let liberar!: () => void;
      repo.recusarAssinatura.mockImplementationOnce(() => new Promise<void>((r) => (liberar = r)));
      botao(el, 'Cliente não pôde assinar')!.click();
      fixture.detectChanges();
      const dialogo = el.querySelector<HTMLElement>('[role=dialog]')!;
      digitar(fixture, dialogo.querySelector('textarea')!, 'Cliente ausente');
      botaoEm(dialogo, 'Registrar').click();
      fixture.detectChanges();
      const tirar = botao(el, 'Tirar foto')!;
      expect(tirar.disabled).toBe(true);
      expect(el.querySelector(`#${tirar.getAttribute('aria-describedby')}`)!.textContent).toContain('Aguarde o registro da recusa');
      liberar();
      await ate(fixture, () => expect(botao(el, 'Tirar foto')!.disabled).toBe(false));
    });
  });

  describe('notas do COMERCIAL (T4)', () => {
    it('o COMERCIAL responsável acrescenta nota na OS aberta; o resto continua só leitura', async () => {
      const { fixture, el, repo } = await montar({ usuario: COMERCIAL, os: osLocal('ABERTA') });
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('textarea[name=nota]')!, 'Cliente pediu para ligar antes');
      botao(el, 'Adicionar')!.click();
      await vi.waitFor(() => expect(repo.adicionarNota).toHaveBeenCalledWith('o1', 'Cliente pediu para ligar antes'));
      expect(botao(el, 'Tirar foto')).toBeUndefined();
      expect(botao(el, 'Concluir e gerar PDF')).toBeUndefined();
      expect(botao(el, 'Iniciar OS')).toBeUndefined();
    });

    it('o COMERCIAL não acrescenta nota na OS concluída nem na cancelada', async () => {
      for (const status of ['CONCLUIDA', 'CANCELADA'] as StatusOs[]) {
        TestBed.resetTestingModule();
        const { el } = await montar({ usuario: COMERCIAL, os: osLocal(status) });
        expect(el.querySelector('textarea[name=nota]'), status).toBeNull();
      }
    });
  });

  // ------------------------------------------------------------------ onda final (M2-P3)

  describe('FW-R1: escolher da galeria (Q13: câmera ou galeria)', () => {
    const GALERIA = '[data-testid=input-galeria]';
    const inputGaleria = (el: HTMLElement) => el.querySelector<HTMLInputElement>(GALERIA)!;

    it('um segundo input só de imagem e sem capture (abre a galeria); "Escolher da galeria" abre esse, não a câmera', async () => {
      const { el } = await montar();
      const galeria = inputGaleria(el);
      expect(galeria.type).toBe('file');
      expect(galeria.getAttribute('accept')).toBe('image/*');
      expect(galeria.hasAttribute('capture')).toBe(false);
      expect(galeria.multiple).toBe(false);
      const camera = el.querySelector<HTMLInputElement>('input[type=file][capture]')!;
      const abrirGaleria = vi.spyOn(galeria, 'click').mockImplementation(() => undefined);
      const abrirCamera = vi.spyOn(camera, 'click').mockImplementation(() => undefined);
      const escolher = botao(el, 'Escolher da galeria')!;
      expect(escolher.className).toMatch(/\bh-12\b/);
      escolher.click();
      expect(abrirGaleria).toHaveBeenCalledTimes(1);
      expect(abrirCamera).not.toHaveBeenCalled();
    });

    it('a foto da galeria vai pelo mesmo adicionarFoto, com o momento e a legenda, e anuncia o contador', async () => {
      const { fixture, el, repo } = await montar();
      botao(el, 'Durante')!.click();
      fixture.detectChanges();
      digitar(fixture, el.querySelector<HTMLInputElement>('input[name=legenda]')!, 'Fiação nova');
      const arquivo = foto();
      const input = escolherFoto(fixture, el, arquivo, GALERIA);
      await vi.waitFor(() => expect(repo.adicionarFoto).toHaveBeenCalledWith('o1', arquivo, { legenda: 'Fiação nova', momento: 'DURANTE' }));
      await ate(fixture, () => expect(anuncio(el)).toBe('Foto gravada (1 de 20).'));
      expect(input.value).toBe('');
    });

    it('as mesmas travas: a legenda longa recusa antes de abrir; uma de cada vez; o limite de 20 com a dica', async () => {
      const { fixture, el: tela, repo } = await montar();
      let el = tela;
      const abrir = vi.spyOn(inputGaleria(el), 'click').mockImplementation(() => undefined);
      digitar(fixture, el.querySelector<HTMLInputElement>('input[name=legenda]')!, 'x'.repeat(201));
      botao(el, 'Escolher da galeria')!.click();
      fixture.detectChanges();
      expect(abrir).not.toHaveBeenCalled();
      expect(el.querySelector('[data-testid=erro-foto]')!.textContent).toContain('A legenda tem no máximo 200 caracteres.');
      digitar(fixture, el.querySelector<HTMLInputElement>('input[name=legenda]')!, '');
      let terminar!: (id: string) => void;
      repo.adicionarFoto.mockImplementation(() => new Promise<string>((r) => (terminar = r)));
      escolherFoto(fixture, el, foto(), GALERIA);
      await vi.waitFor(() => expect(repo.adicionarFoto).toHaveBeenCalledTimes(1));
      fixture.detectChanges();
      expect(botao(el, 'Escolher da galeria')!.disabled).toBe(true);
      escolherFoto(fixture, el, foto(), GALERIA);
      escolherFoto(fixture, el, foto());
      expect(repo.adicionarFoto).toHaveBeenCalledTimes(1);
      terminar('f1');
      await ate(fixture, () => expect(botao(el, 'Escolher da galeria')!.disabled).toBe(false));
      TestBed.resetTestingModule();
      ({ el } = await montar({ anexos: Array.from({ length: 20 }, (_, i) => anexo(`f${i}`)) }));
      const escolher = botao(el, 'Escolher da galeria')!;
      expect(escolher.disabled).toBe(true);
      expect(el.querySelector(`#${escolher.getAttribute('aria-describedby')}`)!.textContent).toContain('20 fotos');
    });

    it('durante a geração do PDF: desabilitado com a dica, e a foto que chegar da galeria não é gravada', async () => {
      const { fixture, el, repo } = await montar({ anexos: [assinaturaPendente()] });
      let terminar!: (r: { blob: Blob; codigoExibido: string }) => void;
      repo.concluir.mockImplementation(() => new Promise((r) => (terminar = r)));
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('textarea[name=resumo]')!, 'Feito.');
      botao(el, 'Concluir e gerar PDF')!.click();
      await ate(fixture, () => expect(botao(el, 'Gerando PDF…')).toBeTruthy());
      const escolher = botao(el, 'Escolher da galeria')!;
      expect(escolher.disabled).toBe(true);
      expect(el.querySelector(`#${escolher.getAttribute('aria-describedby')}`)!.textContent).toContain('Aguarde a conclusão');
      const abrir = vi.spyOn(inputGaleria(el), 'click').mockImplementation(() => undefined);
      escolher.disabled = false;
      escolher.click();
      expect(abrir).not.toHaveBeenCalled();
      escolherFoto(fixture, el, foto(), GALERIA);
      expect(repo.adicionarFoto).not.toHaveBeenCalled();
      expect(el.querySelector('[data-testid=erro-foto]')!.textContent).toContain('não foi gravada');
      terminar({ blob: new Blob(['x']), codigoExibido: 'OS-000123' });
      await fixture.whenStable();
    });

    it('o foco sai do botão desabilitado para o título da seção e volta ao "Escolher da galeria" no fim', async () => {
      const { fixture, el, repo } = await montar();
      let terminar!: (id: string) => void;
      repo.adicionarFoto.mockImplementation(() => new Promise<string>((r) => (terminar = r)));
      const escolher = botao(el, 'Escolher da galeria')!;
      escolher.focus();
      escolherFoto(fixture, el, foto(), GALERIA);
      fixture.detectChanges();
      expect(escolher.disabled).toBe(true);
      expect(document.activeElement).toBe(el.querySelector('#fotos-titulo'));
      terminar('f1');
      await ate(fixture, () => expect(document.activeElement).toBe(escolher));
    });
  });

  describe('FW-R2: rascunho do resumo e da nota (sessionStorage)', () => {
    const resumo = (el: HTMLElement) => el.querySelector<HTMLTextAreaElement>('textarea[name=resumo]')!;
    const nota = (el: HTMLElement) => el.querySelector<HTMLTextAreaElement>('textarea[name=nota]')!;

    it('o resumo e a nota digitados voltam quando a OS abre de novo (a página saiu da memória ou o usuário navegou)', async () => {
      const primeira = await montar();
      digitar(primeira.fixture, resumo(primeira.el), 'Quadro trocado e testado');
      digitar(primeira.fixture, nota(primeira.el), 'Falta o disjuntor de 40 A');
      primeira.fixture.destroy();
      TestBed.resetTestingModule();
      const { el } = await montar();
      expect(resumo(el).value).toBe('Quadro trocado e testado');
      expect(nota(el).value).toBe('Falta o disjuntor de 40 A');
    });

    it('o rascunho vale mais que o resumo da conclusão anterior (OS reaberta); apagado de propósito, fica vazio', async () => {
      gravarRascunhoOs(TECNICO.id, 'o1', 'resumo', 'Segunda visita: aterramento feito');
      const { fixture, el: tela } = await montar({ os: osLocal('EM_ANDAMENTO', { revisao: 2, resumoExecucao: 'Primeira visita' }) });
      let el = tela;
      expect(resumo(el).value).toBe('Segunda visita: aterramento feito');
      digitar(fixture, resumo(el), '');
      fixture.destroy();
      TestBed.resetTestingModule();
      ({ el } = await montar({ os: osLocal('EM_ANDAMENTO', { revisao: 2, resumoExecucao: 'Primeira visita' }) }));
      expect(resumo(el).value).toBe('');
    });

    it('por usuário e por OS: o rascunho de um não aparece para outro usuário nem em outra OS', async () => {
      gravarRascunhoOs(TECNICO.id, 'o1', 'nota', 'Do técnico');
      gravarRascunhoOs(TECNICO.id, 'o2', 'nota', 'Da outra OS');
      const { fixture, el } = await montar({ usuario: ADMIN });
      expect(nota(el).value).toBe('');
      fixture.componentRef.setInput('id', 'o2');
      await ate(fixture, () => expect(el.querySelector('[data-testid=carregando]')).toBeNull());
      expect(nota(el).value).toBe('');
      TestBed.resetTestingModule();
      const tecnico = await montar();
      expect(nota(tecnico.el).value).toBe('Do técnico');
      tecnico.fixture.componentRef.setInput('id', 'o2');
      await ate(tecnico.fixture, () => expect(nota(tecnico.el).value).toBe('Da outra OS'));
    });

    it('a nota adicionada sai do rascunho (o resumo fica); a recusa mantém o texto guardado', async () => {
      const { fixture, el, repo } = await montar();
      digitar(fixture, resumo(el), 'Em andamento');
      digitar(fixture, nota(el), 'Primeira');
      repo.adicionarNota.mockRejectedValueOnce(new ErroOs('SEM_ESPACO', 'nota', 'Pouco espaço no aparelho.'));
      botao(el, 'Adicionar')!.click();
      await ate(fixture, () => expect(el.querySelector('[data-testid=erro-nota]')).not.toBeNull());
      expect(lerRascunhoOs(TECNICO.id, 'o1')).toEqual({ resumo: 'Em andamento', nota: 'Primeira' });
      botao(el, 'Adicionar')!.click();
      await ate(fixture, () => expect(anuncio(el)).toBe('Nota adicionada.'));
      expect(lerRascunhoOs(TECNICO.id, 'o1')).toEqual({ resumo: 'Em andamento' });
    });

    it('a OS concluída tira o resumo do rascunho; a recusa do concluir o mantém', async () => {
      comShare();
      const { fixture, el, repo } = await montar({ anexos: [assinaturaPendente()] });
      digitar(fixture, resumo(el), 'Quadro instalado.');
      repo.concluir.mockRejectedValueOnce(new ErroOs('OS_ALTERADA', 'os', 'A OS mudou enquanto o PDF era gerado. Conclua de novo.'));
      botao(el, 'Concluir e gerar PDF')!.click();
      await vi.waitFor(() => expect(repo.concluir).toHaveBeenCalledTimes(1));
      await fixture.whenStable();
      expect(lerRascunhoOs(TECNICO.id, 'o1')).toEqual({ resumo: 'Quadro instalado.' });
      await ate(fixture, () => expect(botao(el, 'Concluir e gerar PDF')!.disabled).toBe(false));
      botao(el, 'Concluir e gerar PDF')!.click();
      await vi.waitFor(() => expect(repo.concluir).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(lerRascunhoOs(TECNICO.id, 'o1')).toEqual({}));
    });

    it('só os dois textos vão para o sessionStorage (nem a legenda, nem o momento, nem dados da OS)', async () => {
      const { fixture, el } = await montar();
      digitar(fixture, resumo(el), 'Resumo');
      digitar(fixture, nota(el), 'Nota');
      digitar(fixture, el.querySelector<HTMLInputElement>('input[name=legenda]')!, 'Legenda');
      botao(el, 'Antes')!.click();
      fixture.detectChanges();
      const chaves = Object.keys(sessionStorage);
      expect(chaves).toHaveLength(1);
      expect(chaves[0]).toContain(TECNICO.id);
      expect(chaves[0]).toContain('o1');
      expect(JSON.parse(sessionStorage.getItem(chaves[0])!)).toEqual({ resumo: 'Resumo', nota: 'Nota' });
      expect(sessionStorage.getItem(chaves[0])).not.toContain(DOCUMENTO_CLIENTE);
    });

    it('a renovação do token (o mesmo usuário de novo no sinal) não apaga o que está sendo digitado', async () => {
      const { fixture, el, usuario } = await montar();
      digitar(fixture, nota(el), 'Digitando');
      usuario.set({ ...TECNICO });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(nota(el).value).toBe('Digitando');
    });
  });

  describe('M2: o foco volta ao botão que se desabilitou', () => {
    const botaoEm = (raiz: Element, rotulo: string) =>
      [...raiz.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === rotulo)!;
    /** O navegador tira o foco do botão que se desabilita (o jsdom não): simulado com um elemento focado que sai. */
    function perderFoco() {
      const temporario = document.body.appendChild(document.createElement('button'));
      temporario.focus();
      temporario.remove();
      expect(document.activeElement).toBe(document.body);
    }
    const concluida = () =>
      osLocal('CONCLUIDA', { resumoExecucao: 'Quadro instalado.', assinaturaAnexoId: 'as1', assinanteNome: 'Maria Souza' });

    it('iniciar: na recusa, o foco volta a "Iniciar OS"', async () => {
      const { fixture, el, repo, toastErro } = await montar({ os: osLocal('ABERTA') });
      let recusar!: (e: unknown) => void;
      repo.iniciar.mockImplementationOnce(() => new Promise<void>((_, rej) => (recusar = rej)));
      const iniciar = botao(el, 'Iniciar OS')!;
      iniciar.focus();
      iniciar.click();
      await ate(fixture, () => expect(botao(el, 'Iniciando…')!.disabled).toBe(true));
      perderFoco();
      recusar(new ErroOs('OS_SINCRONIZANDO', 'os', 'A OS está sendo sincronizada. Tente de novo em instantes.'));
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalled());
      await ate(fixture, () => expect(document.activeElement).toBe(botao(el, 'Iniciar OS')));
    });

    it('"Gerar PDF novamente": na recusa, o foco volta ao botão', async () => {
      const { fixture, el, repo, toastErro } = await montar({ os: concluida(), anexos: [] });
      let recusar!: (e: unknown) => void;
      repo.regerarPdf.mockImplementationOnce(() => new Promise((_, rej) => (recusar = rej)));
      const regerar = botao(el, 'Gerar PDF novamente')!;
      regerar.focus();
      regerar.click();
      await ate(fixture, () => expect(botao(el, 'Gerando PDF…')!.disabled).toBe(true));
      perderFoco();
      recusar(new ErroOs('OS_ALTERADA', 'os', 'A OS mudou enquanto o PDF era gerado.'));
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalled());
      await ate(fixture, () => expect(document.activeElement).toBe(botao(el, 'Gerar PDF novamente')));
    });

    it('"Salvar técnico": na recusa, o foco volta ao botão (o editor continua aberto)', async () => {
      const { fixture, el, repo, toastErro } = await montar({ usuario: ADMIN, os: osLocal('ABERTA') });
      let recusar!: (e: unknown) => void;
      repo.atribuir.mockImplementationOnce(() => new Promise<void>((_, rej) => (recusar = rej)));
      botao(el, 'Trocar técnico')!.click();
      fixture.detectChanges();
      const select = el.querySelector<HTMLSelectElement>('#tecnico-atribuir-os')!;
      select.value = OUTRO_TECNICO.id;
      select.dispatchEvent(new Event('change'));
      const salvar = botao(el, 'Salvar técnico')!;
      salvar.focus();
      salvar.click();
      fixture.detectChanges();
      expect(salvar.disabled).toBe(true);
      perderFoco();
      recusar(new ErroOs('RESOLVA_A_PENDENCIA', 'os', 'Resolva a pendência desta OS antes de atribuí-la.'));
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalled());
      await ate(fixture, () => expect(document.activeElement).toBe(botao(el, 'Salvar técnico')));
    });

    it.each(['ok', 'erro'] as const)('"Compartilhar" do PDF (%s): o foco sempre volta ao botão', async (fim) => {
      const { fixture, el, repo } = await montar({ os: concluida(), anexos: [documentoPdf()] });
      let liberar!: (b: Blob) => void;
      let recusar!: (e: unknown) => void;
      repo.blobDoAnexo.mockImplementationOnce(() => new Promise<Blob>((r, rej) => ((liberar = r), (recusar = rej))));
      const compartilhar = el.querySelector<HTMLButtonElement>('[aria-label="Compartilhar OS-000123"]')!;
      compartilhar.focus();
      compartilhar.click();
      fixture.detectChanges();
      expect(compartilhar.disabled).toBe(true);
      perderFoco();
      if (fim === 'ok') liberar(new Blob(['%PDF'], { type: 'application/pdf' }));
      else recusar(new Error('falhou'));
      await ate(fixture, () => expect(document.activeElement).toBe(el.querySelector('[aria-label="Compartilhar OS-000123"]')));
    });

    it('o foco só volta se tiver se perdido (no body): quem já foi para outro lugar fica lá', async () => {
      const { fixture, el, repo } = await montar({ os: osLocal('ABERTA') });
      let recusar!: (e: unknown) => void;
      repo.iniciar.mockImplementationOnce(() => new Promise<void>((_, rej) => (recusar = rej)));
      botao(el, 'Iniciar OS')!.click();
      fixture.detectChanges();
      const campo = el.querySelector<HTMLTextAreaElement>('textarea[name=nota]')!;
      campo.focus();
      recusar(new ErroOs('OS_SINCRONIZANDO', 'os', 'Tente de novo.'));
      await ate(fixture, () => expect(botao(el, 'Iniciar OS')!.disabled).toBe(false));
      await fixture.whenStable();
      expect(document.activeElement).toBe(campo);
      expect(botaoEm(el, 'Iniciar OS')).toBeTruthy();
    });
  });

  describe('FW-R3: "Aceitar o trabalho" só com trabalho (a OS em andamento ou concluída)', () => {
    it('a OS aberta numa proposta cancelada: sem o aceite; a faixa sugere cancelar a OS se o serviço não vai acontecer', async () => {
      const { el } = await montar({ usuario: ADMIN, os: osLocal('ABERTA'), propostaStatus: 'CANCELADA' });
      expect(botao(el, 'Aceitar o trabalho')).toBeUndefined();
      const faixa = el.querySelector('[data-testid=proposta-cancelada]')!;
      expect(faixa.textContent).toContain('A proposta desta OS foi cancelada.');
      expect(faixa.textContent).toContain('A OS ainda não começou: se o serviço não vai acontecer, cancele a OS.');
      expect(faixa.textContent).not.toContain('Aceite o trabalho');
      expect(botao(el, 'Cancelar OS')).toBeTruthy();
    });

    it('o COMERCIAL responsável, com a OS aberta, também é orientado a cancelar (ele cancela em ABERTA)', async () => {
      const { el } = await montar({ usuario: COMERCIAL, os: osLocal('ABERTA'), propostaStatus: 'CANCELADA' });
      expect(el.querySelector('[data-testid=proposta-cancelada]')!.textContent).toContain('cancele a OS');
    });

    it.each(['EM_ANDAMENTO', 'CONCLUIDA'] as StatusOs[])('em %s o ADMIN aceita o trabalho, como antes', async (status) => {
      const { el } = await montar({ usuario: ADMIN, os: osLocal(status), propostaStatus: 'CANCELADA' });
      expect(botao(el, 'Aceitar o trabalho')).toBeTruthy();
      expect(el.querySelector('[data-testid=proposta-cancelada]')!.textContent).toContain('Aceite o trabalho para reabrir a proposta.');
    });
  });

  describe('FW-R4: "Trocar responsável" na OS avulsa (ADMIN)', () => {
    const avulsa = (status: StatusOs = 'EM_ANDAMENTO', extra: Partial<OsDados> = {}) =>
      osLocal(status, { propostaId: null, propostaNumero: null, propostaCodigoExibido: null, ...extra });
    const opcoes = (el: HTMLElement) => [...el.querySelectorAll<HTMLOptionElement>('#responsavel-os option')].map((x) => x.textContent?.trim());

    it('lista os ADMIN e COMERCIAL ativos (o atual escolhido); salvar chama atribuir só com o responsável', async () => {
      const { fixture, el, repo, toast } = await montar({ usuario: ADMIN, os: avulsa() });
      const trocar = botao(el, 'Trocar responsável')!;
      expect(trocar.className).toMatch(/\bh-12\b/);
      trocar.click();
      fixture.detectChanges();
      const select = el.querySelector<HTMLSelectElement>('#responsavel-os')!;
      expect(el.querySelector('label[for=responsavel-os]')!.textContent).toContain('Responsável da OS');
      await ate(fixture, () => expect(document.activeElement).toBe(select));
      expect(opcoes(el)).toEqual(['Ana Admin', 'Carla Comercial']);
      expect(select.value).toBe(COMERCIAL.id);
      select.value = ADMIN.id;
      select.dispatchEvent(new Event('change'));
      botao(el, 'Salvar responsável')!.click();
      await vi.waitFor(() => expect(repo.atribuir).toHaveBeenCalledExactlyOnceWith('o1', { responsavelId: ADMIN.id }));
      await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Responsável atualizado.'));
      await ate(fixture, () => expect(el.querySelector('#responsavel-os')).toBeNull());
      await ate(fixture, () => expect(document.activeElement).toBe(botao(el, 'Trocar responsável')));
    });

    it('o responsável atual inativo aparece marcado; salvar o mesmo só fecha, sem gravar', async () => {
      const { fixture, el, repo, toast } = await montar({ usuario: ADMIN, os: avulsa('ABERTA', { responsavelId: 'u-com-off' }) });
      botao(el, 'Trocar responsável')!.click();
      fixture.detectChanges();
      expect(opcoes(el)).toEqual(['Ana Admin', 'Carla Comercial', 'Cris Inativa (inativo)']);
      expect(el.querySelector<HTMLSelectElement>('#responsavel-os')!.value).toBe('u-com-off');
      botao(el, 'Salvar responsável')!.click();
      fixture.detectChanges();
      expect(repo.atribuir).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
      expect(el.querySelector('#responsavel-os')).toBeNull();
    });

    it('nunca na OS de proposta: "O responsável segue o da proposta."; nem para o COMERCIAL', async () => {
      let { el } = await montar({ usuario: ADMIN, os: osLocal('EM_ANDAMENTO') });
      expect(botao(el, 'Trocar responsável')).toBeUndefined();
      expect(el.querySelector('[data-testid=responsavel]')!.textContent).toContain('O responsável segue o da proposta.');
      TestBed.resetTestingModule();
      ({ el } = await montar({ usuario: COMERCIAL, os: avulsa() }));
      expect(botao(el, 'Trocar responsável')).toBeUndefined();
    });

    it('trava do CONFLITO: desabilitado com "Resolva a pendência primeiro"', async () => {
      const { el } = await montar({ usuario: ADMIN, os: avulsa(), pendencias: [conflito()] });
      const trocar = botao(el, 'Trocar responsável')!;
      expect(trocar.disabled).toBe(true);
      expect(el.querySelector(`#${trocar.getAttribute('aria-describedby')}`)!.textContent).toContain('Resolva a pendência primeiro.');
    });

    it('a recusa vira toast pelo mensagemErroOs; o editor fica aberto e o foco volta a "Salvar responsável"', async () => {
      const { fixture, el, repo, toastErro } = await montar({ usuario: ADMIN, os: avulsa() });
      repo.atribuir.mockRejectedValueOnce(ErroOs.de({
        codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { responsavelId: 'Responsável inválido: escolha um administrador ou comercial ativo.' },
      }));
      botao(el, 'Trocar responsável')!.click();
      fixture.detectChanges();
      const select = el.querySelector<HTMLSelectElement>('#responsavel-os')!;
      select.value = ADMIN.id;
      select.dispatchEvent(new Event('change'));
      const salvar = botao(el, 'Salvar responsável')!;
      salvar.focus();
      salvar.click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('Responsável inválido: escolha um administrador ou comercial ativo.'));
      await ate(fixture, () => expect(document.activeElement).toBe(botao(el, 'Salvar responsável')));
      expect(el.querySelector('#responsavel-os')).not.toBeNull();
    });

    it('um editor de cada vez: abrir o do responsável fecha o do técnico, e o contrário', async () => {
      const { fixture, el } = await montar({ usuario: ADMIN, os: avulsa() });
      botao(el, 'Trocar técnico')!.click();
      fixture.detectChanges();
      botao(el, 'Trocar responsável')!.click();
      fixture.detectChanges();
      expect(el.querySelector('#tecnico-atribuir-os')).toBeNull();
      expect(el.querySelector('#responsavel-os')).not.toBeNull();
      botao(el, 'Trocar técnico')!.click();
      fixture.detectChanges();
      expect(el.querySelector('#responsavel-os')).toBeNull();
      expect(el.querySelector('#tecnico-atribuir-os')).not.toBeNull();
    });

    it('a troca que termina com outra OS aberta não escreve nesta', async () => {
      const { fixture, el, repo, toast, toastErro } = await montar({ usuario: ADMIN, os: avulsa() });
      let liberar!: () => void;
      repo.atribuir.mockImplementationOnce(() => new Promise<void>((r) => (liberar = r)));
      botao(el, 'Trocar responsável')!.click();
      fixture.detectChanges();
      const select = el.querySelector<HTMLSelectElement>('#responsavel-os')!;
      select.value = ADMIN.id;
      select.dispatchEvent(new Event('change'));
      botao(el, 'Salvar responsável')!.click();
      await vi.waitFor(() => expect(repo.atribuir).toHaveBeenCalled());
      fixture.componentRef.setInput('id', 'o2');
      fixture.detectChanges();
      liberar();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(toast).not.toHaveBeenCalled();
      expect(toastErro).not.toHaveBeenCalled();
    });
  });

  describe('NR3: a ação que termina com outra OS aberta não escreve nesta', () => {
    const concluida = () =>
      osLocal('CONCLUIDA', { resumoExecucao: 'Quadro instalado.', assinaturaAnexoId: 'as1', assinanteNome: 'Maria Souza' });
    type Metodo = 'adicionarFoto' | 'assinar' | 'recusarAssinatura' | 'concluir' | 'regerarPdf' | 'blobDoAnexo';
    const pdfFeito = () => ({ blob: new Blob(['%PDF'], { type: 'application/pdf' }), codigoExibido: 'OS-000123' });
    const casos: [string, () => Opcoes, Metodo, unknown, (m: Montagem) => void][] = [
      ['foto', () => ({}), 'adicionarFoto', 'f1', ({ fixture, el }) => {
        escolherFoto(fixture, el, foto());
      }],
      ['assinar', () => ({}), 'assinar', 'as1', ({ fixture, el }) => {
        vi.spyOn(AssinaturaCanvas.prototype, 'paraPng').mockResolvedValue(PNG);
        botao(el, 'Colher assinatura')!.click();
        fixture.detectChanges();
        const tela = el.querySelector<HTMLElement>('app-assinatura-tela')!;
        tela.querySelector('canvas')!.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), {
          pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, clientX: 10, clientY: 10,
        }));
        fixture.detectChanges();
        digitar(fixture, tela.querySelector<HTMLInputElement>('input[name=nome]')!, 'Maria Souza');
        botao(tela, 'Confirmar')!.click();
      }],
      ['recusar', () => ({}), 'recusarAssinatura', undefined, ({ fixture, el }) => {
        botao(el, 'Cliente não pôde assinar')!.click();
        fixture.detectChanges();
        const dialogo = el.querySelector<HTMLElement>('app-dialogo-motivo')!;
        digitar(fixture, dialogo.querySelector('textarea')!, 'Cliente ausente');
        botao(dialogo, 'Registrar')!.click();
      }],
      ['concluir', () => ({ anexos: [assinaturaPendente()] }), 'concluir', pdfFeito(), ({ fixture, el }) => {
        digitar(fixture, el.querySelector<HTMLTextAreaElement>('textarea[name=resumo]')!, 'Feito.');
        botao(el, 'Concluir e gerar PDF')!.click();
      }],
      ['regerar', () => ({ os: concluida(), anexos: [] }), 'regerarPdf', pdfFeito(), ({ el }) => {
        botao(el, 'Gerar PDF novamente')!.click();
      }],
      ['compartilhar', () => ({ os: concluida(), anexos: [documentoPdf()] }), 'blobDoAnexo', new Blob(['%PDF'], { type: 'application/pdf' }), ({ el }) => {
        el.querySelector<HTMLButtonElement>('[aria-label="Compartilhar OS-000123"]')!.click();
      }],
    ];
    const linhas = casos.flatMap(([nome, opcoes, metodo, valor, disparar]) =>
      (['ok', 'erro'] as const).map((fim) => [nome, fim, opcoes, metodo, valor, disparar] as const));

    it.each(linhas)('%s (%s)', async (_nome, fim, opcoes, metodo, valor, disparar) => {
      const montagem = await montar(opcoes());
      const { fixture, el, repo, toast, toastErro } = montagem;
      let liberar!: (v: unknown) => void;
      let recusar!: (e: unknown) => void;
      (repo[metodo] as unknown as { mockImplementationOnce(f: () => Promise<unknown>): void })
        .mockImplementationOnce(() => new Promise((r, rej) => ((liberar = r), (recusar = rej))));
      disparar(montagem);
      await vi.waitFor(() => expect(repo[metodo]).toHaveBeenCalled());
      fixture.componentRef.setInput('id', 'o2');
      fixture.detectChanges();
      const antes = anuncio(el);
      if (fim === 'ok') liberar(valor);
      else recusar(new ErroOs('SEM_ESPACO', 'os', 'Pouco espaço no aparelho.'));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(toast).not.toHaveBeenCalled();
      expect(toastErro).not.toHaveBeenCalled();
      expect(anuncio(el)).toBe(antes);
      expect(el.querySelector('[data-testid=erro-foto], [data-testid=erro-resumo], [data-testid=erro-assinatura-os]')).toBeNull();
      expect(el.querySelector('app-pdf-pronto, app-assinatura-tela, app-dialogo-motivo')).toBeNull();
      expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    });
  });
});
