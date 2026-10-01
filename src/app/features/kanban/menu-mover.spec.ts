import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { StatusProposta } from '../propostas/proposta-models';
import { MenuMover, MovimentoEscolhido } from './menu-mover';

@Component({
  imports: [MenuMover],
  template: `
    <app-menu-mover [destinos]="destinos()" [codigo]="'000277'" [bloqueado]="bloqueado()" (escolhido)="escolhidos.push($event)" />
    <button type="button" id="fora">Fora</button>
  `,
})
class Hospedeiro {
  readonly destinos = signal<StatusProposta[]>(['RASCUNHO', 'APROVADA', 'RECUSADA', 'CANCELADA']);
  readonly bloqueado = signal(false);
  readonly escolhidos: MovimentoEscolhido[] = [];
}

function montar() {
  const fixture = TestBed.createComponent(Hospedeiro);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const gatilho = () => el.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  const itens = () => [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  const tecla = (alvo: HTMLElement, key: string, shiftKey = false) => {
    alvo.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  };
  const abrir = async () => {
    gatilho().click();
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, el, gatilho, itens, tecla, abrir, host: fixture.componentInstance };
}

describe('MenuMover', () => {
  it('botão de menu acessível: aria-haspopup, aria-expanded, nome com o código da proposta', async () => {
    const { gatilho, itens, abrir, el } = montar();
    expect(gatilho().textContent).toContain('Mover para…');
    expect(gatilho().textContent).toContain('proposta 000277');
    expect(gatilho().getAttribute('aria-expanded')).toBe('false');
    expect(itens()).toEqual([]);
    await abrir();
    expect(gatilho().getAttribute('aria-expanded')).toBe('true');
    const menu = el.querySelector('[role="menu"]')!;
    expect(gatilho().getAttribute('aria-controls')).toBe(menu.id);
    expect(menu.getAttribute('aria-labelledby')).toBe(gatilho().id);
  });

  it('lista só os destinos recebidos, com os rótulos do status, e o foco vai ao primeiro', async () => {
    const { itens, abrir } = montar();
    await abrir();
    expect(itens().map((b) => b.textContent?.trim())).toEqual(['Rascunho', 'Aprovada', 'Recusada', 'Cancelada']);
    await vi.waitFor(() => expect(document.activeElement).toBe(itens()[0]));
  });

  it('setas, Home e End circulam pelos itens', async () => {
    const { itens, abrir, tecla } = montar();
    await abrir();
    await vi.waitFor(() => expect(document.activeElement).toBe(itens()[0]));
    tecla(itens()[0], 'ArrowDown');
    expect(document.activeElement).toBe(itens()[1]);
    tecla(itens()[1], 'ArrowUp');
    tecla(itens()[0], 'ArrowUp');
    expect(document.activeElement).toBe(itens()[3]);
    tecla(itens()[3], 'ArrowDown');
    expect(document.activeElement).toBe(itens()[0]);
    tecla(itens()[0], 'End');
    expect(document.activeElement).toBe(itens()[3]);
    tecla(itens()[3], 'Home');
    expect(document.activeElement).toBe(itens()[0]);
  });

  it('seta para cima no botão abre com o foco no último', async () => {
    const { gatilho, itens, tecla, fixture } = montar();
    tecla(gatilho(), 'ArrowUp');
    await fixture.whenStable();
    await vi.waitFor(() => expect(document.activeElement).toBe(itens()[3]));
  });

  it('Esc fecha e devolve o foco ao botão, sem escolher nada', async () => {
    const { gatilho, itens, abrir, tecla, host } = montar();
    await abrir();
    tecla(itens()[1], 'Escape');
    expect(itens()).toEqual([]);
    expect(gatilho().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(gatilho());
    expect(host.escolhidos).toEqual([]);
  });

  it('Tab fecha o menu; o clique fora também', async () => {
    const { itens, abrir, tecla, el, fixture } = montar();
    await abrir();
    tecla(itens()[0], 'Tab');
    expect(itens()).toEqual([]);
    await abrir();
    el.querySelector<HTMLButtonElement>('#fora')!.click();
    fixture.detectChanges();
    expect(itens()).toEqual([]);
  });

  it('escolher emite o destino e o botão (para o foco voltar a ele) e fecha', async () => {
    const { gatilho, itens, abrir, host, fixture } = montar();
    await abrir();
    itens()[2].click();
    fixture.detectChanges();
    expect(host.escolhidos).toEqual([{ para: 'RECUSADA', gatilho: gatilho() }]);
    expect(itens()).toEqual([]);
    expect(document.activeElement).toBe(gatilho());
  });

  it('aberto, fecha se ficar bloqueado (um CONFLITO chegou)', async () => {
    const { itens, abrir, host, fixture, gatilho } = montar();
    await abrir();
    expect(itens().length).toBe(4);
    host.bloqueado.set(true);
    fixture.detectChanges();
    expect(itens()).toEqual([]);
    expect(gatilho().getAttribute('aria-expanded')).toBe('false');
  });

  it('bloqueado (CONFLITO): desabilitado, com a dica "Resolva a pendência primeiro."', () => {
    const { gatilho, fixture, el, host } = montar();
    host.bloqueado.set(true);
    fixture.detectChanges();
    expect(gatilho().disabled).toBe(true);
    const dica = el.querySelector(`#${gatilho().getAttribute('aria-describedby')}`);
    expect(dica?.textContent?.trim()).toBe('Resolva a pendência primeiro.');
    gatilho().click();
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });
});
