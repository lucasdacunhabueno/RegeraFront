import { calcularDimensoes } from '../../core/arquivos/imagem-service';
import { filtrarItens, ItemCatalogoDados, paraItemLocal } from './item-models';

const base: ItemCatalogoDados = {
  natureza: 'PRODUTO', codigo: 'PNL-550', nome: 'Painel Solar', descricao: null, unidade: 'un',
  precoCusto: 800, precoVenda: 1250.5, locavel: false, precoLocacaoMensal: null, fotoArquivoId: null, ativo: true,
};

describe('item-models', () => {
  const lista = [
    paraItemLocal('1', 0, base),
    paraItemLocal('2', 0, { ...base, natureza: 'SERVICO', codigo: 'INST', nome: 'Instalação', precoCusto: undefined }),
    paraItemLocal('3', 0, { ...base, codigo: 'GER', nome: 'Gerador', locavel: true, precoLocacaoMensal: 300 }),
    paraItemLocal('4', 0, { ...base, codigo: 'OLD', nome: 'Antigo', ativo: false }),
  ];
  const ids = (l: typeof lista) => l.map((i) => i.id);

  it('nome de busca inclui código e nome sem acento', () => {
    expect(lista[1].nomeBusca).toBe('inst instalacao');
    expect(lista[1].precoCusto).toBeNull();
  });

  it('filtra por natureza, locável e busca; esconde inativos por padrão', () => {
    expect(ids(filtrarItens(lista, 'TODOS', '', false))).toEqual(['1', '2', '3']);
    expect(ids(filtrarItens(lista, 'SERVICO', '', false))).toEqual(['2']);
    expect(ids(filtrarItens(lista, 'LOCAVEL', '', false))).toEqual(['3']);
    expect(ids(filtrarItens(lista, 'TODOS', 'pnl', false))).toEqual(['1']);
    expect(ids(filtrarItens(lista, 'TODOS', '', true))).toEqual(['1', '2', '3', '4']);
  });
});

describe('calcularDimensoes', () => {
  it('reduz o maior lado para o máximo e nunca amplia', () => {
    expect(calcularDimensoes(4000, 3000, 800)).toEqual({ largura: 800, altura: 600 });
    expect(calcularDimensoes(600, 1200, 800)).toEqual({ largura: 400, altura: 800 });
    expect(calcularDimensoes(300, 200, 800)).toEqual({ largura: 300, altura: 200 });
  });
});
