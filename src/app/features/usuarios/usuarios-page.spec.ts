import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { UsuariosPage } from './usuarios-page';

describe('UsuariosPage', () => {
  it('lista usuários com perfil e marca inativos', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(UsuariosPage);
    fixture.detectChanges();

    TestBed.inject(HttpTestingController).expectOne('/api/usuarios').flush([
      { id: '1', nome: 'Ana', email: 'ana@regera.test', perfil: 'COMERCIAL', ativo: true },
      { id: '2', nome: 'Bruno', email: 'bruno@regera.test', perfil: 'TECNICO', ativo: false },
    ]);
    await vi.waitFor(() => {
      fixture.detectChanges();
      const texto = fixture.nativeElement.textContent as string;
      expect(texto).toContain('Ana');
      expect(texto).toContain('Comercial');
      expect(texto).toContain('Técnico');
      expect(texto).toContain('Inativo');
    });
  });
});
