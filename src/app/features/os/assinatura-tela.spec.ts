import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AssinaturaCanvas } from './assinatura-canvas';
import { AssinaturaTela } from './assinatura-tela';
import { ErroOs } from './erro-os';
import type { AssinaturaColhida } from './os-repo';

/** Quem usa a tela: abre com `@if`, guarda o que ela emite e fecha nos dois eventos. */
@Component({
  imports: [AssinaturaTela],
  template: `
    <button type="button" id="abrir" (click)="aberta.set(true)">Colher assinatura</button>
    @if (aberta()) {
      <app-assinatura-tela [gatilho]="gatilho" [ocupado]="ocupado()" [erro]="erro()"
                           (confirmado)="confirmado($event)" (cancelado)="aberta.set(false)" />
    }
  `,
})
class Hospedeiro {
  readonly aberta = signal(false);
  readonly ocupado = signal(false);
  readonly erro = signal<string | null>(null);
  gatilho: HTMLElement | null = null;
  readonly recebidas: AssinaturaColhida[] = [];
  confirmado(a: AssinaturaColhida) {
    this.recebidas.push(a);
  }
}

const PNG = { bytes: new Uint8Array([137, 80, 78, 71]).buffer, sha256: 'ab'.repeat(32) };

function ponteiro(alvo: EventTarget, tipo: string, x: number, y: number) {
  const e = Object.assign(new Event(tipo, { cancelable: true, bubbles: true }), {
    pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, clientX: x, clientY: y,
  });
  alvo.dispatchEvent(e);
}

async function montar() {
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(Hospedeiro);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const abrir = el.querySelector<HTMLButtonElement>('#abrir')!;
  abrir.focus();
  fixture.componentInstance.gatilho = abrir;
  abrir.click();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el, host: fixture.componentInstance, abrir };
}

const botao = (el: HTMLElement, texto: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === texto)!;
const canvas = (el: HTMLElement) => el.querySelector<HTMLCanvasElement>('canvas')!;

function assinar(fixture: ComponentFixture<unknown>, el: HTMLElement, pontos: [number, number][] = [[20, 30], [60, 40], [90, 35]]) {
  const c = canvas(el);
  ponteiro(c, 'pointerdown', ...pontos[0]);
  for (const p of pontos.slice(1)) ponteiro(c, 'pointermove', ...p);
  ponteiro(c, 'pointerup', ...pontos[pontos.length - 1]);
  fixture.detectChanges();
}

/** ResizeObserver falso (o jsdom não tem): `girar()` avisa todos, como o navegador depois de girar a tela. */
class ObservadorFalso {
  static todos: ObservadorFalso[] = [];
  constructor(readonly avisar: () => void) {
    ObservadorFalso.todos.push(this);
  }
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  disconnect(): void {
    ObservadorFalso.todos = ObservadorFalso.todos.filter((o) => o !== this);
  }
}
function comObservador() {
  ObservadorFalso.todos = [];
  vi.stubGlobal('ResizeObserver', ObservadorFalso);
  // o AssinaturaCanvas refaz o bitmap a cada aviso: sem o pacote canvas, o jsdom não tem contexto 2D
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
}
function girar() {
  for (const o of [...ObservadorFalso.todos]) o.avisar();
}

function digitar(fixture: ComponentFixture<unknown>, campo: HTMLInputElement, valor: string) {
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

describe('AssinaturaTela', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('é um diálogo modal em tela cheia, com título, a dica de girar o celular e o foco no painel', async () => {
    const { el } = await montar();
    const dialogo = el.querySelector<HTMLElement>('[role=dialog]')!;
    expect(dialogo.getAttribute('aria-modal')).toBe('true');
    const titulo = el.querySelector(`#${dialogo.getAttribute('aria-labelledby')}`)!;
    expect(titulo.textContent).toContain('Assinatura');
    expect(el.textContent).toContain('Gire o celular para ter mais espaço');
    expect(el.querySelector('app-assinatura-tela')!.className).toContain('fixed');
    expect(el.querySelector('app-assinatura-tela')!.className).toContain('inset-0');
    expect(document.activeElement).toBe(dialogo);
  });

  it('o canvas: tamanho no CSS, sem rolar nem selecionar, sem borda nem padding (a borda é da div em volta)', async () => {
    const { el } = await montar();
    const c = canvas(el);
    for (const classe of ['size-full', 'touch-none', 'select-none', '[-webkit-touch-callout:none]']) {
      expect(c.classList).toContain(classe);
    }
    expect([...c.classList].some((x) => /^(border|p[xytrbl]?-)/.test(x))).toBe(false);
    expect(c.style.touchAction).toBe('none');
    expect(c.parentElement!.className).toContain('border');
    expect(c.getAttribute('aria-label')).toBeTruthy();
  });

  it('nome e papel com rótulo; o papel vem "Cliente"', async () => {
    const { el } = await montar();
    const nome = el.querySelector<HTMLInputElement>('input[name=nome]')!;
    const papel = el.querySelector<HTMLInputElement>('input[name=papel]')!;
    expect(el.querySelector(`label[for="${nome.id}"]`)!.textContent).toContain('Nome');
    expect(el.querySelector(`label[for="${papel.id}"]`)!.textContent).toContain('Papel');
    expect(papel.value).toBe('Cliente');
    expect(nome.value).toBe('');
  });

  it('vazia: Confirmar desabilitado (com a dica ligada) e nada é emitido', async () => {
    const { fixture, el, host } = await montar();
    const paraPng = vi.spyOn(AssinaturaCanvas.prototype, 'paraPng');
    digitar(fixture, el.querySelector<HTMLInputElement>('input[name=nome]')!, 'Maria Souza');
    const confirmar = botao(el, 'Confirmar');
    expect(confirmar.disabled).toBe(true);
    expect(el.querySelector(`#${confirmar.getAttribute('aria-describedby')}`)!.textContent).toContain('Assine');
    confirmar.click();
    await fixture.whenStable();
    expect(paraPng).not.toHaveBeenCalled();
    expect(host.recebidas).toEqual([]);
  });

  it('com traço, Confirmar habilita; Limpar volta a vazia', async () => {
    const { fixture, el } = await montar();
    assinar(fixture, el);
    expect(botao(el, 'Confirmar').disabled).toBe(false);
    expect(el.textContent).not.toContain('Assine aqui');
    botao(el, 'Limpar').click();
    fixture.detectChanges();
    expect(botao(el, 'Confirmar').disabled).toBe(true);
    expect(el.textContent).toContain('Assine aqui');
  });

  it('confirma com o PNG, o nome e o papel sem os espaços das pontas', async () => {
    const { fixture, el, host } = await montar();
    vi.spyOn(AssinaturaCanvas.prototype, 'paraPng').mockResolvedValue(PNG);
    assinar(fixture, el);
    digitar(fixture, el.querySelector<HTMLInputElement>('input[name=nome]')!, '  Maria Souza ');
    digitar(fixture, el.querySelector<HTMLInputElement>('input[name=papel]')!, ' Síndica ');
    botao(el, 'Confirmar').click();
    await vi.waitFor(() => expect(host.recebidas).toHaveLength(1));
    expect(host.recebidas[0]).toEqual({ png: PNG, nome: 'Maria Souza', papel: 'Síndica' });
  });

  it('papel em branco vai null', async () => {
    const { fixture, el, host } = await montar();
    vi.spyOn(AssinaturaCanvas.prototype, 'paraPng').mockResolvedValue(PNG);
    assinar(fixture, el);
    digitar(fixture, el.querySelector<HTMLInputElement>('input[name=nome]')!, 'Maria');
    digitar(fixture, el.querySelector<HTMLInputElement>('input[name=papel]')!, '   ');
    botao(el, 'Confirmar').click();
    await vi.waitFor(() => expect(host.recebidas).toHaveLength(1));
    expect(host.recebidas[0].papel).toBeNull();
  });

  it.each([
    ['', 'Informe o nome de quem assina.'],
    ['M', 'O nome tem de 2 a 120 caracteres.'],
    ['M'.repeat(121), 'O nome tem de 2 a 120 caracteres.'],
  ])('nome %j: erro no campo, foco nele e nada emitido', async (valor, mensagem) => {
    const { fixture, el, host } = await montar();
    const paraPng = vi.spyOn(AssinaturaCanvas.prototype, 'paraPng').mockResolvedValue(PNG);
    assinar(fixture, el);
    const nome = el.querySelector<HTMLInputElement>('input[name=nome]')!;
    digitar(fixture, nome, valor);
    botao(el, 'Confirmar').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(nome.getAttribute('aria-invalid')).toBe('true');
    const erro = el.querySelector(`#${nome.getAttribute('aria-describedby')!.split(' ').at(-1)}`)!;
    expect(erro.textContent).toContain(mensagem);
    expect(erro.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(nome);
    expect(paraPng).not.toHaveBeenCalled();
    expect(host.recebidas).toEqual([]);
  });

  it('o nome conta em code points (emoji conta 1): 120 emojis passam', async () => {
    const { fixture, el, host } = await montar();
    vi.spyOn(AssinaturaCanvas.prototype, 'paraPng').mockResolvedValue(PNG);
    assinar(fixture, el);
    digitar(fixture, el.querySelector<HTMLInputElement>('input[name=nome]')!, '😀'.repeat(120));
    botao(el, 'Confirmar').click();
    await vi.waitFor(() => expect(host.recebidas).toHaveLength(1));
  });

  it('papel acima de 60: erro no campo', async () => {
    const { fixture, el, host } = await montar();
    vi.spyOn(AssinaturaCanvas.prototype, 'paraPng').mockResolvedValue(PNG);
    assinar(fixture, el);
    digitar(fixture, el.querySelector<HTMLInputElement>('input[name=nome]')!, 'Maria');
    const papel = el.querySelector<HTMLInputElement>('input[name=papel]')!;
    digitar(fixture, papel, 'x'.repeat(61));
    botao(el, 'Confirmar').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(papel.getAttribute('aria-invalid')).toBe('true');
    expect(el.textContent).toContain('Máximo de 60 caracteres.');
    expect(document.activeElement).toBe(papel);
    expect(host.recebidas).toEqual([]);
  });

  it('assinatura grande demais (paraPng recusa): a mensagem aparece na tela, que fica aberta', async () => {
    const { fixture, el, host } = await montar();
    vi.spyOn(AssinaturaCanvas.prototype, 'paraPng').mockRejectedValue(
      new ErroOs('ASSINATURA_GRANDE', 'assinatura', 'A assinatura ficou grande demais.'),
    );
    assinar(fixture, el);
    digitar(fixture, el.querySelector<HTMLInputElement>('input[name=nome]')!, 'Maria');
    botao(el, 'Confirmar').click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-testid=erro-assinatura]')?.textContent).toContain('A assinatura ficou grande demais.');
    });
    expect(host.recebidas).toEqual([]);
    expect(host.aberta()).toBe(true);
  });

  it('o erro de quem grava (input erro) aparece como alerta; ocupado desabilita tudo e mostra "Gravando…"', async () => {
    const { fixture, el, host } = await montar();
    assinar(fixture, el);
    host.erro.set('Pouco espaço no aparelho para gravar a assinatura.');
    host.ocupado.set(true);
    fixture.detectChanges();
    const alerta = el.querySelector('[data-testid=erro-assinatura]')!;
    expect(alerta.getAttribute('role')).toBe('alert');
    expect(alerta.textContent).toContain('Pouco espaço');
    expect(botao(el, 'Gravando…').disabled).toBe(true);
    expect(botao(el, 'Cancelar').disabled).toBe(true);
    expect(botao(el, 'Limpar').disabled).toBe(true);
  });

  it('Cancelar fecha e o foco volta ao botão que abriu', async () => {
    const { fixture, el, host, abrir } = await montar();
    botao(el, 'Cancelar').click();
    fixture.detectChanges();
    expect(host.aberta()).toBe(false);
    expect(document.activeElement).toBe(abrir);
  });

  it('Esc fecha (o foco volta ao botão que abriu); ocupado, não', async () => {
    const { fixture, el, host, abrir } = await montar();
    host.ocupado.set(true);
    fixture.detectChanges();
    const dialogo = el.querySelector<HTMLElement>('[role=dialog]')!;
    dialogo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(host.aberta()).toBe(true);
    host.ocupado.set(false);
    fixture.detectChanges();
    dialogo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(host.aberta()).toBe(false);
    expect(document.activeElement).toBe(abrir);
  });

  it('Tab e Shift+Tab ficam presos no diálogo', async () => {
    const { fixture, el } = await montar();
    assinar(fixture, el);
    const dialogo = el.querySelector<HTMLElement>('[role=dialog]')!;
    const focaveis = [...dialogo.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
    const ultimo = focaveis.at(-1)!;
    ultimo.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    ultimo.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focaveis[0]);
    const voltar = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    focaveis[0].dispatchEvent(voltar);
    expect(document.activeElement).toBe(ultimo);
  });

  it('girar com traço fora da área nova: avisa; dentro, não; Limpar tira o aviso', async () => {
    comObservador();
    const { fixture, el } = await montar();
    const c = canvas(el);
    const tamanho = { largura: 600, altura: 300 };
    Object.defineProperty(c, 'clientWidth', { configurable: true, get: () => tamanho.largura });
    Object.defineProperty(c, 'clientHeight', { configurable: true, get: () => tamanho.altura });
    assinar(fixture, el, [[100, 50], [500, 120]]);
    // girou: a área ficou mais estreita que o traço
    tamanho.largura = 360;
    tamanho.altura = 400;
    girar();
    fixture.detectChanges();
    const aviso = el.querySelector('[data-testid=fora-da-area]')!;
    expect(aviso.textContent).toContain('fora do quadro');
    expect(aviso.getAttribute('role')).toBe('alert');
    // voltou: o traço cabe de novo
    tamanho.largura = 600;
    tamanho.altura = 300;
    girar();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=fora-da-area]')).toBeNull();
    tamanho.largura = 360;
    girar();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=fora-da-area]')).not.toBeNull();
    botao(el, 'Limpar').click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=fora-da-area]')).toBeNull();
  });

  it('M1: o ponto de quando o dedo passou da borda (ponteiro capturado) nunca se viu e não dispara o aviso', async () => {
    comObservador();
    const { fixture, el } = await montar();
    const c = canvas(el);
    const tamanho = { largura: 600, altura: 300 };
    Object.defineProperty(c, 'clientWidth', { configurable: true, get: () => tamanho.largura });
    Object.defineProperty(c, 'clientHeight', { configurable: true, get: () => tamanho.altura });
    // o traço sai pela direita do quadro (x 650 num quadro de 600)
    assinar(fixture, el, [[100, 50], [500, 80], [650, 120]]);
    // a altura muda e a largura fica: tudo o que se via continua dentro
    tamanho.altura = 400;
    girar();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=fora-da-area]')).toBeNull();
    // estreitou: o ponto visível em x 500 sai
    tamanho.largura = 360;
    girar();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=fora-da-area]')).not.toBeNull();
  });

  it('M1: o traço em andamento durante o giro conta no tamanho de antes', async () => {
    comObservador();
    const { fixture, el } = await montar();
    const c = canvas(el);
    const tamanho = { largura: 600, altura: 300 };
    Object.defineProperty(c, 'clientWidth', { configurable: true, get: () => tamanho.largura });
    Object.defineProperty(c, 'clientHeight', { configurable: true, get: () => tamanho.altura });
    girar(); // a primeira medida com o tamanho de verdade
    ponteiro(c, 'pointerdown', 100, 50);
    ponteiro(c, 'pointermove', 500, 80);
    tamanho.largura = 360;
    girar();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=fora-da-area]')).not.toBeNull();
  });

  it('M2: enquanto gera o PNG, o foco fica no painel (o Confirmar se desabilita) e volta ao Confirmar no fim', async () => {
    const { fixture, el, host } = await montar();
    let terminar!: (v: typeof PNG) => void;
    vi.spyOn(AssinaturaCanvas.prototype, 'paraPng').mockImplementation(() => new Promise((r) => (terminar = r)));
    assinar(fixture, el);
    digitar(fixture, el.querySelector<HTMLInputElement>('input[name=nome]')!, 'Maria');
    const confirmar = botao(el, 'Confirmar');
    confirmar.focus();
    confirmar.click();
    fixture.detectChanges();
    const dialogo = el.querySelector<HTMLElement>('[role=dialog]')!;
    expect(document.activeElement).toBe(dialogo);
    // tudo desabilitado: o Tab não sai do diálogo
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialogo.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialogo);
    terminar(PNG);
    await vi.waitFor(() => expect(host.recebidas).toHaveLength(1));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(document.activeElement).toBe(botao(el, 'Confirmar'));
    });
  });

  it('o quadro é uma imagem com rótulo', async () => {
    const { el } = await montar();
    expect(canvas(el).getAttribute('role')).toBe('img');
  });

  it('girar sem traço não avisa', async () => {
    comObservador();
    const { fixture, el } = await montar();
    const c = canvas(el);
    Object.defineProperty(c, 'clientWidth', { configurable: true, get: () => 100 });
    Object.defineProperty(c, 'clientHeight', { configurable: true, get: () => 100 });
    girar();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=fora-da-area]')).toBeNull();
  });

  it('solta o canvas ao fechar', async () => {
    const desligar = vi.spyOn(AssinaturaCanvas.prototype, 'desligar');
    const { fixture, el, host } = await montar();
    host.aberta.set(false);
    fixture.detectChanges();
    expect(el.querySelector('canvas')).toBeNull();
    expect(desligar).toHaveBeenCalled();
  });

  it('alvos de toque de 48 px nos botões e campos', async () => {
    const { el } = await montar();
    for (const b of el.querySelectorAll('app-assinatura-tela button')) expect(b.className).toMatch(/\bh-12\b|\bmin-h-12\b/);
    for (const i of el.querySelectorAll('app-assinatura-tela input')) expect(i.className).toMatch(/\bh-12\b/);
  });
});
