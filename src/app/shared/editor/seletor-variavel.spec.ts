import { TestBed } from '@angular/core/testing';
import { VARIAVEIS } from '../../features/templates/template-models';
import { SeletorVariavel } from './seletor-variavel';

const tecla = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

async function montar() {
  const fixture = TestBed.createComponent(SeletorVariavel);
  const escolhidas: string[] = [];
  fixture.componentInstance.escolher.subscribe((n) => escolhidas.push(n));
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const botao = el.querySelector<HTMLButtonElement>('button')!;
  const lista = () => el.querySelector<HTMLElement>('[role=listbox]');
  const abrir = async () => {
    botao.click();
    await fixture.whenStable();
  };
  return { fixture, el, botao, lista, abrir, escolhidas };
}

describe('SeletorVariavel', () => {
  it('botão de disclosure "Inserir variável" com aria-haspopup=listbox e aria-expanded', async () => {
    const { botao, lista, abrir } = await montar();

    expect(botao.textContent).toContain('Inserir variável');
    expect(botao.getAttribute('aria-haspopup')).toBe('listbox');
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    expect(lista()).toBeNull();

    await abrir();

    expect(botao.getAttribute('aria-expanded')).toBe('true');
    expect(botao.getAttribute('aria-controls')).toBe(lista()!.id);
    expect(document.activeElement).toBe(lista());
    const opcoes = Array.from(lista()!.querySelectorAll('[role=option]'));
    expect(opcoes.map((o) => o.textContent?.trim())).toEqual(VARIAVEIS.map((v) => v.rotulo));
  });

  it('setas movem a opção ativa sem inserir; Enter insere a ativa e fecha', async () => {
    const { fixture, botao, lista, abrir, escolhidas } = await montar();
    await abrir();
    const l = lista()!;
    const ativa = () => l.querySelector(`#${l.getAttribute('aria-activedescendant')}`);
    expect(ativa()?.textContent?.trim()).toBe(VARIAVEIS[0].rotulo);

    tecla(l, 'ArrowDown');
    tecla(l, 'ArrowDown');
    tecla(l, 'ArrowUp');
    tecla(l, 'ArrowDown');
    await fixture.whenStable();
    expect(escolhidas).toEqual([]);
    expect(ativa()?.textContent?.trim()).toBe(VARIAVEIS[2].rotulo);
    expect(ativa()?.getAttribute('aria-selected')).toBe('true');

    tecla(l, 'End');
    await fixture.whenStable();
    expect(ativa()?.textContent?.trim()).toBe(VARIAVEIS[VARIAVEIS.length - 1].rotulo);
    tecla(l, 'Home');
    tecla(l, 'ArrowDown');
    tecla(l, 'Enter');
    await fixture.whenStable();

    expect(escolhidas).toEqual([VARIAVEIS[1].nome]);
    expect(lista()).toBeNull();
    expect(botao.getAttribute('aria-expanded')).toBe('false');
  });

  it('Espaço também insere; clique numa opção insere', async () => {
    const { fixture, lista, abrir, escolhidas } = await montar();
    await abrir();
    tecla(lista()!, ' ');
    await fixture.whenStable();
    expect(escolhidas).toEqual([VARIAVEIS[0].nome]);

    await abrir();
    lista()!.querySelectorAll<HTMLElement>('[role=option]')[5].click();
    await fixture.whenStable();
    expect(escolhidas).toEqual([VARIAVEIS[0].nome, VARIAVEIS[5].nome]);
    expect(lista()).toBeNull();
  });

  it('Esc fecha sem inserir e devolve o foco ao botão', async () => {
    const { fixture, botao, lista, abrir, escolhidas } = await montar();
    await abrir();

    tecla(lista()!, 'Escape');
    await fixture.whenStable();

    expect(lista()).toBeNull();
    expect(escolhidas).toEqual([]);
    expect(document.activeElement).toBe(botao);
  });

  it('seta para baixo no botão abre a lista; sair da lista fecha', async () => {
    const { fixture, botao, lista } = await montar();
    botao.focus();
    tecla(botao, 'ArrowDown');
    await fixture.whenStable();
    expect(lista()).not.toBeNull();

    lista()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    await fixture.whenStable();
    expect(lista()).toBeNull();
  });

  it('ids únicos por instância', async () => {
    const a = await montar();
    const b = await montar();
    await a.abrir();
    await b.abrir();

    expect(a.lista()!.id).not.toBe(b.lista()!.id);
  });
});
