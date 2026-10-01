import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { EmpresaDados } from './empresa-models';

export interface EmpresaResposta {
  version: number;
  dados: Partial<EmpresaDados>;
}

@Injectable({ providedIn: 'root' })
export class EmpresaApi {
  private readonly http = inject(HttpClient);

  async obter(): Promise<EmpresaResposta | null> {
    try {
      return await firstValueFrom(this.http.get<EmpresaResposta>('/api/empresa'));
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 404) return null;
      throw e;
    }
  }

  salvar(version: number | null, dados: EmpresaDados): Promise<EmpresaResposta> {
    return firstValueFrom(this.http.put<EmpresaResposta>('/api/empresa', { version, dados }));
  }
}
