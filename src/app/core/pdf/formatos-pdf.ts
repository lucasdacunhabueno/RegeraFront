/**
 * Formatação pt-BR determinística para o PDF (sem Intl: o espaço de "R$ " é o comum, não o U+00A0, e o resultado
 * não depende do ICU do navegador).
 */

const milhar = (inteiro: string): string => inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Centavos inteiros → `R$ 1.234,56`. Fração de centavo é arredondada; valor não finito vira zero. */
export function moedaCentavos(centavos: number): string {
  const n = Number.isFinite(centavos) ? Math.round(centavos) : 0;
  const abs = Math.abs(n);
  const reais = milhar(String(Math.floor(abs / 100)));
  const cents = String(abs % 100).padStart(2, '0');
  return `${n < 0 ? '-' : ''}R$ ${reais},${cents}`;
}

/** `aaaa-mm-dd` (ou ISO com hora) → `dd/mm/aaaa`; ausente ou inválida (mês fora de 1–12, dia fora de 1–31) → ''. */
export function dataBr(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31 ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Número decimal pt-BR com até 4 casas, sem zeros à direita: 1.5 → `1,5`; 1234.5 → `1.234,5`. */
export function quantidadeBr(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const [inteiro, fracao] = Math.abs(v).toFixed(4).split('.');
  const casas = fracao.replace(/0+$/, '');
  const negativo = v < 0 && (inteiro !== '0' || casas !== '');
  return `${negativo ? '-' : ''}${milhar(inteiro)}${casas ? ',' + casas : ''}`;
}

/** 10 → `10%`; 12.5 → `12,5%`. */
export function percentualBr(n: number): string {
  return `${quantidadeBr(n)}%`;
}
