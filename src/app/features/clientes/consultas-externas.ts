import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { somenteDigitos } from '../../core/util/formatos';

export interface EnderecoParcial {
  cep?: string | null;
  logradouro: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

export interface DadosCnpj {
  nome: string | null;
  nomeFantasia: string | null;
  email: string | null;
  telefone: string | null;
  endereco: EnderecoParcial;
}

interface RespostaViaCep {
  erro?: boolean | string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
}

interface RespostaBrasilApi {
  razao_social?: string;
  nome_fantasia?: string;
  email?: string | null;
  ddd_telefone_1?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
}

const vazio = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Atalhos opcionais que só funcionam com internet; falha sempre devolve null. */
@Injectable({ providedIn: 'root' })
export class ConsultasExternas {
  private readonly http = inject(HttpClient);

  async buscarCep(cep: string): Promise<EnderecoParcial | null> {
    const d = somenteDigitos(cep);
    if (d.length !== 8) return null;
    try {
      const r = await firstValueFrom(this.http.get<RespostaViaCep>(`https://viacep.com.br/ws/${d}/json/`).pipe(timeout(8000)));
      if (r.erro) return null;
      return { logradouro: vazio(r.logradouro), bairro: vazio(r.bairro), cidade: vazio(r.localidade), uf: vazio(r.uf) };
    } catch {
      return null;
    }
  }

  async buscarCnpj(cnpj: string): Promise<DadosCnpj | null> {
    const d = cnpj.replace(/[^0-9A-Za-z]/g, '');
    if (!/^\d{14}$/.test(d)) return null;
    try {
      const r = await firstValueFrom(
        this.http.get<RespostaBrasilApi>(`https://brasilapi.com.br/api/cnpj/v1/${d}`).pipe(timeout(8000)),
      );
      return {
        nome: vazio(r.razao_social),
        nomeFantasia: vazio(r.nome_fantasia),
        email: vazio(r.email),
        telefone: vazio(somenteDigitos(r.ddd_telefone_1)),
        endereco: {
          cep: vazio(somenteDigitos(r.cep)),
          logradouro: vazio(r.logradouro),
          numero: vazio(r.numero),
          complemento: vazio(r.complemento),
          bairro: vazio(r.bairro),
          cidade: vazio(r.municipio),
          uf: vazio(r.uf),
        },
      };
    } catch {
      return null;
    }
  }
}
