import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ClienteDados, paraClienteLocal } from './cliente-models';
import { ClientesPage } from './clientes-page';
import { ClientesRepo } from './clientes-repo';

const base: ClienteDados = {
  tipo: 'PF', documento: '52998224725', nome: 'Maria Souza', nomeFantasia: null, inscricaoEstadual: null,
  inscricaoMunicipal: null, email: null, telefone: '11999998888', whatsapp: null, contatoNome: null,
  observacoes: null, enderecos: [],
};

function montar(clientes = [paraClienteLocal('1', 0, base), paraClienteLocal('2', null, { ...base, documento: '11222333000181', nome: 'ACME', tipo: 'PJ' })]) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ClientesRepo, useValue: { observarTodos: () => of(clientes), observarNaoSincronizados: () => of(new Set(['2'])) } },
    ],
  });
  const fixture = TestBed.createComponent(ClientesPage);
  fixture.detectChanges();
  return fixture;
}

describe('ClientesPage', () => {
  it('lista clientes com documento formatado e marca não sincronizados', () => {
    const el = montar().nativeElement as HTMLElement;
    expect(el.textContent).toContain('Maria Souza');
    expect(el.textContent).toContain('529.982.247-25');
    expect(el.textContent).toContain('(11) 99999-8888');
    const itens = el.querySelectorAll('li');
    expect(itens[1].textContent).toContain('Não sincronizado');
    expect(itens[0].textContent).not.toContain('Não sincronizado');
  });

  it('filtra pela busca', async () => {
    const fixture = montar();
    const busca = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type=search]')!;
    busca.value = 'acme';
    busca.dispatchEvent(new Event('input'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(1);
    });
    expect(fixture.nativeElement.textContent).toContain('ACME');
  });

  it('mostra estado vazio', () => {
    const el = montar([]).nativeElement as HTMLElement;
    expect(el.textContent).toContain('Nenhum cliente cadastrado ainda.');
  });
});
