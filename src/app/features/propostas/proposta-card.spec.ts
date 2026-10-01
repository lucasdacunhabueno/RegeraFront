import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Selo } from './formatos-proposta';
import { PropostaCard } from './proposta-card';
import { PropostaLocal, STATUS_PROPOSTA } from './proposta-models';

function proposta(p: Partial<PropostaLocal> = {}): PropostaLocal {
  return {
    id: 'p1', version: 3, codigoProvisorio: 'PROV-7K3M9Q', numero: 277, revisao: 2, tipo: 'SERVICO', status: 'ENVIADA',
    clienteId: 'c1', templateId: 't1', responsavelId: 'u1', tecnicoId: null, dataEmissao: '2026-09-20',
    validadeAte: '2026-09-30', condicoesPagamento: null, prazoExecucao: null, observacoes: null, descontoGeralCentesimos: null,
    totalItensCentavos: 123456, totalDescontosCentavos: 0, totalCentavos: 123456, motivoEncerramento: null, itens: [],
    historico: [], documentos: [], atualizadoEm: null, ...p,
  };
}

function montar(entradas: {
  proposta?: PropostaLocal;
  clienteNome?: string;
  responsavelNome?: string | null;
  mostrarValores?: boolean;
  selos?: Selo[];
} = {}) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(PropostaCard);
  fixture.componentRef.setInput('proposta', entradas.proposta ?? proposta());
  fixture.componentRef.setInput('clienteNome', entradas.clienteNome ?? 'Padaria São João');
  fixture.componentRef.setInput('responsavelNome', entradas.responsavelNome === undefined ? 'Carla Comercial' : entradas.responsavelNome);
  fixture.componentRef.setInput('mostrarValores', entradas.mostrarValores ?? true);
  fixture.componentRef.setInput('selos', entradas.selos ?? []);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('PropostaCard', () => {
  it('o card inteiro é um link para o detalhe, com alvo de 48 px', () => {
    const el = montar();
    const links = el.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/propostas/p1');
    expect(links[0].className).toContain('min-h-12');
    expect(links[0].textContent).toContain('Padaria São João');
  });

  it('código, cliente, tipo, total e responsável', () => {
    const el = montar();
    expect(el.textContent).toContain('000277-R2');
    expect(el.textContent).toContain('Padaria São João');
    expect(el.textContent).toContain('Serviço');
    expect(el.textContent).toContain('R$ 1.234,56');
    expect(el.textContent).toContain('Carla Comercial');
  });

  it('status com o rótulo e a cor do modelo', () => {
    const el = montar({ proposta: proposta({ status: 'EM_EXECUCAO' }) });
    const status = el.querySelector('[data-status]')!;
    expect(status.textContent?.trim()).toBe('Em execução');
    for (const c of STATUS_PROPOSTA.EM_EXECUCAO.cor.split(' ')) expect(status.classList).toContain(c);
  });

  it('PROV enquanto não tem número', () => {
    expect(montar({ proposta: proposta({ numero: null, revisao: null }) }).textContent).toContain('PROV-7K3M9Q');
  });

  it('sem mostrarValores não há dinheiro nenhum', () => {
    const el = montar({ mostrarValores: false });
    expect(el.textContent).not.toMatch(/R\$/);
    expect(el.textContent).not.toContain('1.234,56');
  });

  it('sem total conhecido, não inventa R$ 0,00', () => {
    expect(montar({ proposta: proposta({ totalCentavos: null }) }).textContent).not.toMatch(/R\$/);
  });

  it('sem responsável conhecido, a linha some', () => {
    expect(montar({ responsavelNome: null }).textContent).not.toContain('Responsável');
  });

  it('mostra os selos recebidos', () => {
    const el = montar({
      selos: [
        { tipo: 'expirada', rotulo: 'Expirada' },
        { tipo: 'nao-sincronizada', rotulo: 'Não sincronizada' },
        { tipo: 'pendencia', rotulo: 'Pendência' },
      ],
    });
    const selos = [...el.querySelectorAll('[data-selo]')].map((s) => [s.getAttribute('data-selo'), s.textContent?.trim()]);
    expect(selos).toEqual([
      ['expirada', 'Expirada'],
      ['nao-sincronizada', 'Não sincronizada'],
      ['pendencia', 'Pendência'],
    ]);
  });
});
