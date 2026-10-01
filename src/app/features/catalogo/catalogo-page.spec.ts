import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { ArquivosService } from '../../core/arquivos/arquivos-service';
import { Perfil } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { CatalogoPage } from './catalogo-page';
import { CatalogoRepo } from './catalogo-repo';
import { ItemCatalogoDados, paraItemLocal } from './item-models';

const base: ItemCatalogoDados = {
  natureza: 'PRODUTO', codigo: 'PNL', nome: 'Painel', descricao: null, unidade: 'un', precoCusto: 800,
  precoVenda: 1250.5, locavel: false, precoLocacaoMensal: null, fotoArquivoId: null, ativo: true,
};

function montar(perfil: Perfil, lista?: ReturnType<typeof paraItemLocal>[]) {
  const itens = lista ?? [
    paraItemLocal('1', 0, base),
    paraItemLocal('2', null, { ...base, codigo: 'GER', nome: 'Gerador', locavel: true, precoLocacaoMensal: 300 }),
    paraItemLocal('3', 0, { ...base, codigo: 'INST', nome: 'Instalação', natureza: 'SERVICO' }),
    paraItemLocal('4', 0, { ...base, codigo: 'OLD', nome: 'Antigo', ativo: false }),
  ];
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: CatalogoRepo, useValue: { observarTodos: () => of(itens), observarNaoSincronizados: () => of(new Set(['2'])) } },
      { provide: AuthService, useValue: { usuario: signal({ id: 'u', nome: 'U', email: 'u@u', perfil, ativo: true }) } },
      { provide: ArquivosService, useValue: { obterUrl: vi.fn().mockResolvedValue(null) } },
    ],
  });
  const fixture = TestBed.createComponent(CatalogoPage);
  fixture.detectChanges();
  return fixture;
}

const clicar = (el: HTMLElement, texto: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto)!.click();

describe('CatalogoPage', () => {
  it('mostra preço de venda e locação, marca não sincronizado e esconde inativos', () => {
    const el = montar('COMERCIAL').nativeElement as HTMLElement;
    expect(el.textContent).toMatch(/R\$\s1\.250,50/);
    expect(el.textContent).toMatch(/Locação:\s*R\$\s300,00\/mês/);
    expect(el.textContent).not.toContain('Antigo');
    expect(el.querySelectorAll('li')[1].textContent).toContain('Não sincronizado');
  });

  it('item sem nenhum preço (perfil que não vê preços) aparece sem "R$" nem "Locação"', () => {
    const semPreco = paraItemLocal('9', 0, {
      natureza: 'PRODUTO', codigo: 'TEC', nome: 'Sem preço', descricao: null, unidade: 'un',
      locavel: true, fotoArquivoId: null, ativo: true,
    });
    const el = montar('TECNICO', [semPreco]).nativeElement as HTMLElement;
    const linha = el.querySelector('li')!;
    expect(linha.textContent).toContain('Sem preço');
    expect(linha.textContent).not.toContain('R$');
    expect(linha.textContent).not.toContain('Locação');
  });

  it('comercial não vê botão de novo item nem links de edição', () => {
    const el = montar('COMERCIAL').nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Novo item');
    expect(el.querySelector('a[href^="/catalogo/"]')).toBeNull();
  });

  it('admin vê novo item, edita e pode mostrar inativos', async () => {
    const fixture = montar('ADMIN');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Novo item');
    expect(el.querySelector('a[href="/catalogo/1"]')).not.toBeNull();
    el.querySelector<HTMLInputElement>('#mostrar-inativos')!.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.textContent).toContain('Antigo');
    });
  });

  it('chips de filtro com 48 px no mínimo (alvo de toque)', () => {
    const el = montar('ADMIN').nativeElement as HTMLElement;
    const chips = [...el.querySelectorAll('[role=group] button')];
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach((c) => expect(c.classList).toContain('min-h-12'));
  });

  it('filtra por serviço e por busca', async () => {
    const fixture = montar('ADMIN');
    const el = fixture.nativeElement as HTMLElement;
    clicar(el, 'Serviços');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelectorAll('li')).toHaveLength(1);
    });
    clicar(el, 'Todos');
    const busca = el.querySelector<HTMLInputElement>('input[type=search]')!;
    busca.value = 'ger';
    busca.dispatchEvent(new Event('input'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelectorAll('li')).toHaveLength(1);
      expect(el.textContent).toContain('Gerador');
    });
  });
  it('antes da primeira emissão mostra "Carregando…", não o vazio', () => {
    const todos = new Subject<ReturnType<typeof paraItemLocal>[]>();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CatalogoRepo, useValue: { observarTodos: () => todos, observarNaoSincronizados: () => of(new Set<string>()) } },
        { provide: AuthService, useValue: { usuario: signal({ id: 'u', nome: 'U', email: 'u@u', perfil: 'ADMIN', ativo: true }) } },
        { provide: ArquivosService, useValue: { obterUrl: vi.fn().mockResolvedValue(null) } },
      ],
    });
    const fixture = TestBed.createComponent(CatalogoPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Carregando…');
    expect(el.textContent).not.toContain('Nenhum item no catálogo ainda.');
    todos.next([]);
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Carregando…');
    expect(el.textContent).toContain('Nenhum item no catálogo ainda.');
  });
});
