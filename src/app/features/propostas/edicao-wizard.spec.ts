import casosTexto from './casos-calculo.json' with { loader: 'text' };
import {
  campoDaLinha,
  lerCampoDecimal,
  lerLinha,
  LinhaEditavel,
  linhaComMeses,
  mensagemDecimal,
  paraLinhaEditavel,
  passoDoCampo,
  textoDecimal,
  textoMoeda,
  totaisDe,
} from './edicao-wizard';
import { ItemPropostaLocal } from './proposta-models';
import { paraItemLocal } from '../catalogo/item-models';

const linhaLocal = (l: Partial<ItemPropostaLocal> = {}): ItemPropostaLocal => ({
  id: 'l1', itemCatalogoId: 'i1', codigo: 'PNL', nome: 'Painel', descricao: null, unidade: 'un', natureza: 'PRODUTO',
  precoCustoCentavos: null, quantidadeMilesimos: 1500, precoUnitarioCentavos: 123456, descontoCentesimos: 1250, meses: null,
  subtotalCentavos: null, ordem: 0, ...l,
});

interface Caso {
  nome: string;
  locacao: boolean;
  descontoGeral: string;
  linhas: { quantidade: string; precoUnitario: string; descontoPercentual: string; meses: number | null }[];
  esperado: { subtotais: string[]; totalItens: string; totalDescontos: string; total: string };
}
const casos = (JSON.parse(casosTexto as unknown as string) as { casos: Caso[] }).casos;

const editavel = (l: Partial<LinhaEditavel> = {}): LinhaEditavel => ({ ...paraLinhaEditavel(linhaLocal()), ...l });

describe('edicao-wizard', () => {
  it('mensagemDecimal: os textos do Global Constraints', () => {
    expect(mensagemDecimal('VAZIO', 2)).toBe('Informe o valor.');
    expect(mensagemDecimal('NEGATIVO', 2)).toBe('Não pode ser negativo.');
    expect(mensagemDecimal('CASAS', 3)).toBe('Até 3 casas decimais.');
    expect(mensagemDecimal('AMBIGUO', 3)).toBe('Use vírgula para decimais (ex.: 1,5).');
    expect(mensagemDecimal('INVALIDO', 2)).toBe('Valor inválido.');
  });

  it('textoDecimal: vírgula decimal, sem milhar (relido por lerDecimalEstrito sem ambiguidade)', () => {
    expect(textoDecimal(1500n, 3, false)).toBe('1,5');
    expect(textoDecimal(1000n, 3, false)).toBe('1');
    expect(textoDecimal(123456n, 2, true)).toBe('1234,56');
    expect(textoDecimal(0n, 2, false)).toBe('0');
  });

  it('textoMoeda: milhar pt-BR com 2 casas, relido por lerDecimalEstrito sem ambiguidade', () => {
    expect(textoMoeda(125050n)).toBe('1.250,50');
    expect(textoMoeda(0n)).toBe('0,00');
    expect(textoMoeda(99_999_999_999_999n)).toBe('999.999.999.999,99');
    for (const v of [5n, 125050n, 100000n, 99_999_999_999_999n]) {
      expect(lerCampoDecimal(textoMoeda(v), 2, 0n, 99_999_999_999_999n, 'x')).toBe(v);
    }
  });

  it('lerCampoDecimal: valor, erro de digitação ou fora do limite', () => {
    expect(lerCampoDecimal('1.234,56', 2, 0n, 1_000_000n, 'limite')).toBe(123456n);
    expect(lerCampoDecimal('1.234', 3, 1n, 999_999_999n, 'limite')).toBe('Use vírgula para decimais (ex.: 1,5).');
    expect(lerCampoDecimal('0', 3, 1n, 999_999_999n, 'limite')).toBe('limite');
    expect(lerCampoDecimal('100,01', 2, 0n, 10_000n, 'limite')).toBe('limite');
  });

  it('paraLinhaEditavel e lerLinha vão e voltam', () => {
    const l = editavel();
    expect(l).toMatchObject({ quantidade: '1,5', preco: '1.234,56', desconto: '12,5', meses: '' });
    const lida = lerLinha(l, false);
    expect(lida.erros).toEqual({});
    expect(lida.linha).toMatchObject({ id: 'l1', quantidadeMilesimos: 1500, precoUnitarioCentavos: 123456, descontoCentesimos: 1250, meses: null });
  });

  it('lerLinha: erros por campo, com os limites do servidor', () => {
    const lida = lerLinha(editavel({ quantidade: '1.234', preco: '-1', desconto: '101', meses: '0' }), true);
    expect(lida.linha).toBeNull();
    expect(lida.erros).toEqual({
      quantidade: 'Use vírgula para decimais (ex.: 1,5).',
      preco: 'Não pode ser negativo.',
      desconto: 'O desconto vai de 0 a 100%.',
      meses: 'De 1 a 120 meses.',
    });
    expect(lerLinha(editavel({ meses: '121' }), true).erros.meses).toBe('De 1 a 120 meses.');
    expect(lerLinha(editavel({ meses: '1,5' }), true).erros.meses).toBe('De 1 a 120 meses.');
    expect(lerLinha(editavel({ meses: '' }), true).erros.meses).toBe('Informe o valor.');
    expect(lerLinha(editavel({ meses: '12' }), true).linha?.meses).toBe(12);
    // fora de LOCACAO com locável, os meses digitados são ignorados (o servidor recusaria)
    expect(lerLinha(editavel({ meses: 'x' }), false).linha?.meses).toBeNull();
  });

  it('linhaComMeses: só LOCACAO com item locável; sem o item no aparelho, o que a linha já tinha', () => {
    const locavel = paraItemLocal('i1', 1, {
      natureza: 'PRODUTO', codigo: 'G', nome: 'Gerador', descricao: null, unidade: 'un', locavel: true, fotoArquivoId: null, ativo: true,
    });
    const venda = { ...locavel, locavel: false };
    expect(linhaComMeses('LOCACAO', editavel(), locavel)).toBe(true);
    expect(linhaComMeses('LOCACAO', editavel(), venda)).toBe(false);
    expect(linhaComMeses('VENDA', editavel(), locavel)).toBe(false);
    expect(linhaComMeses('LOCACAO', editavel({ mesesAoCarregar: 3 }), undefined)).toBe(true);
    expect(linhaComMeses('LOCACAO', editavel({ mesesAoCarregar: null }), undefined)).toBe(false);
  });

  it('quantidade "1,5" e preço "1.234,56" dão o subtotal 1.851,84', () => {
    const lida = lerLinha(editavel({ quantidade: '1,5', preco: '1.234,56', desconto: '0' }), false);
    expect(totaisDe([lida.linha!], 0n, 'VENDA').subtotaisCentavos).toEqual([185184n]);
  });

  it('totaisDe confere com casos-calculo.json (o mesmo cálculo do servidor)', () => {
    for (const c of casos.filter((x) => x.linhas.length > 0 && x.linhas.length < 10)) {
      const linhas = c.linhas.map((l, i) => {
        const lida = lerLinha(
          editavel({
            id: `l${i}`,
            quantidade: l.quantidade.replace('.', ','),
            preco: l.precoUnitario.replace('.', ','),
            desconto: l.descontoPercentual.replace('.', ','),
            meses: l.meses === null ? '' : String(l.meses),
          }),
          l.meses !== null,
        );
        expect(lida.erros, c.nome).toEqual({});
        return lida.linha!;
      });
      const geral = lerCampoDecimal(c.descontoGeral.replace('.', ','), 2, 0n, 10_000n, 'x') as bigint;
      const r = totaisDe(linhas, geral, c.locacao ? 'LOCACAO' : 'VENDA');
      const centavos = (v: string) => BigInt(v.replace('.', ''));
      expect(r.totalCentavos, c.nome).toBe(centavos(c.esperado.total));
      expect(r.totalDescontosCentavos, c.nome).toBe(centavos(c.esperado.totalDescontos));
      expect(r.subtotaisCentavos, c.nome).toEqual(c.esperado.subtotais.map(centavos));
    }
  });

  it('passoDoCampo e campoDaLinha leem os nomes de campo do servidor', () => {
    expect(passoDoCampo('clienteId')).toBe(1);
    expect(passoDoCampo('tipo')).toBe(1);
    expect(passoDoCampo('itens')).toBe(2);
    expect(passoDoCampo('itens[3].quantidade')).toBe(2);
    expect(passoDoCampo('templateId')).toBe(3);
    expect(passoDoCampo('descontoGeralPercentual')).toBe(3);
    expect(passoDoCampo('proposta')).toBeNull();
    expect(campoDaLinha('itens[3].quantidade')).toEqual({ indice: 3, campo: 'quantidade' });
    expect(campoDaLinha('itens[0].precoUnitario')).toEqual({ indice: 0, campo: 'preco' });
    expect(campoDaLinha('itens[1].descontoPercentual')).toEqual({ indice: 1, campo: 'desconto' });
    expect(campoDaLinha('itens[2].meses')).toEqual({ indice: 2, campo: 'meses' });
    expect(campoDaLinha('itens[2].itemCatalogoId')).toEqual({ indice: 2, campo: 'geral' });
    expect(campoDaLinha('itens')).toBeNull();
  });
});
