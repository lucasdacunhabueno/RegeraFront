const REAL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatarMoeda(v: number | null | undefined): string {
  return v == null ? '—' : REAL.format(v);
}

export function formatarMoedaInput(v: number | null | undefined): string {
  return v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * "1.234,56" → 1234.56; "10,5" → 10.5; "10.50" → 10.5; "R$ 25,50" → 25.5.
 * Com vírgula, pontos são milhar; sem vírgula, o ponto é decimal. Vazio → null; inválido ou negativo → NaN.
 */
export function parseMoeda(texto: string): number | null {
  const t = (texto ?? '').replace(/R\$|\s/g, '');
  if (!t) return null;
  const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d{1,2})?$/.test(normalizado)) return NaN;
  return Math.round(Number(normalizado) * 100) / 100;
}
