/** CPF e CNPJ (numérico e alfanumérico RFB 2026: valor do caractere = código ASCII − 48). */
const PESOS_CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CNPJ_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizarDocumento(v: string | null | undefined): string {
  return (v ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

function todosIguais(v: string): boolean {
  return new Set(v).size === 1;
}

function digito(valores: number[], pesos: number[]): number {
  const soma = pesos.reduce((acc, peso, i) => acc + valores[i] * peso, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || todosIguais(cpf)) return false;
  const n = [...cpf].map(Number);
  const d1 = digito(n, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(n, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === n[9] && d2 === n[10];
}

export function cnpjValido(cnpj: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || todosIguais(cnpj)) return false;
  const v = [...cnpj].map((c) => c.charCodeAt(0) - 48);
  return digito(v, PESOS_CNPJ_1) === v[12] && digito(v, PESOS_CNPJ_2) === v[13];
}

export function documentoValido(tipo: 'PF' | 'PJ', normalizado: string): boolean {
  return tipo === 'PF' ? cpfValido(normalizado) : cnpjValido(normalizado);
}
