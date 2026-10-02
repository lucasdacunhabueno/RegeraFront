import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import type { UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import type { UsuarioResumo } from '../../core/sync/sync-models';
import { Toasts } from '../../shared/ui/toasts';
import { ClienteLocal, paraClienteLocal } from '../clientes/cliente-models';
import { ClientesRepo } from '../clientes/clientes-repo';
import { PropostasRepo } from '../propostas/propostas-repo';
import { ErroOs } from './erro-os';
import { OsDados, OsLocal, paraOsLocal, StatusOs } from './os-models';
import { EdicaoCabecalhoOs, NovaOsAvulsa, OsRepo } from './os-repo';
import { OsFormPage } from './os-form-page';

const ADMIN: UsuarioSessao = { id: 'u-adm', nome: 'Ana Admin', email: 'ana@regera.com', perfil: 'ADMIN', ativo: true };
const COMERCIAL: UsuarioSessao = { id: 'u-com', nome: 'Carla Comercial', email: 'carla@regera.com', perfil: 'COMERCIAL', ativo: true };
const OUTRO_COMERCIAL: UsuarioSessao = { id: 'u-com2', nome: 'Caio Comercial', email: 'caio@regera.com', perfil: 'COMERCIAL', ativo: true };

const USUARIOS: UsuarioResumo[] = [
  { id: ADMIN.id, nome: ADMIN.nome, perfil: 'ADMIN' },
  { id: COMERCIAL.id, nome: COMERCIAL.nome, perfil: 'COMERCIAL' },
  { id: 'u-tec', nome: 'Téo Técnico', perfil: 'TECNICO' },
  { id: 'u-tec2', nome: 'Ana Técnica', perfil: 'TECNICO' },
  { id: 'u-tec-off', nome: 'Tito Inativo', perfil: 'TECNICO', ativo: false },
];

const DOCUMENTO = '11444777000161';

const cliente = (id: string, nome: string, extra: Partial<Parameters<typeof paraClienteLocal>[2]> = {}): ClienteLocal =>
  paraClienteLocal(id, 1, {
    tipo: 'PJ', documento: DOCUMENTO, nome, nomeFantasia: null, inscricaoEstadual: null, inscricaoMunicipal: null, email: null,
    telefone: '11988887777', whatsapp: null, contatoNome: null, observacoes: null, enderecos: [], ...extra,
  });

const PADARIA = cliente('c1', 'Padaria São João', {
  enderecos: [
    { tipo: 'COBRANCA', cep: '01001000', logradouro: 'Praça da Sé', numero: '1', complemento: null, bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' },
    { tipo: 'PRINCIPAL', cep: '01310100', logradouro: 'Av. Paulista', numero: '1000', complemento: 'cj 12', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP' },
    { tipo: 'INSTALACAO', cep: '13010000', logradouro: 'Rua Barão', numero: '50', complemento: null, bairro: 'Centro', cidade: 'Campinas', uf: 'SP' },
  ],
});
const MERCADO = cliente('c2', 'Mercado Bom Preço');
const CLIENTES = [PADARIA, MERCADO];

function osDados(status: StatusOs, extra: Partial<OsDados> = {}): OsDados {
  return {
    codigoProvisorio: 'OSP-0Z9XY7', numero: 123, revisao: 1, propostaId: 'p1', propostaNumero: 277, propostaCodigoExibido: '000277',
    clienteId: 'c1', tipo: 'INSTALACAO', status, responsavelId: COMERCIAL.id, tecnicoId: 'u-tec', dataPrevista: '2026-10-05',
    urgente: false, concluiProposta: true, descricao: 'Instalar o quadro', enderecoCep: '01310100', enderecoLogradouro: 'Av. Paulista',
    enderecoNumero: '1000', enderecoComplemento: 'cj 12', enderecoBairro: 'Bela Vista', enderecoCidade: 'São Paulo', enderecoUf: 'SP',
    assinaturaRecusada: false,
    itens: [
      { id: 'l1', itemCatalogoId: 'i1', codigo: 'PNL-550', nome: 'Painel Solar', unidade: 'un', natureza: 'PRODUTO', quantidadePrevista: 2, ordem: 0 },
      { id: 'l2', itemCatalogoId: 'i2', codigo: 'CAB-6', nome: 'Cabo 6 mm', unidade: 'm', natureza: 'PRODUTO', quantidadePrevista: 12.5, ordem: 1 },
    ],
    notas: [], anexos: [], historico: [], atualizadoEm: '2026-10-01T13:05:00Z',
    ...extra,
  };
}
const osLocal = (status: StatusOs, extra: Partial<OsDados> = {}): OsLocal => paraOsLocal('o1', 7, osDados(status, extra));

interface Opcoes {
  usuario?: UsuarioSessao;
  /** Edição: a OS de `buscar`; ausente, o formulário da OS avulsa. */
  os?: OsLocal | undefined;
  clienteId?: string;
}

async function montar(o: Opcoes = {}) {
  const repo = {
    buscar: vi.fn<(id: string) => Promise<OsLocal | undefined>>(async () => o.os),
    criarAvulsa: vi.fn<(nova: NovaOsAvulsa) => Promise<string>>(async () => 'o-nova'),
    salvarCabecalho: vi.fn<(id: string, e: Partial<EdicaoCabecalhoOs>, v?: number | null) => Promise<void>>(async () => undefined),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { usuario: signal(o.usuario ?? COMERCIAL) } },
      { provide: OsRepo, useValue: repo },
      { provide: ClientesRepo, useValue: { observarTodos: () => of(CLIENTES) } },
      { provide: PropostasRepo, useValue: { observarUsuarios: () => of(USUARIOS) } },
    ],
  });
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const toast = vi.spyOn(TestBed.inject(Toasts), 'mostrar');
  const toastErro = vi.spyOn(TestBed.inject(Toasts), 'erro');
  const fixture = TestBed.createComponent(OsFormPage);
  if ('os' in o) fixture.componentRef.setInput('id', 'o1');
  if (o.clienteId) fixture.componentRef.setInput('clienteId', o.clienteId);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  await ate(fixture, () => expect(el.querySelector('[data-testid=carregando]')).toBeNull());
  return { fixture, el, repo, navegar, toast, toastErro, pagina: fixture.componentInstance };
}

async function ate(fixture: ComponentFixture<unknown>, verificar: () => void) {
  await vi.waitFor(() => {
    fixture.detectChanges();
    verificar();
  });
}

const botao = (el: HTMLElement, texto: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === texto);
const campo = <T extends HTMLElement = HTMLInputElement>(el: HTMLElement, sel: string) => el.querySelector<T>(sel)!;

function digitar(fixture: ComponentFixture<unknown>, c: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  c.value = valor;
  c.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}
function escolher(fixture: ComponentFixture<unknown>, c: HTMLSelectElement, valor: string) {
  c.value = valor;
  c.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}
function marcar(fixture: ComponentFixture<unknown>, c: HTMLInputElement, valor: boolean) {
  c.checked = valor;
  c.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

/** Busca e escolhe o cliente da lista. */
function escolherCliente(fixture: ComponentFixture<unknown>, el: HTMLElement, nome: string) {
  digitar(fixture, campo(el, '#busca-cliente-os'), nome.split(' ')[0]);
  const opcao = [...el.querySelectorAll<HTMLButtonElement>('[data-testid=escolher-cliente]')].find((b) => b.textContent?.includes(nome))!;
  opcao.click();
  fixture.detectChanges();
}

describe('OsFormPage', () => {
  beforeEach(() => vi.spyOn(window, 'confirm').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  // ------------------------------------------------------------------ OS avulsa (/os/nova)

  describe('OS avulsa (/os/nova)', () => {
    it('título, campos com rótulo e o técnico só entre os técnicos ativos', async () => {
      const { el } = await montar();
      expect(el.querySelector('h1')!.textContent).toContain('Nova OS avulsa');
      for (const id of ['busca-cliente-os', 'tipo-os', 'descricao-os', 'tecnico-os', 'data-os', 'urgente-os']) {
        expect(el.querySelector(`label[for=${id}]`), id).not.toBeNull();
      }
      const tecnicos = [...campo<HTMLSelectElement>(el, '#tecnico-os').options].map((x) => x.textContent?.trim());
      expect(tecnicos).toEqual(['Nenhum (atribuir depois)', 'Ana Técnica', 'Téo Técnico']);
      expect(el.querySelector('a[href="/os"]')).not.toBeNull();
    });

    it('a busca lista os clientes sem o CPF/CNPJ (nome, cidade e telefone)', async () => {
      const { fixture, el } = await montar();
      digitar(fixture, campo(el, '#busca-cliente-os'), 'padaria');
      const opcoes = [...el.querySelectorAll('[data-testid=escolher-cliente]')];
      expect(opcoes).toHaveLength(1);
      expect(opcoes[0].textContent).toContain('Padaria São João');
      expect(opcoes[0].textContent).toContain('São Paulo');
      expect(el.innerHTML).not.toContain(DOCUMENTO);
      expect(el.innerHTML).not.toContain('11.444.777/0001-61');
      // a busca pelo documento continua valendo (só a tela não o mostra)
      digitar(fixture, campo(el, '#busca-cliente-os'), '11444777');
      expect(el.querySelectorAll('[data-testid=escolher-cliente]')).toHaveLength(2);
    });

    it('sem nada preenchido: cliente, tipo e descrição obrigatórios; nada é gravado e o foco vai ao primeiro', async () => {
      const { el, repo } = await montar();
      botao(el, 'Criar OS')!.click();
      await vi.waitFor(() => expect(el.querySelector('#erro-cliente-os')!.textContent).toContain('Escolha o cliente.'));
      expect(el.querySelector('#erro-tipo-os')!.textContent).toContain('Escolha o tipo.');
      expect(el.querySelector('#erro-descricao-os')!.textContent).toContain('Descreva o serviço.');
      expect(campo(el, '#tipo-os').getAttribute('aria-invalid')).toBe('true');
      expect(campo(el, '#descricao-os').getAttribute('aria-describedby')).toContain('erro-descricao-os');
      expect(repo.criarAvulsa).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(campo(el, '#busca-cliente-os'));
    });

    it('descrição acima de 4.000 caracteres é recusada na tela', async () => {
      const { fixture, el, repo } = await montar();
      escolherCliente(fixture, el, 'Mercado Bom Preço');
      escolher(fixture, campo(el, '#tipo-os'), 'CORRETIVA');
      digitar(fixture, campo(el, '#descricao-os'), 'x'.repeat(4001));
      botao(el, 'Criar OS')!.click();
      await vi.waitFor(() => expect(el.querySelector('#erro-descricao-os')!.textContent).toContain('Máximo de 4000 caracteres.'));
      expect(repo.criarAvulsa).not.toHaveBeenCalled();
    });

    it('o endereço é o índice em cliente.enderecos (Q6): o principal vem marcado; escolher outro manda a posição dele', async () => {
      const { fixture, el, repo, navegar, toast } = await montar();
      escolherCliente(fixture, el, 'Padaria São João');
      const radios = [...el.querySelectorAll<HTMLInputElement>('input[name=endereco-os]')];
      expect(radios).toHaveLength(3);
      // o PRINCIPAL é o segundo da lista
      expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
      expect(radios[2].closest('label')!.textContent).toContain('Campinas');
      expect(radios[2].closest('label')!.textContent).toContain('Instalação');
      marcar(fixture, radios[2], true);
      escolher(fixture, campo(el, '#tipo-os'), 'CORRETIVA');
      digitar(fixture, campo(el, '#descricao-os'), '  Trocar o disjuntor  ');
      escolher(fixture, campo(el, '#tecnico-os'), 'u-tec');
      digitar(fixture, campo(el, '#data-os'), '2026-10-10');
      marcar(fixture, campo(el, '#urgente-os'), true);
      botao(el, 'Criar OS')!.click();
      await vi.waitFor(() => expect(repo.criarAvulsa).toHaveBeenCalledExactlyOnceWith({
        clienteId: 'c1', tipo: 'CORRETIVA', descricao: 'Trocar o disjuntor', enderecoId: 2, tecnicoId: 'u-tec',
        dataPrevista: '2026-10-10', urgente: true,
      }));
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/os', 'o-nova']));
      expect(toast).toHaveBeenCalledWith('OS criada.');
    });

    it('sem técnico, sem data e sem urgência: os padrões (null, null, false) e o endereço principal', async () => {
      const { fixture, el, repo } = await montar();
      escolherCliente(fixture, el, 'Padaria São João');
      escolher(fixture, campo(el, '#tipo-os'), 'MANUTENCAO');
      digitar(fixture, campo(el, '#descricao-os'), 'Revisão anual');
      botao(el, 'Criar OS')!.click();
      await vi.waitFor(() => expect(repo.criarAvulsa).toHaveBeenCalledExactlyOnceWith({
        clienteId: 'c1', tipo: 'MANUTENCAO', descricao: 'Revisão anual', enderecoId: 1, tecnicoId: null, dataPrevista: null,
        urgente: false,
      }));
    });

    it('cliente sem endereço: avisa e cria sem endereço (enderecoId ausente)', async () => {
      const { fixture, el, repo } = await montar();
      escolherCliente(fixture, el, 'Mercado Bom Preço');
      expect(el.textContent).toContain('Este cliente não tem endereço cadastrado.');
      expect(el.querySelectorAll('input[name=endereco-os]')).toHaveLength(0);
      escolher(fixture, campo(el, '#tipo-os'), 'SERVICO');
      digitar(fixture, campo(el, '#descricao-os'), 'Visita técnica');
      botao(el, 'Criar OS')!.click();
      await vi.waitFor(() => expect(repo.criarAvulsa).toHaveBeenCalled());
      expect(repo.criarAvulsa.mock.calls[0][0]).not.toHaveProperty('enderecoId');
    });

    it('"Trocar" o cliente volta para a busca e zera o endereço', async () => {
      const { fixture, el } = await montar();
      escolherCliente(fixture, el, 'Padaria São João');
      expect(el.querySelector('[data-testid=cliente-escolhido]')!.textContent).toContain('Padaria São João');
      botao(el, 'Trocar')!.click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid=cliente-escolhido]')).toBeNull();
      expect(el.querySelectorAll('input[name=endereco-os]')).toHaveLength(0);
      expect(campo(el, '#busca-cliente-os')).not.toBeNull();
    });

    it('?clienteId= já abre com o cliente escolhido', async () => {
      const { el } = await montar({ clienteId: 'c1' });
      expect(el.querySelector('[data-testid=cliente-escolhido]')!.textContent).toContain('Padaria São João');
    });

    it('a recusa do repositório no endereço (enderecoId) vai para o campo; as outras, para o toast pelo mensagemErroOs', async () => {
      const { fixture, el, repo, toastErro, navegar } = await montar();
      escolherCliente(fixture, el, 'Padaria São João');
      escolher(fixture, campo(el, '#tipo-os'), 'SERVICO');
      digitar(fixture, campo(el, '#descricao-os'), 'Visita');
      repo.criarAvulsa.mockRejectedValueOnce(ErroOs.de({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { enderecoId: 'Endereço não encontrado.' } }));
      botao(el, 'Criar OS')!.click();
      await ate(fixture, () => expect(el.querySelector('#erro-endereco-os')!.textContent).toContain('Endereço não encontrado.'));
      repo.criarAvulsa.mockRejectedValueOnce(new ErroOs('ACESSO_NEGADO', 'os', 'O técnico não cria OS.'));
      botao(el, 'Criar OS')!.click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('O técnico não cria OS.'));
      repo.criarAvulsa.mockRejectedValueOnce(new Error('Dexie'));
      botao(el, 'Criar OS')!.click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('Não foi possível concluir. Tente de novo.'));
      expect(navegar).not.toHaveBeenCalled();
    });

    it('alterações não salvas: o guard pergunta; depois de criar, não', async () => {
      const { fixture, el, pagina } = await montar();
      expect(pagina.temAlteracoes()).toBe(false);
      digitar(fixture, campo(el, '#descricao-os'), 'Algo');
      expect(pagina.temAlteracoes()).toBe(true);
      escolherCliente(fixture, el, 'Mercado Bom Preço');
      escolher(fixture, campo(el, '#tipo-os'), 'SERVICO');
      botao(el, 'Criar OS')!.click();
      await vi.waitFor(() => expect(pagina.temAlteracoes()).toBe(false));
    });

    it('um toque só: o segundo "Criar OS" enquanto grava não cria outra', async () => {
      const { fixture, el, repo } = await montar();
      let liberar!: (id: string) => void;
      repo.criarAvulsa.mockImplementationOnce(() => new Promise((r) => (liberar = r)));
      escolherCliente(fixture, el, 'Mercado Bom Preço');
      escolher(fixture, campo(el, '#tipo-os'), 'SERVICO');
      digitar(fixture, campo(el, '#descricao-os'), 'Visita');
      botao(el, 'Criar OS')!.click();
      fixture.detectChanges();
      expect(botao(el, 'Criando…')!.disabled).toBe(true);
      botao(el, 'Criando…')!.click();
      liberar('o-nova');
      await vi.waitFor(() => expect(repo.criarAvulsa).toHaveBeenCalledTimes(1));
    });
  });

  // ------------------------------------------------------------------ cabeçalho (/os/:id/editar)

  describe('cabeçalho (/os/:id/editar)', () => {
    const habilitados = (el: HTMLElement) => ({
      tipo: !campo(el, '#tipo-os').disabled,
      descricao: !campo(el, '#descricao-os').disabled,
      data: !campo(el, '#data-os').disabled,
      urgente: !campo(el, '#urgente-os').disabled,
      endereco: !campo(el, '#endereco-logradouro').disabled,
      itens: !!el.querySelector('input[name^=quantidade-]') && !el.querySelector<HTMLInputElement>('input[name^=quantidade-]')!.disabled,
      conclui: !!el.querySelector('#conclui-os') && !campo(el, '#conclui-os').disabled,
    });
    const tudo = { tipo: true, descricao: true, data: true, urgente: true, endereco: true, itens: true, conclui: true };
    const nada = { tipo: false, descricao: false, data: false, urgente: false, endereco: false, itens: false, conclui: false };

    it.each<[string, StatusOs, UsuarioSessao, typeof tudo]>([
      ['ADMIN', 'ABERTA', ADMIN, tudo],
      ['COMERCIAL responsável', 'ABERTA', COMERCIAL, tudo],
      // em andamento: data e urgência; o "conclui a proposta" só o ADMIN (Q21)
      ['ADMIN', 'EM_ANDAMENTO', ADMIN, { ...nada, data: true, urgente: true, conclui: true }],
      ['COMERCIAL responsável', 'EM_ANDAMENTO', COMERCIAL, { ...nada, data: true, urgente: true }],
    ])('%s em %s: os campos que a matriz deixa', async (_quem, status, usuario, esperado) => {
      const { el } = await montar({ usuario, os: osLocal(status) });
      expect(el.querySelector('h1')!.textContent).toContain('Editar OS-000123');
      expect(habilitados(el)).toEqual(esperado);
    });

    it('em andamento, a dica diz o que muda', async () => {
      const { el } = await montar({ usuario: COMERCIAL, os: osLocal('EM_ANDAMENTO') });
      expect(el.textContent).toContain('Com a OS em andamento, só a data prevista e a urgência mudam.');
    });

    it.each<StatusOs>(['CONCLUIDA', 'CANCELADA'])('%s: nada se edita, com o link de volta para a OS', async (status) => {
      const { el } = await montar({ usuario: ADMIN, os: osLocal(status) });
      expect(el.textContent).toContain('Esta OS não pode ser editada.');
      expect(el.querySelector('form')).toBeNull();
      expect(el.querySelector('a[href="/os/o1"]')).not.toBeNull();
    });

    it('o COMERCIAL não vê a OS de outro comercial', async () => {
      const { el } = await montar({ usuario: OUTRO_COMERCIAL, os: osLocal('ABERTA') });
      expect(el.textContent).toContain('OS não encontrada neste aparelho.');
      expect(el.querySelector('form')).toBeNull();
      expect(el.textContent).not.toContain('Instalar o quadro');
    });

    it('OS que não está no aparelho', async () => {
      const { el } = await montar({ usuario: ADMIN, os: undefined });
      expect(el.textContent).toContain('OS não encontrada neste aparelho.');
    });

    it('carrega os valores da OS; o cliente e o técnico só aparecem (o técnico muda em "Atribuir técnico")', async () => {
      const { el } = await montar({ usuario: ADMIN, os: osLocal('ABERTA') });
      expect(campo<HTMLSelectElement>(el, '#tipo-os').value).toBe('INSTALACAO');
      expect(campo<HTMLTextAreaElement>(el, '#descricao-os').value).toBe('Instalar o quadro');
      expect(campo(el, '#data-os').value).toBe('2026-10-05');
      expect(campo(el, '#urgente-os').checked).toBe(false);
      expect(campo(el, '#conclui-os').checked).toBe(true);
      expect(campo(el, '#endereco-logradouro').value).toBe('Av. Paulista');
      expect(campo(el, 'input[name=quantidade-l2]').value).toBe('12,5');
      expect(el.querySelector('#tecnico-os')).toBeNull();
      expect(el.textContent).toContain('Téo Técnico');
      expect(el.textContent).toContain('Padaria São João');
      expect(el.innerHTML).not.toContain(DOCUMENTO);
    });

    it('salvar manda só o que mudou, com a versão carregada, e volta para a OS', async () => {
      const { fixture, el, repo, navegar, toast } = await montar({ usuario: ADMIN, os: osLocal('ABERTA') });
      digitar(fixture, campo(el, '#data-os'), '2026-10-20');
      marcar(fixture, campo(el, '#urgente-os'), true);
      marcar(fixture, campo(el, '#conclui-os'), false);
      botao(el, 'Salvar')!.click();
      await vi.waitFor(() => expect(repo.salvarCabecalho).toHaveBeenCalledExactlyOnceWith(
        'o1', { dataPrevista: '2026-10-20', urgente: true, concluiProposta: false }, 7,
      ));
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/os', 'o1']));
      expect(toast).toHaveBeenCalledWith('OS salva.');
    });

    it('limpar a data manda null; sem mudança nenhuma, só volta', async () => {
      const { fixture, el, repo, navegar } = await montar({ usuario: COMERCIAL, os: osLocal('EM_ANDAMENTO') });
      botao(el, 'Salvar')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(['/os', 'o1']));
      expect(repo.salvarCabecalho).not.toHaveBeenCalled();
      digitar(fixture, campo(el, '#data-os'), '');
      botao(el, 'Salvar')!.click();
      await vi.waitFor(() => expect(repo.salvarCabecalho).toHaveBeenCalledWith('o1', { dataPrevista: null }, 7));
    });

    it('tipo, descrição e endereço; o endereço do cliente preenche os campos', async () => {
      const { fixture, el, repo } = await montar({ usuario: COMERCIAL, os: osLocal('ABERTA') });
      escolher(fixture, campo(el, '#tipo-os'), 'CORRETIVA');
      digitar(fixture, campo(el, '#descricao-os'), 'Instalar o quadro novo');
      escolher(fixture, campo<HTMLSelectElement>(el, '#endereco-do-cliente'), '2');
      expect(campo(el, '#endereco-cidade').value).toBe('Campinas');
      expect(campo(el, '#endereco-complemento').value).toBe('');
      botao(el, 'Salvar')!.click();
      await vi.waitFor(() => expect(repo.salvarCabecalho).toHaveBeenCalledExactlyOnceWith('o1', {
        tipo: 'CORRETIVA', descricao: 'Instalar o quadro novo',
        endereco: { cep: '13010000', logradouro: 'Rua Barão', numero: '50', complemento: null, bairro: 'Centro', cidade: 'Campinas', uf: 'SP' },
      }, 7));
    });

    it('itens: muda a quantidade e tira uma linha; quantidade inválida é recusada na tela', async () => {
      const { fixture, el, repo } = await montar({ usuario: ADMIN, os: osLocal('ABERTA') });
      digitar(fixture, campo(el, 'input[name=quantidade-l1]'), '0');
      botao(el, 'Salvar')!.click();
      await ate(fixture, () => expect(el.querySelector('#erro-quantidade-l1')!.textContent).toContain('A quantidade vai de 0,001 a 999.999,999.'));
      expect(repo.salvarCabecalho).not.toHaveBeenCalled();
      digitar(fixture, campo(el, 'input[name=quantidade-l1]'), '1,5');
      el.querySelector<HTMLButtonElement>('button[aria-label="Tirar Cabo 6 mm"]')!.click();
      fixture.detectChanges();
      expect(el.querySelector('input[name=quantidade-l2]')).toBeNull();
      botao(el, 'Salvar')!.click();
      await vi.waitFor(() => expect(repo.salvarCabecalho).toHaveBeenCalled());
      const edicao = repo.salvarCabecalho.mock.calls[0][1];
      expect(edicao.itens).toEqual([expect.objectContaining({ id: 'l1', quantidadePrevistaMilesimos: 1500, codigo: 'PNL-550' })]);
    });

    it('OS avulsa: sem "Esta OS conclui a proposta?"', async () => {
      const { el } = await montar({ usuario: ADMIN, os: osLocal('ABERTA', { propostaId: null, propostaCodigoExibido: null }) });
      expect(el.querySelector('#conclui-os')).toBeNull();
    });

    it('a recusa VALIDACAO do repositório marca os campos', async () => {
      const { fixture, el, repo } = await montar({ usuario: ADMIN, os: osLocal('ABERTA') });
      repo.salvarCabecalho.mockRejectedValueOnce(ErroOs.de({
        codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { enderecoUf: 'UF inválida.', dataPrevista: 'Data inválida.' },
      }));
      digitar(fixture, campo(el, '#endereco-uf'), 'S');
      botao(el, 'Salvar')!.click();
      await ate(fixture, () => expect(el.querySelector('#erro-endereco-uf')!.textContent).toContain('UF inválida.'));
      expect(el.querySelector('#erro-data-os')!.textContent).toContain('Data inválida.');
      expect(campo(el, '#endereco-uf').getAttribute('aria-invalid')).toBe('true');
    });

    it('a recusa OS_NAO_EDITAVEL (a OS mudou de status no meio-tempo) vai para o toast', async () => {
      const { fixture, el, repo, toastErro } = await montar({ usuario: ADMIN, os: osLocal('ABERTA') });
      repo.salvarCabecalho.mockRejectedValueOnce(ErroOs.de({
        codigo: 'OS_NAO_EDITAVEL', mensagem: 'Alguns campos não podem ser alterados nesta OS.', campos: { tipo: 'Não pode ser alterado com a OS em andamento.' },
      }));
      escolher(fixture, campo(el, '#tipo-os'), 'CORRETIVA');
      botao(el, 'Salvar')!.click();
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('Não pode ser alterado com a OS em andamento.'));
    });

    it('alterações não salvas no cabeçalho contam para o guard', async () => {
      const { fixture, el, pagina } = await montar({ usuario: ADMIN, os: osLocal('ABERTA') });
      expect(pagina.temAlteracoes()).toBe(false);
      marcar(fixture, campo(el, '#urgente-os'), true);
      expect(pagina.temAlteracoes()).toBe(true);
      marcar(fixture, campo(el, '#urgente-os'), false);
      expect(pagina.temAlteracoes()).toBe(false);
    });
  });
});
