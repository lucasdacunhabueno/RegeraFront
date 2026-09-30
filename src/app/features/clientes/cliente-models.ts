import { normalizarDocumento } from '../../core/util/documentos';
import { normalizarBusca, somenteDigitos } from '../../core/util/formatos';

export type TipoPessoa = 'PF' | 'PJ';
export type TipoEndereco = 'PRINCIPAL' | 'COBRANCA' | 'INSTALACAO';

export interface EnderecoDados {
  tipo: TipoEndereco;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

/** Formato do agregado no sync (igual ao ClienteDados do servidor). */
export interface ClienteDados {
  tipo: TipoPessoa;
  documento: string;
  nome: string;
  nomeFantasia: string | null;
  inscricaoEstadual: string | null;
  inscricaoMunicipal: string | null;
  email: string | null;
  telefone: string | null;
  whatsapp: string | null;
  contatoNome: string | null;
  observacoes: string | null;
  enderecos: EnderecoDados[];
}

export interface ClienteLocal extends ClienteDados {
  id: string;
  /** Última versão conhecida do servidor; null = ainda não existe lá. */
  version: number | null;
  nomeBusca: string;
}

export const ROTULO_TIPO_ENDERECO: Record<TipoEndereco, string> = {
  PRINCIPAL: 'Principal',
  COBRANCA: 'Cobrança',
  INSTALACAO: 'Instalação',
};

export function paraClienteLocal(id: string, version: number | null, dados: ClienteDados): ClienteLocal {
  return {
    ...dados,
    enderecos: dados.enderecos ?? [],
    id,
    version,
    nomeBusca: normalizarBusca(`${dados.nome} ${dados.nomeFantasia ?? ''}`),
  };
}

export function dadosDoCliente(c: ClienteLocal): ClienteDados {
  return {
    tipo: c.tipo,
    documento: c.documento,
    nome: c.nome,
    nomeFantasia: c.nomeFantasia,
    inscricaoEstadual: c.inscricaoEstadual,
    inscricaoMunicipal: c.inscricaoMunicipal,
    email: c.email,
    telefone: c.telefone,
    whatsapp: c.whatsapp,
    contatoNome: c.contatoNome,
    observacoes: c.observacoes,
    enderecos: c.enderecos,
  };
}

export function filtrarClientes(lista: ClienteLocal[], busca: string): ClienteLocal[] {
  const q = normalizarBusca(busca);
  if (!q) return lista;
  const doc = normalizarDocumento(busca);
  const digitos = somenteDigitos(busca);
  return lista.filter(
    (c) =>
      c.nomeBusca.includes(q) ||
      (doc.length >= 3 && c.documento.includes(doc)) ||
      (digitos.length >= 3 && somenteDigitos(c.telefone).includes(digitos)),
  );
}
