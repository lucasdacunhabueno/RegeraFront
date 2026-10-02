import { itensPara } from './navegacao';

describe('navegacao', () => {
  const rotas = (p: Parameters<typeof itensPara>[0], lugar?: Parameters<typeof itensPara>[1]) => itensPara(p, lugar).map((i) => i.rota);
  const rotulos = (p: Parameters<typeof itensPara>[0], lugar?: Parameters<typeof itensPara>[1]) => itensPara(p, lugar).map((i) => i.rotulo);

  it('admin e comercial, no menu lateral: Kanban, Propostas, OS, Clientes, Catálogo e Mais', () => {
    for (const p of ['ADMIN', 'COMERCIAL'] as const) {
      expect(rotas(p)).toEqual(['/kanban', '/propostas', '/os', '/clientes', '/catalogo', '/mais']);
      expect(rotulos(p, 'lateral')).toEqual(['Kanban', 'Propostas', 'OS', 'Clientes', 'Catálogo', 'Mais']);
    }
  });

  it('admin e comercial, na barra inferior: cinco abas, o Catálogo fica em Mais', () => {
    for (const p of ['ADMIN', 'COMERCIAL'] as const) {
      expect(rotas(p, 'inferior')).toEqual(['/kanban', '/propostas', '/os', '/clientes', '/mais']);
    }
  });

  it('técnico: só "Minhas OS" e "Mais", nos dois lugares; nada de Propostas', () => {
    for (const lugar of ['lateral', 'inferior'] as const) {
      expect(rotas('TECNICO', lugar)).toEqual(['/os', '/mais']);
      expect(rotulos('TECNICO', lugar)).toEqual(['Minhas OS', 'Mais']);
    }
  });
});
