import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { ClienteDados, paraClienteLocal } from './cliente-models';
import { ClienteFormPage } from './cliente-form-page';
import { ClientesRepo, ErroCampo } from './clientes-repo';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth-service';
import { PropostaLocal } from '../propostas/proposta-models';
import { PropostasRepo } from '../propostas/propostas-repo';
import { Toasts } from '../../shared/ui/toasts';
import { ConsultasExternas } from './consultas-externas';
import { OsRepo } from '../os/os-repo';
import { OsLocal, paraOsLocal } from '../os/os-models';

const existente: ClienteDados = {
  tipo: 'PF', documento: '52998224725', nome: 'Maria', nomeFantasia: null, inscricaoEstadual: null,
  inscricaoMunicipal: null, email: 'm@x.com', telefone: '11999998888', whatsapp: null, contatoNome: null,
  observacoes: null,
  enderecos: [{ tipo: 'PRINCIPAL', cep: '01001000', logradouro: 'Praça da Sé', numero: '1', complemento: null, bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' }],
};

function propostaDe(id: string, p: Partial<PropostaLocal> = {}): PropostaLocal {
  return {
    id, version: 1, codigoProvisorio: 'PROV-ABC123', numero: null, revisao: null, tipo: 'VENDA', status: 'RASCUNHO', clienteId: 'id1',
    templateId: null, responsavelId: 'u1', tecnicoId: null, dataEmissao: '2026-09-20', validadeAte: '2026-10-05', condicoesPagamento: null,
    prazoExecucao: null, observacoes: null, descontoGeralCentesimos: null, totalItensCentavos: 150000, totalDescontosCentavos: 0,
    totalCentavos: 150000, motivoEncerramento: null, itens: [], historico: [], documentos: [], atualizadoEm: null, ...p,
  };
}

function montar(opcoes: {
  id?: string; voltar?: string; salvar?: ReturnType<typeof vi.fn>; buscar?: Promise<unknown>;
  propostas?: PropostaLocal[]; perfil?: 'ADMIN' | 'COMERCIAL' | 'TECNICO'; os?: OsLocal[];
} = {}) {
  const propostas = {
    observarDoCliente: vi.fn((clienteId: string) => of((opcoes.propostas ?? []).filter((p) => p.clienteId === clienteId))),
    observarUsuarios: () => of([{ id: 'u1', nome: 'Carla Comercial', perfil: 'COMERCIAL' }]),
    observarEstadoSync: () => of({ naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() }),
  };
  const osRepo = {
    observarDoCliente: vi.fn((clienteId: string) => of((opcoes.os ?? []).filter((o) => o.clienteId === clienteId))),
    observarEstadoSync: () => of({ naOutbox: new Set<string>(), comPendencia: new Set<string>(), comConflito: new Set<string>() }),
  };
  const repo = {
    buscar: opcoes.buscar ? vi.fn().mockReturnValue(opcoes.buscar) : vi.fn().mockResolvedValue(paraClienteLocal('id1', 3, existente)),
    salvar: opcoes.salvar ?? vi.fn().mockResolvedValue('novo-id'),
    excluir: vi.fn().mockResolvedValue(undefined),
    temPendencia: vi.fn().mockResolvedValue(false),
  };
  const consultas = {
    buscarCep: vi.fn().mockResolvedValue({ logradouro: 'Praça da Sé', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' }),
    buscarCnpj: vi.fn().mockResolvedValue(null),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ClientesRepo, useValue: repo },
      { provide: ConsultasExternas, useValue: consultas },
      { provide: ConectividadeService, useValue: { online: signal(true) } },
      { provide: PropostasRepo, useValue: propostas },
      { provide: OsRepo, useValue: osRepo },
      { provide: AuthService, useValue: { usuario: signal({ id: 'u1', nome: 'U', email: 'u@u', perfil: opcoes.perfil ?? 'COMERCIAL', ativo: true }) } },
    ],
  });
  const fixture = TestBed.createComponent(ClienteFormPage);
  if (opcoes.id) fixture.componentRef.setInput('id', opcoes.id);
  if (opcoes.voltar !== undefined) fixture.componentRef.setInput('voltar', opcoes.voltar);
  fixture.detectChanges();
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return { fixture, repo, consultas, navegar, propostas, osRepo, el: fixture.nativeElement as HTMLElement };
}

function digitar(fixture: ComponentFixture<unknown>, seletor: string, valor: string) {
  const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement | HTMLSelectElement>(seletor)!;
  el.value = valor;
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'));
  fixture.detectChanges();
}

const clicar = (el: HTMLElement, seletor: string) => el.querySelector<HTMLButtonElement>(seletor)!.click();

describe('ClienteFormPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('novo PF: mascara o CPF e salva dados normalizados', async () => {
    const { fixture, el, repo, navegar } = montar();
    digitar(fixture, '#documento', '52998224725');
    expect(el.querySelector<HTMLInputElement>('#documento')!.value).toBe('529.982.247-25');
    digitar(fixture, '#nome', '  Maria  ');
    digitar(fixture, '#telefone', '11999998888');
    clicar(el, 'button[type=submit]');

    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/clientes'));
    const [dados, id] = repo.salvar.mock.calls[0];
    expect(id).toBeUndefined();
    expect(dados).toMatchObject({ tipo: 'PF', documento: '52998224725', nome: 'Maria', telefone: '11999998888', nomeFantasia: null, enderecos: [] });
  });

  it('falha ao ler o cliente: avisa, esconde Salvar e Excluir e não salva', async () => {
    const { fixture, el, repo } = montar({ id: 'id1', buscar: Promise.reject(new Error('IndexedDB indisponível')) });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.textContent).toContain('Não foi possível carregar o cliente.');
    });
    expect(el.querySelector('button[type=submit]')).toBeNull();
    expect(el.querySelector('[data-testid=excluir]')).toBeNull();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await new Promise((r) => setTimeout(r, 10));
    expect(repo.salvar).not.toHaveBeenCalled();
    expect(fixture.componentInstance.temAlteracoes()).toBe(false);
  });

  it('CPF inválido mostra erro e não salva', async () => {
    const { fixture, el, repo } = montar();
    digitar(fixture, '#documento', '52998224724');
    digitar(fixture, '#nome', 'Maria');
    clicar(el, 'button[type=submit]');
    fixture.detectChanges();
    expect(el.textContent).toContain('CPF inválido.');
    expect(repo.salvar).not.toHaveBeenCalled();
  });

  it('PJ aceita CNPJ alfanumérico e mostra campos de empresa', async () => {
    const { fixture, el, repo } = montar();
    digitar(fixture, '#tipo', 'PJ');
    expect(el.querySelector('label[for=nome]')?.textContent).toContain('Razão social');
    digitar(fixture, '#documento', '12abc34501de35');
    expect(el.querySelector<HTMLInputElement>('#documento')!.value).toBe('12.ABC.345/01DE-35');
    digitar(fixture, '#nome', 'ACME Ltda');
    digitar(fixture, '#nomeFantasia', 'ACME');
    clicar(el, 'button[type=submit]');

    await vi.waitFor(() => expect(repo.salvar).toHaveBeenCalled());
    expect(repo.salvar.mock.calls[0][0]).toMatchObject({ tipo: 'PJ', documento: '12ABC34501DE35', nomeFantasia: 'ACME' });
  });

  it('edição carrega o cliente e salva com o mesmo id', async () => {
    const { fixture, el, repo } = montar({ id: 'id1' });
    await vi.waitFor(() => expect(el.querySelector<HTMLInputElement>('#nome')!.value).toBe('Maria'));
    expect(el.querySelector<HTMLInputElement>('#documento')!.value).toBe('529.982.247-25');
    expect(el.querySelector<HTMLInputElement>('#telefone')!.value).toBe('(11) 99999-8888');
    expect(el.querySelectorAll('[data-testid=endereco]')).toHaveLength(1);

    digitar(fixture, '#nome', 'Maria Souza');
    clicar(el, 'button[type=submit]');

    await vi.waitFor(() => expect(repo.salvar).toHaveBeenCalled());
    const [dados, id, versao] = repo.salvar.mock.calls[0];
    expect(id).toBe('id1');
    expect(versao).toBe(3);
    expect(dados.nome).toBe('Maria Souza');
    expect(dados.enderecos[0]).toMatchObject({ cep: '01001000', uf: 'SP' });
  });

  it('documento repetido neste aparelho aparece no campo', async () => {
    const salvar = vi.fn().mockRejectedValue(new ErroCampo('documento', 'Já existe um cliente com este CPF/CNPJ neste aparelho.'));
    const { fixture, el } = montar({ salvar });
    digitar(fixture, '#documento', '52998224725');
    digitar(fixture, '#nome', 'Maria');
    clicar(el, 'button[type=submit]');

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.textContent).toContain('Já existe um cliente com este CPF/CNPJ neste aparelho.');
    });
  });

  it('busca CEP e preenche o endereço', async () => {
    const { fixture, el, consultas } = montar();
    clicar(el, '[data-testid=adicionar-endereco]');
    fixture.detectChanges();
    digitar(fixture, '[data-testid=endereco] input[formcontrolname=cep]', '01001000');
    clicar(el, '[data-testid=buscar-cep]');

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector<HTMLInputElement>('[data-testid=endereco] input[formcontrolname=cidade]')!.value).toBe('São Paulo');
    });
    expect(consultas.buscarCep).toHaveBeenCalledWith('01001-000');
  });

  it('excluir pede confirmação', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { el, repo, navegar } = montar({ id: 'id1' });
    await vi.waitFor(() => expect(el.querySelector<HTMLInputElement>('#nome')!.value).toBe('Maria'));
    clicar(el, '[data-testid=excluir]');
    await vi.waitFor(() => expect(repo.excluir).toHaveBeenCalledWith('id1', 3));
    expect(navegar).toHaveBeenCalledWith('/clientes');
  });

  it('limita a 10 endereços', () => {
    const { fixture, el } = montar();
    for (let i = 0; i < 11; i++) {
      el.querySelector<HTMLButtonElement>('[data-testid=adicionar-endereco]')!.click();
      fixture.detectChanges();
    }
    expect(el.querySelectorAll('[data-testid=endereco]')).toHaveLength(10);
    expect(el.querySelector<HTMLButtonElement>('[data-testid=adicionar-endereco]')!.disabled).toBe(true);
    expect(el.textContent).toContain('Máximo de 10 endereços.');
  });

  it('envio inválido não salva e mostra aviso geral', () => {
    const { fixture, el, repo } = montar();
    digitar(fixture, '#documento', '52998224725');
    digitar(fixture, '#nome', 'Maria');
    clicar(el, '[data-testid=adicionar-endereco]');
    fixture.detectChanges();
    digitar(fixture, '[data-testid=endereco] input[formcontrolname=uf]', 'X1');
    clicar(el, 'button[type=submit]');
    fixture.detectChanges();
    expect(repo.salvar).not.toHaveBeenCalled();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Corrija os campos destacados.');
    expect(el.textContent).toContain('UF inválida.');
  });

  it('falha ao excluir mostra erro e não navega', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { el, repo, navegar } = montar({ id: 'id1' });
    const erro = vi.spyOn(TestBed.inject(Toasts), 'erro');
    repo.excluir.mockRejectedValue(new Error('x'));
    await vi.waitFor(() => expect(el.querySelector('[data-testid=excluir]')).not.toBeNull());
    clicar(el, '[data-testid=excluir]');
    await vi.waitFor(() => expect(erro).toHaveBeenCalledWith('Não foi possível excluir o cliente.'));
    expect(navegar).not.toHaveBeenCalled();
  });

  it('CEP sem logradouro mantém o digitado', async () => {
    const { fixture, el, consultas } = montar();
    consultas.buscarCep.mockResolvedValue({ logradouro: null, bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' });
    clicar(el, '[data-testid=adicionar-endereco]');
    fixture.detectChanges();
    digitar(fixture, '[data-testid=endereco] input[formcontrolname=logradouro]', 'Rua Minha');
    digitar(fixture, '[data-testid=endereco] input[formcontrolname=cep]', '01001000');
    clicar(el, '[data-testid=buscar-cep]');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector<HTMLInputElement>('[data-testid=endereco] input[formcontrolname=cidade]')!.value).toBe('São Paulo');
    });
    expect(el.querySelector<HTMLInputElement>('[data-testid=endereco] input[formcontrolname=logradouro]')!.value).toBe('Rua Minha');
  });

  it('cancelar a confirmação não exclui', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { el, repo } = montar({ id: 'id1' });
    await vi.waitFor(() => expect(el.querySelector('[data-testid=excluir]')).not.toBeNull());
    clicar(el, '[data-testid=excluir]');
    expect(repo.excluir).not.toHaveBeenCalled();
  });
  describe('voltar (Cadastrar cliente do wizard da proposta)', () => {
    async function salvarNovo(voltar: string) {
      const m = montar({ voltar });
      digitar(m.fixture, '#documento', '52998224725');
      digitar(m.fixture, '#nome', 'Maria');
      clicar(m.el, 'button[type=submit]');
      await vi.waitFor(() => expect(m.navegar).toHaveBeenCalled());
      return m;
    }

    it('salvo, volta ao wizard com o clienteId novo', async () => {
      const { navegar, fixture } = await salvarNovo('/propostas/nova?tipo=LOCACAO');
      expect(navegar).toHaveBeenCalledWith('/propostas/nova?tipo=LOCACAO&clienteId=novo-id');
      expect(fixture.componentInstance.temAlteracoes()).toBe(false);
    });

    it('o link do topo volta à proposta, sem o clienteId', () => {
      const { el } = montar({ voltar: '/propostas/p1/editar?passo=1' });
      const link = el.querySelector<HTMLAnchorElement>('a')!;
      expect(link.textContent).toContain('Voltar à proposta');
      expect(link.getAttribute('href')).toBe('/propostas/p1/editar?passo=1');
      // M3: alvo de 48 px, como o "← Propostas" do detalhe
      expect(link.classList).toContain('min-h-12');
      expect(link.classList).toContain('inline-flex');
    });

    it.each(['https://evil.example/propostas/nova', '//evil.example/propostas/nova', '/usuarios', '/propostas/../usuarios'])(
      'voltar inválido (%s) é ignorado: vai para /clientes',
      async (voltar) => {
        const { navegar, el } = await salvarNovo(voltar);
        expect(navegar).toHaveBeenCalledWith('/clientes');
        expect(el.querySelector('a')!.getAttribute('href')).toBe('/clientes');
      },
    );
  });

  it('alterações não salvas: limpo ao abrir, sujo ao editar, limpo depois de salvar', async () => {
    const { fixture, el, navegar } = montar();
    const pagina = fixture.componentInstance;
    expect(pagina.temAlteracoes()).toBe(false);
    digitar(fixture, '#documento', '52998224725');
    expect(pagina.temAlteracoes()).toBe(true);
    digitar(fixture, '#nome', 'Maria');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/clientes'));
    expect(pagina.temAlteracoes()).toBe(false);
  });

  it('alterações não salvas na edição: limpo depois de carregar, sujo ao remover endereço, excluir libera', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, el, navegar } = montar({ id: 'id1' });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelectorAll('[data-testid=endereco]').length).toBe(1);
    });
    const pagina = fixture.componentInstance;
    expect(pagina.temAlteracoes()).toBe(false);
    [...el.querySelectorAll<HTMLButtonElement>('[data-testid=endereco] button')].find((b) => b.textContent?.trim() === 'Remover')!.click();
    fixture.detectChanges();
    expect(pagina.temAlteracoes()).toBe(true);
    clicar(el, '[data-testid=excluir]');
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/clientes'));
    expect(pagina.temAlteracoes()).toBe(false);
  });

  describe('Propostas do cliente', () => {
    const secao = (el: HTMLElement) => el.querySelector('[data-testid="propostas-do-cliente"]');

    it('mostra só as propostas deste cliente, com o responsável e o total', async () => {
      const lista = [
        propostaDe('a', { numero: 277, revisao: 1, status: 'ENVIADA' }),
        propostaDe('b', { clienteId: 'outro', numero: 9 }),
        propostaDe('c', { codigoProvisorio: 'PROV-ZZZ999' }),
      ];
      const { fixture, el, propostas } = montar({ id: 'id1', propostas: lista });
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(secao(el)!.textContent).toContain('Maria');
      });
      expect(propostas.observarDoCliente).toHaveBeenCalledWith('id1');
      const cards = secao(el)!.querySelectorAll('app-proposta-card');
      expect(cards.length).toBe(2);
      expect(secao(el)!.textContent).toContain('000277');
      expect(secao(el)!.textContent).toContain('PROV-ZZZ999');
      expect(secao(el)!.textContent).not.toContain('000009');
      expect(cards[0].textContent).toContain('Maria');
      expect(cards[0].textContent).toContain('Responsável: Carla Comercial');
      expect(cards[0].textContent).toContain('R$');
      expect(secao(el)!.textContent).not.toContain('Nenhuma proposta para este cliente.');
    });

    it('M2-P3: os cards levam os selos das OS da proposta (as do cliente que o perfil vê)', async () => {
      const osDe = (id: string, propostaId: string, status: OsLocal['status']): OsLocal => paraOsLocal(id, 1, {
        codigoProvisorio: 'OSP-AAAAAA', propostaId, clienteId: 'id1', tipo: 'SERVICO', status, urgente: false, concluiProposta: true,
        assinaturaRecusada: false, itens: [], notas: [],
      });
      const { fixture, el, osRepo } = montar({
        id: 'id1',
        propostas: [propostaDe('a', { numero: 277, revisao: 1, status: 'EM_EXECUCAO' }), propostaDe('c', { numero: 278, revisao: 1, status: 'APROVADA' })],
        os: [osDe('o1', 'a', 'EM_ANDAMENTO'), osDe('o2', 'c', 'CANCELADA')],
      });
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(secao(el)!.querySelectorAll('app-proposta-card')).toHaveLength(2);
      });
      expect(osRepo.observarDoCliente).toHaveBeenCalledWith('id1');
      const selos = (i: number) =>
        [...secao(el)!.querySelectorAll('app-proposta-card')[i].querySelectorAll('[data-selo]')].map((s) => s.getAttribute('data-selo'));
      expect(selos(0)).toEqual(['os-em-andamento']);
      expect(selos(1)).toEqual(['os-cancelada']);
    });

    it('N4: "Carregando…" e o vazio numa região de status fixa', async () => {
      const { fixture, el } = montar({ id: 'id1' });
      await fixture.whenStable();
      fixture.detectChanges();
      const regiao = secao(el)!.querySelector('[role=status]')!;
      expect(regiao.textContent?.trim()).toBe('Nenhuma proposta para este cliente.');
    });

    it('sem propostas: texto vazio e "Nova proposta" com o clienteId', async () => {
      const { fixture, el } = montar({ id: 'id1' });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(secao(el)!.textContent).toContain('Nenhuma proposta para este cliente.');
      const nova = el.querySelector<HTMLAnchorElement>('[data-testid="nova-proposta"]')!;
      expect(nova.textContent).toContain('Nova proposta');
      expect(nova.getAttribute('href')).toBe('/propostas/nova?clienteId=id1');
    });

    it('o técnico não tem o botão "Nova proposta" nem vê valores', async () => {
      const { fixture, el } = montar({ id: 'id1', perfil: 'TECNICO', propostas: [propostaDe('a')] });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="nova-proposta"]')).toBeNull();
      expect(secao(el)!.textContent).not.toContain('R$');
    });

    it('cliente novo: sem a seção', () => {
      const { el, propostas } = montar();
      expect(secao(el)).toBeNull();
      expect(propostas.observarDoCliente).not.toHaveBeenCalled();
    });

    it('a seção não conta como alteração do formulário', async () => {
      const { fixture, el } = montar({ id: 'id1', propostas: [propostaDe('a')] });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(secao(el)).not.toBeNull();
      expect(fixture.componentInstance.temAlteracoes()).toBe(false);
    });
  });

  describe('Ordens de serviço do cliente (M2-P3)', () => {
    const secao = (el: HTMLElement) => el.querySelector('[data-testid="os-do-cliente"]');
    const osDe = (id: string, clienteId: string, numero: number) => paraOsLocal(id, 1, {
      codigoProvisorio: 'OSP-K7Q2ZP', numero, revisao: 1, clienteId, tipo: 'INSTALACAO', status: 'ABERTA', urgente: false,
      concluiProposta: true, assinaturaRecusada: false, itens: [], notas: [],
    });

    it('editando: o bloco vem depois das propostas, com as OS deste cliente (o card leva a /os/:id)', async () => {
      const { fixture, el, osRepo } = montar({ id: 'id1', os: [osDe('o1', 'id1', 123), osDe('o2', 'outro', 9)] });
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(secao(el)!.textContent).toContain('Maria');
      });
      expect(osRepo.observarDoCliente).toHaveBeenCalledWith('id1');
      expect(secao(el)!.textContent).toContain('Ordens de serviço');
      expect(secao(el)!.textContent).toContain('OS-000123');
      expect(secao(el)!.textContent).not.toContain('OS-000009');
      expect(secao(el)!.querySelector('a')?.getAttribute('href')).toBe('/os/o1');
      const propostas = el.querySelector('[data-testid="propostas-do-cliente"]')!;
      expect(propostas.compareDocumentPosition(secao(el)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(fixture.componentInstance.temAlteracoes()).toBe(false);
    });

    it('sem OS: o estado vazio', async () => {
      const { fixture, el } = montar({ id: 'id1' });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(secao(el)!.textContent).toContain('Nenhuma OS para este cliente.');
    });

    it('cliente novo: sem o bloco', () => {
      const { el, osRepo } = montar();
      expect(secao(el)).toBeNull();
      expect(osRepo.observarDoCliente).not.toHaveBeenCalled();
    });
  });
});
