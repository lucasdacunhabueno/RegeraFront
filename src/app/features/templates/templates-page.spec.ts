import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { blocosIniciais, paraTemplateLocal, TemplateDados, TemplateLocal, TipoProposta } from './template-models';
import { TemplatesPage } from './templates-page';
import { TemplatesRepo } from './templates-repo';

@Component({ template: '' })
class Vazio {}

const base: TemplateDados = { nome: 'Venda padrão', tipoProposta: 'VENDA', padrao: true, ativo: true, blocos: blocosIniciais() };

function montar(
  lista: TemplateLocal[] = [
    paraTemplateLocal('1', 1, base),
    // também marcado como padrão da VENDA, mas não é o efetivo: sem selo
    paraTemplateLocal('2', 1, { ...base, nome: 'Venda alternativa' }),
    paraTemplateLocal('3', null, { ...base, nome: 'Serviço rápido', tipoProposta: 'SERVICO', padrao: false }),
    paraTemplateLocal('4', 2, { ...base, nome: 'Locação antiga', tipoProposta: 'LOCACAO', padrao: false, ativo: false }),
  ],
  padroes = new Map<TipoProposta, string>([['VENDA', '1']]),
) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'templates/novo', component: Vazio }]),
      {
        provide: TemplatesRepo,
        useValue: {
          observarTodos: () => of(lista),
          observarNaoSincronizados: () => of(new Set(['3'])),
          observarPadroesEfetivos: () => of(padroes),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(TemplatesPage);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const cartao = (el: HTMLElement, nome: string) => [...el.querySelectorAll('li')].find((li) => li.textContent?.includes(nome))!;
const clicar = (el: HTMLElement, texto: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto)!.click();

describe('TemplatesPage', () => {
  it('título, cartões com nome e rótulo do tipo', () => {
    const { el } = montar();
    expect(el.querySelector('h1')?.textContent).toContain('Templates');
    expect(el.querySelectorAll('li').length).toBe(4);
    expect(cartao(el, 'Serviço rápido').textContent).toContain('Serviço');
    expect(cartao(el, 'Serviço rápido').querySelector('a')?.getAttribute('href')).toBe('/templates/3');
  });

  it('selos: Padrão só no efetivo, Inativo e Não sincronizado', () => {
    const { el } = montar();
    expect(cartao(el, 'Venda padrão').textContent).toContain('Padrão');
    expect(cartao(el, 'Venda alternativa').textContent).not.toContain('Padrão');
    expect(cartao(el, 'Locação antiga').textContent).toContain('Inativo');
    expect(cartao(el, 'Venda padrão').textContent).not.toContain('Inativo');
    expect(cartao(el, 'Serviço rápido').textContent).toContain('Não sincronizado');
    expect(cartao(el, 'Venda padrão').textContent).not.toContain('Não sincronizado');
  });

  it('filtra por tipo com os chips', () => {
    const { fixture, el } = montar();
    const chips = [...el.querySelectorAll('[role=group] button')].map((b) => b.textContent?.trim());
    expect(chips).toEqual(['Todos', 'Venda', 'Serviço', 'Manutenção', 'Locação']);

    clicar(el, 'Venda');
    fixture.detectChanges();
    expect([...el.querySelectorAll('li')].map((li) => li.querySelector('p')?.textContent?.trim())).toEqual([
      'Venda padrão',
      'Venda alternativa',
    ]);
    expect([...el.querySelectorAll('[role=group] button')].find((b) => b.textContent?.trim() === 'Venda')?.getAttribute('aria-pressed')).toBe(
      'true',
    );

    clicar(el, 'Manutenção');
    fixture.detectChanges();
    expect(el.querySelectorAll('li').length).toBe(0);
    expect(el.textContent).toContain('Nenhum template deste tipo.');

    clicar(el, 'Todos');
    fixture.detectChanges();
    expect(el.querySelectorAll('li').length).toBe(4);
  });

  it('vazio', () => {
    const { el } = montar([], new Map());
    expect(el.textContent).toContain('Nenhum template ainda.');
  });

  it('"Novo template" leva a /templates/novo', async () => {
    const { fixture, el } = montar();
    const link = [...el.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Novo template')!;
    link.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/templates/novo');
  });
});
