import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { EditorTexto } from '../../shared/editor/editor-texto';
import { BlocoConfig, resumoBloco } from './bloco-config';
import { Bloco, novoBloco, TiptapDoc } from './template-models';
import { TituloVariaveis } from './titulo-variaveis';

async function montar(bloco: Bloco) {
  const fixture = TestBed.createComponent(BlocoConfig);
  fixture.componentRef.setInput('bloco', bloco);
  const emitidos: Bloco['config'][] = [];
  fixture.componentInstance.configChange.subscribe((c) => emitidos.push(c));
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const campo = (seletor: string) => el.querySelector<HTMLInputElement>(seletor)!;
  const alternar = async (seletor: string) => {
    campo(seletor).click();
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, el, emitidos, campo, alternar, ultimo: () => emitidos[emitidos.length - 1] };
}

describe('BlocoConfig', () => {
  beforeAll(() => {
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  });

  it('CABECALHO: toggles de logo e de dados e o título com variáveis', async () => {
    const b = novoBloco('CABECALHO');
    const { fixture, campo, alternar, ultimo } = await montar(b);
    expect(campo('input[name=mostrarLogo]').checked).toBe(true);
    expect(campo('input[name=mostrarDadosEmpresa]').checked).toBe(true);

    await alternar('input[name=mostrarLogo]');
    expect(ultimo()).toEqual({ mostrarLogo: false, mostrarDadosEmpresa: true, titulo: 'Proposta {{proposta.numero}}' });

    await alternar('input[name=mostrarDadosEmpresa]');
    expect(ultimo()).toMatchObject({ mostrarDadosEmpresa: false });

    const titulo = fixture.debugElement.query(By.directive(TituloVariaveis));
    expect(titulo).toBeTruthy();
    const input = titulo.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Proposta {{proposta.numero}}');
    input.value = 'Orçamento';
    input.dispatchEvent(new Event('input'));
    expect(ultimo()).toMatchObject({ titulo: 'Orçamento' });
  });

  it('TEXTO: renderiza o editor e emite o conteúdo', async () => {
    const b = novoBloco('TEXTO');
    const { fixture, ultimo } = await montar(b);
    const editor = fixture.debugElement.query(By.directive(EditorTexto));
    expect(editor).toBeTruthy();
    const doc: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Olá' }] }] };
    (editor.componentInstance as EditorTexto).conteudoChange.emit(doc);
    expect(ultimo()).toEqual({ conteudo: doc });
  });

  it('ITENS: checkboxes das colunas na ordem do PDF, erro com nenhuma e toggle de agrupar', async () => {
    const b: Bloco = { id: 'i', tipo: 'ITENS', config: { colunas: ['descricao'], agruparPorNatureza: false } };
    const { fixture, el, campo, alternar, ultimo } = await montar(b);
    expect(el.querySelectorAll('input[name=coluna]').length).toBe(8);
    expect(campo('input[name=coluna][value=descricao]').checked).toBe(true);
    expect(campo('input[name=coluna][value=codigo]').checked).toBe(false);

    await alternar('input[name=coluna][value=subtotal]');
    expect(ultimo()).toEqual({ colunas: ['descricao', 'subtotal'], agruparPorNatureza: false });
    await alternar('input[name=coluna][value=codigo]');
    // ordem canônica (a mesma do PDF), não a ordem do clique
    expect(ultimo()).toEqual({ colunas: ['codigo', 'descricao'], agruparPorNatureza: false });

    await alternar('input[name=coluna][value=descricao]');
    expect(ultimo()).toEqual({ colunas: [], agruparPorNatureza: false });
    fixture.componentRef.setInput('bloco', { ...b, config: { colunas: [], agruparPorNatureza: false } });
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Escolha pelo menos uma coluna.');

    await alternar('input[name=agruparPorNatureza]');
    expect(ultimo()).toEqual({ colunas: [], agruparPorNatureza: true });
  });

  it('TOTAIS: toggle de descontos', async () => {
    const { campo, alternar, ultimo } = await montar(novoBloco('TOTAIS'));
    expect(campo('input[name=mostrarDescontos]').checked).toBe(true);
    await alternar('input[name=mostrarDescontos]');
    expect(ultimo()).toEqual({ mostrarDescontos: false });
  });

  it('ASSINATURA: checkboxes dos assinantes e erro com nenhum', async () => {
    const b: Bloco = { id: 'a', tipo: 'ASSINATURA', config: { assinantes: ['CLIENTE'] } };
    const { fixture, el, alternar, ultimo } = await montar(b);
    expect(el.querySelectorAll('input[name=assinante]').length).toBe(2);
    await alternar('input[name=assinante][value=EMPRESA]');
    expect(ultimo()).toEqual({ assinantes: ['EMPRESA', 'CLIENTE'] });
    fixture.componentRef.setInput('bloco', { ...b, config: { assinantes: [] } });
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Escolha pelo menos um assinante.');
  });

  it('QUEBRA_PAGINA: só o texto explicativo', async () => {
    const { el } = await montar(novoBloco('QUEBRA_PAGINA'));
    expect(el.querySelectorAll('input').length).toBe(0);
    expect(el.textContent).toContain('nova página');
  });

  it('bloco de tipo desconhecido (vindo do pull) não quebra a tela', async () => {
    const { el } = await montar({ id: 'x', tipo: 'IMAGEM', config: {} } as unknown as Bloco);
    expect(el.textContent).toContain('não é reconhecido');
  });
});

describe('resumoBloco', () => {
  it('um resumo por tipo', () => {
    expect(resumoBloco(novoBloco('CABECALHO'))).toBe('Proposta {{proposta.numero}}');
    const longo = 'a'.repeat(70);
    expect(
      resumoBloco({
        id: 't', tipo: 'TEXTO',
        config: { conteudo: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: longo }] }] } },
      }),
    ).toBe('a'.repeat(60) + '…');
    expect(
      resumoBloco({
        id: 't', tipo: 'TEXTO',
        config: {
          conteudo: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Olá ' }, { type: 'variavel', attrs: { nome: 'cliente.nome' } }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'fim' }] },
            ],
          },
        },
      }),
    ).toBe('Olá {{cliente.nome}} fim');
    expect(resumoBloco({ id: 'i', tipo: 'ITENS', config: { colunas: ['codigo', 'subtotal'], agruparPorNatureza: false } })).toBe(
      'Código, Subtotal',
    );
    expect(resumoBloco({ id: 'a', tipo: 'ASSINATURA', config: { assinantes: ['EMPRESA', 'CLIENTE'] } })).toBe(
      'Empresa (contratada), Cliente (contratante)',
    );
    expect(resumoBloco({ id: 'x', tipo: 'IMAGEM', config: {} } as unknown as Bloco)).toBe('');
  });
});
