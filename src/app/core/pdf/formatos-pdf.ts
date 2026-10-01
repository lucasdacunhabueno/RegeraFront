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

export interface LinhaTotal {
  rotulo: 'Subtotal' | 'Descontos' | 'Total';
  centavos: number;
  /** A linha do Total (em destaque). */
  total: boolean;
}

/**
 * As linhas do bloco TOTAIS (P4a-R6), as mesmas no PDF e no wizard: com `mostrarDescontos`, Subtotal = bruto
 * (total + descontos), para que Subtotal − Descontos = Total feche na tela, e Descontos (negativo) só quando há
 * desconto; por fim o Total.
 */
export function linhasDeTotais(totalCentavos: number, totalDescontosCentavos: number, mostrarDescontos: boolean): LinhaTotal[] {
  const linhas: LinhaTotal[] = [];
  if (mostrarDescontos) {
    const descontos = totalDescontosCentavos > 0 ? totalDescontosCentavos : 0;
    linhas.push({ rotulo: 'Subtotal', centavos: totalCentavos + descontos, total: false });
    if (descontos > 0) linhas.push({ rotulo: 'Descontos', centavos: -descontos, total: false });
  }
  linhas.push({ rotulo: 'Total', centavos: totalCentavos, total: true });
  return linhas;
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
