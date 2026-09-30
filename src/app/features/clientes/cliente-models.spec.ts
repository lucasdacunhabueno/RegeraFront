import { ClienteDados, dadosDoCliente, filtrarClientes, paraClienteLocal } from './cliente-models';

const base: ClienteDados = {
  tipo: 'PF', documento: '52998224725', nome: 'João Ávila', nomeFantasia: null, inscricaoEstadual: null,
  inscricaoMunicipal: null, email: null, telefone: '11999998888', whatsapp: null, contatoNome: null,
  observacoes: null, enderecos: [],
};

describe('cliente-models', () => {
  it('monta registro local com nome de busca', () => {
    const c = paraClienteLocal('id1', 2, base);
    expect(c.nomeBusca).toBe('joao avila');
    expect(c.version).toBe(2);
    expect(dadosDoCliente(c)).toEqual(base);
  });

  it('filtra por nome sem acento, documento com máscara e telefone', () => {
    const lista = [paraClienteLocal('1', 0, base), paraClienteLocal('2', 0, { ...base, documento: '11222333000181', nome: 'ACME', telefone: null })];
    expect(filtrarClientes(lista, 'joao').map((c) => c.id)).toEqual(['1']);
    expect(filtrarClientes(lista, '11.222').map((c) => c.id)).toEqual(['2']);
    expect(filtrarClientes(lista, '99999').map((c) => c.id)).toEqual(['1']);
    expect(filtrarClientes(lista, '  ')).toHaveLength(2);
  });
});
