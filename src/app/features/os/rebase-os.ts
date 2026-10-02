import type { Perfil } from '../../core/auth/auth-models';
import {
  CampoEdicaoOs, camposEditaveisOs, dadosDaOs, OsDados, OsLocal, paraOsLocal, StatusOs,
} from './os-models';

/**
 * Rebase da OS sobre o estado do servidor, sem o servidor recusar o que o perfil não edita (`EdicaoOs`):
 * - `manterMinhaOs`: o "Manter a minha" de um CONFLITO (M2P1-R19);
 * - `rebaseFilaOs` (`rebaseOs` em cadeia) e `rebaseOsLocal`: as mutações seguintes da fila e o registro local, depois
 *   do "manter a minha" e de um OK, inclusive o OK do envio desatualizado do técnico que o servidor rebaseou
 *   (M2P1-R30) e o da OS encerrada (R26).
 *
 * Funções puras. Os [srv] e os comandos não são do `EdicaoOs`: o servidor ignora os primeiros, e os comandos são da
 * própria mutação.
 */

/** As chaves de cada campo do `EdicaoOs` (os mesmos nomes no `OsDados` e no `OsLocal`); notas e aceite têm regra própria. */
const CHAVES_DO_CAMPO: Readonly<Record<Exclude<CampoEdicaoOs, 'notas' | 'aceitarTrabalho'>, readonly string[]>> = {
  propostaId: ['propostaId'],
  clienteId: ['clienteId'],
  tipo: ['tipo'],
  descricao: ['descricao'],
  dataPrevista: ['dataPrevista'],
  urgente: ['urgente'],
  tecnicoId: ['tecnicoId'],
  endereco: ['enderecoCep', 'enderecoLogradouro', 'enderecoNumero', 'enderecoComplemento', 'enderecoBairro', 'enderecoCidade', 'enderecoUf'],
  itens: ['itens'],
  concluiProposta: ['concluiProposta'],
  resumoExecucao: ['resumoExecucao'],
  assinaturaRecusada: ['assinaturaRecusada'],
  motivoRecusa: ['motivoRecusa'],
  responsavelId: ['responsavelId'],
};
type CampoComChaves = keyof typeof CHAVES_DO_CAMPO;
const CAMPOS = Object.keys(CHAVES_DO_CAMPO) as CampoComChaves[];

/** O ciclo da execução, como o `ordemNoCiclo` do R30 (V2): CANCELADA nunca "vem antes". */
const ORDEM: Readonly<Record<StatusOs, number>> = { ABERTA: 0, EM_ANDAMENTO: 1, CONCLUIDA: 2, CANCELADA: Number.MAX_SAFE_INTEGER };

type Registro = Record<string, unknown>;

/** O servidor lido campo a campo, como o adaptador: o que um servidor mais novo mandar a mais não vai para a rede. */
function doContrato(d: OsDados): OsDados {
  return dadosDaOs(paraOsLocal('', null, d));
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** O campo não mudou entre `base` e `meu` (o usuário não mexeu nele desde o envio anterior). */
function semMudanca(meu: Registro, base: Registro, campo: CampoComChaves): boolean {
  return CHAVES_DO_CAMPO[campo].every((k) => igual(meu[k], base[k]));
}

/** As do servidor e, depois, as de `meu` que ele ainda não tem (a união por id do M2-R1). */
function unirNotas<N extends { id: string }>(doServidor: readonly N[], minhas: readonly N[]): N[] {
  const ids = new Set(doServidor.map((n) => n.id));
  return [...doServidor, ...minhas.filter((n) => !ids.has(n.id))];
}

interface ComStatus {
  status: StatusOs;
  revisao?: number | null;
  motivoReabertura?: string | null;
}

/**
 * O status do envio rebaseado, com as regras do R30 do servidor:
 * - V1: a revisão de `meu` é menor que a do servidor (a OS foi reaberta depois): a transição de `meu` é de uma revisão
 *   já fechada e fica o status do servidor;
 * - sem transição própria desde `base`, o do servidor;
 * - V2: o status nunca volta (ABERTA < EM_ANDAMENTO < CONCLUIDA; CANCELADA nunca vem antes). A exceção é a reabertura
 *   (o comando `motivoReabertura`, ou a revisão que o `reabrir` subiu no aparelho);
 * - senão, a transição de `meu`, que o servidor confere.
 */
function statusRebaseado(meu: ComStatus, base: ComStatus | null, servidor: ComStatus): StatusOs {
  const minha = meu.revisao ?? null;
  const dele = servidor.revisao ?? null;
  if (minha !== null && dele !== null && minha < dele) return servidor.status;
  if (base !== null && meu.status === base.status) return servidor.status;
  const reabre = meu.status === 'EM_ANDAMENTO' && servidor.status === 'CONCLUIDA'
    && (meu.motivoReabertura != null || (minha !== null && dele !== null && minha > dele));
  return ORDEM[meu.status] < ORDEM[servidor.status] && !reabre ? servidor.status : meu.status;
}

/**
 * M2P2-R11: a revisão é a maior das duas (a reabertura feita lá, ou a pendente aqui, que o `reabrir` já subiu), e o
 * número do servidor entra quando o aparelho ainda não o tem. Sem isso, a conclusão seguinte, com a fila ainda cheia,
 * geraria o PDF da revisão antiga, que o servidor recusa sempre. Quando a revisão sobe pela do servidor, a conclusão da
 * revisão fechada sai junto (`concluidaEm` do servidor).
 */
function revisaoENumero(r: Registro, meu: ComStatus & { numero?: number | null }, servidor: OsDados | OsLocal): void {
  const minha = meu.revisao ?? null;
  const dele = servidor.revisao ?? null;
  if (dele !== null && (minha === null || dele > minha)) {
    r['revisao'] = dele;
    r['concluidaEm'] = servidor.concluidaEm ?? null;
  }
  if ((meu.numero ?? null) === null && servidor.numero != null) r['numero'] = servidor.numero;
}

/**
 * "Manter a minha" de uma OS (M2P1-R19): o envio parte do estado do servidor (os [srv] e os campos que o perfil não
 * altera no status do servidor, com a posse do servidor), e só os campos que o perfil altera levam o valor de `meu`.
 * As notas são unidas quando o perfil as acrescenta. `responsavelId` vai null (= manter; R18), salvo a troca do ADMIN
 * numa OS avulsa. O status segue o `statusRebaseado`; os comandos (`motivoReabertura`, o `aceitarTrabalho` do ADMIN)
 * e o motivo do cancelamento ficam os de `meu`.
 */
export function manterMinhaOs(meu: OsDados, servidor: OsDados, perfil: Perfil, usuarioId: string): OsDados {
  const s = doContrato(servidor);
  const editaveis = new Set<CampoEdicaoOs>(
    camposEditaveisOs(s.status, perfil, s.responsavelId === usuarioId, s.tecnicoId === usuarioId),
  );
  const r: Registro = { ...s };
  const m = meu as unknown as Registro;
  for (const campo of CAMPOS) {
    if (campo !== 'responsavelId' && editaveis.has(campo)) for (const k of CHAVES_DO_CAMPO[campo]) r[k] = m[k] ?? null;
  }
  r['notas'] = editaveis.has('notas') ? unirNotas(s.notas, meu.notas) : s.notas;
  const troca = editaveis.has('responsavelId') && s.propostaId == null && meu.responsavelId != null
    && meu.responsavelId !== s.responsavelId;
  r['responsavelId'] = troca ? meu.responsavelId : null;
  r['status'] = statusRebaseado(meu, null, s);
  r['motivoCancelamento'] = meu.motivoCancelamento ?? null;
  if (meu.motivoReabertura !== undefined) r['motivoReabertura'] = meu.motivoReabertura;
  if (meu.aceitarTrabalho !== undefined && editaveis.has('aceitarTrabalho')) r['aceitarTrabalho'] = meu.aceitarTrabalho;
  return r as unknown as OsDados;
}

/** Quem envia, com a posse no estado do servidor (a primeira regra do `EdicaoOs`). */
export interface QuemEnvia {
  perfil: Perfil;
  ehResponsavel: boolean;
  ehTecnicoAtribuido: boolean;
}

export function quemNoServidor(servidor: OsDados, perfil: Perfil, usuarioId: string): QuemEnvia {
  return { perfil, ehResponsavel: servidor.responsavelId === usuarioId, ehTecnicoAtribuido: servidor.tecnicoId === usuarioId };
}

/**
 * A mutação `meu`, que está na fila atrás da que foi enviada com `base`, sobre o estado `servidor` que o servidor terá
 * quando ela chegar (3 vias): o campo que não mudou entre `base` e `meu` passa a ser o do servidor (o usuário não mexeu
 * nele: um valor velho desfaria em silêncio a mudança de outra pessoa, ou seria recusado se o perfil não o altera); o
 * que mudou fica. Notas unidas, `responsavelId` null continua null (= manter), status pelo `statusRebaseado`, revisão e
 * número pelo `revisaoENumero`. Os outros [srv] e os comandos ficam os de `meu`.
 *
 * Com `quem` e a posse dele, o que o perfil não altera no status do servidor fica o do servidor, como o servidor faz no
 * R26 e no R30 (ex.: o resumo do técnico numa OS que o escritório cancelou). Sem a posse (o técnico que perdeu a
 * atribuição, M2-R3), nada é tirado: o servidor tem o caminho próprio para as notas dele.
 */
export function rebaseOs(meu: OsDados, base: OsDados, servidor: OsDados, quem?: QuemEnvia): OsDados {
  const s = doContrato(servidor);
  const deles = s as unknown as Registro;
  const m = meu as unknown as Registro;
  const b = base as unknown as Registro;
  const r: Registro = { ...m };
  for (const campo of CAMPOS) {
    if (campo !== 'responsavelId' && semMudanca(m, b, campo)) for (const k of CHAVES_DO_CAMPO[campo]) r[k] = deles[k] ?? null;
  }
  if (meu.responsavelId != null && semMudanca(m, b, 'responsavelId')) r['responsavelId'] = s.responsavelId ?? null;
  r['notas'] = unirNotas(s.notas, meu.notas);
  r['status'] = statusRebaseado(meu, base, s);
  revisaoENumero(r, meu, s);
  if (quem && temPosse(quem)) {
    const editaveis = new Set<CampoEdicaoOs>(camposEditaveisOs(s.status, quem.perfil, quem.ehResponsavel, quem.ehTecnicoAtribuido));
    for (const campo of CAMPOS) {
      if (campo !== 'responsavelId' && !editaveis.has(campo)) for (const k of CHAVES_DO_CAMPO[campo]) r[k] = deles[k] ?? null;
    }
    // não é redundante: a troca do ADMIN numa avulsa que chega com a OS já encerrada lá levaria um responsável que ele
    // não altera mais (OS_NAO_EDITAVEL); null = manter
    if (!editaveis.has('responsavelId')) r['responsavelId'] = null;
    if (!editaveis.has('notas')) r['notas'] = s.notas;
    if (!editaveis.has('aceitarTrabalho')) delete r['aceitarTrabalho'];
  }
  return r as unknown as OsDados;
}

/** A regra 1 do `EdicaoOs`: o COMERCIAL só na OS em que é o responsável, o TECNICO só na atribuída a ele. */
function temPosse(q: QuemEnvia): boolean {
  return !(q.perfil === 'COMERCIAL' && !q.ehResponsavel) && !(q.perfil === 'TECNICO' && !q.ehTecnicoAtribuido);
}

/**
 * As mutações `seguintes` da OS (na ordem da fila), atrás da enviada com `enviado`, sobre o `servidor` que voltou dela:
 * cada uma pelo `rebaseOs` sobre o estado que a anterior deixa (a anterior já rebaseada), para uma transição no meio
 * (ex.: a reabertura) valer para as que vêm depois dela.
 */
export function rebaseFilaOs(enviado: OsDados, servidor: OsDados, seguintes: readonly OsDados[], quem?: QuemEnvia): OsDados[] {
  let base = enviado;
  let estado = servidor;
  return seguintes.map((meu) => {
    const r = rebaseOs(meu, base, estado, quem);
    base = meu;
    estado = r;
    return r;
  });
}

/**
 * O registro local com a regra do `rebaseOs` (`base` = a última mutação da OS na fila, como foi gravada; `servidor` =
 * ela rebaseada, ou o resultado do servidor). Na OS de proposta o aparelho envia `responsavelId` null, então ele segue
 * o do servidor quando o servidor o traz. Guarda o que é só do aparelho (o início local, o autor e a data das notas
 * pendentes), a versão e os [srv] do registro, salvo a revisão e o número (`revisaoENumero`).
 */
export function rebaseOsLocal(local: OsLocal, base: OsDados, servidor: OsDados): OsLocal {
  const m = dadosDaOs(local) as unknown as Registro;
  const b = base as unknown as Registro;
  const s = paraOsLocal(local.id, local.version, servidor);
  const deles = s as unknown as Registro;
  const r: Registro = { ...local };
  for (const campo of CAMPOS) {
    if (campo !== 'responsavelId' && semMudanca(m, b, campo)) for (const k of CHAVES_DO_CAMPO[campo]) r[k] = deles[k];
  }
  if (s.responsavelId !== null && (base.responsavelId == null || semMudanca(m, b, 'responsavelId'))) {
    r['responsavelId'] = s.responsavelId;
  }
  // a nota que o servidor ainda não aceitou (sem data dele; ex.: a do "manter a minha") fica com o autor e a data locais
  const minhas = new Map(local.notas.map((n) => [n.id, n] as const));
  r['notas'] = unirNotas(s.notas.map((n) => (n.criadaEm === null ? minhas.get(n.id) ?? n : n)), local.notas);
  r['status'] = statusRebaseado(local, base, s);
  revisaoENumero(r, local, s);
  return r as unknown as OsLocal;
}
