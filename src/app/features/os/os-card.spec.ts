import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SeloOs } from './formatos-os';
import { OsDados, OsLocal, paraOsLocal } from './os-models';

import { OsCard } from './os-card';

const os = (extra: Partial<OsDados> = {}): OsLocal =>
  paraOsLocal('o-1', 1, {
    codigoProvisorio: 'OSP-K7Q2ZP', numero: 123, revisao: 2, propostaId: 'p1', propostaCodigoExibido: '000277', clienteId: 'c1',
    tipo: 'MANUTENCAO', status: 'EM_ANDAMENTO', tecnicoId: 'u-tec', dataPrevista: '2026-10-05', urgente: true,
    concluiProposta: true, enderecoLogradouro: 'Av. Paulista', enderecoNumero: '1000', enderecoBairro: 'Bela Vista',
    enderecoCidade: 'São Paulo', enderecoUf: 'SP', enderecoCep: '01310100', descricao: 'Trocar o quadro',
    assinaturaRecusada: false, itens: [], notas: [], anexos: [], historico: [], ...extra,
  });

function montar(entradas: { os?: OsLocal; clienteNome?: string; tecnicoNome?: string | null; mostrarTecnico?: boolean; selos?: SeloOs[] } = {}) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(OsCard);
  fixture.componentRef.setInput('os', entradas.os ?? os());
  fixture.componentRef.setInput('clienteNome', entradas.clienteNome ?? 'Padaria São João');
  if (entradas.tecnicoNome !== undefined) fixture.componentRef.setInput('tecnicoNome', entradas.tecnicoNome);
  if (entradas.mostrarTecnico !== undefined) fixture.componentRef.setInput('mostrarTecnico', entradas.mostrarTecnico);
  if (entradas.selos) fixture.componentRef.setInput('selos', entradas.selos);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('OsCard', () => {
  it('código (com a revisão), cliente, bairro e cidade do snapshot, tipo, status e data prevista; o card é o link para /os/:id', () => {
    const el = montar();
    expect(el.querySelector('.font-mono')?.textContent?.trim()).toBe('OS-000123-R2');
    expect(el.textContent).toContain('Padaria São João');
    expect(el.querySelector('[data-local]')?.textContent?.trim()).toBe('Bela Vista · São Paulo');
    expect(el.querySelector('[data-tipo]')?.textContent?.trim()).toBe('Manutenção');
    const status = el.querySelector('[data-status]')!;
    expect(status.textContent?.trim()).toBe('Em andamento');
    expect(status.className).toContain('bg-amber-100');
    expect(el.querySelector('[data-prevista]')?.textContent?.trim()).toBe('Prevista: 05/10/2026');
    const link = el.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/os/o-1');
    expect(link.className).toContain('min-h-12');
  });

  it('sem número: o OSP-…; sem data prevista e sem bairro nem cidade, o card diz isso sem linha vazia', () => {
    const el = montar({ os: os({ numero: null, revisao: null, dataPrevista: null, enderecoBairro: null, enderecoCidade: null }) });
    expect(el.querySelector('.font-mono')?.textContent?.trim()).toBe('OSP-K7Q2ZP');
    expect(el.querySelector('[data-prevista]')?.textContent?.trim()).toBe('Sem data prevista');
    expect(el.querySelector('[data-local]')).toBeNull();
  });

  it('o técnico só aparece no escritório (mostrarTecnico); sem técnico atribuído, "Sem técnico"', () => {
    expect(montar({ tecnicoNome: 'Téo Técnico' }).textContent).not.toContain('Técnico:');
    TestBed.resetTestingModule();
    expect(montar({ tecnicoNome: 'Téo Técnico', mostrarTecnico: true }).querySelector('[data-tecnico]')?.textContent?.trim())
      .toBe('Técnico: Téo Técnico');
    TestBed.resetTestingModule();
    expect(montar({ tecnicoNome: null, mostrarTecnico: true }).querySelector('[data-tecnico]')?.textContent?.trim())
      .toBe('Sem técnico');
  });

  it('selos com o estilo de cada um, na ordem recebida, numa lista "Avisos"', () => {
    const el = montar({
      selos: [
        { tipo: 'urgente', rotulo: 'Urgente' }, { tipo: 'atrasada', rotulo: 'Atrasada' },
        { tipo: 'nao-sincronizada', rotulo: 'Não sincronizada' },
      ],
    });
    const selos = [...el.querySelectorAll('ul[aria-label=Avisos] [data-selo]')];
    expect(selos.map((s) => [s.getAttribute('data-selo'), s.textContent?.trim()])).toEqual([
      ['urgente', 'Urgente'], ['atrasada', 'Atrasada'], ['nao-sincronizada', 'Não sincronizada'],
    ]);
    expect(selos[0].className).toContain('bg-red-100');
    expect(selos[1].className).toContain('bg-orange-100');
    expect(selos[2].className).toContain('bg-amber-100');
    expect(selos.every((s) => s.querySelector('svg[aria-hidden=true]'))).toBe(true);
  });

  it('sem selos, sem a lista', () => {
    expect(montar().querySelector('ul')).toBeNull();
  });

  it('nenhum valor e nenhum documento: o card não mostra CPF/CNPJ, endereço completo, descrição nem a proposta', () => {
    const el = montar({ mostrarTecnico: true, tecnicoNome: 'Téo' });
    const texto = el.textContent ?? '';
    expect(texto).not.toMatch(/R\$/);
    expect(texto).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{11,14}/);
    expect(texto).not.toContain('Paulista');
    expect(texto).not.toContain('01310');
    expect(texto).not.toContain('Trocar o quadro');
    expect(texto).not.toContain('000277');
  });
});
