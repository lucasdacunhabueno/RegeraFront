import { moedaCentavos as moedaPdf } from '../../core/pdf/formatos-pdf';
import { normalizarDocumento } from '../../core/util/documentos';
import { ErroCampo } from '../../core/util/erro-campo';
import { normalizarBusca } from '../../core/util/formatos';
import type { ClienteLocal } from '../clientes/cliente-models';
import { TIPOS_PROPOSTA, TipoProposta } from '../templates/template-models';
import { codigoExibido, PropostaLocal } from './proposta-models';

/**
 * Exibição das propostas nas telas (lista, kanban, detalhe, cliente). Funções puras: quem chama passa o `hoje`
 * (`hojeEmSaoPaulo()` do repositório) e o estado do sync, para o resultado não depender do relógio nem do banco.
 * Sem import do `PropostasRepo`: o card e o kanban usam isto sem levar o repositório junto.
 */

export interface Selo {
  tipo: 'expirada' | 'nao-sincronizada' | 'pendencia';
  rotulo: string;
}

/** Global Constraints: ENVIADA com `validadeAte` antes de `hoje` (`aaaa-mm-dd` em America/Sao_Paulo). */
export function expirada(p: Pick<PropostaLocal, 'status' | 'validadeAte'>, hoje: string): boolean {
  return p.status === 'ENVIADA' && p.validadeAte !== null && p.validadeAte.slice(0, 10) < hoje;
}

/** `000277`, `000277-R2` ou `PROV-XXXXXX`. */
export function rotuloCodigo(p: Pick<PropostaLocal, 'numero' | 'revisao' | 'codigoProvisorio'>): string {
  return codigoExibido(p);
}

/** Centavos → `R$ 1.234,56` (o mesmo texto do PDF). */
export function moedaCentavos(centavos: number): string {
  return moedaPdf(centavos);
}

const DATA_HORA_SAO_PAULO = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Instante ISO → `dd/mm/aaaa hh:mm` na hora de São Paulo (histórico e documentos); ausente ou inválido → ''. */
export function dataHoraBr(iso: string | null | undefined): string {
  const instante = Date.parse(iso ?? '');
  if (Number.isNaN(instante)) return '';
  const p = new Map(DATA_HORA_SAO_PAULO.formatToParts(new Date(instante)).map((x) => [x.type, x.value]));
  return `${p.get('day')}/${p.get('month')}/${p.get('year')} ${p.get('hour')}:${p.get('minute')}`;
}

/** Os campos da proposta pelos nomes do servidor (`campos` das recusas), como a tela os chama. */
const ROTULO_CAMPO: Readonly<Record<string, string>> = {
  tipo: 'Tipo', clienteId: 'Cliente', templateId: 'Template', tecnicoId: 'Técnico', responsavelId: 'Responsável',
  dataEmissao: 'Emissão', validadeAte: 'Validade', condicoesPagamento: 'Condições de pagamento',
  prazoExecucao: 'Prazo de execução', observacoes: 'Observações', descontoGeralPercentual: 'Desconto geral',
  motivoEncerramento: 'Motivo', itens: 'Itens',
};

const ROTULO_CAMPO_DA_LINHA: Readonly<Record<string, string>> = {
  quantidade: 'quantidade', precoUnitario: 'preço', descontoPercentual: 'desconto', meses: 'meses',
  itemCatalogoId: 'item do catálogo', id: 'linha',
};

/** O rótulo de um campo de recusa: `prazoExecucao` → "Prazo de execução", `itens[0].quantidade` → "Item 1, quantidade". */
export function rotuloDoCampo(campo: string): string | null {
  const linha = /^itens\[(\d+)\](?:\.(\w+))?/.exec(campo);
  if (linha) {
    const item = `Item ${Number(linha[1]) + 1}`;
    const doCampo = linha[2] && Object.hasOwn(ROTULO_CAMPO_DA_LINHA, linha[2]) ? ROTULO_CAMPO_DA_LINHA[linha[2]] : undefined;
    return doCampo ? `${item}, ${doCampo}` : item;
  }
  return Object.hasOwn(ROTULO_CAMPO, campo) ? ROTULO_CAMPO[campo] : null;
}

const ROTULO_TIPO = new Map<TipoProposta, string>(TIPOS_PROPOSTA.map((t) => [t.valor, t.rotulo]));

export function rotuloTipo(tipo: TipoProposta): string {
  return ROTULO_TIPO.get(tipo) ?? tipo;
}

/**
 * Selos do card, sempre nesta ordem. `naoSincronizada` = tem mutação na outbox (inclui o upload do PDF);
 * `pendente` = tem pendência de sync (conflito ou rejeição).
 */
export function selosDaProposta(
  p: Pick<PropostaLocal, 'status' | 'validadeAte'>,
  estado: { pendente: boolean; naoSincronizada: boolean; hoje: string },
): Selo[] {
  const selos: Selo[] = [];
  if (expirada(p, estado.hoje)) selos.push({ tipo: 'expirada', rotulo: 'Expirada' });
  if (estado.naoSincronizada) selos.push({ tipo: 'nao-sincronizada', rotulo: 'Não sincronizada' });
  if (estado.pendente) selos.push({ tipo: 'pendencia', rotulo: 'Pendência' });
  return selos;
}

/**
 * Busca local da lista e do kanban: número (com ou sem zeros, com a revisão), PROV (também depois de numerada, porque
 * o PDF feito offline saiu com ele), nome ou nome fantasia do cliente (sem acento nem caixa) e documento do cliente
 * (com ou sem máscara, a partir de 3 caracteres).
 */
export function correspondeABusca(p: PropostaLocal, cliente: ClienteLocal | undefined, busca: string): boolean {
  const q = normalizarBusca(busca);
  if (!q) return true;
  if (normalizarBusca(codigoExibido(p)).includes(q) || normalizarBusca(p.codigoProvisorio).includes(q)) return true;
  if (!cliente) return false;
  if (cliente.nomeBusca.includes(q)) return true;
  const doc = normalizarDocumento(busca);
  return doc.length >= 3 && cliente.documento !== null && cliente.documento.includes(doc);
}

const POR_CODIGO: ReadonlyMap<string, string> = new Map([
  ['PROPOSTA_JA_ENVIADA', 'Esta proposta já foi enviada.'],
  ['PDF_GRANDE', 'O PDF passou de 10 MB. Reduza imagens do template.'],
  ['SNAPSHOT_GRANDE', 'Os dados desta proposta passam do limite do documento (512 KB).'],
  ['PROPOSTA_ALTERADA', 'A proposta mudou enquanto o PDF era gerado. Envie de novo.'],
  ['USE_ENVIAR', 'Para enviar, gere o PDF oficial da proposta.'],
  ['RESOLVA_A_PENDENCIA', 'Resolva a pendência desta proposta antes de editá-la.'],
  ['VALIDACAO', 'Revise os campos destacados.'],
  ['ACESSO_NEGADO', 'Você não tem permissão para esta ação.'],
]);

const GENERICA = 'Não foi possível concluir. Tente de novo.';

/**
 * Texto do toast para um erro do repositório. Um `ErroCampo` (e o `ErroProposta`, que o estende) já vem com a
 * mensagem em pt-BR, que é usada; sem ela, o texto do `codigo`. Qualquer outro erro (Dexie, PDF, rede) é técnico e
 * vira a mensagem genérica.
 */
export function mensagemErroProposta(e: unknown): string {
  if (!(e instanceof ErroCampo)) return GENERICA;
  if (e.message.trim()) return e.message;
  const codigo = (e as ErroCampo & { codigo?: unknown }).codigo;
  return (typeof codigo === 'string' && POR_CODIGO.get(codigo)) || GENERICA;
}
