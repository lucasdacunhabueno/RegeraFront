import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConsultasExternas } from './consultas-externas';

describe('ConsultasExternas', () => {
  let svc: ConsultasExternas;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(ConsultasExternas);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('busca CEP no ViaCEP e mapeia campos', async () => {
    const p = svc.buscarCep('01001-000');
    http.expectOne('https://viacep.com.br/ws/01001000/json/').flush({
      cep: '01001-000', logradouro: 'Praça da Sé', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP',
    });
    expect(await p).toEqual({ logradouro: 'Praça da Sé', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' });
  });

  it('CEP inexistente ou erro de rede devolve null', async () => {
    const p1 = svc.buscarCep('99999999');
    http.expectOne('https://viacep.com.br/ws/99999999/json/').flush({ erro: true });
    expect(await p1).toBeNull();

    const p2 = svc.buscarCep('01001000');
    http.expectOne('https://viacep.com.br/ws/01001000/json/').error(new ProgressEvent('error'), { status: 0 });
    expect(await p2).toBeNull();
  });

  it('CEP com tamanho errado nem consulta', async () => {
    expect(await svc.buscarCep('123')).toBeNull();
    http.expectNone(() => true);
  });

  it('busca CNPJ numérico na BrasilAPI e mapeia', async () => {
    const p = svc.buscarCnpj('11.222.333/0001-81');
    http.expectOne('https://brasilapi.com.br/api/cnpj/v1/11222333000181').flush({
      razao_social: 'ACME LTDA', nome_fantasia: 'ACME', email: 'x@acme.com', ddd_telefone_1: '1133334444',
      cep: '01001000', logradouro: 'PRACA DA SE', numero: '1', complemento: 'SALA 2', bairro: 'SE',
      municipio: 'SAO PAULO', uf: 'SP',
    });
    expect(await p).toEqual({
      nome: 'ACME LTDA', nomeFantasia: 'ACME', email: 'x@acme.com', telefone: '1133334444',
      endereco: { cep: '01001000', logradouro: 'PRACA DA SE', numero: '1', complemento: 'SALA 2', bairro: 'SE', cidade: 'SAO PAULO', uf: 'SP' },
    });
  });

  it('CNPJ alfanumérico não é consultado', async () => {
    expect(await svc.buscarCnpj('12ABC34501DE35')).toBeNull();
    http.expectNone(() => true);
  });
});
