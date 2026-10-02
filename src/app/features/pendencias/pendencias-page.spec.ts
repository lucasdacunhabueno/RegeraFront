import { HttpErrorResponse } from '@angular/common/http';
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
import { ErroOs } from '../os/erro-os';
import { OsRepo } from '../os/os-repo';
import type { ItemPerdaOs } from '../os/formatos-os';
import { OsDados, OsLocal, paraOsLocal, TipoAnexoOs } from '../os/os-models';
import { PropostaLocal } from '../propostas/proposta-models';
import { PropostasRepo } from '../propostas/propostas-repo';
import { Pendencia, TIPO_UPLOAD_ANEXO_OS, TIPO_UPLOAD_DOCUMENTO } from '../../core/sync/sync-models';
import { SyncService } from '../../core/sync/sync-service';
import { tipoUploadDe } from '../../core/sync/tipos-upload';
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
  /** As OS do aparelho com pendência e o tipo dos anexos (`observarOsDasPendencias`). */
  os?: OsLocal[];
  anexos?: [string, TipoAnexoOs][];
  /** A revisão de cada PDF (`revisoesDosPdfs`); sem ela, todo DOCUMENTO de `anexos` é da revisão 1. */
  revisoesPdf?: [string, number][];
  regerar?: ReturnType<typeof vi.fn>;
  /** O `OsRepo.regerarPdf`. */
  regerarOs?: ReturnType<typeof vi.fn>;
  /** P4c-R15: "Usar a do servidor" levaria um envio ou PDF feito no aparelho. */
  descartaEnvio?: boolean;
  /** Na OS: o que a ação levaria (`perdaDaOs`); sem ele, as fotos, a assinatura e o PDF seguem o `descartaEnvio`. */
  perdaOs?: ItemPerdaOs[];
  /** M2: o "Manter a minha" tirou notas. */
  notasDescartadas?: boolean;
}

function montar(itens: Pendencia[], naoSincronizados = 0, perfil: Perfil = 'ADMIN', o: OpcoesMontar = {}) {
  const repo = {
    observarTodas: () => of(o.propostas ?? []),
    regerarDocumento: o.regerar ?? vi.fn().mockResolvedValue({ blob: new Blob(['%PDF'], { type: 'application/pdf' }), codigoExibido: '000277' }),
  };
  const pdf = { gerarBlob: vi.fn().mockResolvedValue(new Blob(['%PDF'])), gerarBlobOs: vi.fn().mockResolvedValue(new Blob(['%PDF'])) };
  const osRepo = {
    regerarPdf: o.regerarOs ?? vi.fn().mockResolvedValue({ blob: new Blob(['%PDF'], { type: 'application/pdf' }), codigoExibido: 'OS-000123' }),
  };
  const svc = {
    observar: () => of(itens),
    manterMinha: vi.fn().mockResolvedValue({ notasDescartadas: o.notasDescartadas ?? false }),
    usarServidor: vi.fn().mockResolvedValue(undefined),
    descartar: vi.fn().mockResolvedValue(undefined),
    usarExistente: vi.fn().mockResolvedValue('c9'),
    descartaEnvio: vi.fn().mockResolvedValue(o.descartaEnvio ?? false),
    perdaDaOs: vi.fn().mockResolvedValue(o.perdaOs ?? (o.descartaEnvio ? ['fotos', 'assinatura', 'pdf'] : [])),
    observarOsDasPendencias: () => of({
      os: new Map((o.os ?? []).map((x) => [x.id, x] as const)), tiposDeAnexo: new Map(o.anexos ?? []),
      revisoesDosPdfs: new Map(o.revisoesPdf ?? (o.anexos ?? []).filter(([, t]) => t === 'DOCUMENTO').map(([id]) => [id, 1] as const)),
    }),
  };
  const sincronizar = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PendenciasService, useValue: svc },
      { provide: PropostasRepo, useValue: repo },
      { provide: PdfService, useValue: pdf },
      { provide: OsRepo, useValue: osRepo },
      { provide: SyncService, useValue: { sincronizar, naoSincronizados: signal(naoSincronizados), sincronizando: signal(false) } },
      { provide: ConectividadeService, useValue: { online: signal(true) } },
      { provide: AuthService, useValue: { usuario: signal({ id: 'u', nome: 'U', email: 'u@u', perfil, ativo: true }) } },
    ],
  });
  const fixture = TestBed.createComponent(PendenciasPage);
  fixture.detectChanges();
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const navegarRota = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { el: fixture.nativeElement as HTMLElement, svc, sincronizar, navegar, navegarRota, fixture, repo, pdf, osRepo };
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

  it('M3: "Sincronizar agora" sem chegar ao servidor avisa "Sem conexão com o servidor."', async () => {
    const { el, sincronizar } = montar([], 2);
    const erro = vi.spyOn(TestBed.inject(Toasts), 'erro');
    sincronizar.mockResolvedValueOnce('sem-rede');
    botao(el, 'Sincronizar agora').click();
    await vi.waitFor(() => expect(erro).toHaveBeenCalledWith('Sem conexão com o servidor.'));

    sincronizar.mockResolvedValueOnce('concluida');
    botao(el, 'Sincronizar agora').click();
    await new Promise((r) => setTimeout(r, 10));
    expect(erro).toHaveBeenCalledTimes(1);
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
    // o download (`<a download>`) é interceptado: nada de navegação no jsdom; tudo volta ao original no fim
    const cliques: string[] = [];
    let clickOriginal: typeof HTMLAnchorElement.prototype.click;
    let criarUrl: typeof URL.createObjectURL;
    let revogarUrl: typeof URL.revokeObjectURL;
    beforeEach(() => {
      cliques.length = 0;
      clickOriginal = HTMLAnchorElement.prototype.click;
      criarUrl = URL.createObjectURL;
      revogarUrl = URL.revokeObjectURL;
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        cliques.push(this.download);
      };
      URL.createObjectURL = vi.fn(() => 'blob:x');
      URL.revokeObjectURL = vi.fn();
    });
    afterEach(() => {
      HTMLAnchorElement.prototype.click = clickOriginal;
      URL.createObjectURL = criarUrl;
      URL.revokeObjectURL = revogarUrl;
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

    describe('"Usar a do servidor" com envio feito aqui (P4c-R15)', () => {
      const AVISO = 'Isto descarta o envio e o PDF gerado neste aparelho.';
      const c = () => rejeitada({ tipo: 'CONFLITO', erro: undefined, dadosServidor: { codigoProvisorio: 'PROV-ABC123' } });
      const dialogo = (el: HTMLElement) => el.querySelector<HTMLElement>('[role=alertdialog]');
      const noDialogo = (el: HTMLElement, texto: string) =>
        [...dialogo(el)!.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto)!;

      it('pede confirmação acessível antes; "Voltar" não muda nada; confirmar usa a do servidor e devolve o foco', async () => {
        const conflitoProposta = c();
        const { el, svc, fixture } = montar([conflitoProposta], 0, 'ADMIN', { propostas: [propostaLocal('p1')], descartaEnvio: true });
        const gatilho = botao(el, 'Usar a do servidor');
        gatilho.focus();
        gatilho.click();
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(dialogo(el)).not.toBeNull();
        });
        const d = dialogo(el)!;
        expect(d.getAttribute('aria-modal')).toBe('true');
        expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent?.trim()).toBe('Usar a do servidor?');
        expect(document.getElementById(d.getAttribute('aria-describedby')!)?.textContent?.trim()).toBe(AVISO);
        expect(svc.descartaEnvio).toHaveBeenCalledWith(conflitoProposta);
        expect(svc.usarServidor).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(document.activeElement).toBe(noDialogo(el, 'Voltar')));

        noDialogo(el, 'Voltar').click();
        fixture.detectChanges();
        expect(dialogo(el)).toBeNull();
        expect(svc.usarServidor).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(document.activeElement).toBe(gatilho));

        botao(el, 'Usar a do servidor').click();
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(dialogo(el)).not.toBeNull();
        });
        noDialogo(el, 'Usar a do servidor').click();
        await vi.waitFor(() => expect(svc.usarServidor).toHaveBeenCalledWith(conflitoProposta));
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(dialogo(el)).toBeNull();
        });
      });

      it('sem envio nem PDF daqui: usa a do servidor direto, sem perguntar', async () => {
        const conflitoProposta = c();
        const { el, svc, fixture } = montar([conflitoProposta], 0, 'ADMIN', { propostas: [propostaLocal('p1')] });
        botao(el, 'Usar a do servidor').click();
        await vi.waitFor(() => expect(svc.usarServidor).toHaveBeenCalledWith(conflitoProposta));
        fixture.detectChanges();
        expect(dialogo(el)).toBeNull();
      });

      it('o "Descartar" de uma proposta excluída no servidor também pergunta', async () => {
        const excluida = rejeitada({ tipo: 'CONFLITO', erro: undefined, dadosServidor: undefined });
        const { el, svc, fixture } = montar([excluida], 0, 'ADMIN', { propostas: [propostaLocal('p1')], descartaEnvio: true });
        botao(el, 'Descartar').click();
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(dialogo(el)?.textContent).toContain(AVISO);
        });
        expect(svc.usarServidor).not.toHaveBeenCalled();
      });
    });

    it('N2: "Descartar" de uma proposta recusada com envio atrás pede a mesma confirmação; sem envio, descarta direto', async () => {
      const recusada = rejeitada({ erro: { codigo: 'ACESSO_NEGADO', mensagem: 'Sem permissão.' } });
      const { el, svc, fixture } = montar([recusada], 0, 'ADMIN', { propostas: [propostaLocal('p1')], descartaEnvio: true });
      botao(el, 'Descartar').click();
      const dialogo = () => el.querySelector<HTMLElement>('[role=alertdialog]');
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(dialogo()?.textContent).toContain('Isto descarta o envio e o PDF gerado neste aparelho.');
      });
      expect(document.getElementById(dialogo()!.getAttribute('aria-labelledby')!)?.textContent?.trim()).toBe('Descartar a pendência?');
      expect(svc.descartaEnvio).toHaveBeenCalledWith(recusada);
      expect(svc.descartar).not.toHaveBeenCalled();
      const noDialogo = (texto: string) => [...dialogo()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto)!;
      noDialogo('Descartar').click();
      await vi.waitFor(() => expect(svc.descartar).toHaveBeenCalledWith(recusada));

      TestBed.resetTestingModule();
      const sem = montar([recusada], 0, 'ADMIN', { propostas: [propostaLocal('p1')] });
      botao(sem.el, 'Descartar').click();
      await vi.waitFor(() => expect(sem.svc.descartar).toHaveBeenCalledWith(recusada));
      sem.fixture.detectChanges();
      expect(sem.el.querySelector('[role=alertdialog]')).toBeNull();
    });

    it('N4: com CONFLITO da proposta, "Gerar PDF novamente" fica desabilitado com a dica', async () => {
      const conflitoProposta = rejeitada({ mutationId: 'mc', tipo: 'CONFLITO', erro: undefined, dadosServidor: { codigoProvisorio: 'PROV-ABC123' } });
      const { el, repo } = montar([conflitoProposta, upload('CODIGO_EXIBIDO_INVALIDO')], 0, 'ADMIN', { propostas: [propostaLocal('p1')] });
      const b = botao(el, 'Gerar PDF novamente');
      expect(b.disabled).toBe(true);
      expect(document.getElementById(b.getAttribute('aria-describedby')!)?.textContent?.trim()).toBe('Resolva a pendência primeiro.');
      b.click();
      expect(repo.regerarDocumento).not.toHaveBeenCalled();
    });

    it('M4: erro técnico numa ação de proposta vira a mensagem genérica; a recusa do repositório, a mensagem dela', async () => {
      const conflitoProposta = rejeitada({ tipo: 'CONFLITO', erro: undefined, dadosServidor: { codigoProvisorio: 'PROV-ABC123' } });
      const { el, svc, fixture } = montar([conflitoProposta], 0, 'ADMIN', { propostas: [propostaLocal('p1')] });
      const erro = vi.spyOn(TestBed.inject(Toasts), 'erro');
      svc.manterMinha.mockRejectedValueOnce(new Error('DatabaseClosedError: Database has been closed'));
      botao(el, 'Manter a minha').click();
      await vi.waitFor(() => expect(erro).toHaveBeenCalledWith('Não foi possível concluir. Tente de novo.'));
      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(botao(el, 'Manter a minha').disabled).toBe(false);
      });
      svc.manterMinha.mockRejectedValueOnce(new ErroProposta('PROPOSTA_SINCRONIZANDO', 'proposta', 'A proposta está sendo sincronizada. Tente de novo em instantes.'));
      botao(el, 'Manter a minha').click();
      await vi.waitFor(() => expect(erro).toHaveBeenCalledWith('A proposta está sendo sincronizada. Tente de novo em instantes.'));
    });

    it('upload CODIGO_EXIBIDO_INVALIDO de proposta enviada: "Gerar PDF novamente" regera pelo repositório e compartilha (sem share: baixa)', async () => {
      {
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
      await vi.waitFor(() => expect(cliques).toEqual(['Proposta-PROV-ABC123.pdf']));
      await fixture.whenStable();
    });

    it('o rótulo "Gerando PDF…" é só da regeração: Descartar em curso não o mostra', async () => {
      let liberar!: () => void;
      const descartar = new Promise<void>((r) => (liberar = r));
      const { el, svc, fixture } = montar([upload('CODIGO_EXIBIDO_INVALIDO')], 0, 'ADMIN', { propostas: [propostaLocal('p1')] });
      svc.descartar.mockReturnValue(descartar);
      botao(el, 'Descartar').click();
      fixture.detectChanges();
      expect(botao(el, 'Gerar PDF novamente').disabled).toBe(true);
      expect(el.textContent).not.toContain('Gerando PDF…');
      liberar();
      await fixture.whenStable();
    });

    it('comercial responsável corrige e reenvia', () => {
      const { el, navegarRota } = montar([rejeitada()], 0, 'COMERCIAL', { propostas: [propostaLocal('p1', { responsavelId: 'u' })] });
      botao(el, 'Corrigir e reenviar').click();
      expect(navegarRota).toHaveBeenCalledWith(['/propostas', 'p1', 'corrigir']);
    });

    it.each<Perfil>(['TECNICO', 'COMERCIAL'])('%s (sem ser o responsável) não vê "Gerar PDF novamente" e a mensagem manda descartar', (perfil) => {
      const { el } = montar([upload('CODIGO_EXIBIDO_INVALIDO')], 0, perfil, { propostas: [propostaLocal('p1', { responsavelId: 'outro' })] });
      expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
      expect(el.textContent).not.toContain('Gere o PDF novamente');
      expect(el.textContent).toContain('Descarte esta pendência');
      expect(botao(el, 'Descartar')).toBeDefined();
    });

    it('sem a cópia local: sem "Gerar PDF novamente"', () => {
      const { el } = montar([upload('CODIGO_EXIBIDO_INVALIDO')]);
      expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
      expect(botao(el, 'Descartar')).toBeDefined();
    });

    it('sem a cópia local (ex.: exclusão recusada): sem "Corrigir e reenviar" nem "Abrir proposta", só Descartar', () => {
      const exclusao = rejeitada({}, { status: 'RASCUNHO' });
      exclusao.mutacao = { ...exclusao.mutacao, op: 'DELETE', dados: null };
      const conflito = rejeitada({ mutationId: 'mc', tipo: 'CONFLITO', erro: undefined });
      const { el } = montar([exclusao, conflito]);
      expect(botao(el, 'Corrigir e reenviar')).toBeUndefined();
      expect(abrir(el)).toBeNull();
      expect(botao(el, 'Descartar')).toBeDefined();
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

  describe('OS e anexos da OS (M2-P2)', () => {
    const dadosOs = (extra: Partial<OsDados> = {}): OsDados => ({
      codigoProvisorio: 'OSP-0Z9XY7', numero: 123, revisao: 1, propostaId: 'p1', clienteId: 'c1', tipo: 'INSTALACAO',
      status: 'EM_ANDAMENTO', responsavelId: 'u-com', tecnicoId: 'u', urgente: false, concluiProposta: true,
      assinaturaRecusada: false, itens: [], notas: [], ...extra,
    });
    const osLocal = (extra: Partial<OsDados> = {}) => paraOsLocal('o1', 4, dadosOs(extra));
    const pendenciaOs = (extra: Partial<Pendencia> = {}, dados: Partial<OsDados> = {}): Pendencia => ({
      mutationId: 'mo', entidade: 'os', agregadoId: 'o1', tipo: 'CONFLITO', criadaEm: '30', versionServidor: 6,
      dadosServidor: dadosOs({ dataPrevista: '2026-10-09' }),
      mutacao: { mutationId: 'mo', entidade: 'os', agregadoId: 'o1', op: 'UPSERT', baseVersion: 4, dados: dadosOs(dados), criadaEm: '' },
      ...extra,
    });
    const uploadOs = (anexoId: string, erro: Pendencia['erro']): Pendencia => ({
      mutationId: `u-${anexoId}`, entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', tipo: 'REJEITADO', criadaEm: '31', erro,
      mutacao: { mutationId: `u-${anexoId}`, entidade: TIPO_UPLOAD_ANEXO_OS, agregadoId: 'o1', op: 'UPLOAD', baseVersion: null,
        dados: { anexoId }, separada: true, criadaEm: '' },
    });
    const abrirOs = (el: HTMLElement) => [...el.querySelectorAll<HTMLAnchorElement>('[data-testid="abrir-os"]')];
    const titulos = (el: HTMLElement) => [...el.querySelectorAll(':scope > ul > li > p:first-child')].map((x) => x.textContent?.trim());
    const dialogo = (el: HTMLElement) => el.querySelector<HTMLElement>('[role=alertdialog]');
    const AVISO_OS = 'Isto descarta o que esta OS tem neste aparelho e ainda não foi enviado: as fotos, a assinatura e o PDF.';

    it('conflito: título "OS " + código exibido, manter a minha / usar a do servidor e "Abrir OS" (/os/:id)', async () => {
      const c = pendenciaOs();
      const { el, svc, fixture } = montar([c], 0, 'TECNICO', { os: [osLocal({ revisao: 2 })] });
      expect(titulos(el)).toEqual(['OS OS-000123-R2']);
      expect(el.textContent).toContain('Alterado por outra pessoa enquanto você editava.');
      expect(abrirOs(el).map((a) => a.getAttribute('href'))).toEqual(['/os/o1']);
      botao(el, 'Manter a minha').click();
      expect(svc.manterMinha).toHaveBeenCalledWith(c);
      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(botao(el, 'Usar a do servidor').disabled).toBe(false);
      });
      botao(el, 'Usar a do servidor').click();
      await vi.waitFor(() => expect(svc.usarServidor).toHaveBeenCalledWith(c));
      expect(svc.perdaDaOs).toHaveBeenCalledWith(c);
      // nada de ação de proposta numa OS
      expect(botao(el, 'Corrigir e reenviar')).toBeUndefined();
      expect(el.querySelector('[data-testid="abrir-proposta"]')).toBeNull();
    });

    it('sem a cópia local: o código vem dos dados (do servidor, senão da mutação) e não há "Abrir OS"', () => {
      const { el } = montar([
        pendenciaOs(),
        pendenciaOs({ mutationId: 'm2', agregadoId: 'o2', dadosServidor: undefined, tipo: 'REJEITADO', erro: { codigo: 'VALIDACAO', mensagem: 'x' } },
          { numero: null, codigoProvisorio: 'OSP-AAAAAA' }),
        pendenciaOs({ mutationId: 'm3', agregadoId: 'o3', dadosServidor: undefined },
          { numero: null, codigoProvisorio: undefined as unknown as string }),
      ]);
      expect(titulos(el)).toEqual(['OS OS-000123', 'OS OSP-AAAAAA', 'OS']);
      expect(abrirOs(el)).toEqual([]);
    });

    it('N1: a recusa VALIDACAO da OS lista os campos pelo nome (Nota, Item N …), e a do anexo também', () => {
      const p = pendenciaOs({ tipo: 'REJEITADO', dadosServidor: undefined, erro: { codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: {
        'notas[2].texto': 'Escreva a nota.', 'itens[1].quantidadePrevista': 'A quantidade vai de 0,001 a 999.999,999.',
        resumoExecucao: 'Máximo de 4000 caracteres.', campoNovo: 'x',
      } } });
      const anexo = uploadOs('s1', { codigo: 'VALIDACAO', mensagem: 'Dados do anexo inválidos.', campos: { assinanteNome: 'Informe o nome.' } });
      const { el } = montar([p, anexo], 0, 'TECNICO', { os: [osLocal()], anexos: [['s1', 'ASSINATURA']] });
      const itens = [...el.querySelectorAll('li li')].map((x) => x.textContent?.trim());
      expect(itens).toEqual([
        'Nota: Escreva a nota.', 'Item 2 (quantidade prevista): A quantidade vai de 0,001 a 999.999,999.',
        'Resumo da execução: Máximo de 4000 caracteres.', 'campoNovo: x', 'Nome de quem assina: Informe o nome.',
      ]);
    });

    it('R30: a OS reaberta por outra pessoa diz o que "Manter a minha" faz', () => {
      const reaberta = pendenciaOs({ dadosServidor: dadosOs({ revisao: 2 }) }, { status: 'CONCLUIDA', revisao: 1 });
      const { el } = montar([reaberta], 0, 'TECNICO', { os: [osLocal()] });
      expect(el.textContent).toContain('Esta OS foi reaberta por outra pessoa. "Manter a minha" guarda o seu resumo e as notas; a OS continua em andamento.');
    });

    it('anexos: "Foto da OS …", "Assinatura da OS …", "PDF da OS …"; sem o anexo no aparelho, "Anexo da OS …"', () => {
      const erro = { codigo: 'LIMITE_FOTOS', mensagem: 'Esta OS já tem o máximo de 20 fotos no servidor.' };
      const { el } = montar(
        [uploadOs('f1', erro), uploadOs('s1', erro), uploadOs('d1', erro), uploadOs('x1', erro)], 0, 'TECNICO',
        { os: [osLocal()], anexos: [['f1', 'FOTO'], ['s1', 'ASSINATURA'], ['d1', 'DOCUMENTO']] },
      );
      expect(titulos(el)).toEqual(['Foto da OS OS-000123', 'Assinatura da OS OS-000123', 'PDF da OS OS-000123', 'Anexo da OS OS-000123']);
      expect(abrirOs(el)).toHaveLength(4);
      TestBed.resetTestingModule();
      // sem a OS no aparelho: só o tipo
      const sem = montar([uploadOs('f1', erro)], 0, 'TECNICO', { anexos: [['f1', 'FOTO']] });
      expect(titulos(sem.el)).toEqual(['Foto da OS']);
      expect(abrirOs(sem.el)).toEqual([]);
    });

    it.each([
      [403, 'OS_CONCLUIDA_POR_OUTRO', 'Esta OS foi concluída pelo escritório.'],
      [403, 'ACESSO_NEGADO', 'Esta OS não está mais com você.'],
      [404, undefined, 'Esta OS não está mais com você.'],
    ])('PDF recusado com %i %s: "%s" e Descartar (direto: descarta só o PDF)', async (status, codigo, mensagem) => {
      // M6: o erro da pendência sai do mapeamento real do upload (`tipos-upload`), como o SyncService o grava
      const resposta = new HttpErrorResponse({ status, error: codigo ? { codigo, detail: 'x' } : {} });
      const pdf = {
        id: 'd1', osId: 'o1', tipo: 'DOCUMENTO', sha256: 'a'.repeat(64), legenda: null, momento: null, tiradaEm: null,
        assinanteNome: null, assinantePapel: null, revisaoOs: 1, codigoExibido: 'OS-000123', miniatura: null,
        enviado: false, arquivoId: null,
      } as const;
      const p = uploadOs('d1', tipoUploadDe(TIPO_UPLOAD_ANEXO_OS)!.erro(resposta, { ...pdf }));
      const { el, svc } = montar([p], 0, 'TECNICO', { os: [osLocal({ status: 'CONCLUIDA' })], anexos: [['d1', 'DOCUMENTO']] });
      expect(el.querySelector('[data-testid="mensagem"]')?.textContent?.trim()).toBe(mensagem);
      expect(botao(el, 'Manter a minha')).toBeUndefined();
      botao(el, 'Descartar').click();
      await vi.waitFor(() => expect(svc.descartar).toHaveBeenCalledWith(p));
      expect(svc.descartaEnvio).not.toHaveBeenCalled();
      expect(svc.perdaDaOs).not.toHaveBeenCalled();
    });

    it('M2P2-R13: o upload da OS que não existe mais (404 OS_NAO_ENCONTRADA) leva a OS inteira: o Descartar pergunta antes', async () => {
      const p = uploadOs('f1', { codigo: 'OS_NAO_ENCONTRADA', mensagem: 'Esta OS não está mais com você.' });
      const { el, svc, fixture } = montar([p], 0, 'TECNICO', { os: [osLocal()], anexos: [['f1', 'FOTO']], perdaOs: ['notas', 'fotos'] });
      botao(el, 'Descartar').click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(dialogo(el)).not.toBeNull();
      });
      expect(svc.perdaDaOs).toHaveBeenCalledWith(p);
      expect(svc.descartar).not.toHaveBeenCalled();
      expect(document.getElementById(dialogo(el)!.getAttribute('aria-describedby')!)?.textContent).toContain('Isto descarta');
      [...dialogo(el)!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Descartar')!.click();
      await vi.waitFor(() => expect(svc.descartar).toHaveBeenCalledWith(p));
    });

    it('o push da OS recusado com ACESSO_NEGADO para o técnico (passados os 7 dias): "Esta OS não está mais com você."', () => {
      const p = pendenciaOs({ tipo: 'REJEITADO', erro: { codigo: 'ACESSO_NEGADO', mensagem: 'Você só altera as OS atribuídas a você.' } });
      const tecnico = montar([p], 0, 'TECNICO', { os: [osLocal()] });
      expect(tecnico.el.textContent).toContain('Esta OS não está mais com você.');
      expect(botao(tecnico.el, 'Descartar')).toBeDefined();
      TestBed.resetTestingModule();
      // para os outros perfis, a mensagem do servidor
      const admin = montar([p], 0, 'ADMIN', { os: [osLocal()] });
      expect(admin.el.textContent).toContain('Você só altera as OS atribuídas a você.');
    });

    it.each([
      ['Usar a do servidor', 'usarServidor', 'Usar a do servidor?', 'Usar a do servidor', pendenciaOs()],
      ['Descartar', 'descartar', 'Descartar a pendência?', 'Descartar', pendenciaOs({ tipo: 'REJEITADO', erro: { codigo: 'VALIDACAO', mensagem: 'x' } })],
      // excluída no servidor: o Descartar do conflito é o "usar a do servidor"
      ['Descartar', 'usarServidor', 'Usar a do servidor?', 'Usar a do servidor', pendenciaOs({ dadosServidor: undefined })],
    ] as const)('P4c-R15: "%s" com fotos, assinatura ou PDF não enviados pede confirmação com o aviso da OS', async (rotulo, acao, titulo, confirmar, p) => {
      const { el, svc, fixture } = montar([p], 0, 'TECNICO', { os: [osLocal()], descartaEnvio: true });
      botao(el, rotulo).click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(dialogo(el)).not.toBeNull();
      });
      const d = dialogo(el)!;
      expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent?.trim()).toBe(titulo);
      expect(document.getElementById(d.getAttribute('aria-describedby')!)?.textContent?.trim()).toBe(AVISO_OS);
      expect(svc[acao]).not.toHaveBeenCalled();
      [...d.querySelectorAll('button')].find((b) => b.textContent?.trim() === confirmar)!.click();
      await vi.waitFor(() => expect(svc[acao]).toHaveBeenCalledWith(p));
    });

    it.each([
      [['notas'], 'Isto descarta o que esta OS tem neste aparelho e ainda não foi enviado: as notas.'],
      // M1: a recusa sozinha, e a conclusão com o resumo e o PDF, pelo nome
      [['recusa'], 'Isto descarta o que esta OS tem neste aparelho e ainda não foi enviado: a recusa da assinatura.'],
      [['inicio', 'notas', 'conclusao', 'resumo', 'pdf'],
        'Isto descarta o que esta OS tem neste aparelho e ainda não foi enviado: o início, as notas, a conclusão, o resumo e o PDF.'],
    ] as [ItemPerdaOs[], string][])('M3/M1: o aviso diz o que sai (%o)', async (perdaOs, aviso) => {
      const { el, fixture } = montar([pendenciaOs()], 0, 'TECNICO', { os: [osLocal()], perdaOs });
      botao(el, 'Usar a do servidor').click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(dialogo(el)).not.toBeNull();
      });
      expect(document.getElementById(dialogo(el)!.getAttribute('aria-describedby')!)?.textContent?.trim()).toBe(aviso);
    });

    it('M2: o "Manter a minha" que tirou notas avisa; sem isso, nada', async () => {
      const c = pendenciaOs();
      const { el, fixture } = montar([c], 0, 'ADMIN', { os: [osLocal()], notasDescartadas: true });
      const mostrar = vi.spyOn(TestBed.inject(Toasts), 'mostrar');
      botao(el, 'Manter a minha').click();
      await vi.waitFor(() => expect(mostrar).toHaveBeenCalledWith('As notas não puderam ser acrescentadas: a OS está encerrada.'));
      await fixture.whenStable();
      TestBed.resetTestingModule();
      const sem = montar([c], 0, 'ADMIN', { os: [osLocal()] });
      const mostrar2 = vi.spyOn(TestBed.inject(Toasts), 'mostrar');
      botao(sem.el, 'Manter a minha').click();
      await vi.waitFor(() => expect(sem.svc.manterMinha).toHaveBeenCalled());
      await sem.fixture.whenStable();
      expect(mostrar2).not.toHaveBeenCalled();
    });

    it('sem anexo a perder: Descartar da criação recusada vai direto', async () => {
      const p = pendenciaOs({ tipo: 'REJEITADO', erro: { codigo: 'VALIDACAO', mensagem: 'x' } });
      p.mutacao = { ...p.mutacao, baseVersion: null };
      const { el, svc, fixture } = montar([p], 0, 'ADMIN', { os: [osLocal()] });
      botao(el, 'Descartar').click();
      await vi.waitFor(() => expect(svc.descartar).toHaveBeenCalledWith(p));
      fixture.detectChanges();
      expect(dialogo(el)).toBeNull();
    });

    it('a ação em curso trava só os botões daquela pendência; o erro vira o toast da OS (mensagemErroOs)', async () => {
      const c = pendenciaOs();
      const outra = uploadOs('f1', { codigo: 'LIMITE_FOTOS', mensagem: 'x' });
      const { el, svc, fixture } = montar([c, outra], 0, 'TECNICO', { os: [osLocal()], anexos: [['f1', 'FOTO']] });
      let terminar!: (e: unknown) => void;
      svc.manterMinha.mockReturnValue(new Promise<void>((_, r) => (terminar = r)));
      const erro = vi.spyOn(TestBed.inject(Toasts), 'erro');
      botao(el, 'Manter a minha').click();
      botao(el, 'Manter a minha').click();
      await fixture.whenStable();
      expect(svc.manterMinha).toHaveBeenCalledTimes(1);
      expect(botao(el, 'Usar a do servidor').disabled).toBe(true);
      expect(botao(el, 'Descartar').disabled).toBe(false);
      terminar(new ErroOs('OS_SINCRONIZANDO', 'os', ''));
      await vi.waitFor(() => expect(erro).toHaveBeenCalledWith('A OS está sendo sincronizada. Tente de novo em instantes.'));
      svc.manterMinha.mockRejectedValueOnce(new Error('DatabaseClosedError'));
      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(botao(el, 'Manter a minha').disabled).toBe(false);
      });
      botao(el, 'Manter a minha').click();
      await vi.waitFor(() => expect(erro).toHaveBeenCalledWith('Não foi possível concluir. Tente de novo.'));
    });
    describe('M2-P3: "Gerar PDF novamente" do PDF da OS e a OS reaberta', () => {
      const pdfRecusado = (codigo: string, anexoId = 'd1', mensagem = 'x'): Pendencia => uploadOs(anexoId, { codigo, mensagem });
      const concluida = (extra: Partial<OsDados> = {}) => osLocal({ status: 'CONCLUIDA', ...extra });
      const cliques: string[] = [];
      let clickOriginal: typeof HTMLAnchorElement.prototype.click;
      let criarUrl: typeof URL.createObjectURL;
      let revogarUrl: typeof URL.revokeObjectURL;
      beforeEach(() => {
        cliques.length = 0;
        clickOriginal = HTMLAnchorElement.prototype.click;
        criarUrl = URL.createObjectURL;
        revogarUrl = URL.revokeObjectURL;
        HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
          cliques.push(this.download);
        };
        URL.createObjectURL = vi.fn(() => 'blob:x');
        URL.revokeObjectURL = vi.fn();
      });
      afterEach(() => {
        HTMLAnchorElement.prototype.click = clickOriginal;
        URL.createObjectURL = criarUrl;
        URL.revokeObjectURL = revogarUrl;
      });
      const mensagemDe = (el: HTMLElement) => el.querySelector('[data-testid="mensagem"]')?.textContent?.trim();

      it.each<[string, Perfil]>([['CODIGO_EXIBIDO_INVALIDO', 'ADMIN'], ['ANEXO_AUSENTE', 'TECNICO']])(
        '%s (%s): regera pelo OsRepo com o PdfService da OS e compartilha (sem share: baixa o código.pdf)',
        async (codigo, perfil) => {
          const { el, osRepo, pdf, fixture } = montar([pdfRecusado(codigo)], 0, perfil, { os: [concluida()], anexos: [['d1', 'DOCUMENTO']] });
          const mostrar = vi.spyOn(TestBed.inject(Toasts), 'mostrar');
          expect(mensagemDe(el)).toBe(codigo === 'ANEXO_AUSENTE'
            ? 'O arquivo deste PDF não está mais neste aparelho. Gere o PDF novamente.'
            : 'O código da OS mudou depois que o PDF foi gerado. Gere o PDF novamente.');
          // "Abrir OS" e Descartar continuam
          expect(abrirOs(el).map((a) => a.getAttribute('href'))).toEqual(['/os/o1']);
          expect(botao(el, 'Descartar')).toBeDefined();
          botao(el, 'Gerar PDF novamente').click();
          await vi.waitFor(() => expect(cliques).toEqual(['OS-000123.pdf']));
          expect(osRepo.regerarPdf).toHaveBeenCalledWith('o1', expect.any(Function));
          const gerar = osRepo.regerarPdf.mock.calls[0][1] as (e: unknown) => Promise<Blob>;
          await gerar({ os: 'entrada' });
          expect(pdf.gerarBlobOs).toHaveBeenCalledWith({ os: 'entrada' });
          expect(pdf.gerarBlob).not.toHaveBeenCalled();
          expect(mostrar).toHaveBeenCalledWith('PDF gerado de novo. Ele vai para o servidor na próxima sincronização.');
          expect(mostrar).toHaveBeenCalledWith('PDF baixado: OS-000123.pdf');
          await fixture.whenStable();
          expect(botao(el, 'Gerar PDF novamente').disabled).toBe(false);
        },
      );

      it('com o navegador pedindo toque, mostra o painel "PDF pronto" com o PDF da OS', async () => {
        const share = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
        Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
        Object.defineProperty(navigator, 'share', { value: share, configurable: true });
        try {
          const regerarOs = vi.fn().mockResolvedValue({ blob: new Blob(['%PDF'], { type: 'application/pdf' }), codigoExibido: 'OS-000123-R2' });
          const { el, fixture } = montar([pdfRecusado('CODIGO_EXIBIDO_INVALIDO')], 0, 'ADMIN', {
            os: [concluida({ revisao: 2 })], anexos: [['d1', 'DOCUMENTO']], revisoesPdf: [['d1', 2]], regerarOs,
          });
          botao(el, 'Gerar PDF novamente').click();
          await vi.waitFor(() => {
            fixture.detectChanges();
            expect(el.querySelector('app-pdf-pronto')).not.toBeNull();
          });
          expect(share).toHaveBeenCalled();
          expect(el.querySelector('app-pdf-pronto')!.textContent).toContain('OS-000123-R2.pdf');
          expect(cliques).toEqual([]);
        } finally {
          delete (navigator as unknown as Record<string, unknown>)['canShare'];
          delete (navigator as unknown as Record<string, unknown>)['share'];
        }
      });

      it('o toque duplo não regera duas vezes ("Gerando PDF…" desabilitado); o erro vira o toast da OS e a pendência fica', async () => {
        let falhar!: (e: unknown) => void;
        const regerarOs = vi.fn(() => new Promise((_, r) => (falhar = r)));
        const { el, fixture } = montar([pdfRecusado('CODIGO_EXIBIDO_INVALIDO')], 0, 'ADMIN', {
          os: [concluida()], anexos: [['d1', 'DOCUMENTO']], regerarOs,
        });
        const erro = vi.spyOn(TestBed.inject(Toasts), 'erro');
        const gatilho = botao(el, 'Gerar PDF novamente');
        gatilho.focus();
        gatilho.click();
        fixture.detectChanges();
        expect(botao(el, 'Gerando PDF…').disabled).toBe(true);
        expect(botao(el, 'Descartar').disabled).toBe(true);
        botao(el, 'Gerando PDF…').click();
        expect(regerarOs).toHaveBeenCalledTimes(1);
        // N3: desabilitado, o botão perde o foco no navegador (o jsdom não o tira: o foco vai para o body)
        const h1 = el.querySelector<HTMLElement>('h1')!;
        h1.focus();
        h1.blur();
        expect(document.activeElement).toBe(document.body);
        falhar(new ErroOs('OS_SINCRONIZANDO', 'os', ''));
        await vi.waitFor(() => expect(erro).toHaveBeenCalledWith('A OS está sendo sincronizada. Tente de novo em instantes.'));
        await fixture.whenStable();
        expect(botao(el, 'Gerar PDF novamente').disabled).toBe(false);
        // o foco volta ao botão
        await vi.waitFor(() => expect(document.activeElement).toBe(botao(el, 'Gerar PDF novamente')));
        expect(cliques).toEqual([]);
      });

      it('N3: quem levou o foco a outro controle durante a geração fica lá quando ela falha', async () => {
        let falhar!: (e: unknown) => void;
        const regerarOs = vi.fn(() => new Promise((_, r) => (falhar = r)));
        const { el, fixture } = montar([pdfRecusado('CODIGO_EXIBIDO_INVALIDO')], 0, 'ADMIN', {
          os: [concluida()], anexos: [['d1', 'DOCUMENTO']], regerarOs,
        });
        const gatilho = botao(el, 'Gerar PDF novamente');
        gatilho.focus();
        gatilho.click();
        fixture.detectChanges();
        const outro = el.querySelector<HTMLElement>('h1')!;
        outro.focus();
        falhar(new ErroOs('OS_SINCRONIZANDO', 'os', ''));
        await vi.waitFor(() => expect(botao(el, 'Gerar PDF novamente').disabled).toBe(false));
        await fixture.whenStable();
        fixture.detectChanges();
        expect(document.activeElement).toBe(outro);
      });

      it('com CONFLITO da OS: desabilitado com a dica "Resolva a pendência primeiro."', () => {
        const { el, osRepo } = montar([pendenciaOs(), pdfRecusado('CODIGO_EXIBIDO_INVALIDO')], 0, 'TECNICO', {
          os: [concluida()], anexos: [['d1', 'DOCUMENTO']],
        });
        const b = botao(el, 'Gerar PDF novamente');
        expect(b.disabled).toBe(true);
        expect(document.getElementById(b.getAttribute('aria-describedby')!)?.textContent?.trim()).toBe('Resolva a pendência primeiro.');
        b.click();
        expect(osRepo.regerarPdf).not.toHaveBeenCalled();
      });

      it('TECNICO: com OS_CONCLUIDA_POR_OUTRO (nesta ou noutra pendência da OS), nunca "Gerar PDF novamente"', () => {
        const porOutro = pdfRecusado('OS_CONCLUIDA_POR_OUTRO', 'd2', 'Esta OS foi concluída pelo escritório.');
        const { el } = montar([porOutro, pdfRecusado('CODIGO_EXIBIDO_INVALIDO')], 0, 'TECNICO', {
          os: [concluida()], anexos: [['d1', 'DOCUMENTO'], ['d2', 'DOCUMENTO']],
        });
        expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
        expect(botao(el, 'Gerando PDF…')).toBeUndefined();
        expect([...el.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Descartar')).toHaveLength(2);
        TestBed.resetTestingModule();
        // o ADMIN gera (o servidor só recusa assim o PDF do técnico; o OsRepo faz a mesma conta)
        const admin = montar([porOutro, pdfRecusado('CODIGO_EXIBIDO_INVALIDO')], 0, 'ADMIN', {
          os: [concluida()], anexos: [['d1', 'DOCUMENTO'], ['d2', 'DOCUMENTO']],
        });
        expect(botao(admin.el, 'Gerar PDF novamente')).toBeDefined();
      });

      it('M3 (regra compartilhada): TECNICO com o histórico dizendo que outro concluiu, também não; com a conclusão dele sem resposta, sim', () => {
        const porOutro: Partial<OsDados> = {
          concluidaEm: '2026-10-01T15:00:00Z',
          historico: [{ statusDe: 'EM_ANDAMENTO', statusPara: 'CONCLUIDA', usuarioId: 'u-adm', em: '2026-10-01T15:00:00Z' }],
        };
        let { el } = montar([pdfRecusado('ANEXO_AUSENTE')], 0, 'TECNICO', { os: [concluida(porOutro)], anexos: [['d1', 'DOCUMENTO']] });
        expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
        TestBed.resetTestingModule();
        ({ el } = montar([pdfRecusado('ANEXO_AUSENTE')], 0, 'ADMIN', { os: [concluida(porOutro)], anexos: [['d1', 'DOCUMENTO']] }));
        expect(botao(el, 'Gerar PDF novamente')).toBeDefined();
        TestBed.resetTestingModule();
        // a conclusão deste aparelho ainda sem resposta (concluidaEm null): a última no servidor vai ser a dele
        ({ el } = montar([pdfRecusado('ANEXO_AUSENTE')], 0, 'TECNICO', {
          os: [concluida({ ...porOutro, concluidaEm: null })], anexos: [['d1', 'DOCUMENTO']],
        }));
        expect(botao(el, 'Gerar PDF novamente')).toBeDefined();
      });

      it.each<[string, Partial<OsDados>, Perfil, [string, TipoAnexoOs][], [string, number][] | undefined]>([
        ['a OS não está concluída no aparelho', { status: 'EM_ANDAMENTO' }, 'ADMIN', [['d1', 'DOCUMENTO']], undefined],
        ['o PDF é de outra revisão (o regerar troca só o da atual)', { revisao: 2 }, 'ADMIN', [['d1', 'DOCUMENTO']], [['d1', 1]]],
        ['o anexo não é o PDF', {}, 'ADMIN', [['d1', 'FOTO']], undefined],
        ['o anexo não está no aparelho', {}, 'ADMIN', [], undefined],
        // o COMERCIAL é o responsável: a exclusão é pelo perfil, não pela posse
        ['o COMERCIAL (responsável) não executa a OS', { responsavelId: 'u' }, 'COMERCIAL', [['d1', 'DOCUMENTO']], undefined],
        ['o TECNICO não é o atribuído', { tecnicoId: 'outro' }, 'TECNICO', [['d1', 'DOCUMENTO']], undefined],
      ])('sem "Gerar PDF novamente" quando %s', (_caso, extra, perfil, anexos, revisoesPdf) => {
        const { el } = montar([pdfRecusado('CODIGO_EXIBIDO_INVALIDO', 'd1', 'O código impresso no PDF não é o desta OS.')], 0, perfil, {
          os: [concluida(extra)], anexos, revisoesPdf,
        });
        expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
        expect(mensagemDe(el)).toBe('O código impresso no PDF não é o desta OS.');
        expect(botao(el, 'Descartar')).toBeDefined();
      });

      it('STATUS_INVALIDO de uma foto ou assinatura: só a mensagem do servidor, sem o "conclua de novo"', () => {
        const texto = 'No servidor, a OS não está em andamento, e o anexo não foi aceito. Descarte este envio para liberar a sincronização da OS.';
        for (const tipo of ['FOTO', 'ASSINATURA'] as const) {
          const { el } = montar([pdfRecusado('STATUS_INVALIDO', 'f1', texto)], 0, 'TECNICO', { os: [concluida()], anexos: [['f1', tipo]] });
          expect(mensagemDe(el)).toBe(texto);
          expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
          TestBed.resetTestingModule();
        }
      });

      it('sem a OS no aparelho: sem "Gerar PDF novamente" nem "Abrir OS"', () => {
        const { el } = montar([pdfRecusado('CODIGO_EXIBIDO_INVALIDO')], 0, 'ADMIN', { anexos: [['d1', 'DOCUMENTO']] });
        expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
        expect(abrirOs(el)).toEqual([]);
      });

      it.each(['REVISAO_INVALIDA', 'STATUS_INVALIDO'])(
        '%s (a OS reaberta no servidor): não se resolve gerando de novo; Descartar e "Abrir OS" para concluir de novo',
        async (codigo) => {
          const texto = 'O PDF é de outra revisão da OS e não foi aceito. Descarte este envio para liberar a sincronização da OS.';
          const recusa = pdfRecusado(codigo, 'd1', texto);
          const { el, svc } = montar([recusa], 0, 'TECNICO', { os: [concluida()], anexos: [['d1', 'DOCUMENTO']] });
          expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
          expect(mensagemDe(el)).toBe(`${texto} Depois, abra a OS: se ela voltou para em andamento, conclua de novo.`);
          expect(abrirOs(el).map((a) => a.getAttribute('href'))).toEqual(['/os/o1']);
          botao(el, 'Descartar').click();
          await vi.waitFor(() => expect(svc.descartar).toHaveBeenCalledWith(recusa));
          TestBed.resetTestingModule();
          // quem não executa a OS não a conclui: só a mensagem do servidor
          const comercial = montar([recusa], 0, 'COMERCIAL', { os: [concluida()], anexos: [['d1', 'DOCUMENTO']] });
          expect(mensagemDe(comercial.el)).toBe(texto);
        },
      );

      it('I1: a criação da OS recusada por VALIDACAO manda descartar e criar de novo; outra recusa da OS, só a mensagem', () => {
        const criacao = pendenciaOs({ tipo: 'REJEITADO', dadosServidor: undefined, erro: {
          codigo: 'VALIDACAO', mensagem: 'Técnico inválido: escolha um técnico ativo.', campos: { tecnicoId: 'Técnico inválido.' },
        } });
        criacao.mutacao = { ...criacao.mutacao, baseVersion: null };
        const { el } = montar([criacao], 0, 'ADMIN', { os: [osLocal()] });
        expect(mensagemDe(el)).toBe('Técnico inválido: escolha um técnico ativo. Descarte e crie a OS de novo.');
        TestBed.resetTestingModule();
        const semMensagem = pendenciaOs({ tipo: 'REJEITADO', dadosServidor: undefined, erro: { codigo: 'VALIDACAO', mensagem: '' } });
        expect(mensagemDe(montar([semMensagem], 0, 'ADMIN', { os: [osLocal()] }).el))
          .toBe('Descarte esta pendência e depois refaça a alteração na OS: o que for alterado antes de descartar se perde.');
        TestBed.resetTestingModule();
        const outra = pendenciaOs({ tipo: 'REJEITADO', dadosServidor: undefined, erro: { codigo: 'OS_NAO_EDITAVEL', mensagem: 'A OS não pode mais ser alterada.' } });
        expect(mensagemDe(montar([outra], 0, 'ADMIN', { os: [osLocal()] }).el)).toBe('A OS não pode mais ser alterada.');
      });

      it('"Corrigir e reenviar" da OS: a recusa VALIDACAO lista os campos e leva à tela da OS por "Abrir OS"', () => {
        const recusa = pendenciaOs({ tipo: 'REJEITADO', dadosServidor: undefined, erro: {
          codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { resumoExecucao: 'Máximo de 4000 caracteres.' },
        } });
        const { el } = montar([recusa], 0, 'TECNICO', { os: [osLocal()] });
        // I1: a correção feita na tela antes de descartar se perde (fica retida e o Descartar a leva): a ordem certa
        expect(mensagemDe(el)).toBe('Dados inválidos. Descarte esta pendência e depois refaça a alteração na OS: '
          + 'o que for alterado antes de descartar se perde.');
        expect(el.textContent).toContain('Resumo da execução: Máximo de 4000 caracteres.');
        expect(abrirOs(el).map((a) => a.getAttribute('href'))).toEqual(['/os/o1']);
        expect(botao(el, 'Corrigir e reenviar')).toBeUndefined();
        expect(botao(el, 'Gerar PDF novamente')).toBeUndefined();
        expect(botao(el, 'Descartar')).toBeDefined();
      });
    });
  });
});
