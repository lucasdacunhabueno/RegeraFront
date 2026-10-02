export const ID_EMPRESA = '00000000-0000-0000-0000-000000000001';

/** A validade da proposta quando a empresa não tem a dela no aparelho (sem empresa, ou a do TECNICO). */
export const VALIDADE_PADRAO_DIAS = 15;

export interface EmpresaDados {
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string | null;
  endereco: string | null;
  telefone: string | null;
  email: string | null;
  site: string | null;
  logoArquivoId: string | null;
  corPrimaria: string;
  /**
   * Padrões comerciais da proposta. O TECNICO recebe a empresa sem eles (M2P1-R25: ela vai no PDF da OS, os padrões
   * não são dele): null. O PUT do ADMIN sempre manda a validade; quem cria proposta usa 15 dias quando falta.
   */
  validadePadraoDias: number | null;
  condicoesPagamentoPadrao: string | null;
}

export interface EmpresaLocal extends EmpresaDados {
  id: string;
  version: number | null;
}

/**
 * O servidor omite campos nulos; aqui eles voltam a ser null explícito. Os padrões comerciais ausentes (a empresa do
 * TECNICO) ficam null, sem valor inventado.
 */
export function paraEmpresaLocal(id: string, version: number | null, d: Partial<EmpresaDados>): EmpresaLocal {
  return {
    id,
    version,
    razaoSocial: d.razaoSocial ?? '',
    nomeFantasia: d.nomeFantasia ?? null,
    cnpj: d.cnpj ?? null,
    endereco: d.endereco ?? null,
    telefone: d.telefone ?? null,
    email: d.email ?? null,
    site: d.site ?? null,
    logoArquivoId: d.logoArquivoId ?? null,
    corPrimaria: d.corPrimaria ?? '#1d4ed8',
    validadePadraoDias: d.validadePadraoDias ?? null,
    condicoesPagamentoPadrao: d.condicoesPagamentoPadrao ?? null,
  };
}

export function dadosDaEmpresa(e: EmpresaLocal): EmpresaDados {
  return {
    razaoSocial: e.razaoSocial,
    nomeFantasia: e.nomeFantasia,
    cnpj: e.cnpj,
    endereco: e.endereco,
    telefone: e.telefone,
    email: e.email,
    site: e.site,
    logoArquivoId: e.logoArquivoId,
    corPrimaria: e.corPrimaria,
    validadePadraoDias: e.validadePadraoDias,
    condicoesPagamentoPadrao: e.condicoesPagamentoPadrao,
  };
}
