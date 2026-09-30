import { normalizarBusca } from '../../core/util/formatos';
import { uuidv7 } from '../../core/util/uuid';

export type TipoProposta = 'VENDA' | 'SERVICO' | 'MANUTENCAO' | 'LOCACAO';
export type TipoBloco = 'CABECALHO' | 'TEXTO' | 'ITENS' | 'TOTAIS' | 'ASSINATURA' | 'QUEBRA_PAGINA';
export type ColunaItens =
  | 'codigo' | 'descricao' | 'quantidade' | 'unidade' | 'precoUnitario' | 'desconto' | 'meses' | 'subtotal';
export type Assinante = 'EMPRESA' | 'CLIENTE';

export const TIPOS_PROPOSTA: readonly { valor: TipoProposta; rotulo: string }[] = [
  { valor: 'VENDA', rotulo: 'Venda' },
  { valor: 'SERVICO', rotulo: 'Serviço' },
  { valor: 'MANUTENCAO', rotulo: 'Manutenção' },
  { valor: 'LOCACAO', rotulo: 'Locação' },
];

export const TIPOS_BLOCO: readonly { valor: TipoBloco; rotulo: string }[] = [
  { valor: 'CABECALHO', rotulo: 'Cabeçalho' },
  { valor: 'TEXTO', rotulo: 'Texto' },
  { valor: 'ITENS', rotulo: 'Itens' },
  { valor: 'TOTAIS', rotulo: 'Totais' },
  { valor: 'ASSINATURA', rotulo: 'Assinatura' },
  { valor: 'QUEBRA_PAGINA', rotulo: 'Quebra de página' },
];

export const COLUNAS_ITENS: readonly { valor: ColunaItens; rotulo: string }[] = [
  { valor: 'codigo', rotulo: 'Código' },
  { valor: 'descricao', rotulo: 'Descrição' },
  { valor: 'quantidade', rotulo: 'Qtd.' },
  { valor: 'unidade', rotulo: 'Un.' },
  { valor: 'precoUnitario', rotulo: 'Preço unit.' },
  { valor: 'desconto', rotulo: 'Desc.' },
  { valor: 'meses', rotulo: 'Meses' },
  { valor: 'subtotal', rotulo: 'Subtotal' },
];

export const ASSINANTES: readonly { valor: Assinante; rotulo: string }[] = [
  { valor: 'EMPRESA', rotulo: 'Empresa (contratada)' },
  { valor: 'CLIENTE', rotulo: 'Cliente (contratante)' },
];

/** Lista fechada de variáveis (§9.2), com os mesmos nomes do BlocosValidator do servidor. */
export const VARIAVEIS: readonly { nome: string; rotulo: string }[] = [
  { nome: 'empresa.nome', rotulo: 'Nome da empresa' },
  { nome: 'empresa.cnpj', rotulo: 'CNPJ da empresa' },
  { nome: 'empresa.telefone', rotulo: 'Telefone da empresa' },
  { nome: 'empresa.email', rotulo: 'E-mail da empresa' },
  { nome: 'empresa.endereco', rotulo: 'Endereço da empresa' },
  { nome: 'cliente.nome', rotulo: 'Nome do cliente' },
  { nome: 'cliente.documento', rotulo: 'CPF/CNPJ do cliente' },
  { nome: 'cliente.endereco', rotulo: 'Endereço do cliente' },
  { nome: 'cliente.contato', rotulo: 'Contato do cliente' },
  { nome: 'cliente.telefone', rotulo: 'Telefone do cliente' },
  { nome: 'cliente.email', rotulo: 'E-mail do cliente' },
  { nome: 'proposta.numero', rotulo: 'Número da proposta' },
  { nome: 'proposta.revisao', rotulo: 'Revisão da proposta' },
  { nome: 'proposta.tipo', rotulo: 'Tipo da proposta' },
  { nome: 'proposta.data', rotulo: 'Data da proposta' },
  { nome: 'proposta.validade', rotulo: 'Validade da proposta' },
  { nome: 'proposta.total', rotulo: 'Total da proposta' },
  { nome: 'proposta.condicoes_pagamento', rotulo: 'Condições de pagamento' },
  { nome: 'proposta.prazo_execucao', rotulo: 'Prazo de execução' },
  { nome: 'proposta.observacoes', rotulo: 'Observações' },
  { nome: 'responsavel.nome', rotulo: 'Nome do responsável' },
  { nome: 'responsavel.email', rotulo: 'E-mail do responsável' },
];

export interface TiptapMarca {
  type: string;
}

export interface TiptapNo {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNo[];
  text?: string;
  marks?: TiptapMarca[];
}

export interface TiptapDoc {
  type: 'doc';
  content?: TiptapNo[];
}

export interface ConfigCabecalho {
  mostrarLogo: boolean;
  mostrarDadosEmpresa: boolean;
  titulo: string;
}
export interface ConfigTexto {
  conteudo: TiptapDoc;
}
export interface ConfigItens {
  colunas: ColunaItens[];
  agruparPorNatureza: boolean;
}
export interface ConfigTotais {
  mostrarDescontos: boolean;
}
export interface ConfigAssinatura {
  assinantes: Assinante[];
}
export type ConfigQuebraPagina = Record<string, never>;

export type Bloco =
  | { id: string; tipo: 'CABECALHO'; config: ConfigCabecalho }
  | { id: string; tipo: 'TEXTO'; config: ConfigTexto }
  | { id: string; tipo: 'ITENS'; config: ConfigItens }
  | { id: string; tipo: 'TOTAIS'; config: ConfigTotais }
  | { id: string; tipo: 'ASSINATURA'; config: ConfigAssinatura }
  | { id: string; tipo: 'QUEBRA_PAGINA'; config: ConfigQuebraPagina };

/** Formato do template no sync (`template_proposta`). Blocos de tipo desconhecido vindos do pull são preservados. */
export interface TemplateDados {
  nome: string;
  tipoProposta: TipoProposta;
  padrao: boolean;
  ativo: boolean;
  blocos: Bloco[];
}

export interface TemplateLocal extends TemplateDados {
  id: string;
  version: number | null;
  nomeBusca: string;
}

export function paraTemplateLocal(id: string, version: number | null, dados: TemplateDados): TemplateLocal {
  return {
    nome: dados.nome,
    tipoProposta: dados.tipoProposta,
    padrao: dados.padrao ?? false,
    ativo: dados.ativo ?? true,
    blocos: dados.blocos ?? [],
    id,
    version,
    nomeBusca: normalizarBusca(dados.nome),
  };
}

export function dadosDoTemplate(t: TemplateLocal): TemplateDados {
  return { nome: t.nome, tipoProposta: t.tipoProposta, padrao: t.padrao, ativo: t.ativo, blocos: t.blocos };
}

/**
 * O padrão que vale para o tipo, sem desmarcar ninguém localmente (se a mutação de B fosse rejeitada e descartada,
 * A ficaria desmarcado para sempre). Candidatos: templates do tipo com `padrao && ativo`.
 * - Algum candidato com mutação ainda não sincronizada (`pendentes`): vale a intenção local mais recente, isto é, o
 *   último candidato na ordem de `pendentes` (do mais antigo ao mais recente; ver `lerNaoSincronizados`).
 * - Nenhum pendente: o de menor `nomeBusca`, depois o menor `id` (determinístico; o servidor garante um só).
 */
export function padraoEfetivo(
  templates: readonly TemplateLocal[],
  tipo: TipoProposta,
  pendentes: ReadonlySet<string>,
): TemplateLocal | undefined {
  const candidatos = templates.filter((t) => t.tipoProposta === tipo && t.padrao && t.ativo);
  const porId = new Map(candidatos.map((t) => [t.id, t]));
  const pendente = [...pendentes].filter((id) => porId.has(id)).pop();
  if (pendente !== undefined) {
    return porId.get(pendente);
  }
  return candidatos.sort((a, b) =>
    a.nomeBusca !== b.nomeBusca ? (a.nomeBusca < b.nomeBusca ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )[0];
}

/** Bloco novo com a configuração padrão do tipo. */
export function novoBloco(tipo: TipoBloco): Bloco {
  const id = uuidv7();
  switch (tipo) {
    case 'CABECALHO':
      return { id, tipo, config: { mostrarLogo: true, mostrarDadosEmpresa: true, titulo: 'Proposta {{proposta.numero}}' } };
    case 'TEXTO':
      return { id, tipo, config: { conteudo: { type: 'doc', content: [{ type: 'paragraph' }] } } };
    case 'ITENS':
      return {
        id, tipo,
        config: { colunas: ['codigo', 'descricao', 'quantidade', 'unidade', 'precoUnitario', 'subtotal'], agruparPorNatureza: false },
      };
    case 'TOTAIS':
      return { id, tipo, config: { mostrarDescontos: true } };
    case 'ASSINATURA':
      return { id, tipo, config: { assinantes: ['EMPRESA', 'CLIENTE'] } };
    case 'QUEBRA_PAGINA':
      return { id, tipo, config: {} };
  }
}

export function blocosIniciais(): Bloco[] {
  return (['CABECALHO', 'TEXTO', 'ITENS', 'TOTAIS', 'ASSINATURA'] as const).map(novoBloco);
}

// ---- Validação: espelho EXATO do BlocosValidator do servidor (mesmas regras, chaves, mensagens e limites) ----

const MAX_BLOCOS = 50;
const MAX_BYTES_TOTAL = 256 * 1024;
const MAX_BYTES_TEXTO = 100 * 1024;
const MAX_ID = 40;
const MAX_TITULO = 200;
/** Profundidade de nós do Tiptap; o `doc` é a profundidade 1. */
const MAX_PROFUNDIDADE = 12;

const TIPOS = new Set<string>(TIPOS_BLOCO.map((t) => t.valor));
const COLUNAS = new Set<string>(COLUNAS_ITENS.map((c) => c.valor));
const NOMES_ASSINANTES = new Set<string>(ASSINANTES.map((a) => a.valor));
const NOMES_VARIAVEIS = new Set<string>(VARIAVEIS.map((v) => v.nome));
const NOS_BLOCO = new Set(['paragraph', 'heading', 'bulletList', 'orderedList']);
const NOS_INLINE = new Set(['text', 'hardBreak', 'variavel']);
const MARCAS = new Set(['bold', 'italic', 'underline']);
const ALINHAMENTOS = new Set(['left', 'center', 'right', 'justify']);
const SO_LISTITEM = new Set(['listItem']);
const SEM_FILHOS = new Set<string>();

const CHAVES_BLOCO = new Set(['id', 'tipo', 'config']);
const CHAVES_CONFIG: Record<string, Set<string>> = {
  CABECALHO: new Set(['mostrarLogo', 'mostrarDadosEmpresa', 'titulo']),
  TEXTO: new Set(['conteudo']),
  ITENS: new Set(['colunas', 'agruparPorNatureza']),
  TOTAIS: new Set(['mostrarDescontos']),
  ASSINATURA: new Set(['assinantes']),
  QUEBRA_PAGINA: new Set(),
};
const CHAVES_DOC = new Set(['type', 'content']);
const CHAVES_NO = new Set(['type', 'content', 'text', 'marks', 'attrs']);
const CHAVES_MARCA = new Set(['type']);
const ATRIBUTOS: Record<string, Set<string>> = {
  paragraph: new Set(['textAlign']),
  heading: new Set(['level', 'textAlign']),
  bulletList: new Set(),
  orderedList: new Set(['start']),
  listItem: new Set(),
  text: new Set(),
  hardBreak: new Set(),
  variavel: new Set(['nome']),
};
const INT_MAX = 2147483647;

/**
 * Tokens `{{nome}}` do título (mesma regex do servidor; o motor de PDF usa esta). Dentro das chaves só espaço ou tab,
 * nunca `\s` (difere entre Java e JS). É função porque a regex é global e guarda estado em `lastIndex`.
 */
export const tokenTitulo = (): RegExp => /\{\{[ \t]*([a-z_.]+)[ \t]*\}\}/g;

const FORMATACAO = 'Conteúdo com formatação não permitida.';

type Json = unknown;
type Objeto = Record<string, Json>;

const ehObjeto = (v: Json): v is Objeto => typeof v === 'object' && v !== null && !Array.isArray(v);
const tem = (o: Objeto, chave: string): boolean => Object.prototype.hasOwnProperty.call(o, chave);
const soChaves = (o: Objeto, permitidas: Set<string>): boolean => Object.keys(o).every((k) => permitidas.has(k));
/** Texto do nó, ou '' se não for string. */
const texto = (v: Json): string => (typeof v === 'string' ? v : '');
const bytes = (json: string): number => new TextEncoder().encode(json).length;
const inteiro = (v: Json): v is number => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= INT_MAX;

/**
 * Objeto vazio se os blocos são válidos; senão caminho → primeira mensagem, na ordem em que foram achados.
 * Valida o JSON que vai pela rede (`JSON.stringify`), como o servidor o recebe: `undefined` some, chave ausente ≠ `null`.
 */
export function validarBlocos(blocos: unknown): Record<string, string> {
  const erros: Record<string, string> = {};
  let json: string | undefined;
  try {
    json = JSON.stringify(blocos);
  } catch {
    json = undefined;
  }
  const lista: Json = json === undefined ? null : JSON.parse(json);
  if (!Array.isArray(lista)) {
    erros['blocos'] = 'Os blocos precisam ser uma lista.';
    return erros;
  }
  if (lista.length > MAX_BLOCOS) {
    erros['blocos'] = `No máximo ${MAX_BLOCOS} blocos.`;
    return erros;
  }
  if (bytes(json!) > MAX_BYTES_TOTAL) {
    erros['blocos'] = 'Template grande demais.';
    return erros;
  }
  const ids = new Set<string>();
  lista.forEach((bloco, i) => validarBloco(bloco, `blocos[${i}]`, ids, erros));
  return erros;
}

function registrar(erros: Record<string, string>, chave: string, mensagem: string): void {
  if (!tem(erros, chave)) erros[chave] = mensagem;
}

function validarBloco(bloco: Json, caminho: string, ids: Set<string>, erros: Record<string, string>): void {
  if (!ehObjeto(bloco)) {
    registrar(erros, caminho, 'Bloco inválido.');
    return;
  }
  if (!soChaves(bloco, CHAVES_BLOCO)) {
    registrar(erros, caminho, 'Bloco inválido.');
  }

  const id = bloco['id'];
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID) {
    registrar(erros, `${caminho}.id`, 'Identificador do bloco inválido.');
  } else if (ids.has(id)) {
    registrar(erros, `${caminho}.id`, 'Identificador de bloco repetido.');
  } else {
    ids.add(id);
  }

  const tipo = bloco['tipo'];
  if (typeof tipo !== 'string' || !TIPOS.has(tipo)) {
    registrar(erros, `${caminho}.tipo`, 'Tipo de bloco desconhecido.');
    return;
  }

  const caminhoConfig = `${caminho}.config`;
  const config = bloco['config'];
  if (!ehObjeto(config)) {
    registrar(erros, caminhoConfig, 'Opções do bloco inválidas.');
    return;
  }
  if (!soChaves(config, CHAVES_CONFIG[tipo])) {
    registrar(erros, caminhoConfig, 'Opção não permitida para este bloco.');
  }

  switch (tipo) {
    case 'CABECALHO':
      booleano(config, 'mostrarLogo', caminhoConfig, erros);
      booleano(config, 'mostrarDadosEmpresa', caminhoConfig, erros);
      titulo(config['titulo'], `${caminhoConfig}.titulo`, erros);
      break;
    case 'TEXTO':
      conteudo(config['conteudo'], `${caminhoConfig}.conteudo`, erros);
      break;
    case 'ITENS':
      listaFechada(config['colunas'], COLUNAS, 'Coluna inválida.', `${caminhoConfig}.colunas`, erros);
      booleano(config, 'agruparPorNatureza', caminhoConfig, erros);
      break;
    case 'TOTAIS':
      booleano(config, 'mostrarDescontos', caminhoConfig, erros);
      break;
    case 'ASSINATURA':
      listaFechada(config['assinantes'], NOMES_ASSINANTES, 'Assinante inválido.', `${caminhoConfig}.assinantes`, erros);
      break;
    default:
      break; // QUEBRA_PAGINA: config vazio, já conferido pelas chaves
  }
}

function booleano(config: Objeto, campo: string, caminhoConfig: string, erros: Record<string, string>): void {
  if (typeof config[campo] !== 'boolean') {
    registrar(erros, `${caminhoConfig}.${campo}`, 'Informe sim ou não.');
  }
}

function titulo(v: Json, caminho: string, erros: Record<string, string>): void {
  if (typeof v !== 'string') {
    registrar(erros, caminho, 'Informe o título.');
    return;
  }
  if (v.length > MAX_TITULO) {
    registrar(erros, caminho, `Máximo de ${MAX_TITULO} caracteres.`);
    return;
  }
  for (const m of v.matchAll(tokenTitulo())) {
    if (!NOMES_VARIAVEIS.has(m[1])) {
      registrar(erros, caminho, 'Variável desconhecida.');
      return;
    }
  }
  // sem os tokens válidos, qualquer "{{" ou "}}" que sobrou é token malformado ({{ }}, {{Cliente}}, {{a b}}, sem fechar)
  const resto = v.replace(tokenTitulo(), '');
  if (resto.includes('{{') || resto.includes('}}')) {
    registrar(erros, caminho, 'Variável inválida.');
  }
}

function listaFechada(v: Json, permitidos: Set<string>, invalido: string, caminho: string, erros: Record<string, string>): void {
  if (!Array.isArray(v) || v.length === 0) {
    registrar(erros, caminho, 'Escolha pelo menos uma opção.');
    return;
  }
  const vistos = new Set<string>();
  for (const item of v) {
    if (typeof item !== 'string' || !permitidos.has(item)) {
      registrar(erros, caminho, invalido);
      return;
    }
    if (vistos.has(item)) {
      registrar(erros, caminho, 'Opção repetida.');
      return;
    }
    vistos.add(item);
  }
}

function conteudo(doc: Json, caminho: string, erros: Record<string, string>): void {
  if (!ehObjeto(doc)) {
    registrar(erros, caminho, 'Informe o texto.');
    return;
  }
  if (bytes(JSON.stringify(doc)) > MAX_BYTES_TEXTO) {
    registrar(erros, caminho, 'Texto grande demais.');
    return;
  }
  if (!docValido(doc)) {
    registrar(erros, caminho, FORMATACAO);
  }
}

// ---- Tiptap restrito ----

function docValido(doc: Objeto): boolean {
  return soChaves(doc, CHAVES_DOC) && texto(doc['type']) === 'doc' && filhosValidos(doc, NOS_BLOCO, 1);
}

/** `content` opcional (ausente ≠ null); cada filho tem de ser de um dos tipos permitidos e fica em profundidadePai + 1. */
function filhosValidos(pai: Objeto, permitidos: Set<string>, profundidadePai: number): boolean {
  if (!tem(pai, 'content')) {
    return true;
  }
  const content = pai['content'];
  if (!Array.isArray(content) || (permitidos.size === 0 && content.length > 0)) {
    return false;
  }
  const profundidade = profundidadePai + 1;
  if (content.length > 0 && profundidade > MAX_PROFUNDIDADE) {
    return false;
  }
  return content.every((filho) => ehObjeto(filho) && permitidos.has(texto(filho['type'])) && noValido(filho, profundidade));
}

function noValido(no: Objeto, profundidade: number): boolean {
  const tipo = texto(no['type']);
  if (!soChaves(no, CHAVES_NO) || !atributosValidos(no, tipo)) {
    return false;
  }
  const inline = NOS_INLINE.has(tipo);
  if (tem(no, 'text') !== (tipo === 'text')) {
    return false;
  }
  if (inline ? tem(no, 'content') : tem(no, 'marks')) {
    return false;
  }
  if (inline) {
    return marcasValidas(no) && (tipo !== 'text' || typeof no['text'] === 'string');
  }
  let filhos: Set<string>;
  switch (tipo) {
    case 'paragraph':
    case 'heading':
      filhos = NOS_INLINE;
      break;
    case 'bulletList':
    case 'orderedList':
      filhos = SO_LISTITEM;
      break;
    case 'listItem':
      filhos = NOS_BLOCO;
      break;
    default:
      filhos = SEM_FILHOS;
  }
  return filhosValidos(no, filhos, profundidade);
}

function atributosValidos(no: Objeto, tipo: string): boolean {
  if (!tem(no, 'attrs')) {
    return tipo !== 'heading' && tipo !== 'variavel';
  }
  const attrs = no['attrs'];
  if (!ehObjeto(attrs) || !soChaves(attrs, ATRIBUTOS[tipo])) {
    return false;
  }
  const alinhamento = attrs['textAlign'];
  if (alinhamento !== undefined && alinhamento !== null && !(typeof alinhamento === 'string' && ALINHAMENTOS.has(alinhamento))) {
    return false;
  }
  switch (tipo) {
    case 'heading': {
      const level = attrs['level'];
      return inteiro(level) && (level === 2 || level === 3);
    }
    case 'orderedList': {
      const start = attrs['start'];
      return !tem(attrs, 'start') || start === null || (inteiro(start) && start >= 1);
    }
    case 'variavel':
      return NOMES_VARIAVEIS.has(texto(attrs['nome']));
    default:
      return true;
  }
}

function marcasValidas(no: Objeto): boolean {
  if (!tem(no, 'marks')) {
    return true;
  }
  const marks = no['marks'];
  if (!Array.isArray(marks)) {
    return false;
  }
  return marks.every((m) => ehObjeto(m) && soChaves(m, CHAVES_MARCA) && MARCAS.has(texto(m['type'])));
}
