import type { Column, Content, StyleDictionary } from 'pdfmake/interfaces';
import { formatarDocumento, formatarTelefone } from '../util/formatos';
import { EmpresaPdf } from './pdf-models';

/** Partes comuns aos PDFs da proposta e da OS: textos seguros, cor, estilos e o bloco da empresa. */

const COR_PADRAO = '#1d4ed8';

/** O pdfmake só lê PNG e JPEG (`image/jpg` é um mime não padrão, mas comum, para JPEG), e só data URL: nada externo. */
export const IMAGEM_SUPORTADA = /^data:image\/(png|jpe?g);base64,/i;

/** A imagem, se for um data URL que o pdfmake lê; senão null (o PDF nunca busca nada fora da entrada). */
export function imagemSegura(v: string | null | undefined): string | null {
  return typeof v === 'string' && IMAGEM_SUPORTADA.test(v) ? v : null;
}

/** Texto ou ''; nunca `undefined`/`null` no PDF (Review Focus 2). */
export const txt = (v: string | null | undefined): string => (typeof v === 'string' ? v : '');
export const telefone = (v: string | null | undefined): string => (v ? formatarTelefone(v) : '');

export function nomeEmpresa(empresa: EmpresaPdf): string {
  return txt(empresa.nomeFantasia) || txt(empresa.razaoSocial);
}

export function corPrimaria(empresa: EmpresaPdf): string {
  const cor = empresa.corPrimaria;
  return typeof cor === 'string' && /^#[0-9a-fA-F]{6}$/.test(cor) ? cor : COR_PADRAO;
}

export function estilosPdf(cor: string): StyleDictionary {
  return {
    titulo: { fontSize: 16, bold: true, color: cor },
    h2: { fontSize: 13, bold: true },
    h3: { fontSize: 11, bold: true },
    cabecalhoTabela: { bold: true, color: 'white', fillColor: cor },
    pequeno: { fontSize: 8 },
  };
}

/**
 * As colunas do cabeçalho: a logo (se houver) e, com `mostrarDados`, razão social, CNPJ da empresa, endereço, contato e
 * site, à direita quando há logo. Vazio quando não há nada a mostrar.
 */
export function colunasEmpresa(empresa: EmpresaPdf, logo: string | null, mostrarDados: boolean): Column[] {
  const colunas: Column[] = [];
  if (logo) colunas.push({ image: logo, fit: [140, 60], width: 140 });
  if (mostrarDados) {
    const linhas: Content[] = [];
    if (txt(empresa.razaoSocial)) linhas.push({ text: empresa.razaoSocial, bold: true });
    const cnpj = empresa.cnpj ? formatarDocumento(empresa.cnpj) : '';
    if (cnpj) linhas.push('CNPJ ' + cnpj);
    if (txt(empresa.endereco)) linhas.push(empresa.endereco!);
    const contato = [telefone(empresa.telefone), txt(empresa.email)].filter((s) => s !== '').join(' · ');
    if (contato) linhas.push(contato);
    if (txt(empresa.site)) linhas.push(empresa.site!);
    if (linhas.length > 0) colunas.push(logo ? { stack: linhas, width: '*', alignment: 'right' } : { stack: linhas, width: '*' });
  }
  return colunas;
}
