import { normalizarBusca } from '../../core/util/formatos';

export type NaturezaItem = 'PRODUTO' | 'SERVICO';
export type FiltroCatalogo = 'TODOS' | 'PRODUTO' | 'SERVICO' | 'LOCAVEL';

export const UNIDADES = ['un', 'h', 'm', 'm²', 'm³', 'kg', 'l', 'dia', 'mês', 'serviço'];

/** Formato do item no sync. Preços ausentes = o perfil não pode vê-los (o servidor não envia). */
export interface ItemCatalogoDados {
  natureza: NaturezaItem;
  codigo: string;
  nome: string;
  descricao: string | null;
  unidade: string;
  precoCusto?: number | null;
  precoVenda?: number | null;
  locavel: boolean;
  precoLocacaoMensal?: number | null;
  fotoArquivoId: string | null;
  ativo: boolean;
}

export interface ItemLocal extends ItemCatalogoDados {
  id: string;
  version: number | null;
  nomeBusca: string;
}

export function paraItemLocal(id: string, version: number | null, dados: ItemCatalogoDados): ItemLocal {
  return {
    natureza: dados.natureza,
    codigo: dados.codigo,
    nome: dados.nome,
    descricao: dados.descricao ?? null,
    unidade: dados.unidade,
    precoCusto: dados.precoCusto ?? null,
    precoVenda: dados.precoVenda ?? null,
    locavel: dados.locavel ?? false,
    precoLocacaoMensal: dados.precoLocacaoMensal ?? null,
    fotoArquivoId: dados.fotoArquivoId ?? null,
    ativo: dados.ativo ?? true,
    id,
    version,
    nomeBusca: normalizarBusca(`${dados.codigo} ${dados.nome}`),
  };
}

export function dadosDoItem(i: ItemLocal): ItemCatalogoDados {
  return {
    natureza: i.natureza,
    codigo: i.codigo,
    nome: i.nome,
    descricao: i.descricao,
    unidade: i.unidade,
    precoCusto: i.precoCusto ?? null,
    precoVenda: i.precoVenda ?? null,
    locavel: i.locavel,
    precoLocacaoMensal: i.precoLocacaoMensal ?? null,
    fotoArquivoId: i.fotoArquivoId,
    ativo: i.ativo,
  };
}

export function filtrarItens(lista: ItemLocal[], filtro: FiltroCatalogo, busca: string, incluirInativos: boolean): ItemLocal[] {
  const q = normalizarBusca(busca);
  return lista.filter(
    (i) =>
      (incluirInativos || i.ativo) &&
      (filtro === 'TODOS' || (filtro === 'LOCAVEL' ? i.locavel : i.natureza === filtro)) &&
      (!q || i.nomeBusca.includes(q)),
  );
}
