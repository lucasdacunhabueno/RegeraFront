import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SeloOsProposta } from '../os/formatos-os';
import { Selo, selosDaProposta } from './formatos-proposta';
import { ESTILO_SELO, ESTILO_SELO_OS_PROPOSTA, PropostaCard } from './proposta-card';
import { PropostaLocal, STATUS_PROPOSTA } from './proposta-models';

function proposta(p: Partial<PropostaLocal> = {}): PropostaLocal {
  return {
    id: 'p1', version: 3, codigoProvisorio: 'PROV-7K3M9Q', numero: 277, revisao: 2, tipo: 'SERVICO', status: 'ENVIADA',
    clienteId: 'c1', templateId: 't1', responsavelId: 'u1', tecnicoId: null, dataEmissao: '2026-09-20',
    validadeAte: '2026-09-30', condicoesPagamento: null, prazoExecucao: null, observacoes: null, descontoGeralCentesimos: null,
    totalItensCentavos: 123456, totalDescontosCentavos: 0, totalCentavos: 123456, motivoEncerramento: null, itens: [],
    historico: [], documentos: [], atualizadoEm: null, origem: null, ...p,
  };
}

function montar(entradas: {
  proposta?: PropostaLocal;
  clienteNome?: string;
  responsavelNome?: string | null;
  mostrarValores?: boolean;
  selos?: Selo[];
  selosOs?: SeloOsProposta[];
  mostrarStatus?: boolean;
} = {}) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(PropostaCard);
  fixture.componentRef.setInput('proposta', entradas.proposta ?? proposta());
  fixture.componentRef.setInput('clienteNome', entradas.clienteNome ?? 'Padaria São João');
  fixture.componentRef.setInput('responsavelNome', entradas.responsavelNome === undefined ? 'Carla Comercial' : entradas.responsavelNome);
  fixture.componentRef.setInput('mostrarValores', entradas.mostrarValores ?? true);
  fixture.componentRef.setInput('selos', entradas.selos ?? []);
  if (entradas.selosOs !== undefined) fixture.componentRef.setInput('selosOs', entradas.selosOs);
  if (entradas.mostrarStatus !== undefined) fixture.componentRef.setInput('mostrarStatus', entradas.mostrarStatus);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('PropostaCard', () => {
  it('mostra o status por padrão; mostrarStatus false (coluna do kanban, que já diz o status) o tira', () => {
    expect(montar().querySelector('[data-status]')?.textContent?.trim()).toBe('Enviada');
    TestBed.resetTestingModule();
    const el = montar({ mostrarStatus: false });
    expect(el.querySelector('[data-status]')).toBeNull();
    expect(el.textContent).toContain('000277-R2');
  });

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

  it('SIGEM: o selo da proposta importada, em cinza neutro com o ícone de histórico, antes dos outros', () => {
    const p = proposta({ status: 'FINALIZADA', origem: 'SIGEM' });
    const el = montar({ proposta: p, selos: selosDaProposta(p, { pendente: true, naoSincronizada: false, hoje: '2026-10-01' }) });
    const selos = [...el.querySelectorAll('[data-selo]')];
    expect(selos.map((s) => [s.getAttribute('data-selo'), s.textContent?.trim()])).toEqual([['sigem', 'SIGEM'], ['pendencia', 'Pendência']]);
    expect(ESTILO_SELO.sigem.cor).toBe('bg-slate-100 text-slate-700');
    for (const c of ESTILO_SELO.sigem.cor.split(' ')) expect(selos[0].classList).toContain(c);
    const icone = selos[0].querySelector('svg')!;
    expect(icone.getAttribute('aria-hidden')).toBe('true');
    expect(icone.getAttribute('class')).toContain('lucide-history');
  });

  it('M2-P3: os selos da OS (selosOs) depois dos da proposta, cada um com a cor e o ícone dele', () => {
    const selosOs: SeloOsProposta[] = [
      { tipo: 'trabalho-proposta-cancelada', rotulo: 'Trabalho em proposta cancelada' },
      { tipo: 'os-em-andamento', rotulo: 'OS em andamento' },
      { tipo: 'os-concluida', rotulo: 'OS concluída' },
      { tipo: 'retorno-pendente', rotulo: 'Retorno pendente' },
      { tipo: 'os-cancelada', rotulo: 'OS cancelada' },
    ];
    const el = montar({ selos: [{ tipo: 'pendencia', rotulo: 'Pendência' }], selosOs });
    const selos = [...el.querySelectorAll('[data-selo]')];
    expect(selos.map((s) => [s.getAttribute('data-selo'), s.textContent?.trim()])).toEqual([
      ['pendencia', 'Pendência'],
      ...selosOs.map((s) => [s.tipo, s.rotulo]),
    ]);
    for (const s of selosOs) {
      const li = el.querySelector(`[data-selo="${s.tipo}"]`)!;
      for (const c of ESTILO_SELO_OS_PROPOSTA[s.tipo].cor.split(' ')) expect(li.classList).toContain(c);
      expect(li.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('M2-P3: sem selosOs (o padrão, como na lista de propostas antes da T5), só os da proposta', () => {
    const el = montar({ selos: [{ tipo: 'expirada', rotulo: 'Expirada' }] });
    expect([...el.querySelectorAll('[data-selo]')].map((s) => s.getAttribute('data-selo'))).toEqual(['expirada']);
  });

  it('M2-P3: só os selos da OS também abrem a lista de avisos', () => {
    const el = montar({ selosOs: [{ tipo: 'os-concluida', rotulo: 'OS concluída' }] });
    expect(el.querySelector('ul[aria-label=Avisos]')!.textContent).toContain('OS concluída');
  });
});
