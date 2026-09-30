import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { ArquivosService } from '../../core/arquivos/arquivos-service';
import { ImagemService } from '../../core/arquivos/imagem-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { ErroCampo } from '../../core/util/erro-campo';
import { Toasts } from '../../shared/ui/toasts';
import { CatalogoRepo } from './catalogo-repo';
import { ItemFormPage } from './item-form-page';
import { ItemCatalogoDados, paraItemLocal } from './item-models';

const existente: ItemCatalogoDados = {
  natureza: 'PRODUTO', codigo: 'PNL', nome: 'Painel', descricao: '550 W', unidade: 'un', precoCusto: 800,
  precoVenda: 1250.5, locavel: false, precoLocacaoMensal: null, fotoArquivoId: null, ativo: true,
};

function montar(opcoes: { id?: string; online?: boolean; salvar?: ReturnType<typeof vi.fn>; buscar?: Promise<unknown> } = {}) {
  const repo = {
    buscar: opcoes.buscar ? vi.fn().mockReturnValue(opcoes.buscar) : vi.fn().mockResolvedValue(paraItemLocal('i1', 4, existente)),
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

  it('offline não permite trocar a foto, mas salva o item', async () => {
    const { fixture, el, repo, navegar } = montar({ online: false });
    expect(el.querySelector<HTMLInputElement>('#foto')!.disabled).toBe(true);
    expect(el.textContent).toContain('A foto precisa de internet.');
    digitar(fixture, '#codigo', 'OFF');
    digitar(fixture, '#nome', 'Offline');
    digitar(fixture, '#precoVenda', '10');
    enviar(el);
    await vi.waitFor(() => expect(repo.salvar).toHaveBeenCalled());
    expect(repo.salvar.mock.calls[0][0]).toMatchObject({ codigo: 'OFF', precoVenda: 10, fotoArquivoId: null });
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/catalogo'));
  });

  it('item inexistente no aparelho: avisa e esconde Salvar e Excluir', async () => {
    const { fixture, el } = montar({ id: 'sumiu', buscar: Promise.resolve(undefined) });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.textContent).toContain('Item não encontrado neste aparelho.');
    });
    expect(el.querySelector('button[type=submit]')).toBeNull();
    expect(el.querySelector('[data-testid=excluir]')).toBeNull();
  });

  it('edição: Salvar e Excluir ficam desabilitados até o item carregar', async () => {
    let resolver!: (v: unknown) => void;
    const { fixture, el, repo } = montar({ id: 'i1', buscar: new Promise((r) => (resolver = r)) });
    fixture.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[data-testid=excluir]')!.disabled).toBe(true);
    resolver(paraItemLocal('i1', 4, existente));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
    });
    expect(el.querySelector<HTMLButtonElement>('[data-testid=excluir]')!.disabled).toBe(false);
    expect(repo.buscar).toHaveBeenCalledWith('i1');
  });

  it('não salva duas vezes com cliques repetidos', async () => {
    const salvar = vi.fn().mockReturnValue(new Promise(() => undefined));
    const { fixture, el } = montar({ salvar });
    digitar(fixture, '#codigo', 'X');
    digitar(fixture, '#nome', 'X');
    digitar(fixture, '#precoVenda', '1');
    enviar(el);
    enviar(el);
    await vi.waitFor(() => expect(salvar).toHaveBeenCalled());
    expect(salvar).toHaveBeenCalledTimes(1);
  });

  it('remover a foto salva fotoArquivoId null e limpa o campo de arquivo', async () => {
    const { fixture, el, repo } = montar({ id: 'i1', buscar: Promise.resolve(paraItemLocal('i1', 4, { ...existente, fotoArquivoId: 'foto-velha' })) });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('img')).not.toBeNull();
    });
    const input = el.querySelector<HTMLInputElement>('#foto')!;
    let valor = 'C:\\fakepath\\f.jpg';
    Object.defineProperty(input, 'value', { get: () => valor, set: (v: string) => (valor = v), configurable: true });
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Remover foto')!.click();
    fixture.detectChanges();
    expect(el.querySelector('img')).toBeNull();
    expect(valor).toBe('');
    enviar(el);
    await vi.waitFor(() => expect(repo.salvar).toHaveBeenCalled());
    expect(repo.salvar.mock.calls[0][0].fotoArquivoId).toBeNull();
  });

  it('escolher foto limpa o campo de arquivo depois (sucesso ou erro)', async () => {
    const { el, arquivos } = montar();
    const input = el.querySelector<HTMLInputElement>('#foto')!;
    let valor = 'C:\\fakepath\\f.jpg';
    Object.defineProperty(input, 'value', { get: () => valor, set: (v: string) => (valor = v), configurable: true });
    Object.defineProperty(input, 'files', { value: [new File(['abc'], 'f.jpg', { type: 'image/jpeg' })] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(arquivos.obterUrl).toHaveBeenCalled());
    await vi.waitFor(() => expect(valor).toBe(''));

    valor = 'C:\\fakepath\\g.jpg';
    arquivos.enviar.mockRejectedValueOnce(new Error('Sem internet: envie a imagem quando a conexão voltar.'));
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(arquivos.enviar).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(valor).toBe(''));
  });

  it('falha no upload mostra toast com a mensagem do erro', async () => {
    const { el, arquivos } = montar();
    const erro = vi.spyOn(TestBed.inject(Toasts), 'erro');
    arquivos.enviar.mockRejectedValueOnce(new HttpErrorResponse({ status: 413, error: { detail: 'Arquivo grande demais.' } }));
    const input = el.querySelector<HTMLInputElement>('#foto')!;
    Object.defineProperty(input, 'files', { value: [new File(['abc'], 'f.jpg', { type: 'image/jpeg' })] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(erro).toHaveBeenCalledWith('Arquivo grande demais.'));

    arquivos.enviar.mockRejectedValueOnce(new Error('Sem internet: envie a imagem quando a conexão voltar.'));
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(erro).toHaveBeenCalledWith('Sem internet: envie a imagem quando a conexão voltar.'));
  });

  it('corrigir o preço limpa o erro do campo e o aviso geral', async () => {
    const { fixture, el } = montar();
    digitar(fixture, '#codigo', 'X');
    digitar(fixture, '#nome', 'X');
    digitar(fixture, '#precoVenda', '12,345');
    enviar(el);
    fixture.detectChanges();
    expect(el.textContent).toContain('Valor inválido.');
    expect(el.textContent).toContain('Corrija os campos destacados.');
    digitar(fixture, '#precoVenda', '12,34');
    expect(el.textContent).not.toContain('Valor inválido.');
    expect(el.textContent).not.toContain('Corrija os campos destacados.');
  });

  it('código em maiúsculas preserva a posição do cursor', () => {
    const { fixture, el } = montar();
    const input = el.querySelector<HTMLInputElement>('#codigo')!;
    input.value = 'abcd';
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(input.value).toBe('ABCD');
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(2);
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
    const { fixture, el, repo, navegar } = montar({ id: 'i1' });
    await vi.waitFor(() => expect(repo.buscar).toHaveBeenCalled());
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector<HTMLButtonElement>('[data-testid=excluir]')?.disabled).toBe(false);
    });
    el.querySelector<HTMLButtonElement>('[data-testid=excluir]')!.click();
    await vi.waitFor(() => expect(repo.excluir).toHaveBeenCalledWith('i1', 4));
    expect(navegar).toHaveBeenCalledWith('/catalogo');
  });
});
