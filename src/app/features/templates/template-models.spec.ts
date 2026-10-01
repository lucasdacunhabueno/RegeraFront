// NOTA: casos-blocos.json precisa ficar IDÊNTICO a RegeraServer/src/test/resources/casos-blocos.json
// (BlocosValidatorCasosCompartilhadosTest). Ao mudar um, copie para o outro e atualize SHA_CASOS nos dois testes.
// Limitação: o SHA só pega uma cópia alterada sozinha. Quem muda o arquivo e o SHA_CASOS juntos num repo só vê esse
// repo passar; a divergência aparece apenas no teste do outro repo, que continua com o SHA antigo.
import casosTexto from './casos-blocos.json' with { loader: 'text' };
import {
  Bloco,
  blocosIniciais,
  COLUNAS_ITENS,
  dadosDoTemplate,
  novoBloco,
  padraoEfetivo,
  paraTemplateLocal,
  TemplateDados,
  TIPOS_PROPOSTA,
  TipoBloco,
  validarBlocos,
  VARIAVEIS,
} from './template-models';

/** SHA-256 do arquivo com fins de linha normalizados para LF. O teste Java tem a mesma constante. */
const SHA_CASOS = '0aa0363b93869e03f2603674e2e5f621bf3fb2adcc7105f786d3247071c13fab';

interface Caso {
  grupo: string;
  caso: string;
  blocos: unknown;
  erros: Record<string, string>;
}

const texto = (casosTexto as unknown as string).replace(/\r\n/g, '\n');
/**
 * Um texto JSON exatamente "<<c*n>>" vale o caractere c repetido n vezes; c é ASCII imprimível sem aspas nem barra
 * invertida e n são dígitos decimais (mesma regex do teste Java).
 */
const expandido = texto.replace(/"<<([ !#-[\]-~])\*([0-9]+)>>"/g, (_, c: string, n: string) => `"${c.repeat(Number(n))}"`);
const casos = (JSON.parse(expandido) as { casos: Caso[] }).casos;

const TIPOS: TipoBloco[] = ['CABECALHO', 'TEXTO', 'ITENS', 'TOTAIS', 'ASSINATURA', 'QUEBRA_PAGINA'];

describe('template-models', () => {
  describe('validarBlocos: casos compartilhados com o BlocosValidator do servidor', () => {
    it('o arquivo é o mesmo do servidor (SHA_CASOS)', async () => {
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
      expect([...hash].map((b) => b.toString(16).padStart(2, '0')).join('')).toBe(SHA_CASOS);
    });

    it('tem os casos esperados', () => {
      expect(casos.length).toBeGreaterThan(60);
    });

    it.each(casos.map((c) => [`${c.grupo}: ${c.caso}`, c] as const))('%s', (_, c) => {
      expect(Object.entries(validarBlocos(c.blocos))).toEqual(Object.entries(c.erros));
    });
  });

  it('valida o que vai pela rede: undefined some como no JSON enviado', () => {
    const bloco = { id: 'a', tipo: 'TOTAIS', config: { mostrarDescontos: true, extra: undefined } };
    expect(validarBlocos([bloco])).toEqual({});
  });

  it('recusa atributos extras do Tiptap 3 (orderedList.attrs.type)', () => {
    const b: Bloco = {
      id: 'a', tipo: 'TEXTO',
      config: { conteudo: { type: 'doc', content: [{ type: 'orderedList', attrs: { start: 1, type: null }, content: [
        { type: 'listItem', content: [{ type: 'paragraph' }] }] }] } },
    };
    expect(validarBlocos([b])).toEqual({ 'blocos[0].config.conteudo': 'Conteúdo com formatação não permitida.' });
  });

  it('novoBloco de cada tipo é válido, com a configuração padrão', () => {
    for (const tipo of TIPOS) {
      const b = novoBloco(tipo);
      expect(b.tipo).toBe(tipo);
      expect(b.id.length).toBeGreaterThan(0);
      expect(validarBlocos([b])).toEqual({});
    }
    expect(novoBloco('CABECALHO').config).toEqual({ mostrarLogo: true, mostrarDadosEmpresa: true, titulo: 'Proposta {{proposta.numero}}' });
    expect(novoBloco('ITENS').config).toEqual({
      colunas: ['codigo', 'descricao', 'quantidade', 'unidade', 'precoUnitario', 'subtotal'], agruparPorNatureza: false,
    });
    expect(novoBloco('TOTAIS').config).toEqual({ mostrarDescontos: true });
    expect(novoBloco('ASSINATURA').config).toEqual({ assinantes: ['EMPRESA', 'CLIENTE'] });
    expect(novoBloco('TEXTO').config).toEqual({ conteudo: { type: 'doc', content: [{ type: 'paragraph' }] } });
    expect(novoBloco('QUEBRA_PAGINA').config).toEqual({});
    expect(novoBloco('TEXTO').id).not.toBe(novoBloco('TEXTO').id);
  });

  it('blocosIniciais: cabeçalho, texto, itens, totais e assinatura, válidos e com ids distintos', () => {
    const blocos = blocosIniciais();
    expect(blocos.map((b) => b.tipo)).toEqual(['CABECALHO', 'TEXTO', 'ITENS', 'TOTAIS', 'ASSINATURA']);
    expect(new Set(blocos.map((b) => b.id)).size).toBe(5);
    expect(validarBlocos(blocos)).toEqual({});
  });

  it('constantes com rótulos em pt-BR', () => {
    expect(VARIAVEIS.find((v) => v.nome === 'cliente.nome')?.rotulo).toBe('Nome do cliente');
    expect(VARIAVEIS).toHaveLength(22);
    expect(new Set(VARIAVEIS.map((v) => v.nome)).size).toBe(22);
    expect(TIPOS_PROPOSTA.map((t) => t.rotulo)).toEqual(['Venda', 'Serviço', 'Manutenção', 'Locação']);
    expect(COLUNAS_ITENS.map((c) => c.valor)).toEqual(
      ['codigo', 'descricao', 'quantidade', 'unidade', 'precoUnitario', 'desconto', 'meses', 'subtotal']);
  });

  describe('padraoEfetivo', () => {
    const t = (id: string, nome: string, padrao = true, ativo = true, tipo: TemplateDados['tipoProposta'] = 'SERVICO') =>
      paraTemplateLocal(id, 1, { nome, tipoProposta: tipo, padrao, ativo, blocos: [] });
    const lista = [t('a', 'Alfa'), t('b', 'Beta'), t('c', 'Gama'), t('i', 'Inativo', true, false), t('n', 'Não', false),
      t('v', 'Venda', true, true, 'VENDA')];

    it('sem pendentes: o de menor nome (depois id) entre os padrão e ativos do tipo', () => {
      expect(padraoEfetivo(lista, 'SERVICO', new Set())?.id).toBe('a');
      expect(padraoEfetivo([t('z', 'Mesmo'), t('y', 'Mesmo')], 'SERVICO', new Set())?.id).toBe('y');
      expect(padraoEfetivo(lista, 'VENDA', new Set())?.id).toBe('v');
      expect(padraoEfetivo(lista, 'LOCACAO', new Set())).toBeUndefined();
    });

    it('prefere o pendente; entre vários, o mais recente (último do conjunto)', () => {
      expect(padraoEfetivo(lista, 'SERVICO', new Set(['c']))?.id).toBe('c');
      expect(padraoEfetivo(lista, 'SERVICO', new Set(['c', 'b']))?.id).toBe('b');
      expect(padraoEfetivo(lista, 'SERVICO', new Set(['b', 'c']))?.id).toBe('c');
    });

    it('pendente que não é padrão ativo não conta', () => {
      expect(padraoEfetivo(lista, 'SERVICO', new Set(['i', 'n', 'v']))?.id).toBe('a');
    });
  });

  it('paraTemplateLocal / dadosDoTemplate: nome de busca e ida e volta; bloco desconhecido é preservado', () => {
    const desconhecido = { id: 'x', tipo: 'IMAGEM', config: { src: 'a' } } as unknown as Bloco;
    const dados: TemplateDados = { nome: 'Serviço Padrão', tipoProposta: 'SERVICO', padrao: true, ativo: true, blocos: [desconhecido] };
    const local = paraTemplateLocal('t1', 3, dados);
    expect(local).toMatchObject({ id: 't1', version: 3, nomeBusca: 'servico padrao' });
    expect(dadosDoTemplate(local)).toEqual(dados);
  });
});
