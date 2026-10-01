import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DialogoMotivo } from './dialogo-motivo';

@Component({
  imports: [DialogoMotivo],
  template: `
    <button type="button" id="gatilho" (click)="aberto.set(true)">Recusar</button>
    @if (aberto()) {
      <app-dialogo-motivo [gatilho]="gatilho()" [titulo]="'Recusar proposta'" [texto]="texto()" [rotuloConfirmar]="'Recusar'" [pedirMotivo]="pedirMotivo()"
                          (confirmado)="confirmado($event)" (cancelado)="cancelado()" />
    }
  `,
})
class Hospedeiro {
  readonly aberto = signal(false);
  readonly gatilho = signal<HTMLElement | null>(null);
  readonly pedirMotivo = signal(true);
  readonly texto = signal<string | null>('O cliente recebe a proposta como recusada.');
  readonly confirmado = vi.fn<(motivo: string | null) => void>(() => this.aberto.set(false));
  readonly cancelado = vi.fn(() => this.aberto.set(false));
}

function montar(o: { pedirMotivo?: boolean } = {}) {
  const fixture = TestBed.createComponent(Hospedeiro);
  const host = fixture.componentInstance;
  if (o.pedirMotivo === false) host.pedirMotivo.set(false);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const gatilho = el.querySelector<HTMLButtonElement>('#gatilho')!;
  gatilho.focus();
  gatilho.click();
  fixture.detectChanges();
  return { fixture, el, host, gatilho };
}

const dialogo = (el: HTMLElement) => el.querySelector<HTMLElement>('[aria-modal="true"]');
const botao = (el: HTMLElement, texto: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('app-dialogo-motivo button')].find((b) => b.textContent?.trim() === texto)!;

function digitar(fixture: ComponentFixture<unknown>, campo: HTMLTextAreaElement, valor: string) {
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function tecla(alvo: HTMLElement, key: string, shiftKey = false): KeyboardEvent {
  const evento = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  alvo.dispatchEvent(evento);
  return evento;
}

describe('DialogoMotivo', () => {
  it('acessível: role=dialog, aria-modal, título e texto ligados, campo "Motivo" rotulado e com o foco', async () => {
    const { el } = montar();
    const d = dialogo(el)!;
    expect(d.getAttribute('role')).toBe('dialog');
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent?.trim()).toBe('Recusar proposta');
    expect(document.getElementById(d.getAttribute('aria-describedby')!)?.textContent).toContain('recebe a proposta como recusada');
    const campo = d.querySelector('textarea')!;
    expect(d.querySelector(`label[for="${campo.id}"]`)?.textContent?.trim()).toBe('Motivo');
    await vi.waitFor(() => expect(document.activeElement).toBe(campo));
    for (const b of d.querySelectorAll('button')) expect(b.classList).toContain('h-12');
  });

  it('motivo obrigatório, de 3 a 500 caracteres sem os espaços das pontas; vai sem eles', async () => {
    const { fixture, el, host } = montar();
    const campo = dialogo(el)!.querySelector('textarea')!;
    botao(el, 'Recusar').click();
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Informe o motivo (de 3 a 500 caracteres).');
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    digitar(fixture, campo, '  ab  ');
    botao(el, 'Recusar').click();
    fixture.detectChanges();
    digitar(fixture, campo, ' ' + 'x'.repeat(501) + ' ');
    botao(el, 'Recusar').click();
    fixture.detectChanges();
    expect(host.confirmado).not.toHaveBeenCalled();
    expect(el.textContent).toContain('501/500');

    digitar(fixture, campo, '\n  Cliente desistiu da obra  ');
    botao(el, 'Recusar').click();
    fixture.detectChanges();
    // como o String.strip() do Java: o espaço não separável fica (o servidor conta igual)
    expect(host.confirmado).toHaveBeenCalledWith('Cliente desistiu da obra  ');
    expect(dialogo(el)).toBeNull();
  });

  it('Esc e Cancelar fecham sem confirmar nada; o foco volta para quem abriu', async () => {
    let { fixture, el, host, gatilho } = montar();
    digitar(fixture, dialogo(el)!.querySelector('textarea')!, 'Caro demais');
    tecla(dialogo(el)!.querySelector('textarea')!, 'Escape');
    fixture.detectChanges();
    expect(host.cancelado).toHaveBeenCalledTimes(1);
    expect(host.confirmado).not.toHaveBeenCalled();
    expect(dialogo(el)).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(gatilho));

    TestBed.resetTestingModule();
    ({ fixture, el, host, gatilho } = montar());
    botao(el, 'Cancelar').click();
    fixture.detectChanges();
    expect(host.cancelado).toHaveBeenCalledTimes(1);
    expect(host.confirmado).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(gatilho));
  });

  it('Safari (o clique não foca o botão): o foco volta para o gatilho recebido, não para o body', async () => {
    const fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const gatilho = el.querySelector<HTMLButtonElement>('#gatilho')!;
    (document.activeElement as HTMLElement | null)?.blur();
    fixture.componentInstance.gatilho.set(gatilho);
    gatilho.click();
    fixture.detectChanges();
    expect(document.activeElement).not.toBe(gatilho);
    botao(el, 'Cancelar').click();
    fixture.detectChanges();
    await vi.waitFor(() => expect(document.activeElement).toBe(gatilho));
  });

  it('o foco fica preso no diálogo: Tab no último volta ao primeiro, Shift+Tab no primeiro vai ao último', async () => {
    const { el } = montar();
    const d = dialogo(el)!;
    const campo = d.querySelector('textarea')!;
    await vi.waitFor(() => expect(document.activeElement).toBe(campo));
    const ultimo = botao(el, 'Recusar');
    ultimo.focus();
    expect(tecla(ultimo, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(campo);
    expect(tecla(campo, 'Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(ultimo);
    // no meio, o Tab segue normal
    campo.focus();
    expect(tecla(campo, 'Tab').defaultPrevented).toBe(false);
  });

  it('confirmação sem motivo (ex.: excluir): role=alertdialog, sem campo, o foco em Cancelar e confirma com null', async () => {
    const { fixture, el, host } = montar({ pedirMotivo: false });
    const d = dialogo(el)!;
    expect(d.getAttribute('role')).toBe('alertdialog');
    expect(d.querySelector('textarea')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(botao(el, 'Cancelar')));
    botao(el, 'Recusar').click();
    fixture.detectChanges();
    expect(host.confirmado).toHaveBeenCalledWith(null);
  });

  it('o toque fora do painel cancela', () => {
    const { fixture, el, host } = montar();
    el.querySelector<HTMLElement>('app-dialogo-motivo')!.click();
    fixture.detectChanges();
    expect(host.cancelado).toHaveBeenCalled();
    expect(host.confirmado).not.toHaveBeenCalled();
  });
});
