import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { GaleriaOs } from './galeria-os';
import type { AnexoOsVisivel } from './os-repo';

const foto = (id: string, a: Partial<AnexoOsVisivel> = {}): AnexoOsVisivel => ({
  id, tipo: 'FOTO', legenda: null, momento: null, tiradaEm: '2026-10-01T12:00:00Z', assinanteNome: null, assinantePapel: null,
  revisaoOs: null, codigoExibido: null, enviado: true, temBytes: false, arquivoId: `arq-${id}`,
  miniatura: new Blob([id], { type: 'image/jpeg' }), ...a,
});

@Component({
  imports: [GaleriaOs],
  template: `<app-galeria-os [fotos]="fotos()" (abrir)="abertas.push($event)" />`,
})
class Hospedeiro {
  readonly fotos = signal<AnexoOsVisivel[]>([]);
  readonly abertas: AnexoOsVisivel[] = [];
}

function montar(fotos: AnexoOsVisivel[]) {
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(Hospedeiro);
  fixture.componentInstance.fotos.set(fotos);
  fixture.detectChanges();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
}

describe('GaleriaOs', () => {
  let criar: typeof URL.createObjectURL;
  let revogar: typeof URL.revokeObjectURL;
  let seq = 0;
  const criadas = new Map<string, Blob>();

  beforeEach(() => {
    criar = URL.createObjectURL;
    revogar = URL.revokeObjectURL;
    seq = 0;
    criadas.clear();
    URL.createObjectURL = vi.fn((b: Blob) => {
      const url = `blob:mini-${++seq}`;
      criadas.set(url, b);
      return url;
    });
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = criar;
    URL.revokeObjectURL = revogar;
  });

  it('miniaturas com o alt (legenda e momento), o contador n/20 e "Não sincronizada" na foto não enviada', () => {
    const { el } = montar([
      foto('f1', { legenda: 'Quadro antigo', momento: 'ANTES' }),
      foto('f2', { momento: 'DEPOIS', enviado: false }),
    ]);
    const imgs = [...el.querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['blob:mini-1', 'blob:mini-2']);
    expect(imgs[0].alt).toBe('Foto 1, Antes: Quadro antigo');
    expect(imgs[1].alt).toBe('Foto 2, Depois');
    const contador = el.querySelector('[data-testid=contador-fotos]')!;
    expect(contador.textContent!.trim()).toBe('2/20');
    expect(contador.getAttribute('aria-label')).toBe('2 de 20 fotos');
    const itens = [...el.querySelectorAll('li')];
    expect(itens[0].textContent).toContain('Quadro antigo');
    expect(itens[0].textContent).not.toContain('Não sincronizada');
    expect(itens[1].querySelector('[data-nao-sincronizada]')!.textContent).toContain('Não sincronizada');
  });

  it('sem fotos: o texto vazio e 0/20', () => {
    const { el } = montar([]);
    expect(el.textContent).toContain('Nenhuma foto ainda.');
    expect(el.querySelector('[data-testid=contador-fotos]')!.textContent!.trim()).toBe('0/20');
  });

  it('a foto só do servidor (sem miniatura) mostra um quadro no lugar da imagem', () => {
    const { el } = montar([foto('f1', { miniatura: null })]);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('li')!.textContent).toContain('Foto no servidor');
  });

  it('"Ver foto" emite a foto (bytes no aparelho ou no servidor)', () => {
    const { el, host } = montar([foto('f1', { legenda: 'Antes do serviço' })]);
    const ver = el.querySelector<HTMLButtonElement>('li button')!;
    expect(ver.textContent!.trim()).toBe('Ver foto');
    expect(ver.getAttribute('aria-label')).toBe('Ver foto 1');
    ver.click();
    expect(host.abertas.map((a) => a.id)).toEqual(['f1']);
  });

  it('sem bytes no aparelho e sem arquivo no servidor: sem "Ver foto"', () => {
    const { el } = montar([foto('f1', { arquivoId: null, temBytes: false, enviado: false })]);
    expect(el.querySelector('li button')).toBeNull();
  });

  it('reaproveita o URL de quem continua, cria o das novas e revoga o das que saíram (e todos ao destruir)', () => {
    const { fixture, el, host } = montar([foto('f1'), foto('f2')]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    // o repositório reemite com Blobs novos a cada escrita
    host.fotos.set([foto('f2'), foto('f3')]);
    fixture.detectChanges();
    fixture.detectChanges();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mini-1');
    expect([...el.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['blob:mini-2', 'blob:mini-3']);
    fixture.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mini-2');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mini-3');
  });

  it('a miniatura que chega depois (a foto do servidor reduzida para o PDF) passa a aparecer', () => {
    const { fixture, el, host } = montar([foto('f1', { miniatura: null })]);
    expect(el.querySelector('img')).toBeNull();
    host.fotos.set([foto('f1')]);
    fixture.detectChanges();
    fixture.detectChanges();
    expect(el.querySelector('img')!.getAttribute('src')).toBe('blob:mini-1');
  });
});
