import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { ArquivosService } from '../../core/arquivos/arquivos-service';
import { ImagemService } from '../../core/arquivos/imagem-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { ErroCampo } from '../../core/util/erro-campo';
import { CatalogoRepo } from './catalogo-repo';
import { ItemFormPage } from './item-form-page';
import { ItemCatalogoDados, paraItemLocal } from './item-models';

const existente: ItemCatalogoDados = {
  natureza: 'PRODUTO', codigo: 'PNL', nome: 'Painel', descricao: '550 W', unidade: 'un', precoCusto: 800,
  precoVenda: 1250.5, locavel: false, precoLocacaoMensal: null, fotoArquivoId: null, ativo: true,
};

function montar(opcoes: { id?: string; online?: boolean; salvar?: ReturnType<typeof vi.fn> } = {}) {
  const repo = {
    buscar: vi.fn().mockResolvedValue(paraItemLocal('i1', 4, existente)),
    salvar: opcoes.salvar ?? vi.fn().mockResolvedValue('novo'),
    excluir: vi.fn().mockResolvedValue(undefined),
    temPendencia: vi.fn().mockResolvedValue(false),
  };
  const arquivos = {
    enviar: vi.fn().mockResolvedValue({ id: 'foto-1', nome: 'f.jpg', mime: 'image/jpeg', tamanho: 3, sha256: 'x' }),
    obterUrl: vi.fn().mockResolvedValue('blob:foto'),
  };
  const imagem = { redimensionar: vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' })) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: CatalogoRepo, useValue: repo },
      { provide: ArquivosService, useValue: arquivos },
      { provide: ImagemService, useValue: imagem },
      { provide: ConectividadeService, useValue: { online: signal(opcoes.online ?? true) } },
    ],
  });
  const fixture = TestBed.createComponent(ItemFormPage);
  if (opcoes.id) fixture.componentRef.setInput('id', opcoes.id);
  fixture.detectChanges();
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return { fixture, el: fixture.nativeElement as HTMLElement, repo, arquivos, imagem, navegar };
}

function digitar(fixture: ComponentFixture<unknown>, seletor: string, valor: string) {
  const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(seletor)!;
  el.value = valor;
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'));
  fixture.detectChanges();
}

const enviar = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();

describe('ItemFormPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('novo item: código em maiúsculas e preços em formato brasileiro', async () => {
    const { fixture, el, repo, navegar } = montar();
    digitar(fixture, '#codigo', 'pnl-9');
    expect(el.querySelector<HTMLInputElement>('#codigo')!.value).toBe('PNL-9');
    digitar(fixture, '#nome', 'Painel 9');
    digitar(fixture, '#precoCusto', '800');
    digitar(fixture, '#precoVenda', '1.250,50');
    enviar(el);

    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/catalogo'));
    const [dados, id, versao] = repo.salvar.mock.calls[0];
    expect(id).toBeUndefined();
    expect(versao).toBeUndefined();
    expect(dados).toMatchObject({ codigo: 'PNL-9', nome: 'Painel 9', precoCusto: 800, precoVenda: 1250.5, unidade: 'un', ativo: true });
  });

  it('preço inválido mostra erro e não salva', () => {
    const { fixture, el, repo } = montar();
    digitar(fixture, '#codigo', 'X');
    digitar(fixture, '#nome', 'X');
    digitar(fixture, '#precoVenda', '12,345');
    enviar(el);
    fixture.detectChanges();
    expect(el.textContent).toContain('Valor inválido.');
    expect(repo.salvar).not.toHaveBeenCalled();
  });

  it('código e nome só com espaços mostram erro e não salvam', () => {
    const { fixture, el, repo } = montar();
    digitar(fixture, '#codigo', '   ');
    digitar(fixture, '#nome', '   ');
    digitar(fixture, '#precoVenda', '1');
    enviar(el);
    fixture.detectChanges();
    expect(el.textContent).toContain('Informe o código.');
    expect(el.textContent).toContain('Informe o nome.');
    expect(repo.salvar).not.toHaveBeenCalled();
  });

  it('locável exige preço de locação', () => {
    const { fixture, el, repo } = montar();
    digitar(fixture, '#codigo', 'GER');
    digitar(fixture, '#nome', 'Gerador');
    digitar(fixture, '#precoVenda', '100');
    el.querySelector<HTMLInputElement>('#locavel')!.click();
    fixture.detectChanges();
    enviar(el);
    fixture.detectChanges();
    expect(el.textContent).toContain('Informe o preço de locação mensal.');
    expect(repo.salvar).not.toHaveBeenCalled();
  });

  it('edição carrega, mostra a margem e salva com a versão carregada', async () => {
    const { fixture, el, repo } = montar({ id: 'i1' });
    await vi.waitFor(() => expect(el.querySelector<HTMLInputElement>('#precoVenda')!.value).toBe('1.250,50'));
    fixture.detectChanges();
    expect(el.textContent).toContain('Margem: 36,0%');
    digitar(fixture, '#nome', 'Painel novo');
    enviar(el);
    await vi.waitFor(() => expect(repo.salvar).toHaveBeenCalled());
    expect(repo.salvar.mock.calls[0][1]).toBe('i1');
    expect(repo.salvar.mock.calls[0][2]).toBe(4);
  });

  it('foto: redimensiona para 800 px, envia e usa o id no salvar', async () => {
    const { fixture, el, repo, imagem, arquivos } = montar();
    const input = el.querySelector<HTMLInputElement>('#foto')!;
    Object.defineProperty(input, 'files', { value: [new File(['abc'], 'grande.jpg', { type: 'image/jpeg' })] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(arquivos.enviar).toHaveBeenCalled());
    expect(imagem.redimensionar).toHaveBeenCalledWith(expect.any(File), 800, 'image/jpeg');

    digitar(fixture, '#codigo', 'F');
    digitar(fixture, '#nome', 'Com foto');
    digitar(fixture, '#precoVenda', '1');
    enviar(el);
    await vi.waitFor(() => expect(repo.salvar).toHaveBeenCalled());
    expect(repo.salvar.mock.calls[0][0].fotoArquivoId).toBe('foto-1');
  });

  it('offline não permite trocar a foto, mas salva o item', () => {
    const { el } = montar({ online: false });
    expect(el.querySelector<HTMLInputElement>('#foto')!.disabled).toBe(true);
    expect(el.textContent).toContain('A foto precisa de internet.');
  });

  it('código repetido no aparelho aparece no campo', async () => {
    const salvar = vi.fn().mockRejectedValue(new ErroCampo('codigo', 'Já existe um item com este código neste aparelho.'));
    const { fixture, el } = montar({ salvar });
    digitar(fixture, '#codigo', 'PNL');
    digitar(fixture, '#nome', 'X');
    digitar(fixture, '#precoVenda', '1');
    enviar(el);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.textContent).toContain('Já existe um item com este código neste aparelho.');
    });
  });

  it('excluir pede confirmação e passa a versão carregada', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { el, repo, navegar } = montar({ id: 'i1' });
    await vi.waitFor(() => expect(repo.buscar).toHaveBeenCalled());
    await vi.waitFor(() => expect(el.querySelector('[data-testid=excluir]')).not.toBeNull());
    el.querySelector<HTMLButtonElement>('[data-testid=excluir]')!.click();
    await vi.waitFor(() => expect(repo.excluir).toHaveBeenCalledWith('i1', 4));
    expect(navegar).toHaveBeenCalledWith('/catalogo');
  });
});
