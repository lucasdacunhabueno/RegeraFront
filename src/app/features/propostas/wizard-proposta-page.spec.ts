import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, map, of } from 'rxjs';
import { vi } from 'vitest';
import type { UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { alteracoesGuard } from '../../core/navegacao/alteracoes-guard';
import type { EntradaPdf } from '../../core/pdf/pdf-models';
import { PdfService } from '../../core/pdf/pdf-service';
import { PendenciasService } from '../../core/sync/pendencias-service';
import type { Pendencia, UsuarioResumo } from '../../core/sync/sync-models';
import { Toasts } from '../../shared/ui/toasts';
import { CatalogoRepo } from '../catalogo/catalogo-repo';
import { ItemCatalogoDados, ItemLocal, paraItemLocal } from '../catalogo/item-models';
import { ClienteLocal, paraClienteLocal } from '../clientes/cliente-models';
import { ClientesRepo } from '../clientes/clientes-repo';
import { paraTemplateLocal, TemplateLocal, TipoProposta } from '../templates/template-models';
import { TemplatesRepo } from '../templates/templates-repo';
import casosTexto from './casos-calculo.json' with { loader: 'text' };
import { codigoExibido, ItemPropostaLocal, PropostaLocal } from './proposta-models';
import { EdicaoRascunho, ErroProposta, PropostasRepo } from './propostas-repo';
import { WizardPropostaPage } from './wizard-proposta-page';

const ADMIN: UsuarioSessao = { id: 'u-adm', nome: 'Ana Admin', email: 'ana@regera.com', perfil: 'ADMIN', ativo: true };
const COMERCIAL: UsuarioSessao = { id: 'u-com', nome: 'Carla Comercial', email: 'carla@regera.com', perfil: 'COMERCIAL', ativo: true };

const USUARIOS: UsuarioResumo[] = [
  { id: ADMIN.id, nome: ADMIN.nome, perfil: 'ADMIN' },
  { id: COMERCIAL.id, nome: COMERCIAL.nome, perfil: 'COMERCIAL' },
  { id: 'u-com2', nome: 'Caio Comercial', perfil: 'COMERCIAL' },
  { id: 'u-tec', nome: 'Téo Técnico', perfil: 'TECNICO' },
  { id: 'u-tec-off', nome: 'Tito Inativo', perfil: 'TECNICO', ativo: false },
];

const cliente = (id: string, nome: string, documento: string, telefone: string | null = null): ClienteLocal =>
  paraClienteLocal(id, 1, {
    tipo: documento.length === 14 ? 'PJ' : 'PF', documento, nome, nomeFantasia: null, inscricaoEstadual: null,
    inscricaoMunicipal: null, email: null, telefone, whatsapp: null, contatoNome: null, observacoes: null, enderecos: [],
  });
const CLIENTES = [cliente('c1', 'Padaria São João', '11444777000161', '11988887777'), cliente('c2', 'Maria Souza', '52998224725')];

const item = (id: string, d: Partial<ItemCatalogoDados>): ItemLocal =>
  paraItemLocal(id, 1, {
    natureza: 'PRODUTO', codigo: id.toUpperCase(), nome: id, descricao: null, unidade: 'un', locavel: false,
    fotoArquivoId: null, ativo: true, ...d,
  });
const ITENS: ItemLocal[] = [
  item('i1', { codigo: 'PNL-550', nome: 'Painel Solar', precoVenda: 1234.56, precoCusto: 800 }),
  item('i2', { codigo: 'GER-10', nome: 'Gerador', precoVenda: 5000, locavel: true, precoLocacaoMensal: 300 }),
  item('i3', { codigo: 'PNL-OLD', nome: 'Painel antigo', precoVenda: 10, ativo: false }),
];

const template = (id: string, nome: string, tipoProposta: TipoProposta, ativo = true): TemplateLocal =>
  paraTemplateLocal(id, 1, { nome, tipoProposta, padrao: false, ativo, blocos: [] });
const TEMPLATES = [
  template('t-venda', 'Venda padrão', 'VENDA'),
  template('t-venda2', 'Venda simples', 'VENDA'),
  template('t-velho', 'Venda antiga', 'VENDA', false),
  template('t-loc', 'Locação', 'LOCACAO'),
];
const PADROES = new Map<TipoProposta, string>([['VENDA', 't-venda'], ['LOCACAO', 't-loc']]);

function linha(id: string, l: Partial<ItemPropostaLocal> = {}): ItemPropostaLocal {
  return {
    id, itemCatalogoId: 'i1', codigo: 'PNL-550', nome: 'Painel Solar', descricao: null, unidade: 'un', natureza: 'PRODUTO',
    precoCustoCentavos: null, quantidadeMilesimos: 1000, precoUnitarioCentavos: 123456, descontoCentesimos: 0, meses: null,
    subtotalCentavos: null, ordem: 0, ...l,
  };
}

function proposta(p: Partial<PropostaLocal> = {}): PropostaLocal {
  return {
    id: 'p1', version: 1, codigoProvisorio: 'PROV-ABC123', numero: null, revisao: 1, tipo: 'VENDA', status: 'RASCUNHO',
    clienteId: 'c1', templateId: 't-venda', responsavelId: COMERCIAL.id, tecnicoId: null, dataEmissao: '2026-10-01',
    validadeAte: '2026-10-16', condicoesPagamento: '50% na assinatura', prazoExecucao: null, observacoes: null,
    descontoGeralCentesimos: 0, totalItensCentavos: 0, totalDescontosCentavos: 0, totalCentavos: 0, motivoEncerramento: null,
    itens: [linha('l1')], historico: [], documentos: [], atualizadoEm: null, ...p,
  };
}

/** Repositório em memória com o mesmo contrato (o que a tela vê do `PropostasRepo`). */
function repoFalso(iniciais: PropostaLocal[]) {
  const store = new Map(iniciais.map((p) => [p.id, structuredClone(p)]));
  const ler = (id: string) => store.get(id)!;
  /** Como o liveQuery: cada escrita reemite a proposta (depois, não no meio da escrita). */
  const vivas = new Map<string, BehaviorSubject<PropostaLocal | undefined>>();
  const viva = (id: string) => {
    if (!vivas.has(id)) vivas.set(id, new BehaviorSubject(store.has(id) ? structuredClone(store.get(id)) : undefined));
    return vivas.get(id)!;
  };
  const emitir = (id: string) => queueMicrotask(() => viva(id).next(store.has(id) ? structuredClone(store.get(id)) : undefined));
  const documentos: { propostaId: string; codigoExibido: string }[] = [];
  /** P4c-R4: a recusa corrigível de cada proposta (`recusaCorrigivel`). */
  const recusas = new Map<string, Pendencia>();
  return {
    store,
    recusas,
    recusaCorrigivel: vi.fn(async (id: string) => recusas.get(id)),
    conferirAtribuicao: vi.fn<(id: string, m: { responsavelId?: string }) => Promise<void>>(async () => undefined),
    /** Como `corrigirPendencia`: a edição entra na cópia local (o status otimista fica) e a recusa sai. */
    corrigir(pendenciaId: string, edicao: Partial<EdicaoRascunho>) {
      const [id] = [...recusas].find(([, x]) => x.mutationId === pendenciaId) ?? [];
      if (!id) throw new ErroProposta('PENDENCIA_INEXISTENTE', 'proposta', 'Esta pendência já foi resolvida.');
      recusas.delete(id);
      const p = ler(id);
      const { itens, ...resto } = edicao;
      Object.assign(p, resto);
      if (itens) p.itens = itens.map((l, i) => ({ ...l, ordem: i, subtotalCentavos: null }));
      emitir(id);
    },
    /** Edição que chega pelo pull (outro aparelho): muda o gravado, sobe a versão e reemite. */
    foraDoAparelho(id: string, mudar: (p: PropostaLocal) => void, opcoes: { emitir?: boolean; versao?: boolean } = {}) {
      const p = ler(id);
      mudar(p);
      if (opcoes.versao !== false) p.version = (p.version ?? 0) + 1;
      if (opcoes.emitir !== false) emitir(id);
    },
    observarProposta: vi.fn((id: string) => viva(id).asObservable()),
    observarDocumentos: vi.fn((id: string) =>
      of(documentos.filter((d) => d.propostaId === id).reverse()).pipe(map((l) => l.map((d) => ({ ...d })))),
    ),
    buscar: vi.fn(async (id: string) => (store.has(id) ? structuredClone(store.get(id)) : undefined)),
    criar: vi.fn(async (tipo: TipoProposta, clienteId?: string | null) => {
      store.set('nova-1', proposta({ id: 'nova-1', tipo, clienteId: clienteId ?? null, templateId: PADROES.get(tipo) ?? null, itens: [] }));
      return 'nova-1';
    }),
    salvarRascunho: vi.fn(async (id: string, edicao: Partial<EdicaoRascunho>, versaoCarregada?: number | null) => {
      const p = ler(id);
      const { itens, ...resto } = edicao;
      Object.assign(p, resto);
      for (const k of ['condicoesPagamento', 'prazoExecucao', 'observacoes'] as const) {
        if (k in edicao) p[k] = edicao[k]?.trim() || null;
      }
      if (itens) p.itens = itens.map((l, i) => ({ ...l, ordem: i, subtotalCentavos: null }));
      // como o repositório: a versão carregada vira a da cópia local (e a baseVersion da mutação)
      if (versaoCarregada !== undefined) p.version = versaoCarregada;
      emitir(id);
    }),
    atribuir: vi.fn(async (id: string, m: { responsavelId?: string; tecnicoId?: string | null }, versaoCarregada?: number | null) => {
      Object.assign(ler(id), m);
      if (versaoCarregada !== undefined) ler(id).version = versaoCarregada;
      emitir(id);
    }),
    adicionarItem: vi.fn(async (id: string, i: ItemLocal) => {
      const p = ler(id);
      const mensal = p.tipo === 'LOCACAO' && i.locavel;
      const nova = linha(`l-${i.id}`, {
        itemCatalogoId: i.id, codigo: i.codigo, nome: i.nome, precoCustoCentavos: i.precoCusto == null ? null : Math.round(i.precoCusto * 100),
        precoUnitarioCentavos: Math.round(((mensal ? i.precoLocacaoMensal : i.precoVenda) ?? 0) * 100), meses: mensal ? 1 : null,
      });
      p.itens.push(nova);
      emitir(id);
      return nova.id;
    }),
    enviar: vi.fn(async (id: string, gerar: (e: EntradaPdf) => Promise<Blob>) => {
      const blob = await gerar({ previa: false } as EntradaPdf);
      const p = ler(id);
      p.status = 'ENVIADA';
      documentos.push({ propostaId: id, codigoExibido: codigoExibido(p) });
      emitir(id);
      return blob;
    }),
    entradaPrevia: vi.fn(async () => ({ previa: true }) as EntradaPdf),
    observarUsuarios: () => of(USUARIOS),
  };
}

interface Opcoes {
  usuario?: UsuarioSessao;
  /** `data.modo` da rota (P4c-R4); padrão `rascunho`. */
  modo?: string;
  /** A recusa corrigível da proposta (modo `corrigir`). */
  recusa?: Pendencia;
  id?: string;
  passo?: string;
  tipo?: string;
  clienteId?: string;
  propostas?: PropostaLocal[];
  online?: boolean;
}

async function montar(o: Opcoes = {}) {
  const repo = repoFalso(o.propostas ?? [proposta()]);
  if (o.recusa) repo.recusas.set(o.recusa.agregadoId, o.recusa);
  const pendencias = {
    corrigirProposta: vi.fn(async (pendenciaId: string, edicao: Partial<EdicaoRascunho>) => repo.corrigir(pendenciaId, edicao)),
  };
  const blob = new Blob(['%PDF'], { type: 'application/pdf' });
  const pdf = { gerarBlob: vi.fn().mockResolvedValue(blob), logoDataUrl: vi.fn().mockResolvedValue(null) };
  TestBed.configureTestingModule({
    providers: [
      { provide: PendenciasService, useValue: pendencias },
      provideRouter([]),
      { provide: AuthService, useValue: { usuario: signal(o.usuario ?? COMERCIAL) } },
      { provide: PropostasRepo, useValue: repo },
      { provide: ClientesRepo, useValue: { observarTodos: () => of(CLIENTES) } },
      { provide: CatalogoRepo, useValue: { observarTodos: () => of(ITENS) } },
      { provide: TemplatesRepo, useValue: { observarTodos: () => of(TEMPLATES), observarPadroesEfetivos: () => of(PADROES) } },
      { provide: PdfService, useValue: pdf },
      { provide: ConectividadeService, useValue: { online: signal(o.online ?? false) } },
    ],
  });
  const router = TestBed.inject(Router);
  const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const toast = vi.spyOn(TestBed.inject(Toasts), 'mostrar');
  const toastErro = vi.spyOn(TestBed.inject(Toasts), 'erro');
  const fixture = TestBed.createComponent(WizardPropostaPage);
  fixture.componentRef.setInput('modo', o.modo ?? 'rascunho');
  for (const k of ['id', 'passo', 'tipo', 'clienteId'] as const) if (o[k] !== undefined) fixture.componentRef.setInput(k, o[k]);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  await ate(fixture, () => expect(el.querySelector('#titulo-passo')).not.toBeNull());
  return { fixture, el, repo, pdf, blob, navegar, toast, toastErro, pendencias, pagina: fixture.componentInstance };
}

async function ate(fixture: ComponentFixture<unknown>, verificar: () => void) {
  await vi.waitFor(() => {
    fixture.detectChanges();
    verificar();
  });
}

const botao = (el: HTMLElement, texto: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);
const titulo = (el: HTMLElement) => el.querySelector('#titulo-passo')?.textContent?.trim();

function digitar(fixture: ComponentFixture<unknown>, campo: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function escolher(fixture: ComponentFixture<unknown>, select: HTMLSelectElement, valor: string) {
  select.value = valor;
  select.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

const campoDaLinha = (el: HTMLElement, linhaId: string, campo: string) =>
  el.querySelector<HTMLInputElement>(`li[data-linha-id="${linhaId}"] input[data-campo=${campo}]`);

describe('WizardPropostaPage', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('nova proposta (/propostas/nova)', () => {
    it('barra de progresso no passo 1; sem cliente não avança e não cria nada', async () => {
      const { fixture, el, repo, navegar } = await montar();
      expect(el.querySelector('h1')?.textContent).toContain('Nova proposta');
      expect(el.textContent).toContain('Passo 1 de 4: Tipo e cliente');
      expect(el.querySelectorAll('nav ol li').length).toBe(4);
      expect(el.querySelector('nav li[aria-current=step]')?.textContent).toContain('Tipo e cliente');
      expect(botao(el, 'Voltar')).toBeUndefined();

      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(el.querySelector('#cliente-erro')?.textContent).toContain('Escolha o cliente.'));
      expect(repo.criar).not.toHaveBeenCalled();
      expect(navegar).not.toHaveBeenCalled();
    });

    it('busca local de clientes por nome, documento ou telefone', async () => {
      const { fixture, el } = await montar();
      const busca = el.querySelector<HTMLInputElement>('#busca-cliente')!;
      const nomes = () => [...el.querySelectorAll('[data-testid=escolher-cliente]')].map((b) => b.querySelector('span')!.textContent!.trim());
      expect(nomes()).toEqual(['Padaria São João', 'Maria Souza']);
      digitar(fixture, busca, 'sao joao');
      expect(nomes()).toEqual(['Padaria São João']);
      digitar(fixture, busca, '529.982');
      expect(nomes()).toEqual(['Maria Souza']);
      digitar(fixture, busca, '98888');
      expect(nomes()).toEqual(['Padaria São João']);
      digitar(fixture, busca, 'ninguém');
      expect(el.textContent).toContain('Nenhum cliente encontrado.');
    });

    it('o rascunho só é criado ao sair do passo 1, com o tipo e o cliente; a URL vira /:id/editar?passo=2', async () => {
      const { fixture, el, repo, navegar, pagina } = await montar();
      escolher(fixture, el.querySelector<HTMLSelectElement>('#tipo-proposta')!, 'LOCACAO');
      el.querySelector<HTMLButtonElement>('[data-testid=escolher-cliente]')!.click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid=cliente-selecionado]')?.textContent).toContain('Padaria São João');
      // escolher não cria: só o Continuar
      expect(repo.criar).not.toHaveBeenCalled();
      expect(pagina.temAlteracoes()).toBe(true);

      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalled());
      expect(repo.criar).toHaveBeenCalledWith('LOCACAO', 'c1');
      expect(navegar).toHaveBeenCalledWith(['/propostas', 'nova-1', 'editar'], { queryParams: { passo: 2 }, replaceUrl: true });
      expect(pagina.temAlteracoes()).toBe(false);
    });

    it('"Salvar rascunho" no passo 1 cria e vai ao detalhe', async () => {
      const { fixture, el, repo, navegar, toast } = await montar();
      el.querySelector<HTMLButtonElement>('[data-testid=escolher-cliente]')!.click();
      fixture.detectChanges();
      el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'nova-1']));
      expect(repo.criar).toHaveBeenCalledWith('VENDA', 'c1');
      expect(toast).toHaveBeenCalledWith('Rascunho salvo.');
    });

    it('"Cadastrar cliente" leva ao formulário com voltar e não pergunta nada ao sair', async () => {
      const { fixture, el, navegar, pagina } = await montar();
      escolher(fixture, el.querySelector<HTMLSelectElement>('#tipo-proposta')!, 'LOCACAO');
      const confirmar = vi.spyOn(window, 'confirm');
      el.querySelector<HTMLButtonElement>('[data-testid=cadastrar-cliente]')!.click();
      expect(navegar).toHaveBeenCalledWith(['/clientes/novo'], { queryParams: { voltar: '/propostas/nova?tipo=LOCACAO' } });
      // o guard roda durante essa navegação: o passo 1 vai na URL de volta
      expect(alteracoesGuard(pagina, null!, null!, null!)).toBe(true);
      expect(confirmar).not.toHaveBeenCalled();
    });

    it('a volta do cadastro (?tipo=&clienteId=) já vem com o cliente novo escolhido', async () => {
      const { el, repo, navegar } = await montar({ tipo: 'LOCACAO', clienteId: 'c2' });
      expect(el.querySelector('[data-testid=cliente-selecionado]')?.textContent).toContain('Maria Souza');
      expect(el.querySelector<HTMLSelectElement>('#tipo-proposta')!.value).toBe('LOCACAO');
      expect(repo.criar).not.toHaveBeenCalled();
      expect(navegar).toHaveBeenCalledWith([], expect.objectContaining({
        queryParams: { tipo: null, clienteId: null }, queryParamsHandling: 'merge', replaceUrl: true,
      }));
    });
  });

  describe('itens (passo 2)', () => {
    it('quantidade "1,5" e preço "1.234,56" dão o subtotal R$ 1.851,84; "1.234" na quantidade é ambíguo', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '2' });
      expect(titulo(el)).toBe('Itens');
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '1,5');
      digitar(fixture, campoDaLinha(el, 'l1', 'preco')!, '1.234,56');
      expect(el.querySelector('[data-testid=subtotal]')?.textContent).toBe('R$ 1.851,84');
      expect(el.querySelector('[data-testid=total-itens]')?.textContent).toBe('R$ 1.851,84');

      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '1.234');
      const qtd = campoDaLinha(el, 'l1', 'quantidade')!;
      expect(qtd.getAttribute('aria-invalid')).toBe('true');
      expect(el.querySelector(`#${qtd.getAttribute('aria-describedby')}`)?.textContent).toBe('Use vírgula para decimais (ex.: 1,5).');
      expect(el.querySelector('[data-testid=subtotal]')?.textContent).toBe('—');

      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await fixture.whenStable();
      expect(repo.salvarRascunho).not.toHaveBeenCalled();
      expect(titulo(el)).toBe('Itens');
    });

    it('mensagens de digitação do Global Constraints nos outros campos', async () => {
      const { fixture, el } = await montar({ id: 'p1', passo: '2' });
      const erro = (campo: string) => {
        const input = campoDaLinha(el, 'l1', campo)!;
        return el.querySelector(`#${input.getAttribute('aria-describedby')}`)?.textContent;
      };
      digitar(fixture, campoDaLinha(el, 'l1', 'preco')!, '');
      expect(erro('preco')).toBe('Informe o valor.');
      digitar(fixture, campoDaLinha(el, 'l1', 'preco')!, '-3');
      expect(erro('preco')).toBe('Não pode ser negativo.');
      digitar(fixture, campoDaLinha(el, 'l1', 'preco')!, '1,234');
      expect(erro('preco')).toBe('Até 2 casas decimais.');
      digitar(fixture, campoDaLinha(el, 'l1', 'desconto')!, '12a');
      expect(erro('desconto')).toBe('Valor inválido.');
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '1,2345');
      expect(erro('quantidade')).toBe('Até 3 casas decimais.');
    });

    it('Continuar grava as linhas com salvarRascunho e vai às condições, com o template padrão', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '2', propostas: [proposta({ templateId: null })] });
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '2');
      digitar(fixture, campoDaLinha(el, 'l1', 'desconto')!, '10');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Condições'));
      expect(repo.salvarRascunho).toHaveBeenCalledTimes(1);
      const [id, edicao] = repo.salvarRascunho.mock.calls[0];
      expect(id).toBe('p1');
      expect(edicao.itens).toEqual([expect.objectContaining({ id: 'l1', quantidadeMilesimos: 2000, precoUnitarioCentavos: 123456, descontoCentesimos: 1000, meses: null })]);
      expect(el.querySelector<HTMLSelectElement>('#template')!.value).toBe('t-venda');
      // só os ativos do tipo
      expect([...el.querySelectorAll('#template option')].map((o) => o.textContent?.trim())).toEqual(['Selecione', 'Venda padrão (padrão)', 'Venda simples']);
    });

    it('Continuar sem alteração não grava; Voltar não grava', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '2' });
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Condições'));
      botao(el, 'Voltar')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Itens'));
      expect(repo.salvarRascunho).not.toHaveBeenCalled();
    });

    it('sem itens não avança', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '2', propostas: [proposta({ itens: [] })] });
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(el.querySelector('#itens-erro')?.textContent).toContain('Inclua pelo menos um item.'));
      expect(repo.salvarRascunho).not.toHaveBeenCalled();
      expect(el.querySelector('#itens-erro')!.getAttribute('tabindex')).toBe('-1');
      await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('#itens-erro')));
    });

    it('busca no catálogo ativo e "Adicionar" chama adicionarItem; a linha nova entra com o foco', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '2' });
      digitar(fixture, el.querySelector<HTMLInputElement>('#busca-catalogo')!, 'pnl');
      const botoes = [...el.querySelectorAll<HTMLButtonElement>('[data-testid=adicionar-item]')];
      // o inativo (PNL-OLD) não aparece
      expect(botoes.map((b) => b.getAttribute('aria-label'))).toEqual(['Adicionar Painel Solar']);
      digitar(fixture, el.querySelector<HTMLInputElement>('#busca-catalogo')!, 'ger');
      el.querySelector<HTMLButtonElement>('[data-testid=adicionar-item]')!.click();
      await ate(fixture, () => expect(campoDaLinha(el, 'l-i2', 'quantidade')).not.toBeNull());
      expect(repo.adicionarItem).toHaveBeenCalledWith('p1', ITENS[1]);
      await vi.waitFor(() => expect(document.activeElement).toBe(campoDaLinha(el, 'l-i2', 'quantidade')));
      // a busca fecha (u1)
      expect(el.querySelector<HTMLInputElement>('#busca-catalogo')!.value).toBe('');
      expect(el.querySelector('[data-testid=adicionar-item]')).toBeNull();
      expect(el.querySelector('[role=status]')?.textContent).toContain('Gerador adicionado.');
    });

    it('editar, adicionar e continuar: as linhas da tela (a editada e a nova) vão juntas', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '2' });
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '3');
      digitar(fixture, el.querySelector<HTMLInputElement>('#busca-catalogo')!, 'ger');
      el.querySelector<HTMLButtonElement>('[data-testid=adicionar-item]')!.click();
      await ate(fixture, () => expect(campoDaLinha(el, 'l-i2', 'quantidade')).not.toBeNull());
      expect(campoDaLinha(el, 'l1', 'quantidade')!.value).toBe('3');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Condições'));
      expect(repo.salvarRascunho.mock.calls[0][1].itens!.map((l) => [l.id, l.quantidadeMilesimos])).toEqual([['l1', 3000], ['l-i2', 1000]]);
    });

    it('↑, ↓ e remover mudam a lista da tela (gravada no Continuar)', async () => {
      const p = proposta({ itens: [linha('l1'), linha('l2', { nome: 'Inversor', itemCatalogoId: 'i9' })] });
      const { fixture, el, repo, pagina } = await montar({ id: 'p1', passo: '2', propostas: [p] });
      const ordem = () => [...el.querySelectorAll('li[data-linha-id]')].map((li) => li.getAttribute('data-linha-id'));
      // alvos de 48 px (Global Constraints)
      for (const b of el.querySelectorAll('li[data-linha-id=l1] button[data-acao]')) expect(b.classList).toContain('size-12');
      expect(campoDaLinha(el, 'l1', 'quantidade')!.classList).toContain('h-12');
      el.querySelector<HTMLButtonElement>('li[data-linha-id=l1] button[data-acao=descer]')!.click();
      fixture.detectChanges();
      expect(ordem()).toEqual(['l2', 'l1']);
      expect(pagina.temAlteracoes()).toBe(true);
      el.querySelector<HTMLButtonElement>('li[data-linha-id=l2] button[data-acao=remover]')!.click();
      fixture.detectChanges();
      expect(ordem()).toEqual(['l1']);
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Condições'));
      expect(repo.salvarRascunho.mock.calls[0][1].itens!.map((l) => l.id)).toEqual(['l1']);
    });

    it('LOCACAO mostra o campo meses só no item locável', async () => {
      const p = proposta({
        tipo: 'LOCACAO',
        templateId: 't-loc',
        itens: [linha('l1'), linha('l2', { itemCatalogoId: 'i2', nome: 'Gerador', precoUnitarioCentavos: 30000, meses: 3 })],
      });
      const { fixture, el } = await montar({ id: 'p1', passo: '2', propostas: [p] });
      expect(campoDaLinha(el, 'l1', 'meses')).toBeNull();
      expect(campoDaLinha(el, 'l2', 'meses')!.value).toBe('3');
      expect(el.querySelectorAll('li[data-linha-id=l2] [data-testid=subtotal]')[0].textContent).toBe('R$ 900,00');
      digitar(fixture, campoDaLinha(el, 'l2', 'meses')!, '121');
      const meses = campoDaLinha(el, 'l2', 'meses')!;
      expect(el.querySelector(`#${meses.getAttribute('aria-describedby')}`)?.textContent).toBe('De 1 a 120 meses.');
    });

    it('fora de LOCACAO, nem o item locável tem meses', async () => {
      const p = proposta({ itens: [linha('l2', { itemCatalogoId: 'i2', nome: 'Gerador' })] });
      const { el } = await montar({ id: 'p1', passo: '2', propostas: [p] });
      expect(campoDaLinha(el, 'l2', 'meses')).toBeNull();
    });

    it('o comercial não vê o custo; o admin vê o custo e a margem da linha', async () => {
      const p = proposta({ itens: [linha('l1', { precoCustoCentavos: 80000 })] });
      const comercial = await montar({ id: 'p1', passo: '2', propostas: [p] });
      expect(comercial.el.querySelector('[data-testid=custo]')).toBeNull();
      expect(comercial.el.textContent).not.toContain('Custo');
      expect(comercial.el.textContent).not.toContain('Margem');
      TestBed.resetTestingModule();

      const admin = await montar({ id: 'p1', passo: '2', propostas: [p], usuario: ADMIN });
      expect(admin.el.querySelector('[data-testid=custo]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Custo: R$ 800,00 · Margem: 35,2%');
    });

    it('a recusa do repositório na linha aparece no campo', async () => {
      const { fixture, el, repo, toastErro } = await montar({ id: 'p1', passo: '2' });
      repo.salvarRascunho.mockRejectedValueOnce(
        new ErroProposta('VALIDACAO', 'itens[0].quantidade', 'A quantidade vai de 0,001 a 999.999,999.', {
          'itens[0].quantidade': 'A quantidade vai de 0,001 a 999.999,999.',
        }),
      );
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '2');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(campoDaLinha(el, 'l1', 'quantidade')!.getAttribute('aria-invalid')).toBe('true'));
      expect(toastErro).toHaveBeenCalledWith('A quantidade vai de 0,001 a 999.999,999.');
      expect(titulo(el)).toBe('Itens');
      await vi.waitFor(() => expect(document.activeElement).toBe(campoDaLinha(el, 'l1', 'quantidade')));
    });
  });

  describe('condições (passo 3)', () => {
    it('grava template, validade, textos, desconto geral e técnico; só técnicos ativos', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '3' });
      expect([...el.querySelectorAll('#tecnico option')].map((o) => o.textContent?.trim())).toEqual(['Nenhum', 'Téo Técnico']);
      expect(el.querySelector('#responsavel')).toBeNull();
      escolher(fixture, el.querySelector<HTMLSelectElement>('#template')!, 't-venda2');
      digitar(fixture, el.querySelector<HTMLInputElement>('#validade')!, '2026-11-30');
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('#condicoes-pagamento')!, '  À vista  ');
      digitar(fixture, el.querySelector<HTMLInputElement>('#prazo-execucao')!, '30 dias');
      digitar(fixture, el.querySelector<HTMLInputElement>('#desconto-geral')!, '12,5');
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('#observacoes')!, 'Obs.');
      escolher(fixture, el.querySelector<HTMLSelectElement>('#tecnico')!, 'u-tec');
      expect(el.querySelector('[data-testid=total-condicoes]')?.textContent).toBe('R$ 1.080,24');

      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Revisão'));
      expect(repo.salvarRascunho).toHaveBeenCalledWith('p1', {
        templateId: 't-venda2', validadeAte: '2026-11-30', condicoesPagamento: '  À vista  ', prazoExecucao: '30 dias',
        observacoes: 'Obs.', descontoGeralCentesimos: 1250, tecnicoId: 'u-tec',
      }, 1);
      expect(repo.atribuir).not.toHaveBeenCalled();
    });

    it('desconto geral inválido barra; sem template não avança', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '3', propostas: [proposta({ templateId: null, tipo: 'MANUTENCAO' })] });
      digitar(fixture, el.querySelector<HTMLInputElement>('#desconto-geral')!, '100,5');
      expect(el.querySelector('#desconto-geral-erro')?.textContent).toBe('O desconto vai de 0 a 100%.');
      digitar(fixture, el.querySelector<HTMLInputElement>('#desconto-geral')!, '5');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(el.querySelector('#template-erro')?.textContent).toBe('Escolha o template.'));
      expect(el.textContent).toContain('Nenhum template ativo para este tipo neste aparelho.');
      expect(repo.salvarRascunho).not.toHaveBeenCalled();
    });

    it('template gravado que foi desativado continua visível no select, marcado como inativo', async () => {
      const { el } = await montar({ id: 'p1', passo: '3', propostas: [proposta({ templateId: 't-velho' })] });
      const select = el.querySelector<HTMLSelectElement>('#template')!;
      expect(select.value).toBe('t-velho');
      expect(select.selectedOptions[0].textContent?.trim()).toBe('Venda antiga (inativo)');
    });

    it('o ADMIN troca o responsável (por atribuir)', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '3', usuario: ADMIN });
      expect([...el.querySelectorAll('#responsavel option')].map((o) => o.textContent?.trim())).toEqual(['Ana Admin', 'Caio Comercial', 'Carla Comercial']);
      escolher(fixture, el.querySelector<HTMLSelectElement>('#responsavel')!, 'u-com2');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Revisão'));
      expect(repo.atribuir).toHaveBeenCalledWith('p1', { responsavelId: 'u-com2' });
      expect(repo.salvarRascunho.mock.calls[0][1]).not.toHaveProperty('responsavelId');
    });

    it('o comercial que não é o responsável não troca o técnico', async () => {
      const { el } = await montar({ id: 'p1', passo: '3', propostas: [proposta({ responsavelId: 'u-com2' })] });
      expect(el.querySelector<HTMLSelectElement>('#tecnico')!.disabled).toBe(true);
    });
  });

  describe('revisão (passo 4) e envio', () => {
    interface Caso {
      nome: string;
      locacao: boolean;
      descontoGeral: string;
      linhas: { quantidade: string; precoUnitario: string; descontoPercentual: string; meses: number | null }[];
      esperado: { totalDescontos: string; total: string };
    }
    const casos = (JSON.parse(casosTexto as unknown as string) as { casos: Caso[] }).casos;
    const centavos = (v: string) => Number(v.replace('.', ''));
    const escala = (v: string, casas: number) => {
      const [i, f = ''] = v.split('.');
      return Number(i + f.padEnd(casas, '0'));
    };

    it.each(['desconto geral 12,5', 'locacao com e sem meses', 'venda tipica com varias linhas'])(
      'os totais batem com casos-calculo.json: %s (Subtotal = bruto, como no PDF)',
      async (nome) => {
        const c = casos.find((x) => x.nome === nome)!;
        const p = proposta({
          tipo: c.locacao ? 'LOCACAO' : 'VENDA',
          descontoGeralCentesimos: escala(c.descontoGeral, 2),
          itens: c.linhas.map((l, i) =>
            linha(`l${i}`, {
              // fora do catálogo do aparelho: os meses que a linha tem decidem
              itemCatalogoId: `fora-${i}`,
              quantidadeMilesimos: escala(l.quantidade, 3),
              precoUnitarioCentavos: escala(l.precoUnitario, 2),
              descontoCentesimos: escala(l.descontoPercentual, 2),
              meses: l.meses,
            }),
          ),
        });
        const { el } = await montar({ id: 'p1', passo: '4', propostas: [p] });
        const moeda = (n: number) => `${n < 0 ? '-' : ''}R$ ${Math.floor(Math.abs(n) / 100).toLocaleString('pt-BR')},${String(Math.abs(n) % 100).padStart(2, '0')}`;
        const total = centavos(c.esperado.total);
        const descontos = centavos(c.esperado.totalDescontos);
        expect(el.querySelector('[data-testid=total-total]')?.textContent).toBe(moeda(total));
        expect(el.querySelector('[data-testid=total-subtotal]')?.textContent).toBe(moeda(total + descontos));
        expect(el.querySelector('[data-testid=total-descontos]')?.textContent).toBe(moeda(-descontos));
      },
    );

    it('?passo=4 abre direto na revisão (P4c-R5), com o resumo', async () => {
      const { el } = await montar({ id: 'p1', passo: '4' });
      expect(titulo(el)).toBe('Revisão');
      expect(el.textContent).toContain('Passo 4 de 4: Revisão');
      expect(el.querySelector('[data-testid=revisao-cliente]')?.textContent).toContain('Padaria São João');
      expect(el.textContent).toContain('Venda padrão');
      expect(el.textContent).toContain('16/10/2026');
      expect(el.querySelector('[data-testid=enviar]')?.textContent?.trim()).toBe('Enviar');
      expect(el.querySelector('[data-testid=continuar]')).toBeNull();
    });

    it('"Ver prévia" usa entradaPrevia e o PdfService (iframe no desktop)', async () => {
      const largura = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
      const criar = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => 'blob:previa');
      try {
        const { fixture, el, repo, pdf } = await montar({ id: 'p1', passo: '4' });
        botao(el, 'Ver prévia')!.click();
        await ate(fixture, () => expect(el.querySelector('iframe[title="Prévia do PDF"]')).not.toBeNull());
        expect(repo.entradaPrevia).toHaveBeenCalledWith('p1');
        expect(pdf.gerarBlob).toHaveBeenCalledWith({ previa: true });
      } finally {
        URL.createObjectURL = criar;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: largura });
      }
    });

    describe('Enviar', () => {
      const nav = navigator as Navigator & { share?: unknown; canShare?: unknown };
      const originais = { share: nav.share, canShare: nav.canShare };
      afterEach(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: originais.share });
        Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: originais.canShare });
      });
      function webShare() {
        const share = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
        Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: () => true });
        return share;
      }

      it('chama repo.enviar com o PdfService, depois compartilha Proposta-<PROV>.pdf, avisa e vai ao detalhe', async () => {
        const share = webShare();
        const { fixture, el, repo, pdf, navegar, toast, pagina } = await montar({ id: 'p1', passo: '4' });
        let liberar!: (b: Blob) => void;
        pdf.gerarBlob.mockReturnValue(new Promise<Blob>((r) => (liberar = r)));
        el.querySelector<HTMLButtonElement>('[data-testid=enviar]')!.click();
        await ate(fixture, () => expect(el.querySelector('[data-testid=enviar]')?.textContent?.trim()).toBe('Gerando PDF…'));
        expect(el.querySelector<HTMLButtonElement>('[data-testid=enviar]')!.disabled).toBe(true);
        liberar(new Blob(['%PDF'], { type: 'application/pdf' }));

        await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1']));
        expect(repo.enviar).toHaveBeenCalledWith('p1', expect.any(Function));
        expect(pdf.gerarBlob).toHaveBeenCalledWith({ previa: false });
        expect(share).toHaveBeenCalledTimes(1);
        expect(repo.enviar.mock.invocationCallOrder[0]).toBeLessThan(share.mock.invocationCallOrder[0]);
        expect((share.mock.calls[0][0] as { files: File[] }).files[0].name).toBe('Proposta-PROV-ABC123.pdf');
        expect(toast).toHaveBeenCalledWith('Proposta enviada. O número chega quando sincronizar.');
        expect(pagina.temAlteracoes()).toBe(false);
      });

      it('online e já numerada: o arquivo leva o número e o aviso é só "Proposta enviada."', async () => {
        const share = webShare();
        const { el, repo, navegar, toast } = await montar({ id: 'p1', passo: '4', online: true, propostas: [proposta({ numero: 277, revisao: 2 })] });
        el.querySelector<HTMLButtonElement>('[data-testid=enviar]')!.click();
        await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1']));
        expect(repo.enviar).toHaveBeenCalled();
        expect((share.mock.calls[0][0] as { files: File[] }).files[0].name).toBe('Proposta-000277-R2.pdf');
        expect(toast).toHaveBeenCalledWith('Proposta enviada.');
      });

      it('sem item, sem cliente ou sem template não envia e mostra o que falta', async () => {
        const { fixture, el, repo } = await montar({ id: 'p1', passo: '4', propostas: [proposta({ itens: [], templateId: null, clienteId: null })] });
        el.querySelector<HTMLButtonElement>('[data-testid=enviar]')!.click();
        await ate(fixture, () => expect(el.querySelector('[data-testid=faltas]')?.getAttribute('role')).toBe('alert'));
        expect(el.querySelector('[data-testid=faltas]')?.textContent).toContain('Informe o cliente.');
        expect(el.querySelector('[data-testid=faltas]')?.textContent).toContain('Inclua pelo menos um item.');
        expect(el.querySelector('[data-testid=faltas]')?.textContent).toContain('Informe o template.');
        expect(repo.enviar).not.toHaveBeenCalled();
        expect(botao(el, 'Corrigir')!.getAttribute('aria-label')).toBe('Corrigir: Informe o cliente.');
        botao(el, 'Corrigir')!.click();
        await ate(fixture, () => expect(titulo(el)).toBe('Tipo e cliente'));
      });

      it('recusa do envio (PDF_GRANDE) mostra a mensagem e fica na revisão', async () => {
        webShare();
        const { fixture, el, repo, navegar, toastErro } = await montar({ id: 'p1', passo: '4' });
        repo.enviar.mockRejectedValueOnce(new ErroProposta('PDF_GRANDE', 'proposta', 'O PDF passou de 10 MB. Reduza imagens do template.'));
        el.querySelector<HTMLButtonElement>('[data-testid=enviar]')!.click();
        await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('O PDF passou de 10 MB. Reduza imagens do template.'));
        await ate(fixture, () => expect(el.querySelector('[data-testid=enviar]')?.textContent?.trim()).toBe('Enviar'));
        expect(navegar).not.toHaveBeenCalled();
      });

      it('PROPOSTA_JA_ENVIADA leva ao detalhe', async () => {
        const { el, repo, navegar, toastErro } = await montar({ id: 'p1', passo: '4' });
        repo.enviar.mockRejectedValueOnce(new ErroProposta('PROPOSTA_JA_ENVIADA', 'proposta', 'Esta proposta já foi enviada.'));
        el.querySelector<HTMLButtonElement>('[data-testid=enviar]')!.click();
        await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1']));
        expect(toastErro).toHaveBeenCalledWith('Esta proposta já foi enviada.');
      });
    });

    it('"Salvar rascunho" na revisão vai ao detalhe', async () => {
      const { el, navegar, repo } = await montar({ id: 'p1', passo: '4' });
      el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1']));
      expect(repo.salvarRascunho).not.toHaveBeenCalled();
    });
  });

  describe('edição e alterações não salvas', () => {
    it('/editar fora de RASCUNHO redireciona ao detalhe com o aviso', async () => {
      TestBed.resetTestingModule();
      const repo = repoFalso([proposta({ status: 'ENVIADA' })]);
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: AuthService, useValue: { usuario: signal(COMERCIAL) } },
          { provide: PropostasRepo, useValue: repo },
          { provide: ClientesRepo, useValue: { observarTodos: () => of(CLIENTES) } },
          { provide: CatalogoRepo, useValue: { observarTodos: () => of(ITENS) } },
          { provide: TemplatesRepo, useValue: { observarTodos: () => of(TEMPLATES), observarPadroesEfetivos: () => of(PADROES) } },
          { provide: PdfService, useValue: {} },
          { provide: ConectividadeService, useValue: { online: signal(true) } },
        ],
      });
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const toastErro = vi.spyOn(TestBed.inject(Toasts), 'erro');
      const fixture = TestBed.createComponent(WizardPropostaPage);
      fixture.componentRef.setInput('id', 'p1');
      fixture.detectChanges();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1'], { replaceUrl: true }));
      expect(toastErro).toHaveBeenCalledWith('Só rascunhos podem ser editados.');
      expect(fixture.componentInstance.temAlteracoes()).toBe(false);
    });

    it('proposta que não está no aparelho volta à lista', async () => {
      TestBed.resetTestingModule();
      const { navegar, toastErro } = await montarSemEsperar({ id: 'nao-existe' });
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas'], { replaceUrl: true }));
      expect(toastErro).toHaveBeenCalledWith('Proposta não encontrada neste aparelho.');
    });

    it('guard: limpo ao abrir, sujo ao editar (pergunta), limpo depois de gravar o passo', async () => {
      const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { fixture, el, pagina } = await montar({ id: 'p1', passo: '2' });
      expect(pagina.temAlteracoes()).toBe(false);
      expect(alteracoesGuard(pagina, null!, null!, null!)).toBe(true);
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '2');
      expect(pagina.temAlteracoes()).toBe(true);
      expect(alteracoesGuard(pagina, null!, null!, null!)).toBe(false);
      expect(confirmar).toHaveBeenCalledTimes(1);
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Condições'));
      expect(pagina.temAlteracoes()).toBe(false);
      // texto normalizado pelo repositório volta ao campo e não conta como alteração
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('#condicoes-pagamento')!, '  À vista  ');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Revisão'));
      expect(pagina.temAlteracoes()).toBe(false);
    });

    it('trocar o tipo no passo 1 grava o template padrão do tipo e os meses das linhas', async () => {
      const p = proposta({ itens: [linha('l1'), linha('l2', { itemCatalogoId: 'i2', nome: 'Gerador' })] });
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '1', propostas: [p] });
      escolher(fixture, el.querySelector<HTMLSelectElement>('#tipo-proposta')!, 'LOCACAO');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Itens'));
      const edicao = repo.salvarRascunho.mock.calls[0][1];
      expect(edicao).toMatchObject({ tipo: 'LOCACAO', clienteId: 'c1', templateId: 't-loc' });
      expect(edicao.itens!.map((l) => l.meses)).toEqual([null, 1]);
      expect(campoDaLinha(el, 'l2', 'meses')!.value).toBe('1');
      expect(campoDaLinha(el, 'l1', 'meses')).toBeNull();
      // M-1: os preços não foram recalculados (aviso) e o template mudou (anúncio)
      expect(el.querySelector('[data-testid=aviso-tipo]')?.textContent).toContain('O tipo mudou: os preços das linhas não foram recalculados. Confira.');
      expect(el.querySelector('[role=status]')?.textContent).toContain('O template passou a ser o padrão do novo tipo.');
    });

    it('"Cadastrar cliente" na edição volta ao passo 1 desta proposta', async () => {
      const { el, navegar } = await montar({ id: 'p1', passo: '1' });
      el.querySelector<HTMLButtonElement>('[data-testid=cadastrar-cliente]')!.click();
      expect(navegar).toHaveBeenCalledWith(['/clientes/novo'], {
        queryParams: { voltar: '/propostas/p1/editar?passo=1&tipo=VENDA&clienteId=c1' },
      });
    });

    it('a volta do cadastro na edição: passo 1 com o cliente novo, ainda não gravado', async () => {
      const { el, pagina } = await montar({ id: 'p1', passo: '1', tipo: 'VENDA', clienteId: 'c2' });
      expect(el.querySelector('[data-testid=cliente-selecionado]')?.textContent).toContain('Maria Souza');
      expect(pagina.temAlteracoes()).toBe(true);
    });
  });

  describe('edição em outro aparelho (P4c-R7)', () => {
    const banner = (el: HTMLElement) => el.querySelector('#aviso-colisao');

    it('passo limpo mudado lá: recarrega em silêncio, não grava de volta e a revisão mostra o novo', async () => {
      const { fixture, el, repo, pagina } = await montar({ id: 'p1', passo: '3' });
      repo.foraDoAparelho('p1', (p) => {
        p.itens[0].precoUnitarioCentavos = 200000;
        p.tecnicoId = null;
      });
      await ate(fixture, () => expect(repo.store.get('p1')!.version).toBe(2));
      fixture.detectChanges();
      expect(banner(el)).toBeNull();
      expect(pagina.temAlteracoes()).toBe(false);
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('#observacoes')!, 'Minha obs.');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Revisão'));
      expect(repo.salvarRascunho).toHaveBeenCalledTimes(1);
      const [, edicao, versao] = repo.salvarRascunho.mock.calls[0];
      expect(edicao).not.toHaveProperty('itens');
      expect(versao).toBe(2);
      expect(el.querySelector('[data-testid=total-total]')?.textContent).toBe('R$ 2.000,00');
      expect(repo.store.get('p1')!.itens[0].precoUnitarioCentavos).toBe(200000);
    });

    it('passo alterado aqui e lá: faixa; Continuar espera a escolha; "Recarregar" fica com a de lá', async () => {
      const { fixture, el, repo, pagina } = await montar({ id: 'p1', passo: '3' });
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('#observacoes')!, 'Minha obs.');
      repo.foraDoAparelho('p1', (p) => (p.observacoes = 'Obs. de lá'));
      await ate(fixture, () => expect(banner(el)?.textContent).toContain('Esta proposta foi alterada em outro aparelho.'));
      expect(banner(el)!.getAttribute('role')).toBe('alert');
      // a tela continua com o digitado
      expect(el.querySelector<HTMLTextAreaElement>('#observacoes')!.value).toBe('Minha obs.');

      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await fixture.whenStable();
      expect(repo.salvarRascunho).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(document.activeElement).toBe(banner(el)));

      botao(el, 'Recarregar')!.click();
      fixture.detectChanges();
      expect(banner(el)).toBeNull();
      expect(el.querySelector<HTMLTextAreaElement>('#observacoes')!.value).toBe('Obs. de lá');
      expect(pagina.temAlteracoes()).toBe(false);
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Revisão'));
      expect(repo.salvarRascunho).not.toHaveBeenCalled();
    });

    it('"Manter as minhas" grava na hora os passos em colisão com a versão base antiga (CONFLITO no servidor, P4c-R9)', async () => {
      const { fixture, el, repo, pagina } = await montar({ id: 'p1', passo: '3' });
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('#observacoes')!, 'Minha obs.');
      repo.foraDoAparelho('p1', (p) => (p.observacoes = 'Obs. de lá'));
      await ate(fixture, () => expect(banner(el)).not.toBeNull());
      botao(el, 'Manter as minhas')!.click();
      await vi.waitFor(() => expect(repo.salvarRascunho).toHaveBeenCalledTimes(1));
      fixture.detectChanges();
      expect(banner(el)).toBeNull();
      const [, edicao, versao] = repo.salvarRascunho.mock.calls[0];
      expect(edicao.observacoes).toBe('Minha obs.');
      expect(versao).toBe(1);
      expect(pagina.temAlteracoes()).toBe(false);
      // o resto da edição segue com a base antiga (a mutação dela já está na frente da fila)
      digitar(fixture, el.querySelector<HTMLInputElement>('#prazo-execucao')!, '20 dias');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Revisão'));
      expect(repo.salvarRascunho.mock.calls[1][2]).toBe(1);
    });

    it('"Manter as minhas" com campo inválido no passo em colisão: não grava, a faixa fica e o campo recebe o foco', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '3' });
      digitar(fixture, el.querySelector<HTMLInputElement>('#desconto-geral')!, '1.234');
      repo.foraDoAparelho('p1', (p) => (p.descontoGeralCentesimos = 500));
      await ate(fixture, () => expect(banner(el)).not.toBeNull());
      botao(el, 'Manter as minhas')!.click();
      await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('#desconto-geral')));
      fixture.detectChanges();
      expect(banner(el)).not.toBeNull();
      expect(repo.salvarRascunho).not.toHaveBeenCalled();
    });

    it('"Manter as minhas" recusado pelo repositório: nada muda (faixa, Adicionar desabilitado); corrigido, mantém com a base antiga (N-4)', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '2' });
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '3');
      repo.foraDoAparelho('p1', (p) => (p.itens[0].precoUnitarioCentavos = 99900));
      await ate(fixture, () => expect(banner(el)).not.toBeNull());
      repo.salvarRascunho.mockRejectedValueOnce(
        new ErroProposta('VALIDACAO', 'itens[0].quantidade', 'A quantidade vai de 0,001 a 999.999,999.', {
          'itens[0].quantidade': 'A quantidade vai de 0,001 a 999.999,999.',
        }),
      );
      botao(el, 'Manter as minhas')!.click();
      await ate(fixture, () => expect(campoDaLinha(el, 'l1', 'quantidade')!.getAttribute('aria-invalid')).toBe('true'));
      await vi.waitFor(() => expect(document.activeElement).toBe(campoDaLinha(el, 'l1', 'quantidade')));
      fixture.detectChanges();
      // nada gravado e nada liberado: a faixa fica e o Adicionar segue desabilitado
      expect(banner(el)).not.toBeNull();
      expect(repo.store.get('p1')!.itens.map((l) => l.quantidadeMilesimos)).toEqual([1000]);
      expect(repo.store.get('p1')!.version).toBe(2);
      digitar(fixture, el.querySelector<HTMLInputElement>('#busca-catalogo')!, 'ger');
      expect(el.querySelector<HTMLButtonElement>('[data-testid=adicionar-item]')!.disabled).toBe(true);
      el.querySelector<HTMLButtonElement>('[data-testid=adicionar-item]')!.click();
      await fixture.whenStable();
      expect(repo.adicionarItem).not.toHaveBeenCalled();

      // corrigido, "Manter" de novo grava com a base antiga e libera
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '4');
      botao(el, 'Manter as minhas')!.click();
      await vi.waitFor(() => expect(repo.salvarRascunho).toHaveBeenCalledTimes(2));
      await ate(fixture, () => expect(banner(el)).toBeNull());
      const [, edicao, versao] = repo.salvarRascunho.mock.calls[1];
      expect(versao).toBe(1);
      expect(edicao.itens!.map((l) => l.quantidadeMilesimos)).toEqual([4000]);
      expect(repo.store.get('p1')!.version).toBe(1);
      expect(el.querySelector<HTMLButtonElement>('[data-testid=adicionar-item]')!.disabled).toBe(false);
    });

    it('"Manter as minhas" com só o responsável trocado (ADMIN): atribuir com a versão base antiga (N-3)', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '3', usuario: ADMIN });
      escolher(fixture, el.querySelector<HTMLSelectElement>('#responsavel')!, 'u-com2');
      repo.foraDoAparelho('p1', (p) => (p.responsavelId = ADMIN.id));
      await ate(fixture, () => expect(banner(el)).not.toBeNull());
      botao(el, 'Manter as minhas')!.click();
      await vi.waitFor(() => expect(repo.atribuir).toHaveBeenCalled());
      expect(repo.atribuir).toHaveBeenCalledWith('p1', { responsavelId: 'u-com2' }, 1);
    });

    it('sem "Manter", o responsável vai por atribuir sem versão (a da cópia local)', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '3', usuario: ADMIN });
      escolher(fixture, el.querySelector<HTMLSelectElement>('#responsavel')!, 'u-com2');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Revisão'));
      expect(repo.atribuir.mock.calls[0]).toEqual(['p1', { responsavelId: 'u-com2' }]);
    });

    it('com a faixa aberta, Adicionar fica desabilitado e nada é adicionado (N-1)', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '2' });
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '3');
      repo.foraDoAparelho('p1', (p) => (p.itens[0].precoUnitarioCentavos = 99900));
      await ate(fixture, () => expect(banner(el)).not.toBeNull());
      digitar(fixture, el.querySelector<HTMLInputElement>('#busca-catalogo')!, 'ger');
      const adicionar = el.querySelector<HTMLButtonElement>('[data-testid=adicionar-item]')!;
      expect(adicionar.disabled).toBe(true);
      adicionar.click();
      await fixture.whenStable();
      expect(repo.adicionarItem).not.toHaveBeenCalled();
      expect(banner(el)).not.toBeNull();
    });

    it('Adicionar relê antes: a edição de lá que ainda não chegou pela observação abre a faixa e nada é adicionado', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '2' });
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '3');
      repo.foraDoAparelho('p1', (p) => (p.itens[0].precoUnitarioCentavos = 99900), { emitir: false });
      digitar(fixture, el.querySelector<HTMLInputElement>('#busca-catalogo')!, 'ger');
      el.querySelector<HTMLButtonElement>('[data-testid=adicionar-item]')!.click();
      await ate(fixture, () => expect(banner(el)).not.toBeNull());
      expect(repo.adicionarItem).not.toHaveBeenCalled();
      expect(campoDaLinha(el, 'l1', 'quantidade')!.value).toBe('3');
    });

    it('edição de lá no meio do Adicionar: o gravado não é "o de antes + a linha nova", então é colisão (N-1)', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '2' });
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '3');
      const original = repo.adicionarItem.getMockImplementation()!;
      repo.adicionarItem.mockImplementationOnce(async (id, item) => {
        repo.foraDoAparelho(id, (p) => (p.itens[0].precoUnitarioCentavos = 99900), { emitir: false });
        return original(id, item);
      });
      digitar(fixture, el.querySelector<HTMLInputElement>('#busca-catalogo')!, 'ger');
      el.querySelector<HTMLButtonElement>('[data-testid=adicionar-item]')!.click();
      await ate(fixture, () => expect(banner(el)).not.toBeNull());
      expect(campoDaLinha(el, 'l-i2', 'quantidade')).not.toBeNull();
      // a base não avançou: manter grava com a versão antiga
      botao(el, 'Manter as minhas')!.click();
      await vi.waitFor(() => expect(repo.salvarRascunho).toHaveBeenCalled());
      expect(repo.salvarRascunho.mock.calls[0][2]).toBe(1);
      expect(repo.salvarRascunho.mock.calls[0][1].itens!.map((l) => [l.id, l.quantidadeMilesimos])).toEqual([['l1', 3000], ['l-i2', 1000]]);
    });

    it('ack do próprio push (versão e número, nenhum campo): sem faixa, a base e o código avançam', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '3', propostas: [proposta({ version: null })] });
      repo.foraDoAparelho('p1', (p) => {
        p.version = 1;
        p.numero = 281;
        p.atualizadoEm = '2026-10-01T12:00:00Z';
        p.itens[0].subtotalCentavos = 123456;
      }, { versao: false });
      await ate(fixture, () => expect(el.textContent).toContain('000281'));
      expect(banner(el)).toBeNull();
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('#observacoes')!, 'x');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Revisão'));
      expect(repo.salvarRascunho.mock.calls[0][2]).toBe(1);
    });

    it('ack que chega sem reemissão ainda é visto antes de gravar (a gravação relê)', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '3', propostas: [proposta({ version: null })] });
      repo.foraDoAparelho('p1', (p) => (p.version = 1), { emitir: false, versao: false });
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('#observacoes')!, 'x');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Revisão'));
      expect(repo.salvarRascunho.mock.calls[0][2]).toBe(1);
    });

    it('a própria gravação não vira colisão (o passo 2 sujo e a linha adicionada)', async () => {
      const { fixture, el } = await montar({ id: 'p1', passo: '2' });
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '3');
      digitar(fixture, el.querySelector<HTMLInputElement>('#busca-catalogo')!, 'ger');
      el.querySelector<HTMLButtonElement>('[data-testid=adicionar-item]')!.click();
      await ate(fixture, () => expect(campoDaLinha(el, 'l-i2', 'quantidade')).not.toBeNull());
      await fixture.whenStable();
      fixture.detectChanges();
      expect(banner(el)).toBeNull();
      expect(campoDaLinha(el, 'l1', 'quantidade')!.value).toBe('3');
    });
  });

  describe('compartilhamento depois do envio (P4c-R8)', () => {
    const nav = navigator as Navigator & { share?: unknown; canShare?: unknown };
    const originais = { share: nav.share, canShare: nav.canShare, criar: URL.createObjectURL, revogar: URL.revokeObjectURL };
    afterEach(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: originais.share });
      Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: originais.canShare });
      URL.createObjectURL = originais.criar;
      URL.revokeObjectURL = originais.revogar;
    });

    it('share recusado por falta de gesto: painel "PDF pronto"; o toque chama share de novo com o mesmo File', async () => {
      const share = vi.fn()
        .mockRejectedValueOnce(new DOMException('sem gesto', 'NotAllowedError'))
        .mockResolvedValueOnce(undefined);
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
      Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: () => true });
      const { fixture, el, navegar } = await montar({ id: 'p1', passo: '4' });
      el.querySelector<HTMLButtonElement>('[data-testid=enviar]')!.click();
      await ate(fixture, () => expect(el.querySelector('[role=dialog]')?.textContent).toContain('PDF pronto'));
      expect(navegar).not.toHaveBeenCalledWith(['/propostas', 'p1']);
      await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('[role=dialog]')));

      botao(el, 'Compartilhar')!.click();
      expect(share).toHaveBeenCalledTimes(2);
      const [primeira, segunda] = share.mock.calls.map((c) => (c[0] as { files: File[] }).files[0]);
      expect(segunda).toBe(primeira);
      expect(segunda.name).toBe('Proposta-PROV-ABC123.pdf');
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1']));
    });

    it('a folha do rodapé respeita a área segura e a página ganha espaço para o fim da revisão (N-2)', async () => {
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: vi.fn().mockRejectedValue(new DOMException('x', 'NotAllowedError')) });
      Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: () => true });
      const { fixture, el } = await montar({ id: 'p1', passo: '4' });
      expect(el.querySelector('[data-testid=pagina-wizard]')!.classList).not.toContain('pb-72');
      el.querySelector<HTMLButtonElement>('[data-testid=enviar]')!.click();
      await ate(fixture, () => expect(el.querySelector('[role=dialog]')).not.toBeNull());
      expect(el.querySelector('[data-testid=folha-pdf-pronto]')!.classList).toContain('pb-[calc(1rem+env(safe-area-inset-bottom))]');
      expect(el.querySelector('[data-testid=pagina-wizard]')!.classList).toContain('pb-72');
    });

    it('fechar o painel também vai ao detalhe', async () => {
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: vi.fn().mockRejectedValue(new DOMException('x', 'NotAllowedError')) });
      Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: () => true });
      const { fixture, el, navegar } = await montar({ id: 'p1', passo: '4' });
      el.querySelector<HTMLButtonElement>('[data-testid=enviar]')!.click();
      await ate(fixture, () => expect(el.querySelector('[role=dialog]')).not.toBeNull());
      botao(el, 'Fechar')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1']));
    });

    it('sem Web Share: baixa e avisa "PDF baixado: <nome>"; anuncia a geração', async () => {
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: undefined });
      URL.createObjectURL = vi.fn(() => 'blob:x');
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      const { fixture, el, pdf, navegar, toast } = await montar({ id: 'p1', passo: '4' });
      let liberar!: (b: Blob) => void;
      pdf.gerarBlob.mockReturnValue(new Promise<Blob>((r) => (liberar = r)));
      el.querySelector<HTMLButtonElement>('[data-testid=enviar]')!.click();
      await ate(fixture, () => expect(el.querySelector('[role=status]')?.textContent).toBe('Gerando o PDF da proposta…'));
      liberar(new Blob(['%PDF']));
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1']));
      expect(toast).toHaveBeenCalledWith('PDF baixado: Proposta-PROV-ABC123.pdf');
    });

    it('o nome do arquivo é o código impresso no PDF, mesmo se o número chegar logo depois', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
      Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: () => true });
      const { el, repo, navegar } = await montar({ id: 'p1', passo: '4', online: true });
      const enviarOriginal = repo.enviar.getMockImplementation()!;
      repo.enviar.mockImplementationOnce(async (id, gerar) => {
        const blob = await enviarOriginal(id, gerar);
        repo.store.get(id)!.numero = 281; // o ack do push chegou antes da tela reler
        return blob;
      });
      el.querySelector<HTMLButtonElement>('[data-testid=enviar]')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1']));
      expect((share.mock.calls[0][0] as { files: File[] }).files[0].name).toBe('Proposta-PROV-ABC123.pdf');
    });
  });

  describe('Salvar rascunho, foco e anúncios', () => {
    it('com passos alterados: grava em ordem e depois vai ao detalhe', async () => {
      const { fixture, el, repo, navegar } = await montar({ id: 'p1', passo: '3' });
      digitar(fixture, el.querySelector<HTMLTextAreaElement>('#observacoes')!, 'Obs.');
      botao(el, 'Voltar')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Itens'));
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '2');
      el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1']));
      expect(repo.salvarRascunho.mock.calls.map((c) => Object.keys(c[1]).includes('itens'))).toEqual([true, false]);
      expect(repo.salvarRascunho.mock.calls[1][1].observacoes).toBe('Obs.');
      expect(repo.salvarRascunho.mock.invocationCallOrder[0]).toBeLessThan(navegar.mock.invocationCallOrder.at(-1)!);
    });

    it('campo inválido: não sai, vai ao passo dele e foca o campo', async () => {
      const { fixture, el, repo, navegar } = await montar({ id: 'p1', passo: '3' });
      digitar(fixture, el.querySelector<HTMLInputElement>('#desconto-geral')!, '1.234');
      botao(el, 'Voltar')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Itens'));
      el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Condições'));
      await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('#desconto-geral')));
      expect(repo.salvarRascunho).not.toHaveBeenCalled();
      expect(navegar).not.toHaveBeenCalled();
    });

    it('sem alteração: não grava nada e vai ao detalhe', async () => {
      const { el, repo, navegar } = await montar({ id: 'p1', passo: '2' });
      el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1']));
      expect(repo.salvarRascunho).not.toHaveBeenCalled();
    });

    it('trocar de passo foca o título e anuncia; abrir com ?passo também (a volta do /nova)', async () => {
      const { fixture, el } = await montar({ id: 'p1', passo: '2' });
      await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('#titulo-passo')));
      expect(el.querySelector('[role=status]')?.textContent).toBe('Passo 2 de 4: Itens.');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Condições'));
      await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('#titulo-passo')));
      expect(el.querySelector('[role=status]')?.textContent).toBe('Passo 3 de 4: Condições.');
    });
  });

  describe('correção (/propostas/:id/corrigir, P4c-R4)', () => {
    /** A criação recusada pelo servidor (VALIDACAO), com a proposta já ENVIADA no aparelho (envio offline). */
    const recusa = (campos: Record<string, string>): Pendencia => ({
      mutationId: 'e1', entidade: 'proposta', agregadoId: 'p1', tipo: 'REJEITADO', criadaEm: '',
      erro: { codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos },
      mutacao: { seq: 5, mutationId: 'e1', entidade: 'proposta', agregadoId: 'p1', op: 'UPSERT', baseVersion: null, dados: null, criadaEm: '' },
    });
    const RECUSA = recusa({ 'itens[0].quantidade': 'A quantidade vai de 0,001 a 999.999,999.', prazoExecucao: 'Máximo de 200 caracteres.' });
    const enviada = () => proposta({ status: 'ENVIADA', prazoExecucao: 'Em breve' });
    const corrigir = (o: Opcoes = {}) => montar({ id: 'p1', modo: 'corrigir', propostas: [enviada()], recusa: RECUSA, ...o });

    it('passos 1–3 e "Salvar e reenviar", com o status ENVIADA; abre no passo do 1º campo recusado, destacado e com o foco', async () => {
      const { el } = await corrigir();
      expect(el.querySelector('h1')?.textContent).toContain('Corrigir proposta');
      expect(el.querySelectorAll('nav ol li').length).toBe(3);
      expect(el.textContent).toContain('Passo 2 de 3: Itens');
      expect(titulo(el)).toBe('Itens');
      const qtd = campoDaLinha(el, 'l1', 'quantidade')!;
      expect(qtd.getAttribute('aria-invalid')).toBe('true');
      expect(el.textContent).toContain('A quantidade vai de 0,001 a 999.999,999.');
      expect(el.querySelector('[data-testid=salvar-rascunho]')?.textContent?.trim()).toBe('Salvar e reenviar');
      expect(el.querySelector('[data-testid=enviar]')).toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(qtd));
    });

    it('Continuar só valida e avança; "Salvar e reenviar" grava tudo numa correção só (corrigirProposta) e vai ao detalhe', async () => {
      const { fixture, el, repo, pendencias, navegar, toast, pagina } = await corrigir();
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '2');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Condições'));
      expect(el.querySelector('#prazo-execucao')!.getAttribute('aria-invalid')).toBe('true');
      expect(el.textContent).toContain('Máximo de 200 caracteres.');
      expect(pendencias.corrigirProposta).not.toHaveBeenCalled();
      expect(repo.salvarRascunho).not.toHaveBeenCalled();
      expect(pagina.temAlteracoes()).toBe(true);
      // o último passo é o 3: sem Continuar, só o "Salvar e reenviar"
      expect(el.querySelector('[data-testid=continuar]')).toBeNull();

      digitar(fixture, el.querySelector<HTMLInputElement>('#prazo-execucao')!, '10 dias');
      el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1']));
      expect(pendencias.corrigirProposta).toHaveBeenCalledTimes(1);
      const [pendenciaId, edicao] = pendencias.corrigirProposta.mock.calls[0];
      expect(pendenciaId).toBe('e1');
      expect(edicao.itens!.map((l) => [l.id, l.quantidadeMilesimos])).toEqual([['l1', 2000]]);
      expect(edicao.prazoExecucao).toBe('10 dias');
      // o passo 1 não mudou: não vai
      expect(edicao).not.toHaveProperty('tipo');
      expect(repo.salvarRascunho).not.toHaveBeenCalled();
      expect(repo.atribuir).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith('Correção gravada. A proposta volta a sincronizar.');
      expect(pagina.temAlteracoes()).toBe(false);
    });

    it('Adicionar não grava na hora: a linha nova aparece e vai junto na correção', async () => {
      const { fixture, el, repo, pendencias } = await corrigir();
      digitar(fixture, el.querySelector<HTMLInputElement>('#busca-catalogo')!, 'ger');
      el.querySelector<HTMLButtonElement>('[data-testid=adicionar-item]')!.click();
      await ate(fixture, () => expect(el.querySelectorAll('li[data-linha-id]').length).toBe(2));
      expect(repo.adicionarItem).not.toHaveBeenCalled();
      expect(el.querySelector('[role=status]')?.textContent).toContain('Gerador adicionado.');
      el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
      await vi.waitFor(() => expect(pendencias.corrigirProposta).toHaveBeenCalled());
      const [, edicao] = pendencias.corrigirProposta.mock.calls[0];
      expect(edicao.itens!.map((l) => [l.itemCatalogoId, l.precoUnitarioCentavos, l.quantidadeMilesimos])).toEqual([
        ['i1', 123456, 1000], ['i2', 500000, 1000],
      ]);
    });

    it('a correção recusada (VALIDACAO) destaca o campo, vai ao passo dele e não sai', async () => {
      const { fixture, el, pendencias, navegar } = await corrigir();
      pendencias.corrigirProposta.mockRejectedValueOnce(
        new ErroProposta('VALIDACAO', 'validadeAte', 'Data inválida.', { validadeAte: 'Data inválida.' }),
      );
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '2');
      el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
      await ate(fixture, () => expect(el.querySelector('#validade')?.getAttribute('aria-invalid')).toBe('true'));
      expect(titulo(el)).toBe('Condições');
      expect(navegar).not.toHaveBeenCalledWith(['/propostas', 'p1']);
    });

    it('sem nenhum passo alterado, "Salvar e reenviar" não reenvia: anuncia e mostra "Corrija os campos destacados." (P4c-R10)', async () => {
      const { fixture, el, pendencias, navegar, toastErro } = await corrigir();
      el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
      await ate(fixture, () => expect(el.querySelector('[role=status]')?.textContent).toContain('Corrija os campos destacados.'));
      expect(toastErro).toHaveBeenCalledWith('Corrija os campos destacados.');
      expect(pendencias.corrigirProposta).not.toHaveBeenCalled();
      expect(navegar).not.toHaveBeenCalledWith(['/propostas', 'p1']);
    });

    it('a recusa já resolvida (PENDENCIA_INEXISTENTE) no salvar: libera, avisa e volta ao detalhe (P4c-R10)', async () => {
      const { fixture, el, pendencias, navegar, toastErro, pagina } = await corrigir();
      pendencias.corrigirProposta.mockRejectedValueOnce(
        new ErroProposta('PENDENCIA_INEXISTENTE', 'proposta', 'Esta pendência já foi resolvida.'),
      );
      digitar(fixture, campoDaLinha(el, 'l1', 'quantidade')!, '2');
      el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1'], { replaceUrl: true }));
      expect(toastErro).toHaveBeenCalledWith('Esta pendência já foi resolvida.');
      expect(pagina.temAlteracoes()).toBe(false);
    });

    it('item novo com o tipo trocado na tela (sem gravar): preço e meses do tipo novo, nos dois sentidos (I1)', async () => {
      for (const [de, para, esperado] of [
        ['VENDA', 'LOCACAO', ['i2', 30000, 1]],
        ['LOCACAO', 'VENDA', ['i2', 500000, null]],
      ] as const) {
        TestBed.resetTestingModule();
        const { fixture, el, pendencias } = await corrigir({ passo: '1', propostas: [proposta({ status: 'ENVIADA', tipo: de })] });
        escolher(fixture, el.querySelector<HTMLSelectElement>('#tipo-proposta')!, para);
        el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
        await ate(fixture, () => expect(titulo(el)).toBe('Itens'));
        digitar(fixture, el.querySelector<HTMLInputElement>('#busca-catalogo')!, 'ger');
        el.querySelector<HTMLButtonElement>('[data-testid=adicionar-item]')!.click();
        await ate(fixture, () => expect(el.querySelectorAll('li[data-linha-id]').length).toBe(2));
        el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
        await vi.waitFor(() => expect(pendencias.corrigirProposta).toHaveBeenCalled());
        const [, edicao] = pendencias.corrigirProposta.mock.calls[0];
        expect(edicao.tipo).toBe(para);
        const nova = edicao.itens!.find((l) => l.itemCatalogoId === 'i2')!;
        expect([nova.itemCatalogoId, nova.precoUnitarioCentavos, nova.meses]).toEqual(esperado);
      }
    });

    it('o responsável inválido é recusado antes da correção: nada muda (P4c-R10)', async () => {
      const { fixture, el, repo, pendencias, navegar, toastErro } = await corrigir({ usuario: ADMIN, passo: '3' });
      repo.conferirAtribuicao.mockRejectedValueOnce(
        new ErroProposta('VALIDACAO', 'responsavelId', 'O responsável tem de ser um administrador ou comercial ativo.', {
          responsavelId: 'O responsável tem de ser um administrador ou comercial ativo.',
        }),
      );
      escolher(fixture, el.querySelector<HTMLSelectElement>('#responsavel')!, 'u-com2');
      el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('O responsável tem de ser um administrador ou comercial ativo.'));
      expect(repo.conferirAtribuicao).toHaveBeenCalledWith('p1', { responsavelId: 'u-com2' });
      expect(pendencias.corrigirProposta).not.toHaveBeenCalled();
      expect(repo.atribuir).not.toHaveBeenCalled();
      expect(navegar).not.toHaveBeenCalledWith(['/propostas', 'p1']);
    });

    it('a correção gravou e o atribuir falhou depois: avisa que o responsável não foi trocado e vai ao detalhe', async () => {
      const { fixture, el, repo, pendencias, navegar, toast, toastErro } = await corrigir({ usuario: ADMIN, passo: '3' });
      repo.atribuir.mockRejectedValueOnce(new ErroProposta('ACESSO_NEGADO', 'responsavelId', 'Só o administrador troca o responsável.'));
      escolher(fixture, el.querySelector<HTMLSelectElement>('#responsavel')!, 'u-com2');
      el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1']));
      expect(pendencias.corrigirProposta).toHaveBeenCalled();
      expect(toastErro).toHaveBeenCalledWith('Correção gravada; o responsável não foi trocado: Só o administrador troca o responsável.');
      expect(toast).not.toHaveBeenCalledWith('Correção gravada. A proposta volta a sincronizar.');
    });

    it('o ADMIN troca o responsável: a correção primeiro, depois atribuir', async () => {
      const { fixture, el, repo, pendencias } = await corrigir({ usuario: ADMIN, passo: '3' });
      escolher(fixture, el.querySelector<HTMLSelectElement>('#responsavel')!, 'u-com2');
      el.querySelector<HTMLButtonElement>('[data-testid=salvar-rascunho]')!.click();
      await vi.waitFor(() => expect(repo.atribuir).toHaveBeenCalledWith('p1', { responsavelId: 'u-com2' }));
      expect(pendencias.corrigirProposta.mock.calls[0][1]).not.toHaveProperty('responsavelId');
      expect(pendencias.corrigirProposta.mock.invocationCallOrder[0]).toBeLessThan(repo.atribuir.mock.invocationCallOrder[0]);
    });

    it('"Cadastrar cliente" volta para a correção (não para o editar), no passo 1', async () => {
      const { el, navegar } = await corrigir({ passo: '1' });
      el.querySelector<HTMLButtonElement>('[data-testid=cadastrar-cliente]')!.click();
      expect(navegar).toHaveBeenCalledWith(['/clientes/novo'], {
        queryParams: { voltar: '/propostas/p1/corrigir?passo=1&tipo=VENDA&clienteId=c1' },
      });
    });

    it('sem recusa corrigível (já reenviada, ou outra pendência): avisa e volta ao detalhe', async () => {
      TestBed.resetTestingModule();
      const { navegar, toastErro } = await montarSemEsperar({ id: 'p1', modo: 'corrigir', propostas: [enviada()] });
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/propostas', 'p1'], { replaceUrl: true }));
      expect(toastErro).toHaveBeenCalledWith('Esta proposta não tem correção pendente.');
    });
  });

  describe('detalhes de acessibilidade e exibição', () => {
    it('os totais correntes não são regiões aria-live (M-6)', async () => {
      const passo2 = await montar({ id: 'p1', passo: '2' });
      expect(passo2.el.querySelector('[data-testid=total-itens]')!.closest('[aria-live]')).toBeNull();
      TestBed.resetTestingModule();
      const passo3 = await montar({ id: 'p1', passo: '3' });
      expect(passo3.el.querySelector('[data-testid=total-condicoes]')!.closest('[aria-live]')).toBeNull();
    });

    it('os rótulos do progresso existem para o leitor de tela também no celular (M-7)', async () => {
      const { el } = await montar();
      const rotulos = [...el.querySelectorAll('nav ol li span:last-child')];
      expect(rotulos.map((r) => r.textContent?.trim())).toEqual(['Tipo e cliente', 'Itens', 'Condições', 'Revisão']);
      for (const r of rotulos) {
        expect(r.classList).toContain('sr-only');
        expect(r.classList).not.toContain('hidden');
      }
    });

    it('locação: o ADMIN vê o custo, sem margem, na linha com meses (M-8)', async () => {
      const p = proposta({
        tipo: 'LOCACAO', templateId: 't-loc',
        itens: [linha('l2', { itemCatalogoId: 'i2', nome: 'Gerador', precoUnitarioCentavos: 30000, meses: 3, precoCustoCentavos: 400000 })],
      });
      const { el } = await montar({ id: 'p1', passo: '2', propostas: [p], usuario: ADMIN });
      expect(el.querySelector('[data-testid=custo]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Custo: R$ 4.000,00');
    });

    it('preço com milhar ao carregar e ao sair do campo; continua aceitando sem milhar (u2)', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '2' });
      const preco = campoDaLinha(el, 'l1', 'preco')!;
      expect(preco.value).toBe('1.234,56');
      digitar(fixture, preco, '1250,5');
      preco.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      expect(campoDaLinha(el, 'l1', 'preco')!.value).toBe('1.250,50');
      digitar(fixture, campoDaLinha(el, 'l1', 'preco')!, 'x');
      campoDaLinha(el, 'l1', 'preco')!.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      // inválido fica como digitado, com o erro
      expect(campoDaLinha(el, 'l1', 'preco')!.value).toBe('x');
      digitar(fixture, campoDaLinha(el, 'l1', 'preco')!, '1250,5');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(titulo(el)).toBe('Condições'));
      expect(repo.salvarRascunho.mock.calls[0][1].itens![0].precoUnitarioCentavos).toBe(125050);
    });

    it('"Cadastrar cliente" tem alvo de 48 px (u3)', async () => {
      const { el } = await montar();
      expect(el.querySelector('[data-testid=cadastrar-cliente]')!.classList).toContain('h-12');
    });

    it('erro do servidor num campo das condições marca aria-invalid (M-5)', async () => {
      const { fixture, el, repo } = await montar({ id: 'p1', passo: '3' });
      repo.salvarRascunho.mockRejectedValueOnce(new ErroProposta('VALIDACAO', 'validadeAte', 'Data inválida.', { validadeAte: 'Data inválida.' }));
      digitar(fixture, el.querySelector<HTMLInputElement>('#validade')!, '2026-11-30');
      el.querySelector<HTMLButtonElement>('[data-testid=continuar]')!.click();
      await ate(fixture, () => expect(el.querySelector('#validade')!.getAttribute('aria-invalid')).toBe('true'));
      await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('#validade')));
    });
  });
});

/** Monta sem esperar o passo aparecer (para os casos em que a tela redireciona). */
async function montarSemEsperar(o: Opcoes) {
  const repo = repoFalso(o.propostas ?? [proposta()]);
  if (o.recusa) repo.recusas.set(o.recusa.agregadoId, o.recusa);
  TestBed.configureTestingModule({
    providers: [
      { provide: PendenciasService, useValue: { corrigirProposta: vi.fn() } },
      provideRouter([]),
      { provide: AuthService, useValue: { usuario: signal(o.usuario ?? COMERCIAL) } },
      { provide: PropostasRepo, useValue: repo },
      { provide: ClientesRepo, useValue: { observarTodos: () => of(CLIENTES) } },
      { provide: CatalogoRepo, useValue: { observarTodos: () => of(ITENS) } },
      { provide: TemplatesRepo, useValue: { observarTodos: () => of(TEMPLATES), observarPadroesEfetivos: () => of(PADROES) } },
      { provide: PdfService, useValue: {} },
      { provide: ConectividadeService, useValue: { online: signal(true) } },
    ],
  });
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const toastErro = vi.spyOn(TestBed.inject(Toasts), 'erro');
  const fixture = TestBed.createComponent(WizardPropostaPage);
  if (o.modo) fixture.componentRef.setInput('modo', o.modo);
  if (o.id) fixture.componentRef.setInput('id', o.id);
  fixture.detectChanges();
  return { fixture, repo, navegar, toastErro };
}
