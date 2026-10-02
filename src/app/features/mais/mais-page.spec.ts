import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { Perfil } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { ConectividadeService } from '../../core/conectividade/conectividade-service';
import { SyncService } from '../../core/sync/sync-service';
import { MaisPage } from './mais-page';

function montar(perfil: Perfil, contagens: number[] = [0], online = true) {
  const logout = vi.fn().mockResolvedValue(undefined);
  const contar = vi.fn();
  contagens.forEach((n) => contar.mockResolvedValueOnce(n));
  contar.mockResolvedValue(contagens.at(-1));
  const sincronizar = vi.fn().mockResolvedValue(undefined);
  const aguardarOciosa = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { usuario: signal({ id: '1', nome: 'A', email: 'a@a', perfil, ativo: true }), logout } },
      { provide: ConectividadeService, useValue: { online: signal(online) } },
      {
        provide: SyncService,
        useValue: { naoSincronizados: signal(contagens[0]), problemas: signal(0), contarNaoSincronizados: contar, sincronizar, aguardarOciosa },
      },
    ],
  });
  const fixture = TestBed.createComponent(MaisPage);
  fixture.detectChanges();
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return { el: fixture.nativeElement as HTMLElement, logout, sincronizar, navegar, aguardarOciosa };
}

describe('MaisPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('admin vê Usuários e Empresa', () => {
    const { el } = montar('ADMIN');
    expect(el.textContent).toContain('Usuários');
    expect(el.textContent).toContain('Empresa');
  });

  it('admin vê "Templates de proposta" entre Usuários e Empresa', () => {
    const { el } = montar('ADMIN');
    const links = [...el.querySelectorAll('a')].map((a) => a.textContent?.trim());
    const i = links.indexOf('Templates de proposta');
    expect(i).toBe(links.indexOf('Usuários') + 1);
    expect(links[i + 1]).toBe('Empresa');
    expect(el.querySelector('a[href="/templates"]')).toBeTruthy();
  });

  it('M2-P3: admin e comercial têm o Catálogo aqui no celular (saiu da barra inferior); no desktop ele está no menu lateral', () => {
    for (const perfil of ['ADMIN', 'COMERCIAL'] as const) {
      TestBed.resetTestingModule();
      const { el } = montar(perfil);
      const link = el.querySelector<HTMLAnchorElement>('a[href="/catalogo"]');
      expect(link?.textContent?.trim()).toBe('Catálogo');
      expect(link?.closest('li')?.classList).toContain('lg:hidden');
      expect(link?.classList).toContain('py-4');
    }
  });

  it('M2-P3: o técnico não tem Catálogo', () => {
    const { el } = montar('TECNICO');
    expect(el.querySelector('a[href="/catalogo"]')).toBeNull();
    expect(el.textContent).toContain('Trocar senha');
  });

  it('comercial não vê Usuários nem Empresa', () => {
    const { el } = montar('COMERCIAL');
    expect(el.textContent).not.toContain('Templates de proposta');
    expect(el.textContent).not.toContain('Usuários');
    expect(el.textContent).toContain('Trocar senha');
  });

  it('mostra o contador de pendências', () => {
    const { el } = montar('COMERCIAL', [4]);
    expect(el.querySelector('[data-testid=contador-pendencias]')?.textContent?.trim()).toBe('4');
  });

  it('sem pendências sai direto', async () => {
    const { el, logout, navegar } = montar('COMERCIAL', [0]);
    el.querySelector<HTMLButtonElement>('[data-testid=sair]')!.click();
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/login'));
    expect(logout).toHaveBeenCalled();
  });

  it('sair espera a sincronização ociosa antes do logout e ignora toque duplo', async () => {
    const { el, logout, navegar, aguardarOciosa } = montar('COMERCIAL', [0]);
    let liberar!: () => void;
    aguardarOciosa.mockReturnValue(new Promise<void>((r) => (liberar = r)));
    const botao = el.querySelector<HTMLButtonElement>('[data-testid=sair]')!;
    botao.click();
    botao.click();
    await vi.waitFor(() => expect(aguardarOciosa).toHaveBeenCalled());
    expect(logout).not.toHaveBeenCalled();
    liberar();
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/login'));
    expect(aguardarOciosa).toHaveBeenCalledBefore(logout);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('com pendências tenta sincronizar e, se sobrar algo e o usuário recusar, não sai', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { el, logout, sincronizar } = montar('COMERCIAL', [2, 1]);
    el.querySelector<HTMLButtonElement>('[data-testid=sair]')!.click();
    await vi.waitFor(() => expect(confirmar).toHaveBeenCalled());
    expect(sincronizar).toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it('com pendências e confirmação, sai', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { el, logout } = montar('COMERCIAL', [2, 2], false);
    el.querySelector<HTMLButtonElement>('[data-testid=sair]')!.click();
    await vi.waitFor(() => expect(logout).toHaveBeenCalled());
  });
});
