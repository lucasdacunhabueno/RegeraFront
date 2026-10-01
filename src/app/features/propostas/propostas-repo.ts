import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { paraBytes } from '../../core/arquivos/arquivos-service';
import type { UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { observar } from '../../core/db/observar';
import { RegeraDb } from '../../core/db/regera-db';
import type { ClientePdf, EmpresaPdf, EntradaPdf, ItemPdf } from '../../core/pdf/pdf-models';
import { PdfService } from '../../core/pdf/pdf-service';
import { observarNaoSincronizados } from '../../core/sync/nao-sincronizados';
import type { ErroMutacao } from '../../core/sync/sync-models';
import { SyncService } from '../../core/sync/sync-service';
import { ErroCampo } from '../../core/util/erro-campo';
import { formatarCep } from '../../core/util/formatos';
import { uuidv7 } from '../../core/util/uuid';
import type { ItemLocal } from '../catalogo/item-models';
import type { ClienteLocal } from '../clientes/cliente-models';
import { EmpresaLocal, ID_EMPRESA } from '../empresa/empresa-models';
import type { TemplateLocal, TipoProposta } from '../templates/template-models';
import { TemplatesRepo } from '../templates/templates-repo';
import { calcular, deCentesimos, deMilesimos, paraCentavos } from './calculo';
import { gerarCodigoProvisorio } from './codigo-provisorio';
import {
  codigoBase,
  codigoExibido,
  ContextoTransicao,
  dadosDaProposta,
  DocumentoLocal,
  exigeMotivo,
  ItemPropostaLocal,
  podeAlterarResponsavel,
  podeAlterarTecnico,
  PropostaLocal,
  StatusProposta,
  transicoesPermitidas,
  validarTransicao,
} from './proposta-models';

// --- datas (§13: emissão = hoje; validade = hoje + empresa.validadePadraoDias) ---

const FORMATO_SAO_PAULO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** A data civil (`aaaa-mm-dd`) de São Paulo no instante `agora`, independente do fuso do aparelho. */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  const partes = new Map(FORMATO_SAO_PAULO.formatToParts(agora).map((p) => [p.type, p.value]));
  return `${partes.get('year')}-${partes.get('month')}-${partes.get('day')}`;
}

/** Aritmética de calendário sobre `aaaa-mm-dd` (em UTC, só como contador de dias: sem fuso nem horário de verão). */
export function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

// --- erros ---

/**
 * Recusa local, com o mesmo `codigo` que o servidor daria (`ACESSO_NEGADO`, `PROPOSTA_NAO_EDITAVEL`,
 * `TRANSICAO_INVALIDA`, `VALIDACAO`...) ou um só do aparelho (`NAO_ENCONTRADA`, `USE_ENVIAR`, `PROPOSTA_ALTERADA`,
 * `SNAPSHOT_GRANDE`). `campo` é o primeiro campo com erro (nomes do servidor, ex.: `itens[0].quantidade`) ou
 * `proposta` quando o erro não é de um campo; `campos` traz todos, na validação.
 */
export class ErroProposta extends ErroCampo {
  constructor(
    readonly codigo: string,
    campo: string,
    mensagem: string,
    readonly campos?: Record<string, string>,
  ) {
    super(campo, mensagem);
  }

  static de(e: ErroMutacao): ErroProposta {
    const [primeiro] = Object.entries(e.campos ?? {});
    return primeiro
      ? new ErroProposta(e.codigo, primeiro[0], primeiro[1], { ...e.campos })
      : new ErroProposta(e.codigo, 'proposta', e.mensagem);
  }
}

function validacao(campos: Record<string, string>): void {
  if (Object.keys(campos).length > 0) throw ErroProposta.de({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos });
}

// --- edição ---

/**
 * Linha como a tela a edita. Unidades: quantidade em milésimos (1,5 → 1500), preço em centavos, desconto em
 * centésimos de ponto percentual (12,5% → 1250) — a tela converte o que se digita com `lerDecimalEstrito`.
 * `subtotalCentavos` e `ordem` são recalculados aqui (a ordem é a da lista).
 */
export type LinhaRascunho = Omit<ItemPropostaLocal, 'subtotalCentavos' | 'ordem'> &
  Partial<Pick<ItemPropostaLocal, 'subtotalCentavos' | 'ordem'>>;

/** Campos editáveis do rascunho (o que faltar fica como está). Responsável muda só por `atribuir`. */
export interface EdicaoRascunho {
  tipo: TipoProposta;
  clienteId: string | null;
  templateId: string | null;
  tecnicoId: string | null;
  dataEmissao: string;
  validadeAte: string | null;
  condicoesPagamento: string | null;
  prazoExecucao: string | null;
  observacoes: string | null;
  /** Centésimos de ponto percentual (12,5% → 1250). */
  descontoGeralCentesimos: number;
  itens: readonly LinhaRascunho[];
}

const MAX_ITENS = 200;
const QUANTIDADE_MAX_MILESIMOS = 999_999_999; // 999.999,999
const PRECO_MAX_CENTAVOS = 99_999_999_999_999; // 999.999.999.999,99
const PERCENTUAL_MAX_CENTESIMOS = 10_000; // 100%
const TOTAL_MAX_CENTAVOS = 9_999_999_999_999_999n; // 99.999.999.999.999,99 (limite do servidor)
const SNAPSHOT_MAX_BYTES = 512 * 1024;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const TAMANHO_TEXTO: readonly ['condicoesPagamento' | 'prazoExecucao' | 'observacoes', number][] = [
  ['condicoesPagamento', 1000], ['prazoExecucao', 200], ['observacoes', 4000],
];

const inteiroEntre = (v: unknown, min: number, max: number): boolean =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;

/** Como o `texto()` do servidor: sem espaços nas pontas, e vazio vira null. */
function texto(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

/** Totais e subtotais para exibição imediata (`calcular`, em `bigint`); o servidor recalcula e prevalece no retorno. */
function comTotais(p: PropostaLocal): PropostaLocal {
  const r = calcular(
    p.itens.map((l) => ({
      quantidadeMilesimos: BigInt(l.quantidadeMilesimos),
      precoUnitarioCentavos: BigInt(l.precoUnitarioCentavos ?? 0),
      descontoCentesimos: BigInt(l.descontoCentesimos ?? 0),
      meses: l.meses,
    })),
    BigInt(p.descontoGeralCentesimos ?? 0),
    p.tipo === 'LOCACAO',
  );
  if (r.totalItensCentavos > TOTAL_MAX_CENTAVOS) {
    validacao({ itens: 'O valor total da proposta excede o limite de 99.999.999.999.999,99.' });
  }
  return {
    ...p,
    itens: p.itens.map((l, i) => ({ ...l, ordem: i, subtotalCentavos: Number(r.subtotaisCentavos[i]) })),
    totalItensCentavos: Number(r.totalItensCentavos),
    totalDescontosCentavos: Number(r.totalDescontosCentavos),
    totalCentavos: Number(r.totalCentavos),
  };
}

function contexto(p: PropostaLocal, c: Partial<ContextoTransicao> = {}): ContextoTransicao {
  return {
    temCliente: p.clienteId !== null,
    temTemplate: p.templateId !== null,
    itens: p.itens.length,
    motivo: null,
    alteraCampos: false,
    alteraAtribuicao: false,
    ...c,
  };
}

const CONTEXTO_CRIACAO: ContextoTransicao = {
  temCliente: false, temTemplate: false, itens: 0, motivo: null, alteraCampos: false, alteraAtribuicao: false,
};

// --- PDF ---

const EMPRESA_VAZIA: EmpresaPdf = {
  razaoSocial: '', nomeFantasia: null, cnpj: null, endereco: null, telefone: null, email: null, site: null,
  corPrimaria: '#1d4ed8',
};

/** Endereço principal (ou o primeiro) em uma linha: `Logradouro, nº - compl. - bairro - Cidade/UF - CEP 00000-000`. */
function enderecoDoCliente(c: ClienteLocal): string | null {
  const e = c.enderecos.find((x) => x.tipo === 'PRINCIPAL') ?? c.enderecos[0];
  if (!e) return null;
  const local = [e.cidade, e.uf].map(texto).filter((x) => x !== null).join('/');
  const partes = [
    [e.logradouro, e.numero].map(texto).filter((x) => x !== null).join(', '),
    texto(e.complemento),
    texto(e.bairro),
    local,
    texto(e.cep) ? `CEP ${formatarCep(e.cep)}` : null,
  ].filter((x): x is string => x !== null && x !== '');
  return partes.length > 0 ? partes.join(' - ') : null;
}

function clienteDoPdf(c: ClienteLocal): ClientePdf {
  return {
    nome: c.nome,
    documento: c.documento,
    endereco: enderecoDoCliente(c),
    contato: c.contatoNome,
    telefone: c.telefone,
    email: c.email,
  };
}

function itemDoPdf(l: ItemPropostaLocal): ItemPdf {
  return {
    codigo: l.codigo ?? '',
    nome: l.nome ?? '',
    descricao: l.descricao,
    unidade: l.unidade ?? '',
    natureza: l.natureza ?? 'PRODUTO',
    quantidade: Number(deMilesimos(BigInt(l.quantidadeMilesimos))),
    precoUnitarioCentavos: l.precoUnitarioCentavos ?? 0,
    descontoPercentual: Number(deCentesimos(BigInt(l.descontoCentesimos ?? 0))),
    meses: l.meses,
    subtotalCentavos: l.subtotalCentavos ?? 0,
  };
}

/** `atualizadoEm` desc pelo instante (o texto ISO tem frações de tamanho variável); sem data por último; empate: id desc. */
function ordenar(lista: PropostaLocal[]): PropostaLocal[] {
  const instante = (p: PropostaLocal) => (p.atualizadoEm ? Date.parse(p.atualizadoEm) : Number.NEGATIVE_INFINITY);
  return lista.sort((a, b) => instante(b) - instante(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Propostas no aparelho (offline-first): cada escrita grava o local e enfileira a mutação `proposta` na outbox, na
 * mesma transação. As regras de perfil e de ciclo de vida (§8, §10) são conferidas aqui com as mesmas funções que
 * espelham o servidor (`validarTransicao`, `transicoesPermitidas`), para a tela recusar na hora; o servidor confere
 * de novo e prevalece. Recusas lançam `ErroProposta` (um `ErroCampo`).
 *
 * Decisão (PDF): o repo não conhece o pdfmake. `enviar` recebe a função que gera o Blob (a tela passa
 * `PdfService.gerarBlob`) e usa o `PdfService` só para a logo (`logoDataUrl`, que não carrega o pdfmake).
 */
@Injectable({ providedIn: 'root' })
export class PropostasRepo {
  private readonly db = inject(RegeraDb);
  private readonly sync = inject(SyncService);
  private readonly auth = inject(AuthService);
  private readonly templates = inject(TemplatesRepo);
  private readonly pdf = inject(PdfService);

  /** Todas as visíveis neste aparelho, por `atualizadoEm` desc (§13, kanban). */
  observarTodas(): Observable<PropostaLocal[]> {
    return observar(async () => ordenar(await this.db.propostas.toArray()));
  }

  observarDoCliente(clienteId: string): Observable<PropostaLocal[]> {
    return observar(async () => ordenar(await this.db.propostas.where('clienteId').equals(clienteId).toArray()));
  }

  /** As atribuídas ao técnico (a lista dele no P4c). */
  observarDoTecnico(usuarioId: string): Observable<PropostaLocal[]> {
    return observar(async () => ordenar(await this.db.propostas.where('tecnicoId').equals(usuarioId).toArray()));
  }

  observarNaoSincronizados(): Observable<Set<string>> {
    return observarNaoSincronizados(this.db);
  }

  buscar(id: string): Promise<PropostaLocal | undefined> {
    return this.db.propostas.get(id);
  }

  async temPendencia(id: string): Promise<boolean> {
    return (await this.db.pendencias.where('agregadoId').equals(id).count()) > 0;
  }

  /**
   * Novo RASCUNHO com os padrões (§13): o usuário atual é o responsável (obrigatório para o COMERCIAL); emissão hoje
   * em São Paulo; validade = hoje + `validadePadraoDias` da empresa (15 sem empresa); condições de pagamento da
   * empresa; template padrão do tipo.
   */
  async criar(tipo: TipoProposta, clienteId?: string | null): Promise<string> {
    const u = this.usuario();
    this.checar(validarTransicao(null, 'RASCUNHO', u.perfil, true, CONTEXTO_CRIACAO));
    const empresa = await this.empresa();
    const template = await this.templates.padraoPorTipo(tipo);
    const hoje = hojeEmSaoPaulo();
    const p = comTotais({
      id: uuidv7(),
      version: null,
      codigoProvisorio: gerarCodigoProvisorio(),
      numero: null,
      revisao: 1,
      tipo,
      status: 'RASCUNHO',
      clienteId: clienteId ?? null,
      templateId: template?.id ?? null,
      responsavelId: u.id,
      tecnicoId: null,
      dataEmissao: hoje,
      validadeAte: somarDias(hoje, empresa?.validadePadraoDias ?? 15),
      condicoesPagamento: texto(empresa?.condicoesPagamentoPadrao),
      prazoExecucao: null,
      observacoes: null,
      descontoGeralCentesimos: 0,
      totalItensCentavos: 0,
      totalDescontosCentavos: 0,
      totalCentavos: 0,
      motivoEncerramento: null,
      itens: [],
      historico: [],
      documentos: [],
      atualizadoEm: null,
    });
    await this.gravar(p, null);
    return p.id;
  }

  /**
   * Edição do rascunho (só em RASCUNHO, pelo ADMIN ou pelo responsável). Recalcula subtotais e totais para a tela;
   * o servidor recalcula e o valor dele volta no retorno. versaoCarregada: versão que a tela carregou (base para o
   * servidor detectar conflito).
   */
  async salvarRascunho(id: string, edicao: Partial<EdicaoRascunho>, versaoCarregada?: number | null): Promise<void> {
    const u = this.usuario();
    const atual = await this.carregar(id);
    this.exigirEdicao(atual, u);
    if (edicao.tecnicoId !== undefined && edicao.tecnicoId !== atual.tecnicoId) {
      await this.conferirTecnico(atual, u, edicao.tecnicoId);
    }
    const novo: PropostaLocal = {
      ...atual,
      ...(edicao.tipo !== undefined ? { tipo: edicao.tipo } : {}),
      ...(edicao.clienteId !== undefined ? { clienteId: edicao.clienteId } : {}),
      ...(edicao.templateId !== undefined ? { templateId: edicao.templateId } : {}),
      ...(edicao.tecnicoId !== undefined ? { tecnicoId: edicao.tecnicoId } : {}),
      ...(edicao.dataEmissao !== undefined ? { dataEmissao: edicao.dataEmissao } : {}),
      ...(edicao.validadeAte !== undefined ? { validadeAte: edicao.validadeAte } : {}),
      ...(edicao.condicoesPagamento !== undefined ? { condicoesPagamento: texto(edicao.condicoesPagamento) } : {}),
      ...(edicao.prazoExecucao !== undefined ? { prazoExecucao: texto(edicao.prazoExecucao) } : {}),
      ...(edicao.observacoes !== undefined ? { observacoes: texto(edicao.observacoes) } : {}),
      ...(edicao.descontoGeralCentesimos !== undefined ? { descontoGeralCentesimos: edicao.descontoGeralCentesimos } : {}),
      ...(edicao.itens !== undefined
        ? { itens: edicao.itens.map((l) => ({ ...l, ordem: null, subtotalCentavos: null })) }
        : {}),
    };
    validacao(await this.validarEdicao(atual, novo));
    const version = versaoCarregada !== undefined ? versaoCarregada : atual.version;
    await this.gravar(comTotais({ ...novo, version }), version, false, true);
  }

  /**
   * Inclui o item do catálogo no rascunho, com o snapshot copiado dele (código, nome, descrição, unidade, natureza e
   * custo, se o perfil o vê). Preço: o de venda, ou o mensal em LOCACAO com item locável (aí `meses = 1`).
   * Quantidade 1, sem desconto. Devolve o id da linha.
   */
  async adicionarItem(id: string, itemCatalogo: ItemLocal): Promise<string> {
    const u = this.usuario();
    const atual = await this.carregar(id);
    this.exigirEdicao(atual, u);
    if (!itemCatalogo.ativo) validacao({ itens: 'Este item do catálogo está inativo.' });
    if (atual.itens.length >= MAX_ITENS) validacao({ itens: `Máximo de ${MAX_ITENS} itens.` });
    const mensal = atual.tipo === 'LOCACAO' && itemCatalogo.locavel;
    const preco = mensal ? itemCatalogo.precoLocacaoMensal : itemCatalogo.precoVenda;
    const linha: ItemPropostaLocal = {
      id: uuidv7(),
      itemCatalogoId: itemCatalogo.id,
      codigo: itemCatalogo.codigo,
      nome: itemCatalogo.nome,
      descricao: itemCatalogo.descricao,
      unidade: itemCatalogo.unidade,
      natureza: itemCatalogo.natureza,
      precoCustoCentavos: itemCatalogo.precoCusto == null ? null : Number(paraCentavos(itemCatalogo.precoCusto)),
      quantidadeMilesimos: 1000,
      precoUnitarioCentavos: preco == null ? 0 : Number(paraCentavos(preco)),
      descontoCentesimos: 0,
      meses: mensal ? 1 : null,
      subtotalCentavos: null,
      ordem: null,
    };
    await this.gravar(comTotais({ ...atual, itens: [...atual.itens, linha] }), atual.version, false, true);
    return linha.id;
  }

  /**
   * Muda o status (§8), como mutação separada (nunca coalesce). Confere a tabela de transições para o perfil
   * (`transicoesPermitidas`) e os requisitos (`validarTransicao`, ex.: motivo de 3 a 500 caracteres em RECUSADA e
   * CANCELADA). RASCUNHO → ENVIADA só por `enviar`, que gera o PDF oficial. ENVIADA → RASCUNHO abre a revisão seguinte
   * já no aparelho (o PDF de um novo envio offline sai com a revisão certa); o servidor confirma.
   */
  async transicionar(id: string, para: StatusProposta, motivo?: string | null): Promise<void> {
    const u = this.usuario();
    const atual = await this.carregar(id);
    if (atual.status === 'RASCUNHO' && para === 'ENVIADA') {
      throw new ErroProposta('USE_ENVIAR', 'proposta', 'Para enviar, gere o PDF oficial da proposta.');
    }
    const motivoLimpo = texto(motivo);
    this.exigirTransicao(atual, para, u, contexto(atual, { motivo: motivoLimpo }));
    const novo: PropostaLocal = {
      ...atual,
      status: para,
      motivoEncerramento: exigeMotivo(para) ? motivoLimpo : atual.motivoEncerramento,
      revisao: atual.status === 'ENVIADA' && para === 'RASCUNHO' ? (atual.revisao ?? 1) + 1 : atual.revisao,
    };
    await this.gravar(novo, atual.version, true);
  }

  /**
   * Atribuição (P4b-R3), em qualquer status não terminal: o responsável só o ADMIN troca (por um ADMIN ou COMERCIAL);
   * o técnico, o ADMIN ou o responsável (por um TECNICO, ou nenhum).
   */
  async atribuir(id: string, mudanca: { responsavelId?: string; tecnicoId?: string | null }): Promise<void> {
    const u = this.usuario();
    const atual = await this.carregar(id);
    const ehResponsavel = atual.responsavelId === u.id;
    const responsavelId = mudanca.responsavelId ?? atual.responsavelId;
    const tecnicoId = mudanca.tecnicoId !== undefined ? mudanca.tecnicoId : atual.tecnicoId;
    if (responsavelId === atual.responsavelId && tecnicoId === atual.tecnicoId) return;
    this.checar(validarTransicao(atual.status, atual.status, u.perfil, ehResponsavel, contexto(atual, { alteraAtribuicao: true })));
    if (responsavelId !== atual.responsavelId) {
      if (!podeAlterarResponsavel(atual.status, u.perfil)) {
        throw new ErroProposta('ACESSO_NEGADO', 'responsavelId', 'Só o administrador troca o responsável.');
      }
      const r = await this.db.usuarios.get(responsavelId);
      if (!r || r.perfil === 'TECNICO') validacao({ responsavelId: 'O responsável tem de ser um administrador ou comercial.' });
    }
    if (tecnicoId !== atual.tecnicoId) await this.conferirTecnico(atual, u, tecnicoId);
    await this.gravar({ ...atual, responsavelId, tecnicoId }, atual.version);
  }

  /**
   * Novo RASCUNHO a partir de qualquer proposta (o caminho para refazer uma encerrada): mesmo tipo, cliente,
   * template, técnico, condições e itens (com ids novos; preço e desconto mantidos), mesmo responsável, novo código
   * provisório, emissão e validade de hoje. Sem número, histórico, documentos nem motivo.
   */
  async duplicar(id: string): Promise<string> {
    const u = this.usuario();
    const original = await this.carregar(id);
    this.checar(validarTransicao(null, 'RASCUNHO', u.perfil, original.responsavelId === u.id, contexto(original)));
    const empresa = await this.empresa();
    const hoje = hojeEmSaoPaulo();
    const p = comTotais({
      ...original,
      id: uuidv7(),
      version: null,
      codigoProvisorio: gerarCodigoProvisorio(),
      numero: null,
      revisao: 1,
      status: 'RASCUNHO',
      dataEmissao: hoje,
      validadeAte: somarDias(hoje, empresa?.validadePadraoDias ?? 15),
      motivoEncerramento: null,
      itens: original.itens.map((l) => ({ ...l, id: uuidv7() })),
      historico: [],
      documentos: [],
      atualizadoEm: null,
    });
    await this.gravar(p, null);
    return p.id;
  }

  /**
   * Envio (RASCUNHO → ENVIADA, §9.3), nesta ordem:
   * 1. confere permissão e requisitos (cliente, template e ≥ 1 item), e que cliente e template estão no aparelho;
   * 2. monta a entrada do PDF com os dados locais e gera o PDF oficial com `gerarPdf`;
   * 3. calcula o SHA-256 dos bytes no aparelho;
   * 4. numa transação só: grava o documento local (bytes, revisão, código exibido e o snapshot da entrada), passa a
   *    proposta a ENVIADA (mutação separada) e enfileira o UPLOAD, que por isso sai depois da transição;
   * 5. dispara a sincronização e devolve o Blob para compartilhar.
   * Código exibido: o número (`000277`, com `-R<n>` na revisão > 1), se já existe; senão, o PROV (com o mesmo sufixo).
   * Com número e um documento PROV anterior, o PDF leva `(ref. PROV-xxxxxx)`.
   */
  async enviar(id: string, gerarPdf: (entrada: EntradaPdf) => Promise<Blob>): Promise<Blob> {
    const u = this.usuario();
    const p = comTotais(await this.carregar(id));
    this.exigirTransicao(p, 'ENVIADA', u, contexto(p));
    const cliente = await this.db.clientes.get(p.clienteId!);
    if (!cliente) validacao({ clienteId: 'O cliente não está neste aparelho. Sincronize e tente de novo.' });
    const template = await this.db.templates.get(p.templateId!);
    if (!template) validacao({ templateId: 'O template não está neste aparelho. Sincronize e tente de novo.' });

    const empresa = await this.empresa();
    const entrada = await this.montarEntrada(p, cliente!, template!, empresa, u);
    // snapshot: a entrada sem a logo em data URL (pesada; vai a referência do arquivo)
    const snapshot = JSON.parse(JSON.stringify({ ...entrada, logoDataUrl: undefined })) as Record<string, unknown>;
    snapshot['logoArquivoId'] = empresa?.logoArquivoId ?? null;
    if (new TextEncoder().encode(JSON.stringify(snapshot)).length > SNAPSHOT_MAX_BYTES) {
      throw new ErroProposta('SNAPSHOT_GRANDE', 'proposta', 'Os dados desta proposta passam do limite do documento (512 KB).');
    }

    const blob = await gerarPdf(entrada);
    const bytes = await paraBytes(blob);
    const sha256 = await sha256Hex(bytes);
    const revisao = p.revisao ?? 1;
    const documento: DocumentoLocal = {
      id: uuidv7(),
      propostaId: p.id,
      revisao,
      codigoExibido: codigoExibido({ ...p, revisao }),
      sha256,
      geradoEm: new Date().toISOString(),
      geradoPor: u.id,
      bytes,
      enviado: false,
      arquivoId: null,
      snapshot,
    };
    const enviada: PropostaLocal = { ...p, status: 'ENVIADA', atualizadoEm: new Date().toISOString() };
    await this.db.transaction('rw', [this.db.propostas, this.db.documentos, this.db.outbox], async () => {
      // o PDF foi gerado fora da transação: se a proposta mudou nesse meio-tempo, ele não a representa mais
      const agora = await this.db.propostas.get(id);
      if (!agora || JSON.stringify(comTotais(agora)) !== JSON.stringify(p)) {
        throw new ErroProposta('PROPOSTA_ALTERADA', 'proposta', 'A proposta mudou enquanto o PDF era gerado. Envie de novo.');
      }
      await this.db.documentos.add(documento);
      await this.db.propostas.put(enviada);
      await this.sync.registrar('proposta', id, 'UPSERT', dadosDaProposta(enviada), p.version, { separada: true });
      await this.sync.registrarUpload(id, documento.id);
    });
    void this.sync.sincronizar();
    return blob;
  }

  // --- internos ---

  private usuario(): UsuarioSessao {
    const u = this.auth.usuario();
    if (!u) throw new ErroProposta('ACESSO_NEGADO', 'proposta', 'Entre de novo para alterar propostas.');
    return u;
  }

  private async carregar(id: string): Promise<PropostaLocal> {
    const p = await this.db.propostas.get(id);
    if (!p) throw new ErroProposta('NAO_ENCONTRADA', 'proposta', 'Proposta não encontrada neste aparelho.');
    return p;
  }

  private empresa(): Promise<EmpresaLocal | undefined> {
    return this.db.empresa.get(ID_EMPRESA);
  }

  private checar(e: ErroMutacao | null): void {
    if (e) throw ErroProposta.de(e);
  }

  /** Edição de campos: perfil (técnico nunca; comercial só se responsável) e status (só RASCUNHO). */
  private exigirEdicao(p: PropostaLocal, u: UsuarioSessao): void {
    this.checar(validarTransicao(p.status, p.status, u.perfil, p.responsavelId === u.id, contexto(p, { alteraCampos: true })));
  }

  /** O destino tem de estar entre os que o usuário pode escolher, e os requisitos dele têm de estar cumpridos. */
  private exigirTransicao(p: PropostaLocal, para: StatusProposta, u: UsuarioSessao, ctx: ContextoTransicao): void {
    const ehResponsavel = p.responsavelId === u.id;
    this.checar(validarTransicao(p.status, para, u.perfil, ehResponsavel, ctx));
    if (!transicoesPermitidas(p.status, u.perfil, ehResponsavel).includes(para)) {
      throw new ErroProposta('TRANSICAO_INVALIDA', 'proposta', 'Esta mudança de status não está disponível.');
    }
  }

  private async conferirTecnico(p: PropostaLocal, u: UsuarioSessao, tecnicoId: string | null): Promise<void> {
    if (!podeAlterarTecnico(p.status, u.perfil, p.responsavelId === u.id)) {
      throw new ErroProposta('ACESSO_NEGADO', 'tecnicoId', 'Só o administrador ou o responsável troca o técnico.');
    }
    if (tecnicoId === null) return;
    const t = await this.db.usuarios.get(tecnicoId);
    if (t?.perfil !== 'TECNICO') validacao({ tecnicoId: 'Escolha um usuário técnico.' });
  }

  /** Limites de entrada do servidor (§7.3 e `PropostaDados`), com os mesmos nomes de campo. */
  private async validarEdicao(atual: PropostaLocal, novo: PropostaLocal): Promise<Record<string, string>> {
    const campos: Record<string, string> = {};
    if (!DATA.test(novo.dataEmissao)) campos['dataEmissao'] = 'Informe a data de emissão.';
    if (novo.validadeAte !== null && !DATA.test(novo.validadeAte)) campos['validadeAte'] = 'Data inválida.';
    for (const [campo, max] of TAMANHO_TEXTO) {
      if ((novo[campo] ?? '').length > max) campos[campo] = `Máximo de ${max} caracteres.`;
    }
    if (!inteiroEntre(novo.descontoGeralCentesimos, 0, PERCENTUAL_MAX_CENTESIMOS)) {
      campos['descontoGeralPercentual'] = 'O desconto vai de 0 a 100%.';
    }
    if (novo.itens.length > MAX_ITENS) campos['itens'] = `Máximo de ${MAX_ITENS} itens.`;
    const anteriores = new Map(atual.itens.map((l) => [l.id, l]));
    const ids = new Set<string>();
    for (const [i, l] of novo.itens.entries()) {
      const pre = `itens[${i}].`;
      if (ids.has(l.id)) {
        campos[pre + 'id'] = 'Linha repetida.';
        continue;
      }
      ids.add(l.id);
      if (!inteiroEntre(l.quantidadeMilesimos, 1, QUANTIDADE_MAX_MILESIMOS)) {
        campos[pre + 'quantidade'] = 'A quantidade vai de 0,001 a 999.999,999.';
      }
      if (!inteiroEntre(l.precoUnitarioCentavos, 0, PRECO_MAX_CENTAVOS)) {
        campos[pre + 'precoUnitario'] = 'O preço vai de 0 a 999.999.999.999,99.';
      }
      if (!inteiroEntre(l.descontoCentesimos, 0, PERCENTUAL_MAX_CENTESIMOS)) {
        campos[pre + 'descontoPercentual'] = 'O desconto vai de 0 a 100%.';
      }
      if (l.meses !== null && !inteiroEntre(l.meses, 1, 120)) {
        campos[pre + 'meses'] = 'De 1 a 120 meses.';
        continue;
      }
      // como no servidor: catálogo e meses conferidos só na linha nova, na que mudou meses ou quando o tipo mudou
      const anterior = anteriores.get(l.id);
      const nova = !anterior || anterior.itemCatalogoId !== l.itemCatalogoId;
      if (!nova && anterior.meses === l.meses && atual.tipo === novo.tipo) continue;
      const catalogo = await this.db.itens.get(l.itemCatalogoId);
      if (!catalogo) continue; // o servidor decide
      if (nova && !catalogo.ativo) {
        campos[pre + 'itemCatalogoId'] = 'Item do catálogo inativo.';
        continue;
      }
      const exigeMeses = novo.tipo === 'LOCACAO' && catalogo.locavel;
      if (exigeMeses && l.meses === null) campos[pre + 'meses'] = 'Informe os meses de locação.';
      else if (!exigeMeses && l.meses !== null) campos[pre + 'meses'] = 'Meses só em proposta de locação com item locável.';
    }
    return campos;
  }

  private async montarEntrada(
    p: PropostaLocal,
    cliente: ClienteLocal,
    template: TemplateLocal,
    empresa: EmpresaLocal | undefined,
    u: UsuarioSessao,
  ): Promise<EntradaPdf> {
    const locais = await this.db.documentos.where('propostaId').equals(p.id).toArray();
    const provisorioAnterior =
      p.numero !== null && [...p.documentos, ...locais].some((d) => d.codigoExibido.startsWith(p.codigoProvisorio));
    const responsavel = await this.db.usuarios.get(p.responsavelId);
    const souEu = p.responsavelId === u.id;
    return {
      empresa: empresa
        ? {
            razaoSocial: empresa.razaoSocial,
            nomeFantasia: empresa.nomeFantasia,
            cnpj: empresa.cnpj,
            endereco: empresa.endereco,
            telefone: empresa.telefone,
            email: empresa.email,
            site: empresa.site,
            corPrimaria: empresa.corPrimaria,
          }
        : { ...EMPRESA_VAZIA },
      cliente: clienteDoPdf(cliente),
      proposta: {
        codigoExibido: codigoBase(p),
        referenciaProvisoria: provisorioAnterior ? p.codigoProvisorio : null,
        revisao: p.revisao ?? 1,
        tipo: p.tipo,
        dataEmissao: p.dataEmissao,
        validadeAte: p.validadeAte,
        condicoesPagamento: p.condicoesPagamento,
        prazoExecucao: p.prazoExecucao,
        observacoes: p.observacoes,
        totalItensCentavos: p.totalItensCentavos ?? 0,
        totalDescontosCentavos: p.totalDescontosCentavos ?? 0,
        totalCentavos: p.totalCentavos ?? 0,
        responsavelNome: responsavel?.nome ?? (souEu ? u.nome : null),
        responsavelEmail: responsavel?.email ?? (souEu ? u.email : null),
      },
      itens: p.itens.map(itemDoPdf),
      blocos: template.blocos,
      logoDataUrl: await this.pdf.logoDataUrl(empresa ?? null),
      previa: false,
    };
  }

  /**
   * Grava o local e enfileira o UPSERT, na mesma transação. `limparRejeicao`: a edição do rascunho substitui a
   * mutação `proposta` rejeitada (como nos outros repos); a rejeição de upload continua.
   */
  private async gravar(p: PropostaLocal, baseVersion: number | null, separada = false, limparRejeicao = false): Promise<void> {
    // P4b-R19: atualizadoEm otimista (o kanban reordena na hora); o servidor sobrescreve no retorno
    p = { ...p, atualizadoEm: new Date().toISOString() };
    await this.db.transaction('rw', [this.db.propostas, this.db.outbox, this.db.pendencias], async () => {
      await this.db.propostas.put(p);
      if (limparRejeicao) {
        await this.db.pendencias
          .where('agregadoId')
          .equals(p.id)
          .filter((x) => x.tipo === 'REJEITADO' && x.entidade === 'proposta')
          .delete();
      }
      await this.sync.registrar('proposta', p.id, 'UPSERT', dadosDaProposta(p), baseVersion, separada ? { separada: true } : {});
    });
    void this.sync.sincronizar();
  }
}
