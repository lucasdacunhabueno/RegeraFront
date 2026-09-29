import { itensPara } from './navegacao';

describe('navegacao', () => {
  const rotas = (p: Parameters<typeof itensPara>[0]) => itensPara(p).map((i) => i.rota);

  it('admin e comercial veem os cinco itens', () => {
    expect(rotas('ADMIN')).toEqual(['/kanban', '/propostas', '/clientes', '/catalogo', '/mais']);
    expect(rotas('COMERCIAL')).toEqual(['/kanban', '/propostas', '/clientes', '/catalogo', '/mais']);
  });

  it('técnico vê só propostas e mais', () => {
    expect(rotas('TECNICO')).toEqual(['/propostas', '/mais']);
  });
});
