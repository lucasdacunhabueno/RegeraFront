import { CdkDropList } from '@angular/cdk/drag-drop';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { RegeraDb } from '../../core/db/regera-db';
import { PdfService } from '../../core/pdf/pdf-service';
import { ErroCampo } from '../../core/util/erro-campo';
import { ID_EMPRESA, paraEmpresaLocal } from '../empresa/empresa-models';
import { Toasts } from '../../shared/ui/toasts';
import { Bloco, paraTemplateLocal, TemplateDados } from './template-models';
import { TemplateEditorPage } from './template-editor-page';
import { TemplatesRepo } from './templates-repo';

const blocosExistentes = (): Bloco[] => [
  { id: 'c1', tipo: 'CABECALHO', config: { mostrarLogo: true, mostrarDadosEmpresa: false, titulo: 'Orçamento' } },
  { id: 'i1', tipo: 'ITENS', config: { colunas: ['descricao', 'subtotal'], agruparPorNatureza: false } },
];
const existente = (blocos: Bloco[] = blocosExistentes()): TemplateDados => ({
  nome: 'Venda padrão', tipoProposta: 'SERVICO', padrao: true, ativo: true, blocos,
});
const empresa = paraEmpresaLocal(ID_EMPRESA, 1, { razaoSocial: 'Solar Ltda', logoArquivoId: 'logo-1' });

function montar(opcoes: { id?: string; dados?: TemplateDados; salvar?: ReturnType<typeof vi.fn>; pendencia?: boolean } = {}) {
  const repo = {
    buscar: vi.fn().mockResolvedValue(paraTemplateLocal('t1', 3, opcoes.dados ?? existente())),
    temPendencia: vi.fn().mockResolvedValue(opcoes.pendencia ?? false),
    salvar: opcoes.salvar ?? vi.fn().mockResolvedValue('novo'),
    excluir: vi.fn().mockResolvedValue(undefined),
  };
  const blob = new Blob(['%PDF'], { type: 'application/pdf' });
  const pdf = { gerarBlob: vi.fn().mockResolvedValue(blob), logoDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AAAA') };
  const db = { empresa: { get: vi.fn().mockResolvedValue(empresa) } };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: TemplatesRepo, useValue: repo },
      { provide: PdfService, useValue: pdf },
      { provide: RegeraDb, useValue: db },
    ],
  });
  const fixture = TestBed.createComponent(TemplateEditorPage);
  if (opcoes.id) fixture.componentRef.setInput('id', opcoes.id);
  fixture.detectChanges();
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const toast = vi.spyOn(TestBed.inject(Toasts), 'mostrar');
  const toastErro = vi.spyOn(TestBed.inject(Toasts), 'erro');
  return { fixture, el: fixture.nativeElement as HTMLElement, repo, pdf, db, navegar, toast, toastErro, blob };
}

async function estavel(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

/** Espera o carregamento assíncrono do template (repo mockado) terminar. */
async function carregado(fixture: ComponentFixture<unknown>) {
  const el = fixture.nativeElement as HTMLElement;
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Carregando…');
  });
  await estavel(fixture);
}

const tipos = (el: HTMLElement) => [...el.querySelectorAll('[data-testid=bloco-tipo]')].map((e) => e.textContent?.trim());
const cartoes = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('li[data-bloco-id]')];
const botaoDe = (li: HTMLElement, rotulo: string) => li.querySelector<HTMLButtonElement>(`button[aria-label="${rotulo}"]`)!;
const botaoTexto = (el: HTMLElement, texto: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === texto)!;

function digitar(fixture: ComponentFixture<unknown>, seletor: string, valor: string) {
  const campo = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(seletor)!;
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

const enviar = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();

describe('TemplateEditorPage', () => {
  let urls: number;
  const criar = vi.fn(() => `blob:http://localhost/previa-${++urls}`);
  const revogar = vi.fn();
  const originais = { criar: URL.createObjectURL, revogar: URL.revokeObjectURL, largura: window.innerWidth };

  beforeAll(() => {
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  });
  beforeEach(() => {
    urls = 0;
    criar.mockClear();
    revogar.mockClear();
    URL.createObjectURL = criar;
    URL.revokeObjectURL = revogar;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = originais.criar;
    URL.revokeObjectURL = originais.revogar;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originais.largura });
  });
  const largura = (px: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: px });

  describe('template novo', () => {
    it('começa com os 5 blocos iniciais', () => {
      const { el } = montar();
      expect(el.querySelector('h1')?.textContent).toContain('Novo template');
      expect(tipos(el)).toEqual(['Cabeçalho', 'Texto', 'Itens', 'Totais', 'Assinatura']);
      expect(el.querySelector<HTMLInputElement>('#nome')!.classList).toContain('h-12');
    });

    it('"+ Bloco" abre o menu com os seis tipos e adicionar QUEBRA deixa 6', async () => {
      const { fixture, el } = montar();
      const mais = botaoTexto(el, '+ Bloco');
      expect(mais.getAttribute('aria-expanded')).toBe('false');
      mais.click();
      await estavel(fixture);
      const itens = [...el.querySelectorAll('[role=menuitem]')].map((b) => b.textContent?.trim());
      expect(itens).toEqual(['Cabeçalho', 'Texto', 'Itens', 'Totais', 'Assinatura', 'Quebra de página']);

      // teclado: o foco vai para o primeiro tipo; setas navegam; Esc fecha e volta ao botão
      const itensMenu = [...el.querySelectorAll<HTMLButtonElement>('[role=menuitem]')];
      expect(document.activeElement).toBe(itensMenu[0]);
      const tecla = (key: string) =>
        (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      tecla('ArrowUp');
      expect(document.activeElement).toBe(itensMenu[5]);
      tecla('ArrowDown');
      expect(document.activeElement).toBe(itensMenu[0]);
      tecla('Escape');
      await estavel(fixture);
      expect(el.querySelectorAll('[role=menuitem]').length).toBe(0);
      expect(document.activeElement).toBe(mais);
      mais.click();
      await estavel(fixture);

      botaoTexto(el, 'Quebra de página').click();
      await estavel(fixture);
      expect(el.querySelectorAll('[role=menuitem]').length).toBe(0);
      expect(tipos(el)).toEqual(['Cabeçalho', 'Texto', 'Itens', 'Totais', 'Assinatura', 'Quebra de página']);
      const ids = cartoes(el).map((li) => li.dataset['blocoId']!);
      expect(new Set(ids).size).toBe(6);
      expect(ids[5]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    });

    it('↑ e ↓ reordenam e o foco fica no bloco movido', async () => {
      const { fixture, el } = montar();
      const [primeiro] = cartoes(el);
      expect(botaoDe(primeiro, 'Mover bloco para cima').disabled).toBe(true);
      botaoDe(primeiro, 'Mover bloco para baixo').click();
      await estavel(fixture);
      expect(tipos(el)).toEqual(['Texto', 'Cabeçalho', 'Itens', 'Totais', 'Assinatura']);
      expect(document.activeElement).toBe(botaoDe(cartoes(el)[1], 'Mover bloco para baixo'));
      expect(el.querySelector('[role=status]')?.textContent).toContain('posição 2 de 5');

      botaoDe(cartoes(el)[4], 'Mover bloco para cima').click();
      await estavel(fixture);
      expect(tipos(el)).toEqual(['Texto', 'Cabeçalho', 'Itens', 'Assinatura', 'Totais']);
      expect(botaoDe(cartoes(el)[4], 'Mover bloco para baixo').disabled).toBe(true);
    });

    it('arrastar (CDK drop) reordena com moveItemInArray', async () => {
      const { fixture, el } = montar();
      const lista = fixture.debugElement.query(By.directive(CdkDropList)).injector.get(CdkDropList);
      expect(cartoes(el)[0].querySelector('[cdkDragHandle], .cdk-drag-handle')?.getAttribute('aria-label')).toBe(
        'Arrastar para reordenar o bloco',
      );
      lista.dropped.emit({ previousIndex: 0, currentIndex: 3 } as never);
      await estavel(fixture);
      expect(tipos(el)).toEqual(['Texto', 'Itens', 'Totais', 'Cabeçalho', 'Assinatura']);
    });

    it('remover pede confirmação', async () => {
      const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
      const { fixture, el } = montar();
      botaoDe(cartoes(el)[1], 'Remover bloco').click();
      await estavel(fixture);
      expect(tipos(el).length).toBe(5);
      botaoDe(cartoes(el)[1], 'Remover bloco').click();
      await estavel(fixture);
      expect(confirmar).toHaveBeenCalledTimes(2);
      expect(tipos(el)).toEqual(['Cabeçalho', 'Itens', 'Totais', 'Assinatura']);
    });

    it('tocar no card abre a configuração do bloco em linha', async () => {
      const { fixture, el } = montar();
      const abrir = cartoes(el)[3].querySelector<HTMLButtonElement>('[data-testid=abrir-bloco]')!;
      expect(abrir.getAttribute('aria-expanded')).toBe('false');
      abrir.click();
      await estavel(fixture);
      expect(abrir.getAttribute('aria-expanded')).toBe('true');
      expect(cartoes(el)[3].querySelector('app-bloco-config input[name=mostrarDescontos]')).toBeTruthy();
      expect(el.querySelectorAll('app-bloco-config').length).toBe(1);

      cartoes(el)[3].querySelector<HTMLInputElement>('input[name=mostrarDescontos]')!.click();
      await estavel(fixture);
      expect(cartoes(el)[3].textContent).toContain('Sem descontos');
    });

    it('salvar chama repo.salvar com os blocos na ordem da tela e versão undefined', async () => {
      const { fixture, el, repo, navegar, toast } = montar();
      digitar(fixture, '#nome', '  Serviço básico  ');
      const tipo = el.querySelector<HTMLSelectElement>('#tipo')!;
      tipo.value = 'MANUTENCAO';
      tipo.dispatchEvent(new Event('change'));
      botaoDe(cartoes(el)[0], 'Mover bloco para baixo').click();
      await estavel(fixture);
      const ordem = cartoes(el).map((li) => li.dataset['blocoId']);

      enviar(el);
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/templates'));
      const [dados, id, versao] = repo.salvar.mock.calls[0];
      expect(id).toBeUndefined();
      expect(versao).toBeUndefined();
      expect(dados).toMatchObject({ nome: 'Serviço básico', tipoProposta: 'MANUTENCAO', ativo: true, padrao: false });
      expect((dados as TemplateDados).blocos.map((b) => b.id)).toEqual(ordem);
      expect((dados as TemplateDados).blocos.map((b) => b.tipo)).toEqual(['TEXTO', 'CABECALHO', 'ITENS', 'TOTAIS', 'ASSINATURA']);
      expect(toast).toHaveBeenCalledWith('Template salvo.');
    });

    it('nome vazio mostra erro e não salva', async () => {
      const { fixture, el, repo } = montar();
      enviar(el);
      await estavel(fixture);
      expect(el.textContent).toContain('Informe o nome.');
      expect(el.querySelector('[data-testid=erro-geral]')?.textContent).toContain('Corrija os campos destacados.');
      expect(repo.salvar).not.toHaveBeenCalled();
    });
  });

  describe('edição', () => {
    it('carrega o template e salva com a versão carregada', async () => {
      const { fixture, el, repo, navegar } = montar({ id: 't1' });
      await carregado(fixture);
      expect(el.querySelector('h1')?.textContent).toContain('Editar template');
      expect(el.querySelector<HTMLInputElement>('#nome')!.value).toBe('Venda padrão');
      expect(el.querySelector<HTMLSelectElement>('#tipo')!.value).toBe('SERVICO');
      expect(el.querySelector<HTMLInputElement>('#padrao')!.checked).toBe(true);
      expect(tipos(el)).toEqual(['Cabeçalho', 'Itens']);
      expect(cartoes(el)[0].textContent).toContain('Orçamento');
      expect(cartoes(el)[1].textContent).toContain('Descrição, Subtotal');

      enviar(el);
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/templates'));
      expect(repo.salvar).toHaveBeenCalledWith(existente(), 't1', 3);
    });

    it('ITENS sem colunas mostra o erro junto do bloco e não salva', async () => {
      const blocos = blocosExistentes();
      blocos[1] = { id: 'i1', tipo: 'ITENS', config: { colunas: [], agruparPorNatureza: false } };
      const { fixture, el, repo } = montar({ id: 't1', dados: existente(blocos) });
      await carregado(fixture);
      enviar(el);
      await estavel(fixture);
      expect(repo.salvar).not.toHaveBeenCalled();
      expect(cartoes(el)[1].querySelector('[data-testid=erro-bloco]')?.textContent).toContain('Escolha pelo menos uma opção.');
      expect(cartoes(el)[0].querySelector('[data-testid=erro-bloco]')).toBeNull();
      expect(el.querySelector('[data-testid=erro-geral]')?.textContent).toContain('Corrija os campos destacados.');
      // o bloco com erro fica aberto
      expect(cartoes(el)[1].querySelector('app-bloco-config')).toBeTruthy();
    });

    it('desmarcar Ativo desmarca e desabilita Padrão', async () => {
      const { fixture, el, repo } = montar({ id: 't1' });
      await carregado(fixture);
      const padrao = el.querySelector<HTMLInputElement>('#padrao')!;
      expect(padrao.disabled).toBe(false);
      el.querySelector<HTMLInputElement>('#ativo')!.click();
      await estavel(fixture);
      expect(padrao.checked).toBe(false);
      expect(padrao.disabled).toBe(true);
      enviar(el);
      await vi.waitFor(() => expect(repo.salvar).toHaveBeenCalled());
      expect(repo.salvar.mock.calls[0][0]).toMatchObject({ ativo: false, padrao: false });
    });

    it('ErroCampo("blocos") vindo do repo aparece', async () => {
      const salvar = vi.fn().mockRejectedValue(new ErroCampo('blocos', 'Template grande demais.'));
      const { fixture, el, navegar } = montar({ id: 't1', salvar });
      await carregado(fixture);
      enviar(el);
      await vi.waitFor(() => expect(salvar).toHaveBeenCalled());
      await estavel(fixture);
      expect(el.querySelector('[data-testid=erro-geral]')?.textContent).toContain('Template grande demais.');
      expect(navegar).not.toHaveBeenCalled();
    });

    it('pendência mostra a faixa com link para Pendências', async () => {
      const { fixture, el } = montar({ id: 't1', pendencia: true });
      await carregado(fixture);
      expect(el.textContent).toContain('pendência de sincronização');
      expect(el.querySelector('a[href="/pendencias"]')).toBeTruthy();
    });

    it('excluir pede confirmação e chama repo.excluir com a versão', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { fixture, el, repo, navegar } = montar({ id: 't1' });
      await carregado(fixture);
      el.querySelector<HTMLButtonElement>('[data-testid=excluir]')!.click();
      await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/templates'));
      expect(repo.excluir).toHaveBeenCalledWith('t1', 3);
    });

    it('bloco de tipo desconhecido (do pull) aparece na lista e a validação barra o salvar', async () => {
      const blocos = [...blocosExistentes(), { id: 'x', tipo: 'IMAGEM', config: {} } as unknown as Bloco];
      const { fixture, el, repo } = montar({ id: 't1', dados: existente(blocos) });
      await carregado(fixture);
      expect(tipos(el)).toEqual(['Cabeçalho', 'Itens', 'Bloco desconhecido']);
      enviar(el);
      await estavel(fixture);
      expect(repo.salvar).not.toHaveBeenCalled();
      expect(cartoes(el)[2].querySelector('[data-testid=erro-bloco]')?.textContent).toContain('Tipo de bloco desconhecido.');
    });
  });

  describe('prévia', () => {
    it('em 1280 px gera o blob com dados fictícios e mostra o iframe com blob:', async () => {
      largura(1280);
      const { fixture, el, pdf, db } = montar({ id: 't1' });
      await carregado(fixture);
      botaoTexto(el, 'Gerar prévia').click();
      await vi.waitFor(() => expect(criar).toHaveBeenCalled());
      await estavel(fixture);
      expect(db.empresa.get).toHaveBeenCalledWith(ID_EMPRESA);
      expect(pdf.logoDataUrl).toHaveBeenCalledWith(empresa);
      const entrada = pdf.gerarBlob.mock.calls[0][0];
      expect(entrada).toMatchObject({ previa: true, logoDataUrl: 'data:image/png;base64,AAAA', blocos: blocosExistentes() });
      expect(entrada.empresa.razaoSocial).toBe('Solar Ltda');
      const iframe = el.querySelector<HTMLIFrameElement>('iframe[title="Prévia do PDF"]')!;
      expect(iframe.getAttribute('src')).toBe('blob:http://localhost/previa-1');
    });

    it('mostra "Gerando prévia…" durante o processo e toast em caso de erro', async () => {
      largura(1280);
      const { fixture, el, pdf, toastErro } = montar();
      let falhar!: (e: Error) => void;
      pdf.gerarBlob.mockReturnValue(new Promise((_, rej) => (falhar = rej)));
      botaoTexto(el, 'Gerar prévia').click();
      await vi.waitFor(() => expect(pdf.gerarBlob).toHaveBeenCalled());
      await estavel(fixture);
      expect(el.textContent).toContain('Gerando prévia…');
      falhar(new Error('x'));
      await vi.waitFor(() => expect(toastErro).toHaveBeenCalledWith('Não foi possível gerar a prévia.'));
      await estavel(fixture);
      expect(el.textContent).not.toContain('Gerando prévia…');
    });

    it('em 390 px abre em nova aba; se o popup for bloqueado, mostra "Abrir prévia"', async () => {
      largura(390);
      const abrir = vi.spyOn(window, 'open').mockReturnValueOnce({} as Window).mockReturnValueOnce(null);
      const { fixture, el } = montar();
      botaoTexto(el, 'Gerar prévia').click();
      await vi.waitFor(() => expect(abrir).toHaveBeenCalledWith('blob:http://localhost/previa-1', '_blank'));
      await estavel(fixture);
      expect(el.querySelector('iframe')).toBeNull();
      expect([...el.querySelectorAll('a')].some((a) => a.textContent?.trim() === 'Abrir prévia')).toBe(false);

      botaoTexto(el, 'Gerar prévia').click();
      await vi.waitFor(() => expect(abrir).toHaveBeenCalledTimes(2));
      await estavel(fixture);
      const link = [...el.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Abrir prévia')!;
      expect(link.getAttribute('href')).toBe('blob:http://localhost/previa-2');
      expect(link.getAttribute('target')).toBe('_blank');
    });

    it('revoga o URL anterior a cada nova prévia e no destroy', async () => {
      largura(1280);
      const { fixture, el } = montar();
      botaoTexto(el, 'Gerar prévia').click();
      await vi.waitFor(() => expect(criar).toHaveBeenCalledTimes(1));
      await estavel(fixture);
      expect(revogar).not.toHaveBeenCalled();
      botaoTexto(el, 'Gerar prévia').click();
      await vi.waitFor(() => expect(criar).toHaveBeenCalledTimes(2));
      expect(revogar).toHaveBeenCalledWith('blob:http://localhost/previa-1');
      fixture.destroy();
      expect(revogar).toHaveBeenCalledWith('blob:http://localhost/previa-2');
    });

    it('usa os blocos da tela, não os salvos', async () => {
      largura(1280);
      const { fixture, el, pdf } = montar({ id: 't1' });
      await carregado(fixture);
      botaoTexto(el, '+ Bloco').click();
      await estavel(fixture);
      botaoTexto(el, 'Totais').click();
      await estavel(fixture);
      botaoTexto(el, 'Gerar prévia').click();
      await vi.waitFor(() => expect(pdf.gerarBlob).toHaveBeenCalled());
      expect(pdf.gerarBlob.mock.calls[0][0].blocos.map((b: Bloco) => b.tipo)).toEqual(['CABECALHO', 'ITENS', 'TOTAIS']);
    });
  });
});
