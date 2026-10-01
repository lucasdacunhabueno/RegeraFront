import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import type { UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { alteracoesGuard } from '../../core/navegacao/alteracoes-guard';
import type { EntradaPdf } from '../../core/pdf/pdf-models';
import { PdfService } from '../../core/pdf/pdf-service';
import type { UsuarioResumo } from '../../core/sync/sync-models';
import { Toasts } from '../../shared/ui/toasts';
import { CatalogoRepo } from '../catalogo/catalogo-repo';
import { ItemCatalogoDados, ItemLocal, paraItemLocal } from '../catalogo/item-models';
import { ClienteLocal, paraClienteLocal } from '../clientes/cliente-models';
import { ClientesRepo } from '../clientes/clientes-repo';
import { paraTemplateLocal, TemplateLocal, TipoProposta } from '../templates/template-models';
import { TemplatesRepo } from '../templates/templates-repo';
import casosTexto from './casos-calculo.json' with { loader: 'text' };
import { ItemPropostaLocal, PropostaLocal } from './proposta-models';
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
  return {
    store,
    buscar: vi.fn(async (id: string) => (store.has(id) ? structuredClone(store.get(id)) : undefined)),
    criar: vi.fn(async (tipo: TipoProposta, clienteId?: string | null) => {
      store.set('nova-1', proposta({ id: 'nova-1', tipo, clienteId: clienteId ?? null, templateId: PADROES.get(tipo) ?? null, itens: [] }));
      return 'nova-1';
    }),
    salvarRascunho: vi.fn(async (id: string, edicao: Partial<EdicaoRascunho>) => {
      const p = ler(id);
      const { itens, ...resto } = edicao;
      Object.assign(p, resto);
      for (const k of ['condicoesPagamento', 'prazoExecucao', 'observacoes'] as const) {
        if (k in edicao) p[k] = edicao[k]?.trim() || null;
      }
      if (itens) p.itens = itens.map((l, i) => ({ ...l, ordem: i, subtotalCentavos: null }));
    }),
    atribuir: vi.fn(async (id: string, m: { responsavelId?: string; tecnicoId?: string | null }) => {
      Object.assign(ler(id), m);
    }),
    adicionarItem: vi.fn(async (id: string, i: ItemLocal) => {
      const p = ler(id);
      const mensal = p.tipo === 'LOCACAO' && i.locavel;
      const nova = linha(`l-${i.id}`, {
        itemCatalogoId: i.id, codigo: i.codigo, nome: i.nome, precoCustoCentavos: i.precoCusto == null ? null : Math.round(i.precoCusto * 100),
        precoUnitarioCentavos: Math.round(((mensal ? i.precoLocacaoMensal : i.precoVenda) ?? 0) * 100), meses: mensal ? 1 : null,
      });
      p.itens.push(nova);
      return nova.id;
    }),
    enviar: vi.fn(async (id: string, gerar: (e: EntradaPdf) => Promise<Blob>) => {
      const blob = await gerar({ previa: false } as EntradaPdf);
      ler(id).status = 'ENVIADA';
      return blob;
    }),
    entradaPrevia: vi.fn(async () => ({ previa: true }) as EntradaPdf),
    observarUsuarios: () => of(USUARIOS),
  };
}

interface Opcoes {
  usuario?: UsuarioSessao;
  id?: string;
  passo?: string;
  tipo?: string;
  clienteId?: string;
  propostas?: PropostaLocal[];
  online?: boolean;
}

async function montar(o: Opcoes = {}) {
  const repo = repoFalso(o.propostas ?? [proposta()]);
  const blob = new Blob(['%PDF'], { type: 'application/pdf' });
  const pdf = { gerarBlob: vi.fn().mockResolvedValue(blob), logoDataUrl: vi.fn().mockResolvedValue(null) };
  TestBed.configureTestingModule({
    providers: [
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
  fixture.componentRef.setInput('modo', 'rascunho');
  for (const k of ['id', 'passo', 'tipo', 'clienteId'] as const) if (o[k] !== undefined) fixture.componentRef.setInput(k, o[k]);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  await ate(fixture, () => expect(el.querySelector('#titulo-passo')).not.toBeNull());
  return { fixture, el, repo, pdf, blob, navegar, toast, toastErro, pagina: fixture.componentInstance };
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
      const { el, repo } = await montar({ tipo: 'LOCACAO', clienteId: 'c2' });
      expect(el.querySelector('[data-testid=cliente-selecionado]')?.textContent).toContain('Maria Souza');
      expect(el.querySelector<HTMLSelectElement>('#tipo-proposta')!.value).toBe('LOCACAO');
      expect(repo.criar).not.toHaveBeenCalled();
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
      });
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
});

/** Monta sem esperar o passo aparecer (para os casos em que a tela redireciona). */
async function montarSemEsperar(o: Opcoes) {
  const repo = repoFalso(o.propostas ?? [proposta()]);
  TestBed.configureTestingModule({
    providers: [
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
  if (o.id) fixture.componentRef.setInput('id', o.id);
  fixture.detectChanges();
  return { fixture, repo, navegar, toastErro };
}
