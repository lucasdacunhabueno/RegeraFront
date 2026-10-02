import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import type { PropostaLocal } from '../propostas/proposta-models';
import { DialogoGerarOs, TecnicoOpcao } from './dialogo-gerar-os';
import type { OpcoesGerarOs } from './os-repo';

function proposta(p: Partial<PropostaLocal> = {}): PropostaLocal {
  return {
    id: 'p1', version: 3, codigoProvisorio: 'PROV-ABC123', numero: 277, revisao: 1, tipo: 'VENDA', status: 'APROVADA',
    clienteId: 'c1', templateId: 't1', responsavelId: 'u-com', tecnicoId: 'u-tec', dataEmissao: '2026-09-20',
    validadeAte: '2026-10-05', condicoesPagamento: '50% na assinatura', prazoExecucao: '30 dias',
    observacoes: 'Telhado de laje. Desconto de R$ 500,00 combinado.', descontoGeralCentesimos: 0, totalItensCentavos: 185184,
    totalDescontosCentavos: 0, totalCentavos: 185184, motivoEncerramento: null, itens: [], historico: [], documentos: [],
    atualizadoEm: null, origem: null, ...p,
  };
}

const TECNICOS: TecnicoOpcao[] = [{ id: 'u-tec2', nome: 'Ana Técnica' }, { id: 'u-tec', nome: 'Téo Técnico' }];

@Component({
  imports: [DialogoGerarOs],
  template: `
    <button id="abrir" type="button">Abrir</button>
    @if (aberto()) {
      <app-dialogo-gerar-os [proposta]="proposta()" [tecnicos]="tecnicos" [emCurso]="emCurso()" [ocupado]="ocupado()"
                            (confirmado)="confirmado($event)" (cancelado)="cancelado()" />
    }
  `,
})
class Hospedeiro {
  readonly aberto = signal(true);
  readonly proposta = signal(proposta());
  readonly emCurso = signal(0);
  readonly ocupado = signal(false);
  readonly tecnicos = TECNICOS;
  readonly confirmado = vi.fn<(o: OpcoesGerarOs) => void>();
  readonly cancelado = vi.fn(() => this.aberto.set(false));
}

function montar(ajustar: (h: Hospedeiro) => void = () => undefined) {
  const fixture = TestBed.createComponent(Hospedeiro);
  ajustar(fixture.componentInstance);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, h: fixture.componentInstance };
}

const botao = (el: HTMLElement, texto: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === texto);
const campo = <T extends HTMLElement = HTMLInputElement>(el: HTMLElement, sel: string) => el.querySelector<T>(sel)!;
function digitar(fixture: ComponentFixture<unknown>, c: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  c.value = valor;
  c.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}
function escolher(fixture: ComponentFixture<unknown>, c: HTMLSelectElement, valor: string) {
  c.value = valor;
  c.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}
function marcar(fixture: ComponentFixture<unknown>, c: HTMLInputElement, valor: boolean) {
  c.checked = valor;
  c.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

describe('DialogoGerarOs', () => {
  it('modal acessível: título ligado, todos os campos com rótulo e o foco no primeiro campo', async () => {
    const { el } = montar();
    const painel = el.querySelector('[role=dialog]')!;
    expect(painel.getAttribute('aria-modal')).toBe('true');
    expect(el.querySelector(`#${painel.getAttribute('aria-labelledby')}`)!.textContent).toContain('Gerar OS');
    for (const sel of ['select[name=tipo]', 'select[name=tecnico]', 'input[name=data]', 'input[name=urgente]', 'input[name=conclui]', 'textarea[name=descricao]']) {
      const c = el.querySelector<HTMLElement>(sel)!;
      expect(el.querySelector(`label[for=${c.id}]`), sel).not.toBeNull();
    }
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('select[name=tipo]')));
  });

  it('padrões: o tipo derivado da proposta (VENDA → Entrega), o técnico da proposta, sem data, não urgente e "conclui" marcado', () => {
    const { el } = montar();
    expect(campo<HTMLSelectElement>(el, 'select[name=tipo]').value).toBe('ENTREGA');
    expect(campo<HTMLSelectElement>(el, 'select[name=tecnico]').value).toBe('u-tec');
    expect([...campo<HTMLSelectElement>(el, 'select[name=tecnico]').options].map((o) => o.textContent?.trim()))
      .toEqual(['Nenhum (atribuir depois)', 'Ana Técnica', 'Téo Técnico']);
    expect(campo(el, 'input[name=data]').value).toBe('');
    expect(campo(el, 'input[name=urgente]').checked).toBe(false);
    expect(campo(el, 'input[name=conclui]').checked).toBe(true);
    expect(el.textContent).toContain('Esta OS conclui a proposta?');
  });

  it('o técnico da proposta que não está entre os ativos não vem escolhido', () => {
    const { el } = montar((h) => h.proposta.set(proposta({ tecnicoId: 'u-tec-off' })));
    expect(campo<HTMLSelectElement>(el, 'select[name=tecnico]').value).toBe('');
  });

  it('M2P2-R17: a descrição vem com as observações e o prazo da proposta, para revisar (o técnico a lê)', () => {
    const { el } = montar();
    const descricao = campo<HTMLTextAreaElement>(el, 'textarea[name=descricao]');
    expect(descricao.value).toBe('Telhado de laje. Desconto de R$ 500,00 combinado.\n\nPrazo de execução: 30 dias');
    const ajuda = el.querySelector(`#${descricao.getAttribute('aria-describedby')!.split(' ')[0]}`)!;
    expect(ajuda.textContent).toContain('O técnico lê a descrição');
    expect(ajuda.textContent).toContain('valores');
  });

  it('sem observações nem prazo, a descrição vem vazia', () => {
    const { el } = montar((h) => h.proposta.set(proposta({ observacoes: null, prazoExecucao: '  ' })));
    expect(campo<HTMLTextAreaElement>(el, 'textarea[name=descricao]').value).toBe('');
  });

  it('confirmar com os padrões: concluiProposta true e a descrição como veio', () => {
    const { el, h } = montar();
    botao(el, 'Gerar OS')!.click();
    expect(h.confirmado).toHaveBeenCalledExactlyOnceWith({
      tipo: 'ENTREGA', tecnicoId: 'u-tec', dataPrevista: null, urgente: false, concluiProposta: true,
      descricao: 'Telhado de laje. Desconto de R$ 500,00 combinado.\n\nPrazo de execução: 30 dias',
    });
  });

  it('confirmar com tudo trocado: "conclui" desmarcado vai false; a descrição revisada (sem o valor) e sem espaços nas pontas', () => {
    const { fixture, el, h } = montar();
    escolher(fixture, campo<HTMLSelectElement>(el, 'select[name=tipo]'), 'INSTALACAO');
    escolher(fixture, campo<HTMLSelectElement>(el, 'select[name=tecnico]'), '');
    digitar(fixture, campo(el, 'input[name=data]'), '2026-10-15');
    marcar(fixture, campo(el, 'input[name=urgente]'), true);
    marcar(fixture, campo(el, 'input[name=conclui]'), false);
    digitar(fixture, campo<HTMLTextAreaElement>(el, 'textarea[name=descricao]'), '  Telhado de laje.  ');
    botao(el, 'Gerar OS')!.click();
    expect(h.confirmado).toHaveBeenCalledExactlyOnceWith({
      tipo: 'INSTALACAO', tecnicoId: null, dataPrevista: '2026-10-15', urgente: true, concluiProposta: false, descricao: 'Telhado de laje.',
    });
  });

  it('a descrição apagada vai null (OS sem descrição)', () => {
    const { fixture, el, h } = montar();
    digitar(fixture, campo<HTMLTextAreaElement>(el, 'textarea[name=descricao]'), '   ');
    botao(el, 'Gerar OS')!.click();
    expect(h.confirmado.mock.calls[0][0].descricao).toBeNull();
  });

  it('descrição acima de 4.000 caracteres: o erro no campo e nada confirmado', () => {
    const { fixture, el, h } = montar();
    const descricao = campo<HTMLTextAreaElement>(el, 'textarea[name=descricao]');
    digitar(fixture, descricao, 'x'.repeat(4001));
    botao(el, 'Gerar OS')!.click();
    fixture.detectChanges();
    expect(h.confirmado).not.toHaveBeenCalled();
    expect(descricao.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('[role=alert]')!.textContent).toContain('Máximo de 4000 caracteres.');
    expect(document.activeElement).toBe(descricao);
  });

  it('com OS em curso na proposta, avisa antes de gerar outra', () => {
    let { el } = montar();
    expect(el.textContent).not.toContain('já tem');
    TestBed.resetTestingModule();
    ({ el } = montar((h) => h.emCurso.set(1)));
    expect(el.textContent).toContain('Esta proposta já tem 1 OS aberta ou em andamento.');
  });

  it('ocupado: os botões desabilitam e o texto diz que está gerando', () => {
    const { el } = montar((h) => h.ocupado.set(true));
    expect(botao(el, 'Gerando…')!.disabled).toBe(true);
    expect(botao(el, 'Voltar')!.disabled).toBe(true);
  });

  it('Esc sem nada mudado cancela', () => {
    const { el, h } = montar();
    el.querySelector<HTMLElement>('[role=dialog]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(h.cancelado).toHaveBeenCalledTimes(1);
  });

  it('o toque fora sem nada mudado cancela', () => {
    const { el, h } = montar();
    el.querySelector<HTMLElement>('app-dialogo-gerar-os')!.click();
    expect(h.cancelado).toHaveBeenCalledTimes(1);
  });

  it('com a descrição alterada, o Esc e o toque fora não descartam (só o Voltar)', () => {
    const { fixture, el, h } = montar();
    digitar(fixture, campo<HTMLTextAreaElement>(el, 'textarea[name=descricao]'), 'Outra coisa');
    el.querySelector<HTMLElement>('[role=dialog]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    el.querySelector<HTMLElement>('app-dialogo-gerar-os')!.click();
    expect(h.cancelado).not.toHaveBeenCalled();
    botao(el, 'Voltar')!.click();
    expect(h.cancelado).toHaveBeenCalledTimes(1);
  });

  it('o foco fica preso no diálogo (Tab no último volta ao primeiro)', () => {
    const { el } = montar();
    const painel = el.querySelector<HTMLElement>('[role=dialog]')!;
    const gerar = botao(el, 'Gerar OS')!;
    gerar.focus();
    painel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(el.querySelector('select[name=tipo]'));
  });

  it('ao fechar, o foco volta a quem abriu', async () => {
    const { fixture, el, h } = montar((x) => x.aberto.set(false));
    const abrir = el.querySelector<HTMLButtonElement>('#abrir')!;
    abrir.focus();
    h.aberto.set(true);
    fixture.detectChanges();
    botao(el, 'Voltar')!.click();
    fixture.detectChanges();
    await vi.waitFor(() => expect(document.activeElement).toBe(abrir));
  });
});
