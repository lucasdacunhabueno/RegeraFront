import {
  LucideClipboardList,
  LucideFileText,
  LucideIcon,
  LucideMenu,
  LucidePackage,
  LucideSquareKanban,
  LucideUsers,
} from '@lucide/angular';
import { Perfil } from '../../core/auth/auth-models';

export interface ItemNav {
  rota: string;
  rotulo: string;
  icone: LucideIcon;
  perfis: Perfil[];
  /** Só no menu lateral (desktop); no celular o item fica na página "Mais", para a barra inferior ter até cinco abas. */
  soLateral?: boolean;
}

/**
 * M2-P3: o técnico trabalha pela OS ("Minhas OS" + "Mais", spec §9). O escritório ganha "OS" depois de Propostas; na
 * barra inferior, o Catálogo (consulta e cadastro, menos usado no dia a dia) vai para "Mais", e ficam cinco abas.
 */
export const ITENS_NAV: ItemNav[] = [
  { rota: '/kanban', rotulo: 'Kanban', icone: LucideSquareKanban, perfis: ['ADMIN', 'COMERCIAL'] },
  { rota: '/propostas', rotulo: 'Propostas', icone: LucideFileText, perfis: ['ADMIN', 'COMERCIAL'] },
  { rota: '/os', rotulo: 'Minhas OS', icone: LucideClipboardList, perfis: ['TECNICO'] },
  { rota: '/os', rotulo: 'OS', icone: LucideClipboardList, perfis: ['ADMIN', 'COMERCIAL'] },
  { rota: '/clientes', rotulo: 'Clientes', icone: LucideUsers, perfis: ['ADMIN', 'COMERCIAL'] },
  { rota: '/catalogo', rotulo: 'Catálogo', icone: LucidePackage, perfis: ['ADMIN', 'COMERCIAL'], soLateral: true },
  { rota: '/mais', rotulo: 'Mais', icone: LucideMenu, perfis: ['ADMIN', 'COMERCIAL', 'TECNICO'] },
];

/** Os itens do perfil no menu lateral (desktop) ou na barra inferior (celular). */
export function itensPara(perfil: Perfil, lugar: 'lateral' | 'inferior' = 'lateral'): ItemNav[] {
  return ITENS_NAV.filter((i) => i.perfis.includes(perfil) && (lugar === 'lateral' || !i.soLateral));
}
