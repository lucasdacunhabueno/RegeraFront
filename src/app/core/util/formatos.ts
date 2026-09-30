import { normalizarDocumento } from './documentos';

export function somenteDigitos(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

/** '#' é substituído pelo próximo caractere do valor; o resto do padrão é separador. */
export function aplicarPadrao(valor: string, padrao: string): string {
  let saida = '';
  let i = 0;
  for (const ch of padrao) {
    if (i >= valor.length) break;
    if (ch === '#') {
      saida += valor[i++];
    } else {
      saida += ch;
    }
  }
  return saida;
}

export function mascararDocumento(tipo: 'PF' | 'PJ', valor: string): string {
  const n = normalizarDocumento(valor);
  return tipo === 'PF'
    ? aplicarPadrao(n.replace(/\D/g, '').slice(0, 11), '###.###.###-##')
    : aplicarPadrao(n.slice(0, 14), '##.###.###/####-##');
}

export function formatarDocumento(doc: string | null | undefined): string {
  const n = normalizarDocumento(doc);
  if (n.length === 11) return aplicarPadrao(n, '###.###.###-##');
  if (n.length === 14) return aplicarPadrao(n, '##.###.###/####-##');
  return n;
}

export function formatarTelefone(v: string | null | undefined): string {
  const d = somenteDigitos(v).slice(0, 11);
  return aplicarPadrao(d, d.length <= 10 ? '(##) ####-####' : '(##) #####-####');
}

export function formatarCep(v: string | null | undefined): string {
  return aplicarPadrao(somenteDigitos(v).slice(0, 8), '#####-###');
}

export function normalizarBusca(v: string | null | undefined): string {
  return (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
