import { LucideFileText, LucideIcon, LucideMenu, LucidePackage, LucideSquareKanban, LucideUsers } from '@lucide/angular';
import { Perfil } from '../../core/auth/auth-models';

export interface ItemNav {
  rota: string;
  rotulo: string;
  icone: LucideIcon;
  perfis: Perfil[];
}

export const ITENS_NAV: ItemNav[] = [
  { rota: '/kanban', rotulo: 'Kanban', icone: LucideSquareKanban, perfis: ['ADMIN', 'COMERCIAL'] },
  { rota: '/propostas', rotulo: 'Propostas', icone: LucideFileText, perfis: ['ADMIN', 'COMERCIAL', 'TECNICO'] },
  { rota: '/clientes', rotulo: 'Clientes', icone: LucideUsers, perfis: ['ADMIN', 'COMERCIAL'] },
  { rota: '/catalogo', rotulo: 'Catálogo', icone: LucidePackage, perfis: ['ADMIN', 'COMERCIAL'] },
  { rota: '/mais', rotulo: 'Mais', icone: LucideMenu, perfis: ['ADMIN', 'COMERCIAL', 'TECNICO'] },
];

export function itensPara(perfil: Perfil): ItemNav[] {
  return ITENS_NAV.filter((i) => i.perfis.includes(perfil));
}
