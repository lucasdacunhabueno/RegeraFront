/**
 * O rascunho da OS (M2P3 FW-R2): o resumo da execução e a nota que o usuário digitou e ainda não gravou, por usuário e
 * por OS, no `sessionStorage` da aba. Cobre a página que sai da memória (a câmera num Android fraco, o iOS que
 * descarta o PWA) e a navegação para outra tela; some ao fechar a aba e no logout (`limparRascunhosOs`).
 *
 * Só os dois textos, nunca outro dado da OS ou do cliente. Todo acesso fica em try/catch: o armazenamento bloqueado
 * (modo privado, política do navegador) ou cheio só deixa de guardar o rascunho.
 */
export interface RascunhoOs {
  resumo?: string;
  nota?: string;
}

export type CampoRascunhoOs = keyof RascunhoOs;

const PREFIXO = 'regera:rascunho-os:';

const chave = (usuarioId: string, osId: string) => `${PREFIXO}${usuarioId}:${osId}`;

function armazem(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** O rascunho guardado (só os campos de texto que existem); vazio sem nenhum, ou com o armazenamento indisponível. */
export function lerRascunhoOs(usuarioId: string, osId: string): RascunhoOs {
  try {
    const bruto = armazem()?.getItem(chave(usuarioId, osId));
    if (!bruto) return {};
    const lido = JSON.parse(bruto) as Record<string, unknown> | null;
    const r: RascunhoOs = {};
    if (typeof lido?.['resumo'] === 'string') r.resumo = lido['resumo'];
    if (typeof lido?.['nota'] === 'string') r.nota = lido['nota'];
    return r;
  } catch {
    return {};
  }
}

/**
 * Guarda (ou, com null, esquece) um dos textos. A nota vazia não se guarda; o resumo vazio sim (apagado de propósito
 * na OS reaberta, que vem com o resumo anterior). Sem nenhum dos dois, a chave sai.
 */
export function gravarRascunhoOs(usuarioId: string, osId: string, campo: CampoRascunhoOs, texto: string | null): void {
  try {
    const s = armazem();
    if (!s) return;
    const r = lerRascunhoOs(usuarioId, osId);
    if (texto === null || (campo === 'nota' && texto === '')) delete r[campo];
    else r[campo] = texto;
    const k = chave(usuarioId, osId);
    if (r.resumo === undefined && r.nota === undefined) s.removeItem(k);
    else s.setItem(k, JSON.stringify(r));
  } catch {
    // sem armazenamento (ou cheio): o rascunho só não fica guardado
  }
}

/** O logout: apaga os rascunhos da OS desta aba (de qualquer usuário), sem tocar no resto do `sessionStorage`. */
export function limparRascunhosOs(): void {
  try {
    const s = armazem();
    if (!s) return;
    const chaves: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(PREFIXO)) chaves.push(k);
    }
    for (const k of chaves) s.removeItem(k);
  } catch {
    // sem armazenamento: nada guardado
  }
}
