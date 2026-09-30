import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { PendenciasService } from '../../core/sync/pendencias-service';
import { Pendencia } from '../../core/sync/sync-models';
import { SyncService } from '../../core/sync/sync-service';
import { PendenciasPage } from './pendencias-page';

const conflito: Pendencia = {
  mutationId: 'm1', entidade: 'cliente', agregadoId: 'c1', tipo: 'CONFLITO', criadaEm: '1', versionServidor: 3, dadosServidor: { nome: 'Outra' },
  mutacao: { mutationId: 'm1', entidade: 'cliente', agregadoId: 'c1', op: 'UPSERT', baseVersion: 1, dados: { nome: 'Maria' }, criadaEm: '' },
};
const duplicado: Pendencia = {
  mutationId: 'm2', entidade: 'cliente', agregadoId: 'c2', tipo: 'REJEITADO', criadaEm: '2',
  erro: { codigo: 'DOCUMENTO_DUPLICADO', mensagem: 'Já existe um cliente com este CPF/CNPJ.', idExistente: 'c9' },
  mutacao: { mutationId: 'm2', entidade: 'cliente', agregadoId: 'c2', op: 'UPSERT', baseVersion: null, dados: { nome: 'Maria 2' }, criadaEm: '' },
};

const excluidoLa: Pendencia = { ...conflito, mutationId: 'm3', agregadoId: 'c3', dadosServidor: undefined };
const comCampos: Pendencia = {
  ...duplicado, mutationId: 'm4', agregadoId: 'c4',
  erro: { codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { email: 'E-mail inválido', nome: 'Obrigatório' } },
};

function montar(itens: Pendencia[], naoSincronizados = 0) {
  const svc = {
    observar: () => of(itens),
    manterMinha: vi.fn().mockResolvedValue(undefined),
    usarServidor: vi.fn().mockResolvedValue(undefined),
    descartar: vi.fn().mockResolvedValue(undefined),
    usarExistente: vi.fn().mockResolvedValue('c9'),
  };
  const sincronizar = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PendenciasService, useValue: svc },
      { provide: SyncService, useValue: { sincronizar, naoSincronizados: signal(naoSincronizados), sincronizando: signal(false) } },
      { provide: ConectividadeService, useValue: { online: signal(true) } },
    ],
  });
  const fixture = TestBed.createComponent(PendenciasPage);
  fixture.detectChanges();
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return { el: fixture.nativeElement as HTMLElement, svc, sincronizar, navegar };
}

const botao = (el: HTMLElement, texto: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto)!;

describe('PendenciasPage', () => {
  it('sem pendências mostra tudo em dia e permite sincronizar', () => {
    const { el, sincronizar } = montar([], 2);
    expect(el.textContent).toContain('2 alteração(ões) aguardando envio');
    botao(el, 'Sincronizar agora').click();
    expect(sincronizar).toHaveBeenCalled();
  });

  it('conflito oferece manter a minha ou usar a do servidor', () => {
    const { el, svc } = montar([conflito]);
    expect(el.textContent).toContain('Maria');
    expect(el.textContent).toContain('Alterado por outra pessoa');
    botao(el, 'Manter a minha').click();
    expect(svc.manterMinha).toHaveBeenCalledWith(conflito);
    botao(el, 'Usar a do servidor').click();
    expect(svc.usarServidor).toHaveBeenCalledWith(conflito);
  });

  it('conflito com registro excluído no servidor oferece só Descartar', () => {
    const { el, svc } = montar([excluidoLa]);
    expect(el.textContent).toContain('Excluído por outra pessoa.');
    expect(el.textContent).not.toContain('Alterado por outra pessoa');
    expect(botao(el, 'Manter a minha')).toBeUndefined();
    botao(el, 'Descartar').click();
    expect(svc.usarServidor).toHaveBeenCalledWith(excluidoLa);
    expect(svc.descartar).not.toHaveBeenCalled();
  });

  it('lista erro.campos como campo: mensagem', () => {
    const { el } = montar([comCampos]);
    expect(el.textContent).toContain('email: E-mail inválido');
    expect(el.textContent).toContain('nome: Obrigatório');
  });

  it('documento duplicado oferece usar o cadastro existente e abre ele', async () => {
    const { el, svc, navegar } = montar([duplicado]);
    expect(el.textContent).toContain('Já existe um cliente com este CPF/CNPJ.');
    botao(el, 'Usar cadastro existente').click();
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/clientes/c9'));
    expect(svc.usarExistente).toHaveBeenCalledWith(duplicado);
  });

  it('rejeição permite editar ou descartar', () => {
    const { el, svc, navegar } = montar([duplicado]);
    botao(el, 'Editar').click();
    expect(navegar).toHaveBeenCalledWith('/clientes/c2');
    botao(el, 'Descartar').click();
    expect(svc.descartar).toHaveBeenCalledWith(duplicado);
  });
});
