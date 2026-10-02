import { inject, Injectable, InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { ArquivosService, paraBytes, paraDataUrl } from '../../core/arquivos/arquivos-service';
import type { Perfil, UsuarioSessao } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { observar } from '../../core/db/observar';
import { RegeraDb } from '../../core/db/regera-db';
import type { ClientePdf, EmpresaPdf } from '../../core/pdf/pdf-models';
import { PdfService } from '../../core/pdf/pdf-service';
import {
  type DadosUploadAnexoOs, type ErroMutacao, type MutacaoLocal, type Pendencia, TIPO_UPLOAD_ANEXO_OS, type UsuarioResumo,
} from '../../core/sync/sync-models';
import { SyncService } from '../../core/sync/sync-service';
import { ehUpload } from '../../core/sync/tipos-upload';
import { formatarCep } from '../../core/util/formatos';
import { sha256Hex } from '../../core/util/sha256';
import { uuidv7 } from '../../core/util/uuid';
import type { NaturezaItem } from '../catalogo/item-models';
import type { ClienteLocal, EnderecoDados } from '../clientes/cliente-models';
import { EmpresaLocal, ID_EMPRESA } from '../empresa/empresa-models';
import { deMilesimos } from '../propostas/calculo';
import { ordenarPorAtualizacao, stripJava } from '../propostas/proposta-models';
import { type EstadoSync, hojeEmSaoPaulo } from '../propostas/propostas-repo';
import type { TipoProposta } from '../templates/template-models';
import { gerarCodigoProvisorioOs } from './codigo-provisorio-os';
import { ErroOs } from './erro-os';
import { FotoPreparada, gerarMiniatura, prepararFoto } from './foto-os';
import {
  AnexoOsLocal,
  AnexoOsServidor,
  BytesAnexoOs,
  CampoEdicaoOs,
  codigoOsExibido,
  ComandosOs,
  ContextoTransicaoOs,
  dadosDaOs,
  ItemOsLocal,
  MOTIVO_MAX_OS,
  MOTIVO_MIN_OS,
  MomentoFoto,
  NotaOsLocal,
  OsDados,
  OsLocal,
  rotuloTipoOs,
  StatusOs,
  tamanhoTextoOs,
  textoOsValido,
  TipoAnexoOs,
  TipoOs,
  validarEdicaoOs,
  validarMutacaoOs,
} from './os-models';

export { ErroOs } from './erro-os';
export type { EstadoSync } from '../propostas/propostas-repo';

/**
 * Prepara a foto (`prepararFoto`): um token só para os testes trocarem a compressão do aparelho (canvas e
 * `createImageBitmap`) por uma falsa.
 */
export const PREPARAR_FOTO = new InjectionToken<(arquivo: Blob) => Promise<FotoPreparada>>('PREPARAR_FOTO', {
  providedIn: 'root',
  factory: () => prepararFoto,
});

/**
 * Reduz uma imagem ao tamanho da miniatura (`gerarMiniatura`, a rotina da captura): a foto que só o servidor tem entra
 * assim no PDF (M2P2-R10). Token pelo mesmo motivo do `PREPARAR_FOTO`.
 */
export const MINIATURA_FOTO = new InjectionToken<(imagem: Blob) => Promise<ArrayBuffer>>('MINIATURA_FOTO', {
  providedIn: 'root',
  factory: () => gerarMiniatura,
});

// --- limites (os do servidor: OsDados, ItemOsDados, NotaOsDados, AnexoOsService) ---

const MAX_DESCRICAO = 4000;
const MAX_RESUMO = 4000;
const MAX_ITENS = 200;
const QUANTIDADE_MAX_MILESIMOS = 999_999_999; // 999.999,999
const MAX_CODIGO = 40;
const MAX_NOME = 160;
const MAX_UNIDADE = 10;
const MAX_NOTA = 2000;
/** `NotaOsDados.MAX_NOVAS_POR_ENVIO`: notas novas numa mutação. */
const MAX_NOTAS_NOVAS = 200;
const LIMITE: Readonly<Record<TipoAnexoOs, { max: number; codigo: string; mensagem: string }>> = {
  FOTO: { max: 20, codigo: 'LIMITE_FOTOS', mensagem: 'Esta OS já tem o máximo de 20 fotos.' },
  ASSINATURA: { max: 10, codigo: 'LIMITE_ASSINATURAS', mensagem: 'Esta OS já tem o máximo de 10 assinaturas.' },
  DOCUMENTO: { max: 20, codigo: 'LIMITE_DOCUMENTOS', mensagem: 'Esta OS já tem o máximo de 20 PDFs.' },
};
const MAX_LEGENDA = 200;
const ASSINANTE_NOME_MIN = 2;
const ASSINANTE_NOME_MAX = 120;
const ASSINANTE_PAPEL_MAX = 60;
const ASSINATURA_MAX_BYTES = 512 * 1024;
const SNAPSHOT_MAX_BYTES = 512 * 1024;
/** `ArquivoService.MAX_BYTES` do servidor (o PDF): acima disso o upload volta 413. */
const PDF_MAX_BYTES = 10 * 1024 * 1024;
const ENDERECO_MAX: readonly [keyof OsLocal, number][] = [
  ['enderecoCep', 9], ['enderecoLogradouro', 160], ['enderecoNumero', 20], ['enderecoComplemento', 80],
  ['enderecoBairro', 80], ['enderecoCidade', 80],
];
/** Fotos só do servidor baixadas ao mesmo tempo para o PDF (cada uma com o prazo de 60 s do `baixarSemCache`). */
const DOWNLOADS_SIMULTANEOS = 2;
/** Tentativas do `concluir` quando a OS muda enquanto o PDF é gerado (P4b-R21). */
const TENTATIVAS_CONCLUIR = 3;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const MIME: Readonly<Record<TipoAnexoOs, string>> = { FOTO: 'image/jpeg', ASSINATURA: 'image/png', DOCUMENTO: 'application/pdf' };

/** O tipo da OS que sai de cada tipo de proposta (o parâmetro `tipo` troca). */
const TIPO_DA_PROPOSTA: Readonly<Record<TipoProposta, TipoOs>> = {
  VENDA: 'ENTREGA', SERVICO: 'SERVICO', MANUTENCAO: 'MANUTENCAO', LOCACAO: 'ENTREGA',
};

// --- tipos da API ---

/** Endereço do serviço (o *snapshot* na OS). */
export interface EnderecoOs {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

/** Linha como a tela a edita: quantidade em milésimos (1,5 → 1500). A `ordem` é a posição na lista. */
export type LinhaOs = Omit<ItemOsLocal, 'ordem'> & Partial<Pick<ItemOsLocal, 'ordem'>>;

/** O cabeçalho que `salvarCabecalho` edita (o que faltar fica como está). O responsável muda só por `atribuir`. */
export interface EdicaoCabecalhoOs {
  tipo: TipoOs;
  descricao: string | null;
  /** `aaaa-mm-dd`. */
  dataPrevista: string | null;
  urgente: boolean;
  tecnicoId: string | null;
  endereco: EnderecoOs;
  itens: readonly LinhaOs[];
  /** Q17/Q21: "Esta OS conclui a proposta?". */
  concluiProposta: boolean;
}

export interface OpcoesGerarOs {
  tecnicoId?: string | null;
  dataPrevista?: string | null;
  urgente?: boolean;
  /** Troca o tipo derivado da proposta. */
  tipo?: TipoOs;
  /** Q17: "Esta OS conclui a proposta?" (padrão sim). */
  concluiProposta?: boolean;
  /**
   * M2P2-R17: a descrição que o técnico lê, revisada na tela do "Gerar OS" (que a pré-preenche com as observações e o
   * prazo da proposta, onde o comercial pode ter escrito valores). Dada, vale ela (null ou só espaços: sem descrição);
   * ausente, a cópia da proposta.
   */
  descricao?: string | null;
}

export interface NovaOsAvulsa {
  clienteId: string;
  tipo: TipoOs;
  descricao: string | null;
  /** A posição do endereço em `cliente.enderecos` (o endereço do cliente não tem id); sem ela, o principal. */
  enderecoId?: number;
  tecnicoId?: string | null;
  dataPrevista?: string | null;
  urgente?: boolean;
}

export interface OpcoesFoto {
  legenda?: string | null;
  momento?: MomentoFoto | null;
}

export interface AssinaturaColhida {
  /** O `paraPng()` do `AssinaturaCanvas`. */
  png: { bytes: ArrayBuffer; sha256: string };
  nome: string;
  papel?: string | null;
}

export interface OpcoesConcluir {
  /** Q21: "Precisa voltar" desmarca "conclui a proposta" na própria mutação do concluir. */
  precisaVoltar?: boolean;
}

/** Um anexo da OS para a tela: do servidor (`OsLocal.anexos`), do aparelho (`anexosOs`) ou dos dois. */
export interface AnexoOsVisivel {
  id: string;
  tipo: TipoAnexoOs;
  legenda: string | null;
  momento: MomentoFoto | null;
  /** Na ASSINATURA, quando foi assinada. */
  tiradaEm: string | null;
  assinanteNome: string | null;
  assinantePapel: string | null;
  revisaoOs: number | null;
  codigoExibido: string | null;
  /** O upload foi aceito (está no servidor). */
  enviado: boolean;
  /** Os bytes completos estão no aparelho (`blobDoAnexo`); senão, só online pelo `arquivoId`. */
  temBytes: boolean;
  arquivoId: string | null;
  /** JPEG de 320 px da FOTO, ou o próprio PNG da ASSINATURA; null quando só o servidor o tem. */
  miniatura: Blob | null;
}

// --- entrada do PDF da OS (o desenho é do M2-P3) ---

export interface ItemPdfOs {
  codigo: string;
  nome: string;
  unidade: string;
  natureza: NaturezaItem;
  quantidade: number;
}

export interface NotaPdfOs {
  texto: string;
  autorNome: string | null;
  /** Do servidor; na nota ainda pendente, a hora do aparelho. */
  criadaEm: string | null;
}

export interface FotoPdfOs {
  id: string;
  legenda: string | null;
  momento: MomentoFoto | null;
  tiradaEm: string | null;
  /** Data URL (a miniatura, M2P1 final review M4); null se o aparelho não tem a imagem. */
  imagem: string | null;
}

export interface AssinaturaPdfOs {
  anexoId: string;
  /** Data URL do PNG; null se o aparelho não tem a imagem. */
  imagem: string | null;
  nome: string | null;
  papel: string | null;
  assinadaEm: string | null;
}

/** Tudo o que o PDF da OS precisa (spec M2 §8): sem preço, custo nem total. */
export interface EntradaPdfOs {
  empresa: EmpresaPdf;
  logoDataUrl: string | null;
  os: {
    /** `OS-000123` ou `OSP-…`, com `-R<n>` na revisão > 1 (o código impresso e o `codigoExibido` do upload). */
    codigoExibido: string;
    revisao: number;
    tipo: TipoOs;
    rotuloTipo: string;
    urgente: boolean;
    dataPrevista: string | null;
    /** Do servidor; antes dele, a hora do `iniciar` neste aparelho. */
    iniciadaEm: string | null;
    /** Do servidor; na conclusão offline, a hora da emissão. */
    concluidaEm: string | null;
    emitidaEm: string;
    descricao: string | null;
    /** O endereço do serviço em uma linha. */
    endereco: string | null;
    resumoExecucao: string | null;
    /** [srv] Da proposta (M2P1-R25); null na avulsa. */
    propostaNumero: number | null;
    propostaCodigoExibido: string | null;
  };
  /** null se o cliente não está no aparelho. O `documento` é sempre null (M2P2-R8): o PDF da OS não leva o CPF/CNPJ. */
  cliente: ClientePdf | null;
  tecnicoNome: string | null;
  responsavelNome: string | null;
  itens: ItemPdfOs[];
  notas: NotaPdfOs[];
  fotos: FotoPdfOs[];
  assinatura: AssinaturaPdfOs | null;
  /** O motivo da recusa, quando não há assinatura; o PDF imprime "Cliente não assinou: motivo" (M2P3-R5). */
  recusaAssinatura: string | null;
}

/** O que `montarEntradaOs` lê: a OS e o que o repositório já buscou no aparelho. */
export interface FontesPdfOs {
  os: OsLocal;
  cliente: ClienteLocal | null;
  empresa: EmpresaLocal | null;
  logoDataUrl: string | null;
  usuarios: readonly UsuarioResumo[];
  fotos: readonly FotoPdfOs[];
  assinatura: AssinaturaPdfOs | null;
  emitidaEm: string;
  /** Quem emite: o nome dele vale mesmo fora da lista de usuários do aparelho. */
  usuarioAtual?: Pick<UsuarioSessao, 'id' | 'nome'> | null;
}

const EMPRESA_VAZIA: EmpresaPdf = {
  razaoSocial: '', nomeFantasia: null, cnpj: null, endereco: null, telefone: null, email: null, site: null,
  corPrimaria: '#1d4ed8',
};

// --- funções puras ---

/** Como o `texto()` do servidor (`strip()`, vazio → null), com o critério de espaço do Java. */
function texto(v: string | null | undefined): string | null {
  const t = stripJava(v ?? '');
  return t === '' ? null : t;
}

/** `aaaa-mm-dd` de um dia que existe (2026-02-30 não): o `LocalDate` do servidor recusaria. */
function dataValida(d: string): boolean {
  if (!DATA.test(d)) return false;
  const [ano, mes, dia] = d.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).toISOString().slice(0, 10) === d;
}

/** Corta em `max` code points (sem partir um emoji). */
function cortar(t: string, max: number): string {
  const pontos = [...t];
  return pontos.length > max ? pontos.slice(0, max).join('') : t;
}

/** Endereço em uma linha: `Logradouro, nº - compl. - bairro - Cidade/UF - CEP 00000-000`. */
function linhaDoEndereco(e: EnderecoOs): string | null {
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

function enderecoDaOs(os: OsLocal): EnderecoOs {
  return {
    cep: os.enderecoCep, logradouro: os.enderecoLogradouro, numero: os.enderecoNumero, complemento: os.enderecoComplemento,
    bairro: os.enderecoBairro, cidade: os.enderecoCidade, uf: os.enderecoUf,
  };
}

/** O snapshot do endereço, normalizado como o servidor grava (UF em maiúsculas só se for válida). */
function camposDoEndereco(e: EnderecoOs | EnderecoDados | undefined): Pick<OsLocal,
  'enderecoCep' | 'enderecoLogradouro' | 'enderecoNumero' | 'enderecoComplemento' | 'enderecoBairro' | 'enderecoCidade' | 'enderecoUf'> {
  const uf = texto(e?.uf);
  return {
    enderecoCep: texto(e?.cep), enderecoLogradouro: texto(e?.logradouro), enderecoNumero: texto(e?.numero),
    enderecoComplemento: texto(e?.complemento), enderecoBairro: texto(e?.bairro), enderecoCidade: texto(e?.cidade),
    enderecoUf: uf !== null && /^[A-Za-z]{2}$/.test(uf) ? uf.toUpperCase() : uf,
  };
}

/**
 * Técnico: por data prevista ascendente (a normal sem data no fim); no mesmo dia, as urgentes primeiro; depois a
 * atualizada mais recentemente. M2P3-R8: a urgente sem data prevista conta como de `hoje` (`aaaa-mm-dd` em São Paulo),
 * no topo do dia, em vez de ir para o fim. Ordena no lugar.
 */
export function ordenarParaTecnico<T extends Pick<OsLocal, 'id' | 'dataPrevista' | 'urgente' | 'atualizadoEm'>>(
  lista: T[],
  hoje: string = hojeEmSaoPaulo(),
): T[] {
  const instante = (o: T) => (o.atualizadoEm ? Date.parse(o.atualizadoEm) : Number.NEGATIVE_INFINITY);
  const data = (o: T) => o.dataPrevista ?? (o.urgente ? hoje : null);
  return lista.sort((a, b) => {
    const da = data(a);
    const db = data(b);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da < db ? -1 : 1;
    }
    if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
    return instante(b) - instante(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  });
}

/** A entrada do PDF da OS (spec M2 §8), sem ler nada fora de `f`. */
export function montarEntradaOs(f: FontesPdfOs): EntradaPdfOs {
  const { os } = f;
  const nome = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return f.usuarios.find((x) => x.id === id)?.nome ?? (f.usuarioAtual?.id === id ? f.usuarioAtual.nome : null);
  };
  const e = f.empresa;
  const c = f.cliente;
  const enderecoCliente = c ? c.enderecos.find((x) => x.tipo === 'PRINCIPAL') ?? c.enderecos[0] : undefined;
  return {
    empresa: e
      ? {
          razaoSocial: e.razaoSocial, nomeFantasia: e.nomeFantasia, cnpj: e.cnpj, endereco: e.endereco, telefone: e.telefone,
          email: e.email, site: e.site, corPrimaria: e.corPrimaria,
        }
      : { ...EMPRESA_VAZIA },
    logoDataUrl: f.logoDataUrl,
    os: {
      codigoExibido: codigoOsExibido(os),
      revisao: os.revisao ?? 1,
      tipo: os.tipo,
      rotuloTipo: rotuloTipoOs(os.tipo),
      urgente: os.urgente,
      dataPrevista: os.dataPrevista,
      iniciadaEm: os.iniciadaEm ?? os.iniciadaLocalEm ?? null,
      concluidaEm: os.concluidaEm ?? f.emitidaEm,
      emitidaEm: f.emitidaEm,
      descricao: os.descricao,
      endereco: linhaDoEndereco(enderecoDaOs(os)),
      resumoExecucao: os.resumoExecucao,
      propostaNumero: os.propostaNumero,
      propostaCodigoExibido: os.propostaCodigoExibido,
    },
    cliente: c
      ? {
          // M2P2-R8: o PDF da OS nunca leva o CPF/CNPJ do cliente, para nenhum perfil (como o TECNICO, Q14; o snapshot
          // fica imutável no servidor). O CNPJ da própria empresa, no cabeçalho, continua
          nome: c.nome, documento: null, endereco: enderecoCliente ? linhaDoEndereco(enderecoCliente) : null,
          contato: c.contatoNome, telefone: c.telefone, email: c.email,
        }
      : null,
    tecnicoNome: nome(os.tecnicoId),
    responsavelNome: nome(os.responsavelId),
    itens: os.itens.map((i) => ({
      codigo: i.codigo, nome: i.nome, unidade: i.unidade, natureza: i.natureza,
      quantidade: Number(deMilesimos(BigInt(i.quantidadePrevistaMilesimos))),
    })),
    notas: os.notas.map((n) => ({
      texto: n.texto, autorNome: nome(n.autorId ?? n.autorLocalId), criadaEm: n.criadaEm ?? n.criadaLocalEm ?? null,
    })),
    fotos: f.fotos.map((x) => ({ ...x })),
    assinatura: f.assinatura ? { ...f.assinatura } : null,
    recusaAssinatura: f.assinatura === null && os.assinaturaRecusada ? os.motivoRecusa : null,
  };
}

/** O snapshot do DOCUMENTO (≤ 512 KB): a entrada sem as imagens (a logo vai pela referência do arquivo). */
function snapshotDaEntrada(e: EntradaPdfOs, empresa: EmpresaLocal | null): Record<string, unknown> {
  const semImagens = {
    ...e,
    logoDataUrl: undefined,
    fotos: e.fotos.map((x) => ({ ...x, imagem: undefined })),
    assinatura: e.assinatura ? { ...e.assinatura, imagem: undefined } : null,
  };
  const snapshot = JSON.parse(JSON.stringify(semImagens)) as Record<string, unknown>;
  snapshot['logoArquivoId'] = empresa?.logoArquivoId ?? null;
  return snapshot;
}

/** Para a rede: na OS de proposta, `responsavelId` vai null (= manter; M2P1-R18, o servidor segue o da proposta). */
function paraEnvio(os: OsLocal, comandos?: ComandosOs): OsDados {
  const d = dadosDaOs(os, comandos);
  return os.propostaId !== null ? { ...d, responsavelId: null } : d;
}

function mesmasLinhas(a: readonly ItemOsLocal[], b: readonly ItemOsLocal[]): boolean {
  const chave = (l: ItemOsLocal) =>
    [l.id, l.itemCatalogoId, l.codigo, l.nome, l.unidade, l.natureza, l.quantidadePrevistaMilesimos].join('\u0000');
  return a.length === b.length && a.every((l, i) => chave(l) === chave(b[i]));
}

/** Os campos do `EdicaoOs` que diferem entre a OS conhecida e a nova, como o `alterados()` do servidor. */
function camposAlterados(a: OsLocal, b: OsLocal, comandos: ComandosOs = {}): CampoEdicaoOs[] {
  const r: CampoEdicaoOs[] = [];
  const se = (campo: CampoEdicaoOs, condicao: boolean) => condicao && r.push(campo);
  se('propostaId', a.propostaId !== b.propostaId);
  se('clienteId', b.clienteId !== null && b.clienteId !== a.clienteId);
  se('tipo', a.tipo !== b.tipo);
  se('descricao', a.descricao !== b.descricao);
  se('dataPrevista', a.dataPrevista !== b.dataPrevista);
  se('urgente', a.urgente !== b.urgente);
  se('tecnicoId', a.tecnicoId !== b.tecnicoId);
  se('endereco', JSON.stringify(enderecoDaOs(a)) !== JSON.stringify(enderecoDaOs(b)));
  se('itens', !mesmasLinhas(a.itens, b.itens));
  se('concluiProposta', a.concluiProposta !== b.concluiProposta);
  se('resumoExecucao', a.resumoExecucao !== b.resumoExecucao);
  se('assinaturaRecusada', a.assinaturaRecusada !== b.assinaturaRecusada);
  se('motivoRecusa', a.motivoRecusa !== b.motivoRecusa);
  const existentes = new Set(a.notas.map((n) => n.id));
  se('notas', b.notas.some((n) => !existentes.has(n.id)));
  se('responsavelId', b.responsavelId !== null && b.responsavelId !== a.responsavelId);
  se('aceitarTrabalho', comandos.aceitarTrabalho === true);
  return r;
}

/** Na criação, os campos que vêm preenchidos (`preenchidos()` do servidor; `responsavelId` é derivado, nunca). */
function camposPreenchidos(b: OsLocal): CampoEdicaoOs[] {
  const r: CampoEdicaoOs[] = ['tipo'];
  const se = (campo: CampoEdicaoOs, condicao: boolean) => condicao && r.push(campo);
  se('propostaId', b.propostaId !== null);
  se('clienteId', b.clienteId !== null);
  se('descricao', b.descricao !== null);
  se('dataPrevista', b.dataPrevista !== null);
  se('urgente', b.urgente);
  se('tecnicoId', b.tecnicoId !== null);
  se('endereco', Object.values(enderecoDaOs(b)).some((v) => v !== null));
  se('itens', b.itens.length > 0);
  se('concluiProposta', !b.concluiProposta);
  se('resumoExecucao', b.resumoExecucao !== null);
  se('assinaturaRecusada', b.assinaturaRecusada);
  se('motivoRecusa', b.motivoRecusa !== null);
  se('notas', b.notas.length > 0);
  return r;
}

function contexto(novo: OsLocal, temAssinatura: boolean, motivo: string | null = null): ContextoTransicaoOs {
  return {
    temTecnico: novo.tecnicoId !== null,
    resumoExecucao: novo.resumoExecucao,
    temAssinatura,
    assinaturaRecusada: novo.assinaturaRecusada,
    motivoRecusa: novo.motivoRecusa,
    motivo,
  };
}

function checar(e: ErroMutacao | null): void {
  if (e) throw ErroOs.de(e);
}

function validacao(campos: Record<string, string>): void {
  if (Object.keys(campos).length > 0) throw ErroOs.de({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos });
}

/** `QuotaExceededError` do IndexedDB, direto ou embrulhado pelo Dexie (`inner`) ou por outro erro (`cause`). */
function semEspaco(e: unknown): boolean {
  let x = e as { name?: unknown; inner?: unknown; cause?: unknown } | null | undefined;
  for (let i = 0; x && i < 5; i++) {
    if (x.name === 'QuotaExceededError') return true;
    x = (x.inner ?? x.cause) as typeof x;
  }
  return false;
}

/** O que uma edição do `OsRepo` grava (M2P2-R12): a OS nova, a base da mutação e, só nela, os comandos e os [srv]. */
interface EdicaoGravada {
  novo: OsLocal;
  base: number | null;
  comandos?: ComandosOs;
  envio?: Partial<OsLocal>;
}

/** P4c-R15: o que fica travado com um CONFLITO da OS, e o texto da recusa de cada um. */
const ANTES_DE = {
  iniciar: 'iniciá-la',
  concluir: 'concluí-la',
  cancelar: 'cancelá-la',
  reabrir: 'reabri-la',
  atribuir: 'mudar a atribuição',
  aceitarTrabalho: 'aceitar o trabalho',
  regerarPdf: 'gerar o PDF de novo',
} as const;
type AcaoTravada = keyof typeof ANTES_DE;

/**
 * P4c-R15: com um CONFLITO da OS, uma transição, a atribuição ou o aceite entraria na fila atrás da mutação em conflito,
 * e "Usar a do servidor" a apagaria sem aviso. Notas, fotos e o cabeçalho continuam (só se acrescentam ou se editam
 * no aparelho).
 */
function exigirSemConflito(pendencias: readonly Pendencia[], acao: AcaoTravada): void {
  if (pendencias.some((x) => x.tipo === 'CONFLITO')) {
    throw new ErroOs('RESOLVA_A_PENDENCIA', 'os', `Resolva a pendência desta OS antes de ${ANTES_DE[acao]}.`);
  }
}

const encerrada = (s: StatusOs) => s === 'CONCLUIDA' || s === 'CANCELADA';

/** Quem vê a OS (o `AcessoOs.visivel` do servidor): o ADMIN todas, o COMERCIAL as dele, o TECNICO as atribuídas. */
function visivelPara(o: OsLocal, u: UsuarioSessao): boolean {
  return u.perfil === 'ADMIN' || (u.perfil === 'COMERCIAL' ? o.responsavelId : o.tecnicoId) === u.id;
}

/**
 * O `concluidaPorOutro` do `AnexoOsService` sobre o histórico do servidor: a última transição para CONCLUIDA (por data;
 * no empate, a que vem depois na ordem do pull) foi de outro usuário. Os registros sem transição não contam.
 */
function concluidaPorOutro(os: OsLocal, usuarioId: string): boolean {
  let ultima: OsLocal['historico'][number] | undefined;
  for (const h of os.historico) {
    if (h.statusPara !== 'CONCLUIDA' || h.statusDe === 'CONCLUIDA') continue;
    if (!ultima || h.em >= ultima.em) ultima = h;
  }
  return !!ultima && ultima.usuarioId !== usuarioId;
}

/**
 * Há assinatura para concluir: a aceita pelo servidor ou uma colhida neste aparelho ainda não enviada (sai na fila
 * antes do concluir). A colhida com a OS encerrada (M2P1-R26) é evidência e só existe com a OS já encerrada aqui.
 */
function temAssinatura(os: OsLocal, locais: readonly AnexoOsLocal[]): boolean {
  return os.assinaturaAnexoId !== null || locais.some((a) => a.tipo === 'ASSINATURA' && !a.enviado);
}

/**
 * OS no aparelho (offline-first), a única porta das telas: cada escrita grava o local e enfileira a mutação `os` (ou o
 * upload do anexo) na outbox, na mesma transação. As regras de perfil, status e campos são conferidas aqui antes de
 * gravar, com as mesmas funções que espelham o servidor (`validarMutacaoOs`: a transição primeiro, a edição só se ela
 * aceitar, M2P1-R13) e os mesmos códigos e campos; o servidor confere de novo e prevalece. Recusas lançam `ErroOs`.
 *
 * A ordem da fila de uma OS é a ordem dos fatos (FIFO do agregado): criação/edição, `iniciar` (separada), notas,
 * fotos, assinatura, `concluir` (separada) e o PDF. Os uploads saem depois da mutação que deixou a OS no status que
 * o servidor exige, e a versão é rebaseada pelo `versaoOs` de cada resposta (P4b-R9/R24).
 *
 * Carregado sob demanda: só as telas do M2-P3 o importam (o bundle inicial não leva código de OS além do sync).
 */
@Injectable({ providedIn: 'root' })
export class OsRepo {
  private readonly db = inject(RegeraDb);
  private readonly sync = inject(SyncService);
  private readonly auth = inject(AuthService);
  private readonly pdf = inject(PdfService);
  private readonly arquivos = inject(ArquivosService);
  private readonly preparar = inject(PREPARAR_FOTO);
  private readonly reduzir = inject(MINIATURA_FOTO);
  /** Uma foto de cada vez (pico de memória da decodificação; limite de 20 conferido na ordem). */
  private filaDeFotos: Promise<unknown> = Promise.resolve();

  // ------------------------------------------------------------------ leitura

  /** ADMIN: todas; COMERCIAL: as dele (responsável); TECNICO: as atribuídas. Por `atualizadoEm` desc. */
  observarTodas(): Observable<OsLocal[]> {
    return observar(async () => {
      const u = this.auth.usuario();
      if (!u) return [];
      return ordenarPorAtualizacao((await this.db.os.toArray()).filter((o) => visivelPara(o, u)));
    });
  }

  /**
   * M2P2-R18: as OS do cliente que o perfil vê (a mesma regra do `observarTodas`), por `atualizadoEm` desc: a lista
   * "Ordens de serviço" do cliente.
   */
  observarDoCliente(clienteId: string): Observable<OsLocal[]> {
    return observar(async () => {
      const u = this.auth.usuario();
      if (!u) return [];
      const doCliente = await this.db.os.where('clienteId').equals(clienteId).toArray();
      return ordenarPorAtualizacao(doCliente.filter((o) => visivelPara(o, u)));
    });
  }

  /** As atribuídas ao técnico, por data prevista (sem data no fim) e urgentes primeiro no mesmo dia. */
  observarDoTecnico(usuarioId: string): Observable<OsLocal[]> {
    return observar(async () => ordenarParaTecnico(await this.db.os.where('tecnicoId').equals(usuarioId).toArray()));
  }

  /** As OS da proposta, por `atualizadoEm` desc. */
  observarDaProposta(propostaId: string): Observable<OsLocal[]> {
    return observar(async () => ordenarPorAtualizacao(await this.db.os.where('propostaId').equals(propostaId).toArray()));
  }

  /** A OS, reemitida a cada escrita (local ou do pull); undefined se ela sai do aparelho. */
  observarOs(id: string): Observable<OsLocal | undefined> {
    return observar(() => this.db.os.get(id));
  }

  buscar(id: string): Promise<OsLocal | undefined> {
    return this.db.os.get(id);
  }

  /** As pendências da OS (as das mutações e as dos uploads, que levam o id dela), das mais antigas às novas. */
  observarPendencias(id: string): Observable<Pendencia[]> {
    return observar(async () =>
      (await this.pendenciasDa(id)).sort((a, b) => a.criadaEm.localeCompare(b.criadaEm)),
    );
  }

  /**
   * Os anexos da OS: os do servidor (`anexos`, que chegaram pelo sync) e os do aparelho (ainda não enviados, ou
   * enviados com a miniatura), por momento da captura. O do aparelho completa o do servidor (miniatura, bytes).
   */
  observarAnexos(osId: string): Observable<AnexoOsVisivel[]> {
    return observar(async () => {
      const doServidor = (await this.db.os.get(osId))?.anexos ?? [];
      const locais = await this.db.anexosOs.where('osId').equals(osId).toArray();
      // M2P2-R16: só as chaves de `anexosOsBytes` (os bytes completos não são lidos a cada emissão)
      const comBytes = new Set(await this.db.anexosOsBytes.where('id').anyOf(locais.map((a) => a.id)).primaryKeys());
      const porId = new Map<string, AnexoOsVisivel>();
      for (const a of doServidor) {
        porId.set(a.id, {
          id: a.id, tipo: a.tipo, legenda: a.legenda, momento: a.momento, tiradaEm: a.tiradaEm ?? a.criadoEm,
          assinanteNome: a.assinanteNome, assinantePapel: a.assinantePapel, revisaoOs: a.revisaoOs,
          codigoExibido: a.codigoExibido, enviado: true, temBytes: false, arquivoId: a.arquivoId, miniatura: null,
        });
      }
      for (const a of locais) {
        const s = porId.get(a.id);
        porId.set(a.id, {
          id: a.id, tipo: a.tipo, legenda: a.legenda, momento: a.momento, tiradaEm: a.tiradaEm ?? s?.tiradaEm ?? null,
          assinanteNome: a.assinanteNome, assinantePapel: a.assinantePapel, revisaoOs: a.revisaoOs,
          codigoExibido: a.codigoExibido, enviado: a.enviado || !!s, temBytes: comBytes.has(a.id),
          arquivoId: a.arquivoId ?? s?.arquivoId ?? null,
          miniatura: a.miniatura ? new Blob([a.miniatura], { type: MIME[a.tipo] }) : null,
        });
      }
      const instante = (a: AnexoOsVisivel) => (a.tiradaEm ? Date.parse(a.tiradaEm) : Number.POSITIVE_INFINITY);
      return [...porId.values()].sort((a, b) => instante(a) - instante(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    });
  }

  /** Os bytes completos do anexo guardados no aparelho (JPEG, PNG ou PDF); null se só o servidor os tem. */
  async blobDoAnexo(anexoId: string): Promise<Blob | null> {
    const a = await this.db.anexosOs.get(anexoId);
    const b = a ? await this.db.anexosOsBytes.get(anexoId) : undefined;
    return a && b ? new Blob([b.bytes], { type: MIME[a.tipo] }) : null;
  }

  /** Os selos de sync, como o de propostas: na outbox, com pendência e com CONFLITO (ids de agregado). */
  observarEstadoSync(): Observable<EstadoSync> {
    return observar(async () => {
      const pendencias = await this.db.pendencias.toArray();
      return {
        naOutbox: new Set((await this.db.outbox.toArray()).map((m) => m.agregadoId)),
        comPendencia: new Set(pendencias.map((p) => p.agregadoId)),
        comConflito: new Set(pendencias.filter((p) => p.tipo === 'CONFLITO').map((p) => p.agregadoId)),
      };
    });
  }

  // ------------------------------------------------------------------ criação

  /**
   * OS da proposta APROVADA ou EM_EXECUCAO, pelo ADMIN ou pelo COMERCIAL responsável dela. Copia, sem nenhum valor:
   * - as linhas, como *snapshot* (`codigo`, `nome`, `unidade`, `natureza`, quantidade → `quantidadePrevista`, ordem),
   *   cada uma com UUID novo (o servidor recusa id de linha de outra OS). Linha de item do catálogo inativo ou que
   *   não está neste aparelho vai sem o vínculo (`itemCatalogoId` null): a linha nova com item inativo ou inexistente
   *   seria recusada. A natureza ausente vem do catálogo (ou PRODUTO);
   * - o endereço principal do cliente (ou o primeiro), como *snapshot*;
   * - a descrição: as observações e o prazo de execução da proposta (cortada em 4.000), ou a `opcoes.descricao`
   *   revisada na tela (M2P2-R17; acima de 4.000, `VALIDACAO` em `descricao`);
   * - o tipo derivado (VENDA → ENTREGA, SERVICO → SERVICO, MANUTENCAO → MANUTENCAO, LOCACAO → ENTREGA), que
   *   `opcoes.tipo` troca.
   * O responsável é o da proposta (no aparelho; vai null na rede, M2P1-R18). Devolve o id.
   */
  async gerarDaProposta(propostaId: string, opcoes: OpcoesGerarOs = {}): Promise<string> {
    const u = this.usuario();
    const proposta = await this.db.propostas.get(propostaId);
    if (!proposta) throw new ErroOs('NAO_ENCONTRADA', 'propostaId', 'Proposta não encontrada neste aparelho.');
    const cliente = proposta.clienteId === null ? undefined : await this.db.clientes.get(proposta.clienteId);
    const itens: ItemOsLocal[] = [];
    for (const [i, l] of proposta.itens.entries()) {
      const catalogo = await this.db.itens.get(l.itemCatalogoId);
      itens.push({
        id: uuidv7(),
        // a linha é nova para o servidor, que recusa o vínculo com item inativo ou inexistente: só vai com o ativo
        itemCatalogoId: catalogo?.ativo ? l.itemCatalogoId : null,
        codigo: texto(l.codigo) ?? '',
        nome: texto(l.nome) ?? '',
        unidade: texto(l.unidade) ?? '',
        natureza: l.natureza ?? catalogo?.natureza ?? 'PRODUTO',
        quantidadePrevistaMilesimos: l.quantidadeMilesimos,
        ordem: i,
      });
    }
    const prazo = texto(proposta.prazoExecucao);
    const descricao = opcoes.descricao !== undefined ? texto(opcoes.descricao) : texto(cortar(
      [texto(proposta.observacoes), prazo && `Prazo de execução: ${prazo}`].filter((x) => !!x).join('\n\n'), MAX_DESCRICAO,
    ));
    const os = this.nova({
      propostaId,
      clienteId: proposta.clienteId,
      responsavelId: proposta.responsavelId,
      tipo: opcoes.tipo ?? TIPO_DA_PROPOSTA[proposta.tipo],
      tecnicoId: opcoes.tecnicoId ?? null,
      dataPrevista: opcoes.dataPrevista ?? null,
      urgente: opcoes.urgente ?? false,
      concluiProposta: opcoes.concluiProposta ?? true,
      descricao,
      ...camposDoEndereco(cliente?.enderecos.find((e) => e.tipo === 'PRINCIPAL') ?? cliente?.enderecos[0]),
      itens,
    });
    this.exigirMutacao(null, os, u, contexto(os, false));
    const campos: Record<string, string> = {};
    if (proposta.status !== 'APROVADA' && proposta.status !== 'EM_EXECUCAO') {
      campos['propostaId'] = 'A proposta precisa estar aprovada ou em execução.';
    } else if (proposta.clienteId === null) {
      campos['clienteId'] = 'A proposta não tem cliente.';
    }
    validacao({ ...campos, ...(await this.validarCampos(null, os)) });
    await this.criar(os);
    return os.id;
  }

  /**
   * OS sem proposta (Q6), pelo ADMIN ou pelo COMERCIAL, que fica como responsável. O cliente tem de estar no aparelho;
   * o endereço é o `enderecoId` (a posição na lista do cliente) ou o principal. Devolve o id.
   */
  async criarAvulsa(nova: NovaOsAvulsa): Promise<string> {
    const u = this.usuario();
    const cliente = await this.db.clientes.get(nova.clienteId);
    const endereco = nova.enderecoId === undefined
      ? cliente?.enderecos.find((e) => e.tipo === 'PRINCIPAL') ?? cliente?.enderecos[0]
      : cliente?.enderecos[nova.enderecoId];
    const os = this.nova({
      propostaId: null,
      clienteId: nova.clienteId,
      responsavelId: u.id,
      tipo: nova.tipo,
      tecnicoId: nova.tecnicoId ?? null,
      dataPrevista: nova.dataPrevista ?? null,
      urgente: nova.urgente ?? false,
      concluiProposta: true,
      descricao: texto(nova.descricao),
      ...camposDoEndereco(endereco),
      itens: [],
    });
    this.exigirMutacao(null, os, u, contexto(os, false));
    const campos: Record<string, string> = {};
    if (!cliente) campos['clienteId'] = 'Cliente não encontrado neste aparelho.';
    else if (nova.enderecoId !== undefined && !endereco) campos['enderecoId'] = 'Endereço não encontrado.';
    validacao({ ...campos, ...(await this.validarCampos(null, os)) });
    await this.criar(os);
    return os.id;
  }

  // ------------------------------------------------------------------ edição

  /**
   * Edição do cabeçalho: valida por status e perfil como o `EdicaoOs` do servidor (ABERTA: ADMIN e COMERCIAL
   * responsável alteram tudo; EM_ANDAMENTO: só data, urgência e técnico; `concluiProposta` também pelo técnico em
   * andamento, Q21). O técnico novo tem de ser TECNICO ativo. versaoCarregada: a versão que a tela carregou (base para
   * o servidor detectar conflito).
   */
  async salvarCabecalho(id: string, edicao: Partial<EdicaoCabecalhoOs>, versaoCarregada?: number | null): Promise<void> {
    const u = this.usuario();
    await this.gravar(id, async (atual) => {
      const novo: OsLocal = {
        ...atual,
        ...(edicao.tipo !== undefined ? { tipo: edicao.tipo } : {}),
        ...(edicao.descricao !== undefined ? { descricao: texto(edicao.descricao) } : {}),
        ...(edicao.dataPrevista !== undefined ? { dataPrevista: edicao.dataPrevista } : {}),
        ...(edicao.urgente !== undefined ? { urgente: edicao.urgente } : {}),
        ...(edicao.tecnicoId !== undefined ? { tecnicoId: edicao.tecnicoId } : {}),
        ...(edicao.concluiProposta !== undefined ? { concluiProposta: edicao.concluiProposta } : {}),
        ...(edicao.endereco !== undefined ? camposDoEndereco(edicao.endereco) : {}),
        ...(edicao.itens !== undefined
          ? {
              itens: edicao.itens.map((l, ordem) => ({
                id: l.id, itemCatalogoId: l.itemCatalogoId, codigo: texto(l.codigo) ?? '', nome: texto(l.nome) ?? '',
                unidade: texto(l.unidade) ?? '', natureza: l.natureza, quantidadePrevistaMilesimos: l.quantidadePrevistaMilesimos,
                ordem,
              })),
            }
          : {}),
      };
      this.exigirMutacao(atual, novo, u, contexto(novo, await this.temAssinatura(atual)));
      validacao(await this.validarCampos(atual, novo));
      const version = versaoCarregada !== undefined ? versaoCarregada : atual.version;
      return { novo: { ...novo, version }, base: version };
    });
  }

  /**
   * Atribuição: o técnico (ADMIN ou COMERCIAL responsável, em ABERTA ou EM_ANDAMENTO; TECNICO ativo; em andamento não
   * fica sem técnico) e o responsável (só o ADMIN, por um ADMIN ou COMERCIAL ativo, e só na avulsa: a OS de proposta
   * segue o da proposta, M2P1-R18). Sem mudança, não grava nada. Com um CONFLITO da OS, `RESOLVA_A_PENDENCIA`.
   */
  async atribuir(
    id: string,
    mudanca: { tecnicoId?: string | null; responsavelId?: string },
    versaoCarregada?: number | null,
  ): Promise<void> {
    const u = this.usuario();
    await this.gravar(id, async (atual) => {
      const tecnicoId = mudanca.tecnicoId !== undefined ? mudanca.tecnicoId : atual.tecnicoId;
      const responsavelId = mudanca.responsavelId ?? atual.responsavelId;
      if (tecnicoId === atual.tecnicoId && responsavelId === atual.responsavelId) return null;
      const novo: OsLocal = { ...atual, tecnicoId, responsavelId };
      this.exigirMutacao(atual, novo, u, contexto(novo, await this.temAssinatura(atual)));
      const campos: Record<string, string> = {};
      if (responsavelId !== atual.responsavelId) {
        if (atual.propostaId !== null) {
          campos['responsavelId'] = 'O responsável segue o da proposta.';
        } else if (responsavelId === null || !(await this.usuarioAtivo(responsavelId, ['ADMIN', 'COMERCIAL']))) {
          campos['responsavelId'] = 'Responsável inválido: escolha um administrador ou comercial ativo.';
        }
      }
      validacao({ ...campos, ...(await this.validarCampos(atual, novo)) });
      const version = versaoCarregada !== undefined ? versaoCarregada : atual.version;
      return { novo: { ...novo, version }, base: version };
    }, { semConflito: 'atribuir' });
  }

  // ------------------------------------------------------------------ execução

  /**
   * ABERTA → EM_ANDAMENTO (mutação separada), pelo técnico atribuído ou pelo ADMIN; exige técnico. Marca
   * `iniciadaLocalEm` (só no aparelho), para o PDF de uma conclusão offline mostrar o início.
   */
  async iniciar(id: string): Promise<void> {
    const u = this.usuario();
    await this.gravar(id, async (atual) => {
      if (atual.status !== 'ABERTA') {
        this.exigirPosse(atual, u);
        throw new ErroOs('TRANSICAO_INVALIDA', 'os', 'Só uma OS aberta pode ser iniciada.');
      }
      const novo: OsLocal = { ...atual, status: 'EM_ANDAMENTO', iniciadaLocalEm: new Date().toISOString() };
      this.exigirMutacao(atual, novo, u, contexto(novo, await this.temAssinatura(atual)));
      validacao(await this.validarCampos(atual, novo));
      return { novo, base: atual.version };
    }, { separada: true, semConflito: 'iniciar' });
  }

  /**
   * Nota do diário: só acrescenta (M2-R1), de 1 a 2.000 code points depois do `strip` (M2P1-R7). Quem pode, pela
   * matriz: todos em ABERTA e EM_ANDAMENTO; em CONCLUIDA, o ADMIN e o técnico atribuído; em CANCELADA, só o técnico
   * (M2P1-R26). `autorId` e `criadaEm` são do servidor: vão null; o aparelho mostra a nota pendente com quem a
   * escreveu e quando (`autorLocalId`, `criadaLocalEm`), sem mandar isso. Devolve o id da nota.
   */
  async adicionarNota(id: string, textoNota: string): Promise<string> {
    const u = this.usuario();
    const nota: NotaOsLocal = {
      id: uuidv7(), texto: stripJava(textoNota ?? ''), autorId: null, criadaEm: null, autorLocalId: u.id,
      criadaLocalEm: new Date().toISOString(),
    };
    await this.gravar(id, async (atual) => {
      const novo: OsLocal = { ...atual, notas: [...atual.notas, nota] };
      this.exigirMutacao(atual, novo, u, contexto(novo, await this.temAssinatura(atual)));
      const campo = `notas[${novo.notas.length - 1}].texto`;
      const tamanho = tamanhoTextoOs(nota.texto);
      if (tamanho === 0) validacao({ [campo]: 'Escreva a nota.' });
      if (tamanho > MAX_NOTA) validacao({ [campo]: `Máximo de ${MAX_NOTA} caracteres.` });
      return { novo, base: atual.version };
    });
    return nota.id;
  }

  /**
   * Foto: `prepararFoto` (1.600 px, JPEG 0,75, miniatura de 320 px) e, numa transação Dexie só, o anexo em `anexosOs`
   * e o upload na fila, que sai depois da mutação que deixou a OS em andamento. Uma de cada vez: chamadas simultâneas
   * (uma seleção múltipla) esperam a anterior. Quem: o técnico atribuído ou o ADMIN, em EM_ANDAMENTO; o técnico
   * atribuído também em CONCLUIDA e CANCELADA (M2P1-R26, evidência). No máximo 20 por OS. Sem espaço no IndexedDB,
   * `SEM_ESPACO`. Devolve o id do anexo.
   */
  adicionarFoto(id: string, arquivo: Blob, opcoes: OpcoesFoto = {}): Promise<string> {
    const vez = this.filaDeFotos.then(() => this.gravarFoto(id, arquivo, opcoes));
    this.filaDeFotos = vez.catch(() => undefined);
    return vez;
  }

  /**
   * Assinatura colhida (o PNG do `AssinaturaCanvas.paraPng()`): o anexo ASSINATURA (com nome, papel e a hora, que vai
   * como `assinadaEm`) e o upload, numa transação. O PNG fica também como miniatura, para o PDF de uma reemissão
   * offline. Em andamento, zera a recusa local; a assinatura aceita só chega com o upload. Com a OS encerrada
   * (M2P1-R26) é evidência: o registro da OS não muda (M6). No máximo 10 por OS. Devolve o id do anexo.
   */
  async assinar(id: string, assinatura: AssinaturaColhida): Promise<string> {
    const u = this.usuario();
    const atual = await this.carregar(id);
    this.exigirAnexoDeCampo(atual, u);
    const nome = texto(assinatura.nome);
    const papel = texto(assinatura.papel);
    const campos: Record<string, string> = {};
    const tamanhoNome = tamanhoTextoOs(nome);
    if (tamanhoNome === 0) campos['assinanteNome'] = 'Informe o nome de quem assina.';
    else if (tamanhoNome < ASSINANTE_NOME_MIN || tamanhoNome > ASSINANTE_NOME_MAX) {
      campos['assinanteNome'] = `O nome tem de ${ASSINANTE_NOME_MIN} a ${ASSINANTE_NOME_MAX} caracteres.`;
    }
    if (tamanhoTextoOs(papel) > ASSINANTE_PAPEL_MAX) campos['assinantePapel'] = `Máximo de ${ASSINANTE_PAPEL_MAX} caracteres.`;
    validacao(campos);
    if (assinatura.png.bytes.byteLength > ASSINATURA_MAX_BYTES) {
      throw new ErroOs('ASSINATURA_GRANDE', 'assinatura', 'A assinatura ficou grande demais. Limpe e assine de novo.');
    }
    await this.exigirLimite(atual, 'ASSINATURA');
    const anexo = this.anexo(id, 'ASSINATURA', assinatura.png.sha256, {
      assinanteNome: nome, assinantePapel: papel, miniatura: assinatura.png.bytes,
    });
    try {
      await this.db.transaction('rw', [this.db.os, this.db.anexosOs, this.db.anexosOsBytes, this.db.outbox], async () => {
        const agora = await this.carregar(id);
        this.exigirAnexoDeCampo(agora, u);
        await this.exigirLimite(agora, 'ASSINATURA');
        if (agora.status === 'EM_ANDAMENTO' && (agora.assinaturaRecusada || agora.motivoRecusa !== null)) {
          await this.db.os.put({ ...agora, assinaturaRecusada: false, motivoRecusa: null });
        }
        await this.db.anexosOs.add(anexo);
        await this.db.anexosOsBytes.add({ id: anexo.id, bytes: assinatura.png.bytes });
        await this.sync.registrarUploadAnexoOs(id, anexo.id);
      });
    } catch (e) {
      if (semEspaco(e)) throw new ErroOs('SEM_ESPACO', 'assinatura', 'Pouco espaço no aparelho para gravar a assinatura.');
      throw e;
    }
    void this.sync.sincronizar();
    return anexo.id;
  }

  /**
   * Recusa (ou ausência) de quem assinaria, com o motivo (3 a 500): UPSERT com `assinaturaRecusada` e `motivoRecusa`.
   * Com uma assinatura já colhida (aceita, ou na fila), `ASSINATURA_COLHIDA`: no servidor ela prevalece (M2P1-R10).
   */
  async recusarAssinatura(id: string, motivo: string): Promise<void> {
    const u = this.usuario();
    await this.gravar(id, async (atual) => {
      const novo: OsLocal = { ...atual, assinaturaRecusada: true, motivoRecusa: texto(motivo) };
      const assinada = await this.temAssinatura(atual);
      this.exigirMutacao(atual, novo, u, contexto(novo, assinada));
      if (assinada) throw new ErroOs('ASSINATURA_COLHIDA', 'assinatura', 'A assinatura já foi colhida.');
      validacao(await this.validarCampos(atual, novo));
      return { novo, base: atual.version };
    });
  }

  /**
   * Conclusão (EM_ANDAMENTO → CONCLUIDA), pelo técnico atribuído ou pelo ADMIN, nesta ordem:
   * 1. confere o resumo (3 a 4.000) e a assinatura (aceita ou na fila) ou a recusa com motivo, como o servidor;
   * 2. monta a entrada (`montarEntradaOs`, com a OS já concluída) e gera o PDF com `gerarPdf` (o desenho é do M2-P3);
   *    recusa o snapshot acima de 512 KB antes de gerar e o PDF acima de 10 MB depois;
   * 3. numa transação Dexie só: a OS local concluída, o UPSERT separado CONCLUIDA, o anexo DOCUMENTO (`codigoExibido`
   *    de `codigoOsExibido`, `revisaoOs` = revisão da OS e o snapshot) e o upload dele, que sai por último;
   * 4. dispara a sincronização e devolve o Blob e o código impresso nele.
   * `precisaVoltar` (Q21) desmarca `concluiProposta` na própria mutação; sem ele, o valor da OS fica (o do escritório).
   * P4b-R21: se o que o PDF mostra mudou durante a geração (o ack que traz o número, um anexo novo), gera de novo, até
   * 3 vezes (`OS_ALTERADA`). M2P2-R9: um upload aceito no meio-tempo (versão e `enviado`) não conta; a conclusão vai
   * sobre a versão de agora.
   * Com um CONFLITO da OS, `RESOLVA_A_PENDENCIA`, antes de gerar e na transação.
   */
  async concluir(
    id: string,
    resumo: string,
    gerarPdf: (entrada: EntradaPdfOs) => Promise<Blob>,
    opcoes: OpcoesConcluir = {},
  ): Promise<{ blob: Blob; codigoExibido: string }> {
    const u = this.usuario();
    for (let tentativa = 1; ; tentativa++) {
      const atual = await this.carregar(id);
      if (atual.status === 'CONCLUIDA') {
        this.exigirPosse(atual, u);
        throw new ErroOs('OS_JA_CONCLUIDA', 'os', 'Esta OS já foi concluída.');
      }
      const locais = await this.anexosLocais(id);
      const novo: OsLocal = {
        ...atual,
        status: 'CONCLUIDA',
        resumoExecucao: texto(resumo),
        concluiProposta: opcoes.precisaVoltar ? false : atual.concluiProposta,
      };
      this.exigirMutacao(atual, novo, u, contexto(novo, temAssinatura(atual, locais)));
      validacao(await this.validarCampos(atual, novo));
      exigirSemConflito(await this.pendenciasDa(id), 'concluir');
      await this.exigirLimite(atual, 'DOCUMENTO');
      const { blob, documento, bytes } = await this.gerarDocumento(novo, locais, u, gerarPdf);
      let gravou: boolean;
      try {
        gravou = await this.db.transaction('rw', [this.db.os, this.db.anexosOs, this.db.anexosOsBytes, this.db.outbox, this.db.pendencias], async () => {
          exigirSemConflito(await this.pendenciasDa(id), 'concluir');
          // o PDF foi gerado fora da transação: se o conteúdo dele mudou (a OS ou um anexo novo), ele não a representa
          // mais. M2P2-R9: um upload aceito nesse meio-tempo só muda a versão e o `enviado`, e o PDF continua valendo
          const agora = await this.db.os.get(id);
          if (!agora || chaveDoPdf(agora, await this.anexosLocais(id)) !== chaveDoPdf(atual, locais)) return false;
          // sobre o registro de agora (a versão e os anexos do upload aceito), com a mesma conclusão
          const concluida: OsLocal = {
            ...agora, status: novo.status, resumoExecucao: novo.resumoExecucao, concluiProposta: novo.concluiProposta,
            atualizadoEm: new Date().toISOString(),
          };
          await this.db.os.put(concluida);
          await this.sync.registrar('os', id, 'UPSERT', paraEnvio(concluida), agora.version, { separada: true });
          await this.db.anexosOs.add(documento);
          await this.db.anexosOsBytes.add(bytes);
          await this.sync.registrarUploadAnexoOs(id, documento.id);
          return true;
        });
      } catch (e) {
        if (semEspaco(e)) throw new ErroOs('SEM_ESPACO', 'os', 'Pouco espaço no aparelho para gravar o PDF.');
        throw e;
      }
      if (gravou) {
        void this.sync.sincronizar();
        return { blob, codigoExibido: documento.codigoExibido! };
      }
      if (tentativa >= TENTATIVAS_CONCLUIR) {
        throw new ErroOs('OS_ALTERADA', 'os', 'A OS mudou enquanto o PDF era gerado. Conclua de novo.');
      }
    }
  }

  /**
   * M2P2-R18: "Gerar PDF novamente" de uma OS CONCLUIDA no aparelho, depois de `ANEXO_AUSENTE`, de
   * `CODIGO_EXIBIDO_INVALIDO` (o OSP- trocado, a numeração que chegou) ou do PDF que se perdeu. Pela mesma montagem e
   * pelo mesmo padrão do `concluir`:
   * - exige a posse; a OS CONCLUIDA no aparelho; nenhum CONFLITO dela (`RESOLVA_A_PENDENCIA`); do TECNICO, que o
   *   servidor não diga que outro usuário concluiu (`OS_CONCLUIDA_POR_OUTRO`: a pendência do PDF recusado com esse
   *   código, ou o histórico do servidor, se a conclusão dele não está mais na fila);
   * - gera o PDF da revisão atual (`montarEntradaOs`), com o snapshot e os limites do `concluir`;
   * - numa transação: tira o DOCUMENTO desta revisão ainda não enviado ou recusado (o anexo, os bytes, o upload na
   *   fila e a pendência) e grava o novo com o upload, que sai atrás do que já está na fila. Sem UPSERT: a OS não muda.
   *   O upload trocado em voo dá `OS_SINCRONIZANDO`. O DOCUMENTO de outra revisão fica, com a pendência dele;
   * - P4b-R21: se o que o PDF mostra mudou durante a geração, gera de novo (até 3 vezes, `OS_ALTERADA`).
   * Devolve o Blob e o código impresso nele.
   */
  async regerarPdf(id: string, gerarPdf: (entrada: EntradaPdfOs) => Promise<Blob>): Promise<{ blob: Blob; codigoExibido: string }> {
    const u = this.usuario();
    for (let tentativa = 1; ; tentativa++) {
      const atual = await this.carregar(id);
      this.exigirPosse(atual, u);
      if (atual.status !== 'CONCLUIDA') {
        throw new ErroOs('STATUS_INVALIDO', 'os', 'Só uma OS concluída tem o PDF para gerar de novo.');
      }
      await this.exigirPdfPossivel(atual, u);
      const locais = await this.anexosLocais(id);
      const trocados = new Set(this.pdfsATrocar(atual, locais).map((a) => a.id));
      await this.exigirLimite(atual, 'DOCUMENTO', trocados);
      const { blob, documento, bytes } = await this.gerarDocumento(atual, locais, u, gerarPdf);
      let gravou: boolean;
      try {
        gravou = await this.db.transaction('rw', [this.db.os, this.db.anexosOs, this.db.anexosOsBytes, this.db.outbox, this.db.pendencias], async () => {
          const agora = await this.db.os.get(id);
          if (!agora || agora.status !== 'CONCLUIDA') return false;
          await this.exigirPdfPossivel(agora, u);
          const deAgora = await this.anexosLocais(id);
          if (chaveDoPdf(agora, deAgora) !== chaveDoPdf(atual, locais)) return false;
          const sair = this.pdfsATrocar(agora, deAgora).map((a) => a.id);
          const doUpload = (m: MutacaoLocal) =>
            m.entidade === TIPO_UPLOAD_ANEXO_OS && sair.includes((m.dados as DadosUploadAnexoOs | null)?.anexoId ?? '');
          const naFila = (await this.db.outbox.where('agregadoId').equals(id).toArray()).filter(doUpload);
          if (naFila.some((m) => m.enviando)) {
            throw new ErroOs('OS_SINCRONIZANDO', 'os', 'O PDF anterior está sendo enviado. Tente de novo em instantes.');
          }
          await this.db.outbox.bulkDelete(naFila.map((m) => m.seq!));
          await this.db.pendencias.bulkDelete((await this.pendenciasDa(id)).filter((x) => doUpload(x.mutacao)).map((x) => x.mutationId));
          await this.db.anexosOs.bulkDelete(sair);
          await this.db.anexosOsBytes.bulkDelete(sair);
          await this.db.anexosOs.add(documento);
          await this.db.anexosOsBytes.add(bytes);
          await this.sync.registrarUploadAnexoOs(id, documento.id);
          return true;
        });
      } catch (e) {
        if (semEspaco(e)) throw new ErroOs('SEM_ESPACO', 'os', 'Pouco espaço no aparelho para gravar o PDF.');
        throw e;
      }
      if (gravou) {
        void this.sync.sincronizar();
        return { blob, codigoExibido: documento.codigoExibido! };
      }
      if (tentativa >= TENTATIVAS_CONCLUIR) {
        throw new ErroOs('OS_ALTERADA', 'os', 'A OS mudou enquanto o PDF era gerado. Gere de novo.');
      }
    }
  }

  // ------------------------------------------------------------------ encerramento e exceções

  /** → CANCELADA (separada), com o motivo (3 a 500): ADMIN e COMERCIAL responsável em ABERTA; só o ADMIN em andamento. */
  async cancelar(id: string, motivo: string): Promise<void> {
    const u = this.usuario();
    await this.gravar(id, async (atual) => {
      if (atual.status === 'CANCELADA') {
        // mesmo status: a transição aceitaria, e a fila levaria uma mutação vazia
        this.exigirPosse(atual, u);
        throw new ErroOs('TRANSICAO_INVALIDA', 'os', 'Esta OS já está cancelada.');
      }
      const motivoLimpo = texto(motivo);
      const novo: OsLocal = { ...atual, status: 'CANCELADA', motivoCancelamento: motivoLimpo };
      this.exigirMutacao(atual, novo, u, contexto(novo, await this.temAssinatura(atual), motivoLimpo));
      validacao(await this.validarCampos(atual, novo));
      return { novo, base: atual.version };
    }, { separada: true, semConflito: 'cancelar' });
  }

  /**
   * CONCLUIDA → EM_ANDAMENTO (separada), só pelo ADMIN, com o motivo (3 a 500), que vai como o comando
   * `motivoReabertura` só nesta mutação. A revisão sobe e a conclusão sai já no aparelho, como no servidor (M2P1-R3):
   * o PDF de uma nova conclusão offline sai com o `-R<n>` certo. São [srv]: a mutação leva os valores do servidor.
   * Só a OS concluída: em outro status a transição seria outra (de ABERTA, um início, que mexe na proposta).
   */
  async reabrir(id: string, motivo: string): Promise<void> {
    const u = this.usuario();
    await this.gravar(id, async (atual) => {
      if (atual.status !== 'CONCLUIDA') {
        this.exigirPosse(atual, u);
        throw new ErroOs('TRANSICAO_INVALIDA', 'os', 'Só uma OS concluída pode ser reaberta.');
      }
      const motivoLimpo = texto(motivo);
      const novo: OsLocal = { ...atual, status: 'EM_ANDAMENTO', revisao: (atual.revisao ?? 1) + 1, concluidaEm: null };
      this.exigirMutacao(atual, novo, u, contexto(novo, await this.temAssinatura(atual), motivoLimpo));
      return {
        novo, base: atual.version, comandos: { motivoReabertura: motivoLimpo },
        envio: { revisao: atual.revisao, concluidaEm: atual.concluidaEm },
      };
    }, { separada: true, semConflito: 'reabrir' });
  }

  /**
   * M2-R4: o ADMIN aceita o trabalho de uma OS cuja proposta foi cancelada: o servidor reabre a proposta.
   * O comando `aceitarTrabalho` vai só nesta mutação (separada, para uma edição seguinte não o apagar ao coalescer) e
   * nunca fica no registro. Os outros perfis recebem `ACESSO_NEGADO`.
   *
   * Recusado no aparelho onde o servidor não teria efeito (o `EfeitoOsNaProposta` ignora o comando em silêncio):
   * - a proposta não está CANCELADA. RECUSADA também fica de fora: só se cria OS em proposta APROVADA ou EM_EXECUCAO,
   *   e nenhuma das duas chega a RECUSADA, então o servidor nunca reabre uma recusada;
   * - a OS é avulsa (sem proposta);
   * - a própria OS está CANCELADA (`OS_CANCELADA`). O servidor decide pelas OS não canceladas da proposta: sem nenhuma,
   *   não há trabalho a aceitar; com outra em curso, o aceite é dela.
   */
  async aceitarTrabalho(id: string): Promise<void> {
    const u = this.usuario();
    await this.gravar(id, async (atual) => {
      if (u.perfil !== 'ADMIN') {
        throw new ErroOs('ACESSO_NEGADO', 'os', 'Só o administrador aceita o trabalho de uma proposta cancelada.');
      }
      if (atual.propostaId === null) throw new ErroOs('PROPOSTA_NAO_CANCELADA', 'os', 'Esta OS não é de uma proposta.');
      const proposta = await this.db.propostas.get(atual.propostaId);
      if (!proposta) {
        throw new ErroOs('NAO_ENCONTRADA', 'os', 'A proposta não está neste aparelho. Sincronize e tente de novo.');
      }
      if (proposta.status !== 'CANCELADA') {
        throw new ErroOs('PROPOSTA_NAO_CANCELADA', 'os', 'Só há trabalho a aceitar com a proposta cancelada.');
      }
      if (atual.status === 'CANCELADA') {
        throw new ErroOs('OS_CANCELADA', 'os', 'Esta OS foi cancelada: não há trabalho dela a aceitar.');
      }
      const comandos: ComandosOs = { aceitarTrabalho: true };
      this.exigirMutacao(atual, atual, u, contexto(atual, await this.temAssinatura(atual)), comandos);
      return { novo: atual, base: atual.version, comandos };
    }, { separada: true, semConflito: 'aceitarTrabalho' });
  }

  /**
   * Exclui a OS, como o DELETE do servidor: só ABERTA e sem técnico (com técnico, cancela-se: ele pode estar
   * trabalhando offline), pelo ADMIN ou pelo COMERCIAL responsável. Numa transação: apaga a OS local, os anexos locais
   * e as pendências dela, tira os uploads dela da fila e enfileira o DELETE (que, se ela nunca chegou ao servidor, só
   * esvazia a fila). Com uma mutação dela em voo, `OS_SINCRONIZANDO` (a resposta pode trazer o número).
   */
  async excluir(id: string): Promise<void> {
    const u = this.usuario();
    const atual = await this.carregar(id);
    if (u.perfil === 'TECNICO') throw new ErroOs('ACESSO_NEGADO', 'os', 'O técnico não exclui OS.');
    this.exigirPosse(atual, u);
    if (atual.status !== 'ABERTA') throw new ErroOs('OS_NAO_EDITAVEL', 'os', 'Só uma OS aberta pode ser excluída.');
    if (atual.tecnicoId !== null) throw new ErroOs('OS_NAO_EDITAVEL', 'os', 'Cancele a OS em vez de excluir.');
    await this.db.transaction('rw', [this.db.os, this.db.anexosOs, this.db.anexosOsBytes, this.db.outbox, this.db.pendencias], async () => {
      const fila = await this.db.outbox.where('agregadoId').equals(id).toArray();
      if (fila.some((m) => m.enviando)) {
        throw new ErroOs('OS_SINCRONIZANDO', 'os', 'A OS está sendo sincronizada. Tente de novo em instantes.');
      }
      await this.db.outbox.bulkDelete(fila.filter(ehUpload).map((m) => m.seq!));
      await this.db.anexosOsBytes.bulkDelete(await this.db.anexosOs.where('osId').equals(id).primaryKeys());
      await this.db.anexosOs.where('osId').equals(id).delete();
      await this.db.pendencias.where('agregadoId').equals(id).delete();
      await this.db.os.delete(id);
      await this.sync.registrar('os', id, 'DELETE', null, atual.version);
    });
    void this.sync.sincronizar();
  }

  // ------------------------------------------------------------------ internos

  private usuario(): UsuarioSessao {
    const u = this.auth.usuario();
    if (!u) throw new ErroOs('ACESSO_NEGADO', 'os', 'Entre de novo para alterar OS.');
    return u;
  }

  private async carregar(id: string): Promise<OsLocal> {
    const os = await this.db.os.get(id);
    if (!os) throw new ErroOs('NAO_ENCONTRADA', 'os', 'OS não encontrada neste aparelho.');
    return os;
  }

  private anexosLocais(osId: string): Promise<AnexoOsLocal[]> {
    return this.db.anexosOs.where('osId').equals(osId).toArray();
  }

  private pendenciasDa(id: string): Promise<Pendencia[]> {
    return this.db.pendencias.where('agregadoId').equals(id).toArray();
  }

  /** Os DOCUMENTO da revisão atual ainda não enviados (na fila ou recusados): o `regerarPdf` os troca. */
  private pdfsATrocar(os: OsLocal, locais: readonly AnexoOsLocal[]): AnexoOsLocal[] {
    const revisao = os.revisao ?? 1;
    return locais.filter((a) => a.tipo === 'DOCUMENTO' && !a.enviado && (a.revisaoOs ?? 1) === revisao);
  }

  /**
   * O `regerarPdf` pode gerar: sem CONFLITO da OS e, para o TECNICO, sem o servidor dizer que outro usuário a concluiu
   * (o PDF dele voltaria 403 `OS_CONCLUIDA_POR_OUTRO`, M2P1-R28/R29). O histórico só vale se a conclusão deste aparelho
   * não está mais na fila (com ela na fila, a última conclusão no servidor vai ser a dele).
   */
  private async exigirPdfPossivel(os: OsLocal, u: UsuarioSessao): Promise<void> {
    const pendencias = await this.pendenciasDa(os.id);
    exigirSemConflito(pendencias, 'regerarPdf');
    if (u.perfil !== 'TECNICO') return;
    const recusado = pendencias.some((x) => x.erro?.codigo === 'OS_CONCLUIDA_POR_OUTRO');
    const concluirNaFila = [...(await this.db.outbox.where('agregadoId').equals(os.id).toArray()), ...pendencias.map((x) => x.mutacao)]
      .some((m) => m.entidade === 'os' && (m.dados as OsDados | null)?.status === 'CONCLUIDA');
    if (recusado || (!concluirNaFila && concluidaPorOutro(os, u.id))) {
      throw new ErroOs('OS_CONCLUIDA_POR_OUTRO', 'os', 'Esta OS foi concluída pelo escritório.');
    }
  }

  private async temAssinatura(os: OsLocal): Promise<boolean> {
    return temAssinatura(os, await this.anexosLocais(os.id));
  }

  /** A OS nova no aparelho (sem versão, código `OSP-` novo, revisão 1, ABERTA), com os campos dados. */
  private nova(campos: Pick<OsLocal, 'propostaId' | 'clienteId' | 'responsavelId' | 'tipo' | 'tecnicoId' | 'dataPrevista'
    | 'urgente' | 'concluiProposta' | 'descricao' | 'itens' | 'enderecoCep' | 'enderecoLogradouro' | 'enderecoNumero'
    | 'enderecoComplemento' | 'enderecoBairro' | 'enderecoCidade' | 'enderecoUf'>): OsLocal {
    return {
      id: uuidv7(),
      version: null,
      codigoProvisorio: gerarCodigoProvisorioOs(),
      numero: null,
      revisao: 1,
      propostaNumero: null,
      propostaCodigoExibido: null,
      status: 'ABERTA',
      iniciadaEm: null,
      concluidaEm: null,
      resumoExecucao: null,
      motivoCancelamento: null,
      assinaturaAnexoId: null,
      assinanteNome: null,
      assinantePapel: null,
      assinadaEm: null,
      assinaturaRecusada: false,
      motivoRecusa: null,
      notas: [],
      anexos: [],
      historico: [],
      atualizadoEm: null,
      ...campos,
    };
  }

  /**
   * `validarMutacaoOs` (a transição primeiro, a edição só se ela aceitar, M2P1-R13) sobre o estado local: `atual` null
   * = criação (posse pelo responsável derivado e pelo técnico informado, campos preenchidos).
   */
  private exigirMutacao(atual: OsLocal | null, novo: OsLocal, u: UsuarioSessao, ctx: ContextoTransicaoOs, comandos?: ComandosOs): void {
    const posse = atual ?? novo;
    const campos = atual ? camposAlterados(atual, novo, comandos) : camposPreenchidos(novo);
    checar(validarMutacaoOs(atual?.status ?? null, novo.status, u.perfil, posse.responsavelId === u.id,
      posse.tecnicoId === u.id, ctx, campos));
  }

  /** Só a posse (`ACESSO_NEGADO`), como a primeira regra do `EdicaoOs`. */
  private exigirPosse(os: OsLocal, u: UsuarioSessao): void {
    checar(validarEdicaoOs(os.status, os.status, u.perfil, os.responsavelId === u.id, os.tecnicoId === u.id, []));
  }

  /**
   * FOTO e ASSINATURA, como o `AnexoOsService`: o COMERCIAL nunca; o TECNICO só a OS atribuída a ele; em EM_ANDAMENTO,
   * e o TECNICO também em CONCLUIDA e CANCELADA (M2P1-R26).
   */
  private exigirAnexoDeCampo(os: OsLocal, u: UsuarioSessao): void {
    if (u.perfil === 'COMERCIAL') {
      throw new ErroOs('ACESSO_NEGADO', 'os', 'Só o técnico atribuído ou o administrador envia fotos e assinatura.');
    }
    if (u.perfil === 'TECNICO' && os.tecnicoId !== u.id) {
      throw new ErroOs('ACESSO_NEGADO', 'os', 'Você só altera as OS atribuídas a você.');
    }
    if (os.status !== 'EM_ANDAMENTO' && !(u.perfil === 'TECNICO' && encerrada(os.status))) {
      throw new ErroOs('STATUS_INVALIDO', 'os', 'Fotos e assinatura só com a OS em andamento.');
    }
  }

  /**
   * O limite do tipo (20 fotos, 10 assinaturas, 20 PDFs), contando os do servidor e os do aparelho, menos os `ignorar`
   * (os que o `regerarPdf` troca).
   */
  private async exigirLimite(os: OsLocal, tipo: TipoAnexoOs, ignorar: ReadonlySet<string> = new Set()): Promise<void> {
    const ids = new Set([
      ...os.anexos.filter((a) => a.tipo === tipo).map((a) => a.id),
      ...(await this.anexosLocais(os.id)).filter((a) => a.tipo === tipo).map((a) => a.id),
    ].filter((x) => !ignorar.has(x)));
    const limite = LIMITE[tipo];
    if (ids.size >= limite.max) throw new ErroOs(limite.codigo, tipo === 'DOCUMENTO' ? 'os' : tipo.toLowerCase(), limite.mensagem);
  }

  /** Os metadados de um anexo novo (os bytes vão à parte, em `anexosOsBytes`, M2P2-R16). */
  private anexo(osId: string, tipo: TipoAnexoOs, sha256: string, extra: Partial<AnexoOsLocal> = {}): AnexoOsLocal {
    return {
      id: uuidv7(), osId, tipo, sha256, legenda: null, momento: null, tiradaEm: new Date().toISOString(),
      assinanteNome: null, assinantePapel: null, revisaoOs: null, codigoExibido: null, miniatura: null,
      enviado: false, arquivoId: null, ...extra,
    };
  }

  private async gravarFoto(id: string, arquivo: Blob, opcoes: OpcoesFoto): Promise<string> {
    const u = this.usuario();
    const atual = await this.carregar(id);
    this.exigirAnexoDeCampo(atual, u);
    const legenda = texto(opcoes.legenda);
    if (tamanhoTextoOs(legenda) > MAX_LEGENDA) validacao({ legenda: `Máximo de ${MAX_LEGENDA} caracteres.` });
    await this.exigirLimite(atual, 'FOTO');
    const foto = await this.preparar(arquivo);
    const anexo = this.anexo(id, 'FOTO', foto.sha256, {
      legenda, momento: opcoes.momento ?? null, miniatura: foto.miniatura,
    });
    try {
      await this.db.transaction('rw', [this.db.os, this.db.anexosOs, this.db.anexosOsBytes, this.db.outbox], async () => {
        const agora = await this.carregar(id);
        this.exigirAnexoDeCampo(agora, u);
        await this.exigirLimite(agora, 'FOTO');
        await this.db.anexosOs.add(anexo);
        await this.db.anexosOsBytes.add({ id: anexo.id, bytes: foto.bytes });
        await this.sync.registrarUploadAnexoOs(id, anexo.id);
      });
    } catch (e) {
      if (semEspaco(e)) throw new ErroOs('SEM_ESPACO', 'foto', 'Pouco espaço no aparelho para mais fotos.');
      throw e;
    }
    void this.sync.sincronizar();
    return anexo.id;
  }

  /** Está na lista de usuários do aparelho, com um dos perfis e ativo (linha antiga sem `ativo` conta como ativa). */
  private async usuarioAtivo(id: string, perfis: readonly Perfil[]): Promise<boolean> {
    const x = await this.db.usuarios.get(id);
    return !!x && perfis.includes(x.perfil) && x.ativo !== false;
  }

  /**
   * Os limites de conteúdo do servidor (`validarCabecalho` e `validarLinhas` do `OsSyncHandler`), com os mesmos nomes
   * de campo: técnico (TECNICO ativo quando muda; obrigatório em andamento), data, textos em code points, endereço,
   * motivo da recusa e linhas. `atual` null = criação.
   */
  private async validarCampos(atual: OsLocal | null, novo: OsLocal): Promise<Record<string, string>> {
    const campos: Record<string, string> = {};
    if (novo.tecnicoId !== null) {
      if ((atual === null || novo.tecnicoId !== atual.tecnicoId) && !(await this.usuarioAtivo(novo.tecnicoId, ['TECNICO']))) {
        campos['tecnicoId'] = 'Técnico inválido: escolha um técnico ativo.';
      }
    } else if (novo.status === 'EM_ANDAMENTO') {
      campos['tecnicoId'] = 'A OS em andamento precisa de um técnico.';
    }
    if (novo.dataPrevista !== null && !dataValida(novo.dataPrevista)) campos['dataPrevista'] = 'Data inválida.';
    if (tamanhoTextoOs(novo.descricao) > MAX_DESCRICAO) campos['descricao'] = `Máximo de ${MAX_DESCRICAO} caracteres.`;
    for (const [campo, max] of ENDERECO_MAX) {
      if (tamanhoTextoOs(novo[campo] as string | null) > max) campos[campo] = `Máximo de ${max} caracteres.`;
    }
    if (novo.enderecoUf !== null && !/^[A-Z]{2}$/.test(novo.enderecoUf)) campos['enderecoUf'] = 'UF inválida.';
    if (tamanhoTextoOs(novo.resumoExecucao) > MAX_RESUMO) campos['resumoExecucao'] = `Máximo de ${MAX_RESUMO} caracteres.`;
    if (novo.motivoRecusa !== null && !textoOsValido(novo.motivoRecusa, MOTIVO_MIN_OS, MOTIVO_MAX_OS)) {
      campos['motivoRecusa'] = `O motivo da recusa tem de ${MOTIVO_MIN_OS} a ${MOTIVO_MAX_OS} caracteres.`;
    }
    if (novo.itens.length > MAX_ITENS) campos['itens'] = `Máximo de ${MAX_ITENS} itens.`;
    const existentes = new Map((atual?.itens ?? []).map((l) => [l.id, l]));
    const ids = new Set<string>();
    for (const [i, l] of novo.itens.entries()) {
      const pre = `itens[${i}].`;
      if (ids.has(l.id)) {
        campos[pre + 'id'] = 'Linha repetida.';
        continue;
      }
      ids.add(l.id);
      for (const [campo, max, falta] of [
        ['codigo', MAX_CODIGO, 'Informe o código.'], ['nome', MAX_NOME, 'Informe o nome.'], ['unidade', MAX_UNIDADE, 'Informe a unidade.'],
      ] as const) {
        const n = tamanhoTextoOs(l[campo]);
        if (n === 0) campos[pre + campo] = falta;
        else if (n > max) campos[pre + campo] = `Máximo de ${max} caracteres.`;
      }
      if (!Number.isSafeInteger(l.quantidadePrevistaMilesimos) || l.quantidadePrevistaMilesimos < 1
        || l.quantidadePrevistaMilesimos > QUANTIDADE_MAX_MILESIMOS) {
        campos[pre + 'quantidadePrevista'] = 'A quantidade vai de 0,001 a 999.999,999.';
      }
      // como o servidor: o catálogo só é conferido na linha nova (ou que trocou de item); fora do aparelho, ele decide
      const anterior = existentes.get(l.id);
      if (l.itemCatalogoId !== null && (!anterior || anterior.itemCatalogoId !== l.itemCatalogoId)) {
        const catalogo = await this.db.itens.get(l.itemCatalogoId);
        if (catalogo && !catalogo.ativo) campos[pre + 'itemCatalogoId'] = 'Item do catálogo inativo ou não encontrado.';
      }
    }
    return campos;
  }

  /**
   * M2P1-R17: no máximo 200 notas novas por mutação. As notas coalescem numa mutação só; se a que receberia esta
   * passaria do teto (contando as que nenhuma mutação anterior da fila leva), a OS vai numa mutação nova, separada.
   */
  private async estouraNotas(os: OsLocal): Promise<boolean> {
    const fila = await this.db.outbox.where('agregadoId').equals(os.id).toArray();
    const ultima = fila.at(-1);
    const coalesce = !!ultima && !ultima.enviando && !ultima.separada && ultima.entidade === 'os';
    const anteriores = (coalesce ? fila.slice(0, -1) : fila).filter((m: MutacaoLocal) => m.entidade === 'os');
    const naFila = new Set(anteriores.flatMap((m) => ((m.dados as OsDados | null)?.notas ?? []).map((n) => n.id)));
    return os.notas.filter((n) => n.criadaEm === null && !naFila.has(n.id)).length > MAX_NOTAS_NOVAS;
  }

  /**
   * M2P2-R12: lê a OS, aplica `editar` (que valida e devolve a edição, ou null se nada muda), grava o local e enfileira o
   * UPSERT, tudo na mesma transação, com `atualizadoEm` otimista (P4b-R19). Assim um rebase da fila que o sync grave
   * no meio-tempo (o OK de uma mutação anterior) não é desfeito por uma cópia lida antes dele: a edição é sempre sobre o
   * registro de agora, como o `concluir` faz com o `agora`.
   * `separada`: não coalesce (transição, comando); `semConflito`: recusa se a OS tem um CONFLITO (P4c-R15). Na edição,
   * `comandos` vão só nesta mutação, nunca no registro; `envio` são campos [srv] que a mutação leva com o valor do
   * servidor em vez do local (o `reabrir` sobe a revisão só no aparelho).
   */
  private async gravar(
    id: string,
    editar: (atual: OsLocal) => Promise<EdicaoGravada | null>,
    opcoes: { separada?: boolean; semConflito?: AcaoTravada } = {},
  ): Promise<void> {
    const tabelas = [this.db.os, this.db.outbox, this.db.pendencias, this.db.anexosOs, this.db.usuarios, this.db.itens, this.db.propostas];
    await this.db.transaction('rw', tabelas, async () => {
      const e = await editar(await this.carregar(id));
      if (e) await this.enfileirar(e, opcoes);
    });
    void this.sync.sincronizar();
  }

  /** A criação (já validada): a OS nova e o UPSERT sem base, numa transação. */
  private async criar(os: OsLocal): Promise<void> {
    await this.db.transaction('rw', [this.db.os, this.db.outbox, this.db.pendencias], () => this.enfileirar({ novo: os, base: null }));
    void this.sync.sincronizar();
  }

  /** Grava o local e enfileira o UPSERT; roda na transação de quem chama. */
  private async enfileirar(e: EdicaoGravada, opcoes: { separada?: boolean; semConflito?: AcaoTravada } = {}): Promise<void> {
    if (opcoes.semConflito) exigirSemConflito(await this.pendenciasDa(e.novo.id), opcoes.semConflito);
    const local: OsLocal = { ...e.novo, atualizadoEm: new Date().toISOString() };
    const separada = opcoes.separada || (await this.estouraNotas(local));
    await this.db.os.put(local);
    await this.sync.registrar('os', local.id, 'UPSERT', paraEnvio({ ...local, ...e.envio }, e.comandos), e.base,
      separada ? { separada: true } : {});
  }

  /**
   * O PDF da OS `os` (já concluída) como está, sem gravar nada: monta a entrada com o que o aparelho tem (cliente,
   * empresa, logo, usuários, fotos e assinatura), recusa o snapshot acima de 512 KB antes de gerar e o PDF acima de
   * 10 MB depois (o upload voltaria 413), e calcula o SHA-256 dos bytes.
   */
  private async gerarDocumento(
    os: OsLocal,
    locais: readonly AnexoOsLocal[],
    u: UsuarioSessao,
    gerarPdf: (entrada: EntradaPdfOs) => Promise<Blob>,
  ): Promise<{ blob: Blob; documento: AnexoOsLocal; bytes: BytesAnexoOs }> {
    const cliente = os.clienteId === null ? undefined : await this.db.clientes.get(os.clienteId);
    const empresa = (await this.db.empresa.get(ID_EMPRESA)) ?? null;
    const emitidaEm = new Date().toISOString();
    const entrada = montarEntradaOs({
      os,
      cliente: cliente ?? null,
      empresa,
      logoDataUrl: await this.pdf.logoDataUrl(empresa),
      usuarios: await this.db.usuarios.toArray(),
      fotos: await this.fotosDoPdf(os, locais),
      assinatura: await this.assinaturaDoPdf(os, locais),
      emitidaEm,
      usuarioAtual: u,
    });
    const snapshot = snapshotDaEntrada(entrada, empresa);
    if (new TextEncoder().encode(JSON.stringify(snapshot)).length > SNAPSHOT_MAX_BYTES) {
      throw new ErroOs('SNAPSHOT_GRANDE', 'os', 'Os dados desta OS passam do limite do documento (512 KB).');
    }
    const blob = await gerarPdf(entrada);
    const bytes = await paraBytes(blob);
    if (bytes.byteLength > PDF_MAX_BYTES) {
      throw new ErroOs('PDF_GRANDE', 'os', 'O PDF passou de 10 MB.');
    }
    const documento = this.anexo(os.id, 'DOCUMENTO', await sha256Hex(bytes), {
      tiradaEm: emitidaEm, revisaoOs: os.revisao ?? 1, codigoExibido: entrada.os.codigoExibido,
    });
    return { blob, documento, bytes: { id: documento.id, bytes, snapshot } };
  }

  /**
   * As fotos para o PDF, por momento da captura: as do servidor e as do aparelho. A imagem é a miniatura (o PDF fica
   * pequeno, e é o que o aparelho guarda depois do upload); sem ela, os bytes; só do servidor, a imagem baixada sem
   * cache e reduzida ao tamanho da miniatura (M2P2-R10, R14: `imagemDoServidor`), nunca em tamanho cheio. As do
   * servidor vêm `DOWNLOADS_SIMULTANEOS` por vez: cada uma é baixada e reduzida antes de a mesma vez pegar a próxima, o
   * que limita a memória a duas fotos cheias; a ordem do PDF é a de sempre.
   */
  private async fotosDoPdf(os: OsLocal, locais: readonly AnexoOsLocal[]): Promise<FotoPdfOs[]> {
    const doAparelho = new Map(locais.filter((a) => a.tipo === 'FOTO').map((a) => [a.id, a]));
    const fotos: { quando: number; foto: FotoPdfOs }[] = [];
    const instante = (t: string | null) => (t ? Date.parse(t) : Number.POSITIVE_INFINITY);
    const doServidor = os.anexos.filter((x) => x.tipo === 'FOTO' && !doAparelho.has(x.id));
    const imagens: (ArrayBuffer | null)[] = new Array(doServidor.length).fill(null);
    let proxima = 0;
    const vez = async () => {
      for (let i = proxima++; i < doServidor.length; i = proxima++) imagens[i] = await this.imagemDoServidor(os.id, doServidor[i]);
    };
    await Promise.all(Array.from({ length: Math.min(DOWNLOADS_SIMULTANEOS, doServidor.length) }, vez));
    for (const [i, a] of doServidor.entries()) {
      const bytes = imagens[i];
      fotos.push({
        quando: instante(a.tiradaEm ?? a.criadoEm),
        foto: { id: a.id, legenda: a.legenda, momento: a.momento, tiradaEm: a.tiradaEm, imagem: bytes ? paraDataUrl(bytes, MIME.FOTO) : null },
      });
    }
    for (const a of doAparelho.values()) {
      const bytes = a.miniatura ?? (await this.db.anexosOsBytes.get(a.id))?.bytes;
      fotos.push({
        quando: instante(a.tiradaEm),
        foto: { id: a.id, legenda: a.legenda, momento: a.momento, tiradaEm: a.tiradaEm, imagem: bytes ? paraDataUrl(bytes, MIME.FOTO) : null },
      });
    }
    return fotos
      .sort((a, b) => a.quando - b.quando || (a.foto.id < b.foto.id ? -1 : a.foto.id > b.foto.id ? 1 : 0))
      .map((x) => x.foto);
  }

  /**
   * M2P2-R14: a imagem de um anexo que só o servidor tem, para o PDF: a FOTO reduzida à miniatura (M2P2-R10) ou o PNG
   * da ASSINATURA. Baixada com `baixarSemCache` (só online), nunca pelo cache `arquivos`: o arquivo cheio do servidor
   * não fica no aparelho (Q18, disco). O que vai para o PDF fica como a miniatura de uma linha `enviado` de `anexosOs`,
   * sem bytes, que sai com a OS (tombstone, troca de dono, descartes); assim a reemissão offline ainda tem a imagem, e
   * a galeria a mostra. Só grava se a OS ainda está no aparelho com o anexo. null offline, sem sessão, com erro do
   * servidor ou se a foto não abre (o PDF sai só com a legenda).
   */
  private async imagemDoServidor(osId: string, a: AnexoOsServidor): Promise<ArrayBuffer | null> {
    let imagem: Blob;
    try {
      imagem = await this.arquivos.baixarSemCache(a.arquivoId);
    } catch {
      return null; // sem internet, sem sessão ou o servidor recusou: o PDF sai sem a imagem
    }
    let miniatura: ArrayBuffer;
    try {
      miniatura = a.tipo === 'FOTO' ? await this.reduzir(imagem) : await paraBytes(imagem);
    } catch (e) {
      // a foto não abre: o PDF sai só com a legenda, e a causa fica para o suporte de campo
      console.warn(e);
      return null;
    }
    await this.db.transaction('rw', [this.db.os, this.db.anexosOs], async () => {
      const os = await this.db.os.get(osId);
      if (!os?.anexos.some((x) => x.id === a.id) || (await this.db.anexosOs.get(a.id))) return;
      await this.db.anexosOs.add({
        id: a.id, osId, tipo: a.tipo, sha256: a.sha256, legenda: a.legenda, momento: a.momento, tiradaEm: a.tiradaEm,
        assinanteNome: a.assinanteNome, assinantePapel: a.assinantePapel, revisaoOs: a.revisaoOs, codigoExibido: a.codigoExibido,
        miniatura, enviado: true, arquivoId: a.arquivoId,
      });
    });
    return miniatura;
  }

  /**
   * A assinatura do PDF: a última colhida neste aparelho e ainda não enviada (sai antes do concluir na fila); senão, a
   * aceita pelo servidor, com a imagem do aparelho ou baixada sem cache (`imagemDoServidor`). Sem nenhuma, null (vale
   * a recusa).
   */
  private async assinaturaDoPdf(os: OsLocal, locais: readonly AnexoOsLocal[]): Promise<AssinaturaPdfOs | null> {
    // a miniatura da assinatura é o próprio PNG (`assinar`)
    const imagem = async (a: AnexoOsLocal | undefined) => {
      const bytes = a ? a.miniatura ?? (await this.db.anexosOsBytes.get(a.id))?.bytes : undefined;
      return bytes ? paraDataUrl(bytes, MIME.ASSINATURA) : null;
    };
    const pendente = locais
      .filter((a) => a.tipo === 'ASSINATURA' && !a.enviado)
      .sort((a, b) => (a.tiradaEm ?? '').localeCompare(b.tiradaEm ?? ''))
      .at(-1);
    if (pendente) {
      return { anexoId: pendente.id, imagem: await imagem(pendente), nome: pendente.assinanteNome, papel: pendente.assinantePapel,
        assinadaEm: pendente.tiradaEm };
    }
    if (os.assinaturaAnexoId === null) return null;
    const local = locais.find((a) => a.id === os.assinaturaAnexoId);
    const doServidor: AnexoOsServidor | undefined = os.anexos.find((a) => a.id === os.assinaturaAnexoId);
    const doDownload = !local && doServidor ? await this.imagemDoServidor(os.id, doServidor) : null;
    return {
      anexoId: os.assinaturaAnexoId,
      imagem: (await imagem(local)) ?? (doDownload ? paraDataUrl(doDownload, MIME.ASSINATURA) : null),
      nome: os.assinanteNome,
      papel: os.assinantePapel,
      assinadaEm: os.assinadaEm,
    };
  }
}

/**
 * O que o PDF da OS lê dela, para o P4b-R21 do `concluir` (M2P2-R9): tudo menos a versão e o que um upload aceito muda
 * sem mudar o conteúdo, isto é, o `enviado` e a lista de anexos do servidor (conta o conjunto de ids, do servidor e do
 * aparelho) e a assinatura aceita espelhada do mesmo anexo, que no PDF sai igual à que estava na fila.
 */
const FORA_DO_PDF: ReadonlySet<string> = new Set([
  'version', 'anexos', 'assinaturaAnexoId', 'assinanteNome', 'assinantePapel', 'assinadaEm',
]);

function chaveDoPdf(os: OsLocal, locais: readonly AnexoOsLocal[]): string {
  const campos = Object.entries(os).filter(([k]) => !FORA_DO_PDF.has(k)).sort(([a], [b]) => a.localeCompare(b));
  const anexos = [...new Set([...os.anexos.map((a) => a.id), ...locais.map((a) => a.id)])].sort();
  return JSON.stringify([campos, anexos]);
}
