import type { UsuarioResumo } from '../sync/sync-models';
import { opcoesDeResponsavel, RESPONSAVEL_FORA_DA_LISTA } from './responsaveis';

const usuario = (id: string, nome: string, perfil: UsuarioResumo['perfil'], ativo?: boolean): UsuarioResumo =>
  ({ id, nome, perfil, ...(ativo === undefined ? {} : { ativo }) });

const USUARIOS: UsuarioResumo[] = [
  usuario('c1', 'Carla Comercial', 'COMERCIAL'),
  usuario('t1', 'Tiago Técnico', 'TECNICO'),
  usuario('a1', 'Ana Admin', 'ADMIN', true),
  usuario('c2', 'Caio Comercial', 'COMERCIAL', false),
  usuario('e1', 'Érica Comercial', 'COMERCIAL'),
];

describe('opcoesDeResponsavel', () => {
  it('oferece ADMIN e COMERCIAL ativos em ordem pt-BR, sem técnico nem inativo', () => {
    expect(opcoesDeResponsavel(USUARIOS, 'a1')).toEqual([
      { id: 'a1', rotulo: 'Ana Admin' },
      { id: 'c1', rotulo: 'Carla Comercial' },
      { id: 'e1', rotulo: 'Érica Comercial' },
    ]);
  });

  it('o atual inativo fica, marcado', () => {
    expect(opcoesDeResponsavel(USUARIOS, 'c2').map((o) => o.rotulo)).toEqual([
      'Ana Admin', 'Caio Comercial (inativo)', 'Carla Comercial', 'Érica Comercial',
    ]);
  });

  it('o atual que não está no aparelho vem primeiro, com o rótulo próprio', () => {
    expect(opcoesDeResponsavel(USUARIOS, 'x9')[0]).toEqual({ id: 'x9', rotulo: RESPONSAVEL_FORA_DA_LISTA });
    expect(RESPONSAVEL_FORA_DA_LISTA).toBe('Responsável atual (não está neste aparelho)');
    expect(opcoesDeResponsavel(USUARIOS, 'x9')).toHaveLength(4);
  });

  it('o atual técnico (está no aparelho, mas não pode ser responsável) não ganha opção', () => {
    expect(opcoesDeResponsavel(USUARIOS, 't1').map((o) => o.id)).toEqual(['a1', 'c1', 'e1']);
  });

  it('sem atual, só a lista; sem usuários, vazia', () => {
    expect(opcoesDeResponsavel(USUARIOS, null)).toHaveLength(3);
    expect(opcoesDeResponsavel([], null)).toEqual([]);
    expect(opcoesDeResponsavel([], 'a1')).toEqual([{ id: 'a1', rotulo: RESPONSAVEL_FORA_DA_LISTA }]);
  });
});
