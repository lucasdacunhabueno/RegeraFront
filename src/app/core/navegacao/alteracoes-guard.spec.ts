import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { vi } from 'vitest';
import { alteracoesGuard, avisarAoSairDaPagina, ComAlteracoes, instantaneo, MENSAGEM_ALTERACOES } from './alteracoes-guard';

const alterado = signal(false);

@Component({ template: 'form' })
class Formulario implements ComAlteracoes {
  constructor() {
    avisarAoSairDaPagina(alterado);
  }
  temAlteracoes(): boolean {
    return alterado();
  }
}

@Component({ template: 'outra' })
class Outra {}

@Component({ imports: [RouterOutlet], template: '<router-outlet />' })
class Raiz {}

async function montar() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'form', component: Formulario, canDeactivate: [alteracoesGuard] },
        { path: 'outra', component: Outra },
      ]),
    ],
  });
  const router = TestBed.inject(Router);
  const fixture = TestBed.createComponent(Raiz);
  await router.navigateByUrl('/form');
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('form');
  return { router, fixture };
}

const antesDeSair = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e;
};

describe('alteracoesGuard', () => {
  beforeEach(() => alterado.set(false));
  afterEach(() => vi.restoreAllMocks());

  it('sem alterações: sai sem perguntar', async () => {
    const confirmar = vi.spyOn(window, 'confirm');
    const { router } = await montar();
    expect(await router.navigateByUrl('/outra')).toBe(true);
    expect(confirmar).not.toHaveBeenCalled();
    expect(router.url).toBe('/outra');
  });

  it('com alterações: pergunta; cancelar mantém na página', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { router } = await montar();
    alterado.set(true);
    expect(await router.navigateByUrl('/outra')).toBe(false);
    expect(confirmar).toHaveBeenCalledWith(MENSAGEM_ALTERACOES);
    expect(router.url).toBe('/form');
  });

  it('com alterações: confirmar sai', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { router } = await montar();
    alterado.set(true);
    expect(await router.navigateByUrl('/outra')).toBe(true);
    expect(router.url).toBe('/outra');
  });

  it('beforeunload só é barrado enquanto houver alterações, e o ouvinte sai no destroy', async () => {
    const { router, fixture } = await montar();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(antesDeSair().defaultPrevented).toBe(false);
    alterado.set(true);
    TestBed.tick();
    expect(antesDeSair().defaultPrevented).toBe(true);
    alterado.set(false);
    TestBed.tick();
    expect(antesDeSair().defaultPrevented).toBe(false);
    alterado.set(true);
    TestBed.tick();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await router.navigateByUrl('/outra');
    expect(antesDeSair().defaultPrevented).toBe(false);
  });
});

describe('instantaneo', () => {
  it('JSON estável: a ordem das chaves não importa, a dos arrays importa', () => {
    expect(instantaneo({ b: 1, a: { d: [1, 2], c: null } })).toBe(instantaneo({ a: { c: null, d: [1, 2] }, b: 1 }));
    expect(instantaneo({ a: [1, 2] })).not.toBe(instantaneo({ a: [2, 1] }));
  });
});
