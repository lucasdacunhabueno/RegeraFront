import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { Perfil } from '../../core/auth/auth-models';
import { AuthService } from '../../core/auth/auth-service';
import { Shell } from './shell';

function montar(perfil: Perfil, sessaoExpirada = false) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideServiceWorker('ngsw-worker.js', { enabled: false }),
      {
        provide: AuthService,
        useValue: {
          usuario: signal({ id: '1', nome: 'Ana Souza', email: 'a@a', perfil, ativo: true }),
          sessaoExpirada: signal(sessaoExpirada),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Shell);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Shell', () => {
  it('mostra nome do usuário e status de conexão', () => {
    const el = montar('COMERCIAL');
    expect(el.textContent).toContain('Ana Souza');
    expect(el.querySelector('[data-testid=status-conexao]')?.textContent).toMatch(/Online|Offline/);
  });

  it('técnico não vê Kanban nem Clientes', () => {
    const el = montar('TECNICO');
    expect(el.textContent).not.toContain('Kanban');
    expect(el.textContent).not.toContain('Clientes');
    expect(el.textContent).toContain('Propostas');
  });

  it('mostra aviso quando a sessão expirou', () => {
    const el = montar('COMERCIAL', true);
    expect(el.textContent).toContain('Sua sessão expirou');
  });
});
