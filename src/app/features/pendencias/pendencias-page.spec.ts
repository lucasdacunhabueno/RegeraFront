import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { Perfil } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
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

const itemDuplicado: Pendencia = {
  mutationId: 'm5', entidade: 'item_catalogo', agregadoId: 'i1', tipo: 'REJEITADO', criadaEm: '5',
  erro: { codigo: 'CODIGO_DUPLICADO', mensagem: 'Já existe um item com este código.' },
  mutacao: { mutationId: 'm5', entidade: 'item_catalogo', agregadoId: 'i1', op: 'UPSERT', baseVersion: null, dados: { codigo: 'PNL', nome: 'Painel' }, criadaEm: '' },
};
const itemExcluido: Pendencia = {
  mutationId: 'm6', entidade: 'item_catalogo', agregadoId: 'i2', tipo: 'CONFLITO', criadaEm: '6', versionServidor: 3,
  dadosServidor: { codigo: 'GER', nome: 'Gerador' },
  mutacao: { mutationId: 'm6', entidade: 'item_catalogo', agregadoId: 'i2', op: 'DELETE', baseVersion: 1, dados: null, criadaEm: '' },
};
const empresaRejeitada: Pendencia = {
  mutationId: 'm7', entidade: 'empresa', agregadoId: 'e1', tipo: 'REJEITADO', criadaEm: '7',
  erro: { codigo: 'VALIDACAO', mensagem: 'Dados inválidos.' },
  mutacao: { mutationId: 'm7', entidade: 'empresa', agregadoId: 'e1', op: 'UPSERT', baseVersion: 1, dados: { razaoSocial: 'X' }, criadaEm: '' },
};

const templateRejeitado: Pendencia = {
  mutationId: 'm9', entidade: 'template_proposta', agregadoId: 't1', tipo: 'REJEITADO', criadaEm: '9',
  erro: { codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { 'blocos[0].config': 'Opção não permitida para este bloco.' } },
  mutacao: { mutationId: 'm9', entidade: 'template_proposta', agregadoId: 't1', op: 'UPSERT', baseVersion: 1, dados: { nome: 'Serviço padrão' }, criadaEm: '' },
};
const templateExcluido: Pendencia = {
  mutationId: 'm10', entidade: 'template_proposta', agregadoId: 't2', tipo: 'REJEITADO', criadaEm: '10',
  erro: { codigo: 'ACESSO_NEGADO', mensagem: 'Sem permissão.' },
  mutacao: { mutationId: 'm10', entidade: 'template_proposta', agregadoId: 't2', op: 'DELETE', baseVersion: 1, dados: null, criadaEm: '' },
};

function montar(itens: Pendencia[], naoSincronizados = 0, perfil: Perfil = 'ADMIN') {
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
      { provide: AuthService, useValue: { usuario: signal({ id: 'u', nome: 'U', email: 'u@u', perfil, ativo: true }) } },
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

  it('item com código duplicado: título do item, orienta a editar o código e o admin abre o item', () => {
    const { el, navegar } = montar([itemDuplicado]);
    expect(el.textContent).toContain('Item do catálogo: PNL · Painel');
    expect(el.textContent).toContain('Este código já é usado por outro item. Edite o código deste item.');
    expect(el.textContent).not.toContain('Exclusão de cliente');
    expect(botao(el, 'Usar cadastro existente')).toBeUndefined();
    botao(el, 'Editar').click();
    expect(navegar).toHaveBeenCalledWith('/catalogo/i1');
  });

  it('item: só o admin pode editar; descartar continua disponível', () => {
    const { el, svc } = montar([itemDuplicado], 0, 'COMERCIAL');
    expect(botao(el, 'Editar')).toBeUndefined();
    botao(el, 'Descartar').click();
    expect(svc.descartar).toHaveBeenCalledWith(itemDuplicado);
  });

  it('exclusão de item mostra o título certo com os dados do servidor', () => {
    const { el } = montar([itemExcluido]);
    expect(el.textContent).toContain('Exclusão de item do catálogo: GER · Gerador');
  });

  it('empresa: título "Dados da empresa" e sem Editar', () => {
    const { el } = montar([empresaRejeitada]);
    expect(el.textContent).toContain('Dados da empresa');
    expect(el.textContent).not.toContain('Cliente');
    expect(botao(el, 'Editar')).toBeUndefined();
  });

  it('template: título com o nome e o admin abre /templates/id', () => {
    const { el, navegar } = montar([templateRejeitado]);
    expect(el.textContent).toContain('Template de proposta: Serviço padrão');
    expect(el.textContent).toContain('blocos[0].config: Opção não permitida para este bloco.');
    botao(el, 'Editar').click();
    expect(navegar).toHaveBeenCalledWith('/templates/t1');
  });

  it('template: só o admin pode editar', () => {
    const { el } = montar([templateRejeitado], 0, 'COMERCIAL');
    expect(botao(el, 'Editar')).toBeUndefined();
    expect(botao(el, 'Descartar')).toBeDefined();
  });

  it('exclusão de template sem dados: título "Exclusão de template"', () => {
    const { el } = montar([templateExcluido]);
    expect(el.textContent).toContain('Exclusão de template');
    expect(el.textContent).not.toContain('Template de proposta');
  });

  it('cliente sem nome: título de cliente', () => {
    const semNome: Pendencia = { ...duplicado, mutationId: 'm8', mutacao: { ...duplicado.mutacao, op: 'DELETE', dados: null } };
    const { el } = montar([semNome]);
    expect(el.textContent).toContain('Exclusão de cliente');
  });
});
