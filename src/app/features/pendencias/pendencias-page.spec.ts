import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ErroProposta } from '../propostas/propostas-repo';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { Perfil } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { PdfService } from '../../core/pdf/pdf-service';
import { PendenciasService } from '../../core/sync/pendencias-service';
import { Toasts } from '../../shared/ui/toasts';
import { PropostaLocal } from '../propostas/proposta-models';
import { PropostasRepo } from '../propostas/propostas-repo';
import { Pendencia, TIPO_UPLOAD_DOCUMENTO } from '../../core/sync/sync-models';
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

function propostaLocal(id: string, p: Partial<PropostaLocal> = {}): PropostaLocal {
  return {
    id, version: 1, codigoProvisorio: 'PROV-ABC123', numero: null, revisao: null, tipo: 'VENDA', status: 'ENVIADA', clienteId: 'c1',
    templateId: null, responsavelId: 'u', tecnicoId: null, dataEmissao: '2026-09-20', validadeAte: '2026-10-05', condicoesPagamento: null,
    prazoExecucao: null, observacoes: null, descontoGeralCentesimos: null, totalItensCentavos: 0, totalDescontosCentavos: 0,
    totalCentavos: 0, motivoEncerramento: null, itens: [], historico: [], documentos: [], atualizadoEm: null, ...p,
  };
}

interface OpcoesMontar {
  propostas?: PropostaLocal[];
  regerar?: ReturnType<typeof vi.fn>;
}

function montar(itens: Pendencia[], naoSincronizados = 0, perfil: Perfil = 'ADMIN', o: OpcoesMontar = {}) {
  const repo = {
    observarTodas: () => of(o.propostas ?? []),
    regerarDocumento: o.regerar ?? vi.fn().mockResolvedValue({ blob: new Blob(['%PDF'], { type: 'application/pdf' }), codigoExibido: '000277' }),
  };
  const pdf = { gerarBlob: vi.fn().mockResolvedValue(new Blob(['%PDF'])) };
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
      { provide: PropostasRepo, useValue: repo },
      { provide: PdfService, useValue: pdf },
      { provide: SyncService, useValue: { sincronizar, naoSincronizados: signal(naoSincronizados), sincronizando: signal(false) } },
      { provide: ConectividadeService, useValue: { online: signal(true) } },
      { provide: AuthService, useValue: { usuario: signal({ id: 'u', nome: 'U', email: 'u@u', perfil, ativo: true }) } },
    ],
  });
  const fixture = TestBed.createComponent(PendenciasPage);
  fixture.detectChanges();
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const navegarRota = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { el: fixture.nativeElement as HTMLElement, svc, sincronizar, navegar, navegarRota, fixture, repo, pdf };
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

  it('conflito oferece manter a minha ou usar a do servidor', async () => {
    const { el, svc, fixture } = montar([conflito]);
    expect(el.textContent).toContain('Maria');
    expect(el.textContent).toContain('Alterado por outra pessoa');
    botao(el, 'Manter a minha').click();
    expect(svc.manterMinha).toHaveBeenCalledWith(conflito);
    // uma ação por vez na mesma pendência: espera a primeira terminar
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(botao(el, 'Usar a do servidor').disabled).toBe(false);
    });
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

  it('ação em curso desabilita os botões daquela pendência (toque duplo não repete a ação)', async () => {
    const { el, svc, fixture } = montar([conflito, duplicado]);
    let terminar!: () => void;
    svc.manterMinha.mockReturnValue(new Promise<void>((r) => (terminar = r)));
    botao(el, 'Manter a minha').click();
    botao(el, 'Manter a minha').click();
    await fixture.whenStable();
    expect(svc.manterMinha).toHaveBeenCalledTimes(1);
    expect(botao(el, 'Manter a minha').disabled).toBe(true);
    expect(botao(el, 'Usar a do servidor').disabled).toBe(true);
    // a outra pendência continua livre
    expect(botao(el, 'Usar cadastro existente').disabled).toBe(false);
    terminar();
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(botao(el, 'Manter a minha').disabled).toBe(false);
    });
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
    expect(el.textContent).toContain('Bloco 1: Opção não permitida para este bloco.');
    botao(el, 'Editar').click();
    expect(navegar).toHaveBeenCalledWith('/templates/t1');
  });

  it('template: caminhos de erro viram texto amigável, com o tipo do bloco quando há dados', () => {
    const p: Pendencia = {
      ...templateRejeitado,
      erro: {
        codigo: 'VALIDACAO', mensagem: 'Dados inválidos.',
        campos: {
          'blocos[0].config.colunas': 'Escolha pelo menos uma coluna.',
          'blocos[2].tipo': 'Tipo de bloco desconhecido.',
          blocos: 'No máximo 50 blocos.',
          nome: 'Informe o nome.',
          padrao: 'Um template inativo não pode ser o padrão.',
        },
      },
      mutacao: {
        ...templateRejeitado.mutacao,
        dados: { nome: 'Serviço padrão', blocos: [{ id: 'a', tipo: 'ITENS', config: {} }, { id: 'b', tipo: 'TOTAIS', config: {} }, { id: 'c', tipo: 'X' }] },
      },
    };
    const { el } = montar([p]);
    const linhas = [...el.querySelectorAll('li li')].map((l) => l.textContent?.trim());
    expect(linhas).toEqual([
      'Bloco 1 (Itens): Escolha pelo menos uma coluna.',
      'Bloco 3: Tipo de bloco desconhecido.',
      'Blocos: No máximo 50 blocos.',
      'Nome: Informe o nome.',
      'Padrão: Um template inativo não pode ser o padrão.',
    ]);
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

  it('upload do PDF recusado: título do PDF, a mensagem e só Descartar', () => {
    const upload: Pendencia = {
      mutationId: 'm11', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', tipo: 'REJEITADO', criadaEm: '11',
      erro: { codigo: 'REVISAO_INVALIDA', mensagem: 'O PDF PROV-0Z9XY7 é de outra revisão da proposta.' },
      mutacao: { mutationId: 'm11', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', op: 'UPLOAD', baseVersion: null, dados: { documentoId: 'd1' }, criadaEm: '' },
    };
    const { el, svc } = montar([upload]);
    expect(el.textContent).toContain('PDF da proposta');
    expect(el.textContent).toContain('O PDF PROV-0Z9XY7 é de outra revisão da proposta.');
    expect(botao(el, 'Editar')).toBeUndefined();
    botao(el, 'Descartar').click();
    expect(svc.descartar).toHaveBeenCalledWith(upload);
  });

  describe('proposta', () => {
    const rejeitada = (extra: Partial<Pendencia> = {}, dados: Record<string, unknown> = { status: 'RASCUNHO', codigoProvisorio: 'PROV-MUT999' }): Pendencia => ({
      mutationId: 'mp', entidade: 'proposta', agregadoId: 'p1', tipo: 'REJEITADO', criadaEm: '20',
      erro: { codigo: 'VALIDACAO', mensagem: 'Revise os campos destacados.' },
      mutacao: { mutationId: 'mp', entidade: 'proposta', agregadoId: 'p1', op: 'UPSERT', baseVersion: 1, dados, criadaEm: '' },
      ...extra,
    });
    const upload = (codigo: string): Pendencia => ({
      mutationId: 'mu', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', tipo: 'REJEITADO', criadaEm: '21',
      erro: { codigo, mensagem: 'O código impresso no PDF não é o da proposta.' },
      mutacao: { mutationId: 'mu', entidade: TIPO_UPLOAD_DOCUMENTO, agregadoId: 'p1', op: 'UPLOAD', baseVersion: null, dados: { documentoId: 'd1' }, criadaEm: '' },
    });
    const abrir = (el: HTMLElement) => el.querySelector<HTMLAnchorElement>('[data-testid="abrir-proposta"]');

    it('título com o código da cópia local (número) e, sem ela, o provisório da mutação', () => {
      const a = montar([rejeitada()], 0, 'ADMIN', { propostas: [propostaLocal('p1', { numero: 277, revisao: 2 })] });
      expect(a.el.querySelector('li p')!.textContent).toContain('Proposta 000277-R2');
      TestBed.resetTestingModule();
      const b = montar([rejeitada()]);
      expect(b.el.querySelector('li p')!.textContent).toContain('Proposta PROV-MUT999');
    });

    it('rejeição corrigível: "Corrigir e reenviar" leva a /propostas/:id/corrigir (sem "Abrir proposta")', () => {
      const { el, navegarRota } = montar([rejeitada()], 0, 'ADMIN', { propostas: [propostaLocal('p1')] });
      expect(abrir(el)).toBeNull();
      botao(el, 'Corrigir e reenviar').click();
      expect(navegarRota).toHaveBeenCalledWith(['/propostas', 'p1', 'corrigir']);
    });

    it('rejeição não corrigível: "Abrir proposta" leva ao detalhe, e Descartar continua', () => {
      const naoCorrigivel = rejeitada({ erro: { codigo: 'ACESSO_NEGADO', mensagem: 'Sem permissão.' } });
      const { el } = montar([naoCorrigivel], 0, 'ADMIN', { propostas: [propostaLocal('p1')] });
      expect(botao(el, 'Corrigir e reenviar')).toBeUndefined();
      expect(abrir(el)!.getAttribute('href')).toBe('/propostas/p1');
      expect(botao(el, 'Descartar')).toBeDefined();
    });

    it('comercial que não é o responsável não corrige: só abre a proposta', () => {
      const { el } = montar([rejeitada()], 0, 'COMERCIAL', { propostas: [propostaLocal('p1', { responsavelId: 'outro' })] });
      expect(botao(el, 'Corrigir e reenviar')).toBeUndefined();
      expect(abrir(el)).not.toBeNull();
    });

    it('conflito de proposta mantém as ações e ganha "Abrir proposta"', () => {
      const c = rejeitada({ tipo: 'CONFLITO', erro: undefined, dadosServidor: { codigoProvisorio: 'PROV-ABC123' } });
      const { el } = montar([c], 0, 'ADMIN', { propostas: [propostaLocal('p1')] });
      expect(botao(el, 'Manter a minha')).toBeDefined();
      expect(abrir(el)!.getAttribute('href')).toBe('/propostas/p1');
    });

    it('upload CODIGO_EXIBIDO_INVALIDO de proposta enviada: "Gerar PDF novamente" regera pelo repositório e compartilha (sem share: baixa)', async () => {
      const cliques: string[] = [];
      const original = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        cliques.push(this.download);
      };
      URL.createObjectURL = vi.fn(() => 'blob:x');
      URL.revokeObjectURL = vi.fn();
      try {
        const { el, repo, pdf, fixture } = montar([upload('CODIGO_EXIBIDO_INVALIDO')], 0, 'ADMIN', { propostas: [propostaLocal('p1')] });
        expect(el.textContent).toContain('PDF da proposta PROV-ABC123');
        expect(el.textContent).toContain('Gere o PDF novamente');
        botao(el, 'Gerar PDF novamente').click();
        await vi.waitFor(() => expect(cliques).toEqual(['Proposta-000277.pdf']));
        expect(repo.regerarDocumento).toHaveBeenCalledWith('p1', expect.any(Function));
        // o gerador entregue ao repositório é o PdfService
        const gerar = repo.regerarDocumento.mock.calls[0][1] as (e: unknown) => Promise<Blob>;
        await gerar({});
        expect(pdf.gerarBlob).toHaveBeenCalled();
        await fixture.whenStable();
        expect(botao(el, 'Gerar PDF novamente').disabled).toBe(false);
      } finally {
        HTMLAnchorElement.prototype.click = original;
      }
    });

    it('"Gerar PDF novamente": o toque duplo não regera duas vezes', async () => {
      let liberar!: (v: { blob: Blob; codigoExibido: string }) => void;
      const regerar = vi.fn(() => new Promise<{ blob: Blob; codigoExibido: string }>((r) => (liberar = r)));
      const { el, fixture } = montar([upload('CODIGO_EXIBIDO_INVALIDO')], 0, 'ADMIN', { propostas: [propostaLocal('p1')], regerar });
      botao(el, 'Gerar PDF novamente').click();
      fixture.detectChanges();
      expect(botao(el, 'Gerando PDF…').disabled).toBe(true);
      botao(el, 'Gerando PDF…').click();
      expect(regerar).toHaveBeenCalledTimes(1);
      liberar({ blob: new Blob(['x']), codigoExibido: 'PROV-ABC123' });
    });

    it('"Gerar PDF novamente": o erro do repositório vira toast e a pendência continua', async () => {
      const regerar = vi.fn().mockRejectedValue(new ErroProposta('PDF_GRANDE', 'proposta', 'O PDF passou de 10 MB. Reduza imagens do template.'));
      const { el, fixture } = montar([upload('CODIGO_EXIBIDO_INVALIDO')], 0, 'ADMIN', { propostas: [propostaLocal('p1')], regerar });
      const erro = vi.spyOn(TestBed.inject(Toasts), 'erro');
      botao(el, 'Gerar PDF novamente').click();
      await vi.waitFor(() => expect(erro).toHaveBeenCalledWith('O PDF passou de 10 MB. Reduza imagens do template.'));
      await fixture.whenStable();
      expect(botao(el, 'Gerar PDF novamente').disabled).toBe(false);
    });

    it('"Gerar PDF novamente": com o navegador pedindo toque, mostra o painel "PDF pronto"', async () => {
      const share = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', { value: share, configurable: true });
      try {
        const { el, fixture } = montar([upload('CODIGO_EXIBIDO_INVALIDO')], 0, 'ADMIN', { propostas: [propostaLocal('p1')] });
        botao(el, 'Gerar PDF novamente').click();
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(el.querySelector('app-pdf-pronto')).not.toBeNull();
        });
        expect(el.textContent).toContain('Proposta-000277.pdf');
      } finally {
        delete (navigator as unknown as Record<string, unknown>)['canShare'];
        delete (navigator as unknown as Record<string, unknown>)['share'];
      }
    });

    it('upload CODIGO_EXIBIDO_INVALIDO de rascunho: não há o que gerar, só Descartar', () => {
      const { el, svc } = montar([upload('CODIGO_EXIBIDO_INVALIDO')], 0, 'ADMIN', { propostas: [propostaLocal('p1', { status: 'RASCUNHO' })] });
      expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
      expect(el.textContent).toContain('Descarte esta pendência');
      botao(el, 'Descartar').click();
      expect(svc.descartar).toHaveBeenCalled();
    });

    it('upload recusado por outro motivo: a mensagem do servidor e Descartar, sem "Gerar PDF novamente"', () => {
      const u = upload('REVISAO_INVALIDA');
      const { el, svc } = montar([u], 0, 'ADMIN', { propostas: [propostaLocal('p1')] });
      expect(el.textContent).toContain('O código impresso no PDF não é o da proposta.');
      expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
      botao(el, 'Descartar').click();
      expect(svc.descartar).toHaveBeenCalledWith(u);
    });
  });
});
