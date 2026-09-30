import { TestBed } from '@angular/core/testing';
import { ConectividadeService } from './conectividade-service';

describe('ConectividadeService', () => {
  it('acompanha eventos online/offline do navegador', () => {
    const svc = TestBed.inject(ConectividadeService);

    window.dispatchEvent(new Event('offline'));
    expect(svc.online()).toBe(false);

    window.dispatchEvent(new Event('online'));
    expect(svc.online()).toBe(true);
  });
});
