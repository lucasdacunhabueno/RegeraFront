export const ID_EMPRESA = '00000000-0000-0000-0000-000000000001';

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
  validadePadraoDias: number;
  condicoesPagamentoPadrao: string | null;
}

export interface EmpresaLocal extends EmpresaDados {
  id: string;
  version: number | null;
}

/** O servidor omite campos nulos; aqui eles voltam a ser null explícito. */
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
    validadePadraoDias: d.validadePadraoDias ?? 15,
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
