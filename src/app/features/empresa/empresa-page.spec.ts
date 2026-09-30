import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ArquivosService } from '../../core/arquivos/arquivos-service';
import { ImagemService } from '../../core/arquivos/imagem-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { RegeraDb } from '../../core/db/regera-db';
import { EmpresaApi } from './empresa-api';
import { EmpresaDados } from './empresa-models';
import { EmpresaPage } from './empresa-page';

const dados: EmpresaDados = {
  razaoSocial: 'Regera Energia Ltda', nomeFantasia: 'Regera', cnpj: '11222333000181', endereco: 'Rua A, 1',
  telefone: '1133334444', email: 'c@regera.test', site: null, logoArquivoId: null, corPrimaria: '#1d4ed8',
  validadePadraoDias: 15, condicoesPagamentoPadrao: '50/50',
};

function montar(opcoes: { online?: boolean; obter?: unknown; salvar?: ReturnType<typeof vi.fn> } = {}) {
  const api = {
    obter: vi.fn().mockResolvedValue(opcoes.obter === undefined ? { version: 2, dados } : opcoes.obter),
    salvar: opcoes.salvar ?? vi.fn().mockResolvedValue({ version: 3, dados }),
  };
  const arquivos = {
    enviar: vi.fn().mockResolvedValue({ id: 'logo-1', nome: 'l.png', mime: 'image/png', tamanho: 1, sha256: 'x' }),
    obterUrl: vi.fn().mockResolvedValue('blob:logo'),
  };
  const imagem = { redimensionar: vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/png' })) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: EmpresaApi, useValue: api },
      { provide: ArquivosService, useValue: arquivos },
      { provide: ImagemService, useValue: imagem },
      { provide: ConectividadeService, useValue: { online: signal(opcoes.online ?? true) } },
    ],
  });
  const fixture = TestBed.createComponent(EmpresaPage);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, api, arquivos, imagem };
}

function digitar(fixture: ComponentFixture<unknown>, seletor: string, valor: string) {
  const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(seletor)!;
  el.value = valor;
  el.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

const enviar = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();

describe('EmpresaPage', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await TestBed.inject(RegeraDb).limparTudo();
  });

  it('carrega do servidor com CNPJ e telefone formatados', async () => {
    const { el } = montar();
    await vi.waitFor(() => expect(el.querySelector<HTMLInputElement>('#razaoSocial')!.value).toBe('Regera Energia Ltda'));
    expect(el.querySelector<HTMLInputElement>('#cnpj')!.value).toBe('11.222.333/0001-81');
    expect(el.querySelector<HTMLInputElement>('#telefone')!.value).toBe('(11) 3333-4444');
  });

  it('salva com a versão carregada, dados normalizados e grava a cópia local', async () => {
    const { fixture, el, api } = montar();
    await vi.waitFor(() => expect(el.querySelector<HTMLInputElement>('#razaoSocial')!.value).not.toBe(''));
    digitar(fixture, '#razaoSocial', 'Regera S.A.');
    enviar(el);
    await vi.waitFor(() => expect(api.salvar).toHaveBeenCalled());
    const [version, enviado] = api.salvar.mock.calls[0];
    expect(version).toBe(2);
    expect(enviado).toMatchObject({ razaoSocial: 'Regera S.A.', cnpj: '11222333000181', telefone: '1133334444' });
    await vi.waitFor(async () => expect((await TestBed.inject(RegeraDb).empresa.toArray())[0]?.version).toBe(3));
  });

  it('empresa ainda não cadastrada: formulário vazio e salva com version null', async () => {
    const { fixture, el, api } = montar({ obter: null });
    await vi.waitFor(() => expect(api.obter).toHaveBeenCalled());
    digitar(fixture, '#razaoSocial', 'Nova Ltda');
    enviar(el);
    await vi.waitFor(() => expect(api.salvar).toHaveBeenCalled());
    expect(api.salvar.mock.calls[0][0]).toBeNull();
  });

  it('razão social só com espaços bloqueia o salvar', async () => {
    const { fixture, el, api } = montar({ obter: null });
    await vi.waitFor(() => expect(api.obter).toHaveBeenCalled());
    digitar(fixture, '#razaoSocial', '   ');
    enviar(el);
    fixture.detectChanges();
    expect(el.textContent).toContain('Informe a razão social.');
    expect(api.salvar).not.toHaveBeenCalled();
  });

  it('CNPJ inválido bloqueia o salvar', async () => {
    const { fixture, el, api } = montar();
    await vi.waitFor(() => expect(el.querySelector<HTMLInputElement>('#cnpj')!.value).not.toBe(''));
    digitar(fixture, '#cnpj', '11222333000182');
    enviar(el);
    fixture.detectChanges();
    expect(el.textContent).toContain('CNPJ inválido.');
    expect(api.salvar).not.toHaveBeenCalled();
  });

  it('conflito de versão avisa e recarrega', async () => {
    const salvar = vi.fn().mockRejectedValue(new HttpErrorResponse({
      status: 409, error: { codigo: 'CONFLITO_VERSAO', detail: 'Os dados da empresa foram alterados por outra pessoa.' },
    }));
    const { el, api } = montar({ salvar });
    await vi.waitFor(() => expect(el.querySelector<HTMLInputElement>('#razaoSocial')!.value).not.toBe(''));
    enviar(el);
    await vi.waitFor(() => expect(api.obter).toHaveBeenCalledTimes(2));
  });

  it('logo: redimensiona para 400 px PNG, envia e salva o id', async () => {
    const { el, api, imagem, arquivos } = montar();
    await vi.waitFor(() => expect(el.querySelector<HTMLInputElement>('#razaoSocial')!.value).not.toBe(''));
    const input = el.querySelector<HTMLInputElement>('#logo')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'logo.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(imagem.redimensionar).toHaveBeenCalledWith(expect.any(File), 400, 'image/png'));
    await vi.waitFor(() => expect(arquivos.obterUrl).toHaveBeenCalledWith('logo-1'));
    enviar(el);
    await vi.waitFor(() => expect(api.salvar).toHaveBeenCalled());
    expect(api.salvar.mock.calls[0][1].logoArquivoId).toBe('logo-1');
  });

  it('offline mostra aviso e desabilita o salvar', async () => {
    const { el } = montar({ online: false });
    expect(el.textContent).toContain('precisa de internet');
    expect(el.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  });
});
