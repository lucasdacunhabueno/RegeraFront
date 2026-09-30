import { TestBed } from '@angular/core/testing';
import { VARIAVEIS } from './template-models';
import { TituloVariaveis } from './titulo-variaveis';

async function montar(valor: string) {
  const fixture = TestBed.createComponent(TituloVariaveis);
  fixture.componentRef.setInput('valor', valor);
  const emitidos: string[] = [];
  fixture.componentInstance.valor.subscribe((v) => emitidos.push(v));
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const input = el.querySelector<HTMLInputElement>('input')!;
  /** Abre "Inserir variável" e clica na opção da variável. */
  const escolher = async (nome: string) => {
    el.querySelector<HTMLButtonElement>('button[aria-haspopup=listbox]')!.click();
    await fixture.whenStable();
    el.querySelectorAll<HTMLElement>('[role=option]')[VARIAVEIS.findIndex((v) => v.nome === nome)].click();
    await fixture.whenStable();
  };
  return { fixture, el, input, escolher, emitidos };
}

describe('TituloVariaveis', () => {
  it('input h-12 com o valor recebido', async () => {
    const { input } = await montar('Proposta');

    expect(input.value).toBe('Proposta');
    expect(input.classList).toContain('h-12');
  });

  it('digitar emite valorChange', async () => {
    const { input, emitidos } = await montar('');

    input.value = 'Orçamento';
    input.dispatchEvent(new Event('input'));

    expect(emitidos).toEqual(['Orçamento']);
  });

  it('insere {{nome}} na posição do cursor, mesmo depois de o input perder o foco', async () => {
    const { el, input, escolher, emitidos } = await montar('Proposta  de');
    input.focus();
    input.setSelectionRange(9, 9);
    input.blur();

    await escolher('proposta.numero');

    expect(emitidos).toEqual(['Proposta {{proposta.numero}} de']);
    expect(input.value).toBe('Proposta {{proposta.numero}} de');
    expect(el.querySelector('[role=listbox]')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(9 + '{{proposta.numero}}'.length);
  });

  it('substitui o texto selecionado; sem cursor conhecido insere no fim', async () => {
    const { input, escolher, emitidos } = await montar('Proposta XXX');
    input.setSelectionRange(9, 12);
    await escolher('cliente.nome');
    expect(emitidos.at(-1)).toBe('Proposta {{cliente.nome}}');

    const outro = await montar('Para ');
    await outro.escolher('cliente.nome');
    expect(outro.emitidos).toEqual(['Para {{cliente.nome}}']);
  });

  it('mostra a contagem n/200 e o erro inline quando passa de 200', async () => {
    const { fixture, input } = await montar('Proposta');
    const el = fixture.nativeElement as HTMLElement;
    const contagem = () => el.querySelector('[data-testid=contagem-titulo]')?.textContent?.trim();
    const erro = () => el.querySelector('[role=alert]');

    expect(contagem()).toBe('8/200');
    expect(erro()).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('false');

    fixture.componentRef.setInput('valor', 'x'.repeat(190) + '{{proposta.numero}}');
    await fixture.whenStable();

    expect(contagem()).toBe('209/200');
    expect(erro()?.textContent?.trim()).toBe('Máximo de 200 caracteres.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(erro()!.id);
  });

  it('sem select nativo; id do input único por instância quando não informado', async () => {
    const a = await montar('');
    const b = await montar('');

    expect(a.el.querySelector('select')).toBeNull();
    expect(a.input.id).not.toBe('');
    expect(a.input.id).not.toBe(b.input.id);
    expect(a.el.querySelector(`#${a.input.id}-contagem`)).not.toBeNull();
  });
});
