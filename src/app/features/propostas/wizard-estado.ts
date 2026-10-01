import { computed, inject, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth/auth-service';
import { instantaneo } from '../../core/navegacao/alteracoes-guard';
import { CatalogoRepo } from '../catalogo/catalogo-repo';
import type { ItemLocal } from '../catalogo/item-models';
import type { ClienteLocal } from '../clientes/cliente-models';
import { ClientesRepo } from '../clientes/clientes-repo';
import type { TemplateLocal, TipoProposta } from '../templates/template-models';
import { TemplatesRepo } from '../templates/templates-repo';
import type { TotaisCalculo } from './calculo';
import {
  campoDaLinha,
  ERRO_DESCONTO,
  ErrosLinha,
  lerCampoDecimal,
  lerLinha,
  LinhaEditavel,
  linhaComMeses,
  LinhaLida,
  paraLinhaEditavel,
  Passo,
  passoDoCampo,
  PERCENTUAL_MAX,
  textoDecimal,
  totaisDe,
} from './edicao-wizard';
import { codigoExibido, podeAlterarTecnico, PropostaLocal, StatusProposta } from './proposta-models';
import { EdicaoRascunho, ErroProposta, LinhaRascunho, PropostasRepo } from './propostas-repo';

/** O que um passo grava: a edição do rascunho e, só do ADMIN, a troca do responsável (que vai por `atribuir`). */
export type EdicaoWizard = Partial<EdicaoRascunho> & { responsavelId?: string };

interface CamposCliente {
  tipo: TipoProposta;
  clienteId: string | null;
}

interface CamposCondicoes {
  templateId: string | null;
  validadeAte: string;
  condicoesPagamento: string;
  prazoExecucao: string;
  observacoes: string;
  descontoGeral: string;
  tecnicoId: string | null;
  responsavelId: string | null;
}

export interface ErrosCliente {
  clienteId?: string;
  tipo?: string;
}

export interface ErrosItens {
  itens?: string;
  /** Alinhado com `linhas()`. */
  linhas: ErrosLinha[];
}

export type ErrosCondicoes = Partial<Record<keyof CamposCondicoes, string>>;

/** O servidor chama o desconto geral assim; na tela é `descontoGeral`. */
const CAMPO_CONDICOES: Readonly<Record<string, keyof CamposCondicoes>> = { descontoGeralPercentual: 'descontoGeral' };

const VAZIO_CLIENTE: CamposCliente = { tipo: 'VENDA', clienteId: null };

function camposCliente(p: PropostaLocal): CamposCliente {
  return { tipo: p.tipo, clienteId: p.clienteId };
}

function camposCondicoes(p: PropostaLocal): CamposCondicoes {
  return {
    templateId: p.templateId,
    validadeAte: p.validadeAte ?? '',
    condicoesPagamento: p.condicoesPagamento ?? '',
    prazoExecucao: p.prazoExecucao ?? '',
    observacoes: p.observacoes ?? '',
    descontoGeral: textoDecimal(BigInt(p.descontoGeralCentesimos ?? 0), 2, false),
    tecnicoId: p.tecnicoId,
    responsavelId: p.responsavelId,
  };
}

/**
 * Estado do wizard da proposta, um por página (`providers` do `WizardPropostaPage`): os campos dos 4 passos como a
 * tela os edita (textos, para mostrar o erro de digitação), os dados do aparelho que os passos usam (clientes,
 * catálogo, templates, usuários), a validação de cada passo e o que já está gravado (para o aviso de alterações não
 * salvas, por passo).
 */
@Injectable()
export class EstadoWizard {
  readonly usuario = inject(AuthService).usuario;
  readonly admin = computed(() => this.usuario()?.perfil === 'ADMIN');

  /** undefined até a primeira leitura (o passo 1 não acusa "cliente não encontrado" antes disso). */
  readonly clientes = toSignal(inject(ClientesRepo).observarTodos());
  readonly catalogo = toSignal(inject(CatalogoRepo).observarTodos(), { initialValue: [] as ItemLocal[] });
  readonly templates = toSignal(inject(TemplatesRepo).observarTodos(), { initialValue: [] as TemplateLocal[] });
  readonly padroes = toSignal(inject(TemplatesRepo).observarPadroesEfetivos(), {
    initialValue: new Map<TipoProposta, string>(),
  });
  readonly usuarios = toSignal(inject(PropostasRepo).observarUsuarios(), { initialValue: [] });

  // ---- a proposta (o que está gravado) ----
  readonly id = signal<string | null>(null);
  readonly codigo = signal<string | null>(null);
  readonly status = signal<StatusProposta>('RASCUNHO');
  readonly responsavelSalvo = signal<string | null>(null);
  private readonly salvo = signal<Readonly<Record<Passo, string>>>({ 1: '', 2: '', 3: '', 4: '' });

  // ---- campos ----
  readonly tipo = signal<TipoProposta>('VENDA');
  readonly clienteId = signal<string | null>(null);
  readonly linhas = signal<LinhaEditavel[]>([]);
  readonly templateId = signal<string | null>(null);
  readonly validadeAte = signal('');
  readonly condicoesPagamento = signal('');
  readonly prazoExecucao = signal('');
  readonly observacoes = signal('');
  readonly descontoGeral = signal('0');
  readonly tecnicoId = signal<string | null>(null);
  readonly responsavelId = signal<string | null>(null);

  // ---- validação ----
  /** Passos em que o usuário já tentou avançar: os campos obrigatórios só acusam depois disso. */
  readonly tentou = signal<ReadonlySet<Passo>>(new Set());
  /** A última recusa do repositório, por campo (nomes do servidor, ex.: `itens[0].quantidade`). */
  readonly errosServidor = signal<Readonly<Record<string, string>>>({});

  readonly catalogoPorId = computed(() => new Map(this.catalogo().map((i) => [i.id, i])));
  readonly clientePorId = computed(() => new Map((this.clientes() ?? []).map((c): [string, ClienteLocal] => [c.id, c])));
  readonly cliente = computed(() => {
    const id = this.clienteId();
    return id ? this.clientePorId().get(id) : undefined;
  });
  readonly template = computed(() => this.templates().find((t) => t.id === this.templateId()));
  /** Templates ativos do tipo, para o select do passo 3. */
  readonly templatesDoTipo = computed(() => this.templates().filter((t) => t.ativo && t.tipoProposta === this.tipo()));

  readonly leituras = computed<LinhaLida[]>(() => this.linhas().map((l) => lerLinha(l, this.comMeses(l))));
  /** As linhas prontas para gravar; null se alguma tem erro. */
  readonly linhasLidas = computed<LinhaRascunho[] | null>(() => {
    const lidas = this.leituras().map((x) => x.linha);
    return lidas.every((l) => l !== null) ? (lidas as LinhaRascunho[]) : null;
  });
  readonly descontoGeralLido = computed(() => lerCampoDecimal(this.descontoGeral(), 2, 0n, PERCENTUAL_MAX, ERRO_DESCONTO));
  /** Totais só dos itens (sem o desconto geral), para o rodapé do passo 2. */
  readonly totaisItens = computed<TotaisCalculo | null>(() => {
    const linhas = this.linhasLidas();
    return linhas ? totaisDe(linhas, 0n, this.tipo()) : null;
  });
  /** Os totais da proposta, iguais aos do servidor; null enquanto algum valor digitado tem erro. */
  readonly totais = computed<TotaisCalculo | null>(() => {
    const linhas = this.linhasLidas();
    const desconto = this.descontoGeralLido();
    return linhas && typeof desconto === 'bigint' ? totaisDe(linhas, desconto, this.tipo()) : null;
  });

  readonly podeTrocarTecnico = computed(() => {
    const u = this.usuario();
    return !!u && podeAlterarTecnico(this.status(), u.perfil, this.responsavelSalvo() === u.id);
  });

  // ---- erros por passo ----
  readonly errosCliente = computed<ErrosCliente>(() => {
    const erros: ErrosCliente = {};
    if (this.tentou().has(1)) {
      const id = this.clienteId();
      if (!id) erros.clienteId = 'Escolha o cliente.';
      else if (this.clientes() !== undefined && !this.cliente()) erros.clienteId = 'Cliente não encontrado neste aparelho.';
    }
    const servidor = this.errosServidor();
    if (servidor['clienteId']) erros.clienteId ??= servidor['clienteId'];
    if (servidor['tipo']) erros.tipo = servidor['tipo'];
    return erros;
  });

  readonly errosItens = computed<ErrosItens>(() => {
    const linhas = this.leituras().map((x): ErrosLinha => ({ ...x.erros }));
    let itens: string | undefined;
    if (this.tentou().has(2) && linhas.length === 0) itens = 'Inclua pelo menos um item.';
    for (const [campo, mensagem] of Object.entries(this.errosServidor())) {
      if (campo === 'itens') itens ??= mensagem;
      const daLinha = campoDaLinha(campo);
      if (daLinha && linhas[daLinha.indice]) linhas[daLinha.indice][daLinha.campo] ??= mensagem;
    }
    return { itens, linhas };
  });

  readonly errosCondicoes = computed<ErrosCondicoes>(() => {
    const erros: ErrosCondicoes = {};
    const desconto = this.descontoGeralLido();
    if (typeof desconto === 'string') erros.descontoGeral = desconto;
    if (this.tentou().has(3) && !this.templateId()) erros.templateId = 'Escolha o template.';
    for (const [campo, mensagem] of Object.entries(this.errosServidor())) {
      if (passoDoCampo(campo) !== 3) continue;
      const nome = CAMPO_CONDICOES[campo] ?? (campo as keyof CamposCondicoes);
      erros[nome] ??= mensagem;
    }
    return erros;
  });

  /**
   * O passo `n` pode ser gravado (a validação de agora, mesmo sem a tentativa). `paraAvancar` exige também o que o
   * avanço pede (cliente, ≥ 1 item, template); sem ele ("Salvar rascunho"), só que o digitado seja válido.
   */
  valido(n: Passo, paraAvancar = true): boolean {
    switch (n) {
      case 1:
        if (!this.clienteId()) return !paraAvancar;
        return this.clientes() === undefined || !!this.cliente();
      case 2:
        return (!paraAvancar || this.linhas().length > 0) && this.linhasLidas() !== null;
      case 3:
        return (!paraAvancar || !!this.templateId()) && typeof this.descontoGeralLido() === 'bigint';
      default:
        return true;
    }
  }

  comMeses(l: LinhaEditavel): boolean {
    return linhaComMeses(this.tipo(), l, this.catalogoPorId().get(l.itemCatalogoId));
  }

  /** O que falta para enviar (§8: cliente, template e ≥ 1 item), com o passo onde se resolve. */
  readonly faltasParaEnviar = computed(() => {
    const faltas: { passo: Passo; mensagem: string }[] = [];
    if (!this.clienteId()) faltas.push({ passo: 1, mensagem: 'Informe o cliente.' });
    if (this.linhas().length === 0) faltas.push({ passo: 2, mensagem: 'Inclua pelo menos um item.' });
    if (!this.templateId()) faltas.push({ passo: 3, mensagem: 'Informe o template.' });
    return faltas;
  });

  // ---- carga e gravação ----

  /** Proposta nova (`/propostas/nova`): só o passo 1, com o tipo e o cliente que vieram na URL. */
  iniciarNovo(tipo: TipoProposta | null, clienteId: string | null): void {
    this.salvo.set({ 1: instantaneo(VAZIO_CLIENTE), 2: instantaneo([]), 3: instantaneo(this.camposCondicoesAtuais()), 4: '' });
    if (tipo) this.tipo.set(tipo);
    if (clienteId) this.clienteId.set(clienteId);
  }

  /** Preenche todos os passos com a proposta gravada. */
  carregar(p: PropostaLocal): void {
    for (const n of [1, 2, 3] as const) this.preencher(n, p);
    this.rebasear(p);
  }

  /** Depois de gravar o passo `n`: o passo volta a mostrar o que ficou gravado (texto normalizado) e tudo é rebaseado. */
  aposSalvar(n: Passo, p: PropostaLocal): void {
    if (n === 1 || n === 2 || n === 3) this.preencher(n, p);
    if (n === 1) {
      // a troca de tipo também gravou o template padrão do tipo e os meses das linhas
      if (this.sujo(2)) this.alinharMeses(p);
      else this.preencher(2, p);
      if (this.sujo(3)) this.templateId.set(p.templateId);
      else this.preencher(3, p);
    }
    this.rebasear(p);
  }

  sujo(n: Passo): boolean {
    return this.instantaneoPasso(n) !== this.salvo()[n];
  }

  /**
   * A edição do passo `n` para gravar; null se o passo tem erro. `atual` é a proposta gravada: na troca de tipo, o
   * passo 1 leva junto o template padrão do novo tipo e os meses das linhas gravadas (o servidor exige `meses` só em
   * LOCACAO com item locável).
   */
  edicaoDoPasso(n: Passo, atual: PropostaLocal | undefined): EdicaoWizard | null {
    if (!this.valido(n, false)) return null;
    if (n === 1) {
      const edicao: EdicaoWizard = { tipo: this.tipo(), clienteId: this.clienteId() };
      if (atual && atual.tipo !== this.tipo()) {
        edicao.templateId = this.padroes().get(this.tipo()) ?? null;
        edicao.itens = atual.itens.map((l) => ({ ...l, meses: this.mesesNoTipo(l.itemCatalogoId, l.meses) }));
      }
      return edicao;
    }
    if (n === 2) return { itens: this.linhasLidas()! };
    if (n === 3) {
      const c = this.camposCondicoesAtuais();
      const edicao: EdicaoWizard = {
        templateId: c.templateId,
        validadeAte: c.validadeAte === '' ? null : c.validadeAte,
        condicoesPagamento: c.condicoesPagamento,
        prazoExecucao: c.prazoExecucao,
        observacoes: c.observacoes,
        descontoGeralCentesimos: Number(this.descontoGeralLido()),
        tecnicoId: c.tecnicoId,
      };
      if (this.admin() && c.responsavelId && c.responsavelId !== atual?.responsavelId) edicao.responsavelId = c.responsavelId;
      return edicao;
    }
    return {};
  }

  /** Guarda a recusa do repositório por campo; devolve o passo do primeiro campo (null: erro sem campo). */
  registrarErro(e: unknown): Passo | null {
    if (!(e instanceof ErroProposta) || !e.campos) {
      this.errosServidor.set({});
      return e instanceof ErroProposta ? passoDoCampo(e.campo) : null;
    }
    this.errosServidor.set(e.campos);
    const passos = Object.keys(e.campos).map(passoDoCampo).filter((x): x is Passo => x !== null);
    return passos.length > 0 ? (Math.min(...passos) as Passo) : null;
  }

  marcarTentativa(n: Passo): void {
    this.tentou.update((s) => new Set([...s, n]));
  }

  // ---- edição das linhas ----

  /** A linha que `adicionarItem` gravou, no fim da lista da tela (as outras linhas da tela ficam como estão). */
  anexarLinha(linha: PropostaLocal['itens'][number], p: PropostaLocal): void {
    this.linhas.update((l) => [...l.filter((x) => x.id !== linha.id), paraLinhaEditavel(linha)]);
    this.salvo.update((s) => ({ ...s, 2: instantaneo(p.itens.map(paraLinhaEditavel)) }));
  }

  alterarLinha(id: string, campo: 'quantidade' | 'preco' | 'desconto' | 'meses', valor: string): void {
    this.linhas.update((lista) => lista.map((l) => (l.id === id ? { ...l, [campo]: valor } : l)));
    this.limparErroServidor((c) => c.startsWith('itens'));
  }

  removerLinha(id: string): void {
    this.linhas.update((lista) => lista.filter((l) => l.id !== id));
    this.limparErroServidor((c) => c.startsWith('itens'));
  }

  moverLinha(indice: number, delta: -1 | 1): boolean {
    const lista = [...this.linhas()];
    const destino = indice + delta;
    if (destino < 0 || destino >= lista.length) return false;
    [lista[indice], lista[destino]] = [lista[destino], lista[indice]];
    this.linhas.set(lista);
    this.limparErroServidor((c) => c.startsWith('itens['));
    return true;
  }

  limparErroServidor(campo: (c: string) => boolean): void {
    const atual = this.errosServidor();
    if (!Object.keys(atual).some(campo)) return;
    this.errosServidor.set(Object.fromEntries(Object.entries(atual).filter(([c]) => !campo(c))));
  }

  // ---- internos ----

  private mesesNoTipo(itemCatalogoId: string, meses: number | null): number | null {
    if (this.tipo() !== 'LOCACAO') return null;
    const catalogo = this.catalogoPorId().get(itemCatalogoId);
    if (!catalogo) return meses;
    return catalogo.locavel ? (meses ?? 1) : null;
  }

  /** Os meses das linhas da tela passam a ser os gravados (troca de tipo com o passo 2 ainda sujo). */
  private alinharMeses(p: PropostaLocal): void {
    const gravadas = new Map(p.itens.map((l) => [l.id, l]));
    this.linhas.update((lista) =>
      lista.map((l) => {
        const g = gravadas.get(l.id);
        return g ? { ...l, meses: g.meses === null ? '' : String(g.meses), mesesAoCarregar: g.meses } : l;
      }),
    );
  }

  private preencher(n: 1 | 2 | 3, p: PropostaLocal): void {
    if (n === 1) {
      this.tipo.set(p.tipo);
      this.clienteId.set(p.clienteId);
    } else if (n === 2) {
      this.linhas.set(p.itens.map(paraLinhaEditavel));
    } else {
      const c = camposCondicoes(p);
      this.templateId.set(c.templateId);
      this.validadeAte.set(c.validadeAte);
      this.condicoesPagamento.set(c.condicoesPagamento);
      this.prazoExecucao.set(c.prazoExecucao);
      this.observacoes.set(c.observacoes);
      this.descontoGeral.set(c.descontoGeral);
      this.tecnicoId.set(c.tecnicoId);
      this.responsavelId.set(c.responsavelId);
    }
  }

  /** O gravado passa a ser `p`: base do "sujo" de cada passo e os dados que não se editam aqui. */
  private rebasear(p: PropostaLocal): void {
    this.id.set(p.id);
    this.codigo.set(codigoExibido(p));
    this.status.set(p.status);
    this.responsavelSalvo.set(p.responsavelId);
    this.salvo.set({
      1: instantaneo(camposCliente(p)),
      2: instantaneo(p.itens.map(paraLinhaEditavel)),
      3: instantaneo(camposCondicoes(p)),
      4: '',
    });
  }

  private camposCondicoesAtuais(): CamposCondicoes {
    return {
      templateId: this.templateId(),
      validadeAte: this.validadeAte(),
      condicoesPagamento: this.condicoesPagamento(),
      prazoExecucao: this.prazoExecucao(),
      observacoes: this.observacoes(),
      descontoGeral: this.descontoGeral(),
      tecnicoId: this.tecnicoId(),
      responsavelId: this.responsavelId(),
    };
  }

  private instantaneoPasso(n: Passo): string {
    switch (n) {
      case 1:
        return instantaneo({ tipo: this.tipo(), clienteId: this.clienteId() });
      case 2:
        return instantaneo(this.linhas());
      case 3:
        return instantaneo(this.camposCondicoesAtuais());
      default:
        return '';
    }
  }
}
