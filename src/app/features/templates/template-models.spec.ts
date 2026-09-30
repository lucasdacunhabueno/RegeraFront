// NOTA: casos-blocos.json precisa ficar IDÊNTICO a RegeraServer/src/test/resources/casos-blocos.json
// (BlocosValidatorCasosCompartilhadosTest). Ao mudar um, copie para o outro e atualize SHA_CASOS nos dois testes.
import casosTexto from './casos-blocos.json' with { loader: 'text' };
import {
  Bloco,
  blocosIniciais,
  COLUNAS_ITENS,
  dadosDoTemplate,
  novoBloco,
  paraTemplateLocal,
  TemplateDados,
  TIPOS_PROPOSTA,
  TipoBloco,
  validarBlocos,
  VARIAVEIS,
} from './template-models';

/** SHA-256 do arquivo com fins de linha normalizados para LF. O teste Java tem a mesma constante. */
const SHA_CASOS = 'a59db76ef7a5c2baa527423b61727efed5b51994c0c4257979758474a0c2cf83';

interface Caso {
  grupo: string;
  caso: string;
  blocos: unknown;
  erros: Record<string, string>;
}

const texto = (casosTexto as unknown as string).replace(/\r\n/g, '\n');
/** Um texto JSON exatamente "<<c*n>>" vale o caractere c repetido n vezes (igual ao teste Java). */
const expandido = texto.replace(/"<<(.)\*(\d+)>>"/g, (_, c: string, n: string) => `"${c.repeat(Number(n))}"`);
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

  it('paraTemplateLocal / dadosDoTemplate: nome de busca e ida e volta; bloco desconhecido é preservado', () => {
    const desconhecido = { id: 'x', tipo: 'IMAGEM', config: { src: 'a' } } as unknown as Bloco;
    const dados: TemplateDados = { nome: 'Serviço Padrão', tipoProposta: 'SERVICO', padrao: true, ativo: true, blocos: [desconhecido] };
    const local = paraTemplateLocal('t1', 3, dados);
    expect(local).toMatchObject({ id: 't1', version: 3, nomeBusca: 'servico padrao' });
    expect(dadosDoTemplate(local)).toEqual(dados);
  });
});
