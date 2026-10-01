import { randomUUID } from 'node:crypto';
import { APIRequestContext, Browser, BrowserContext, devices, expect, Page, request as fabricaRequest } from '@playwright/test';
import { aguardarSincronizacaoInicial } from './apoio';

/**
 * Apoio dos E2E de aceite do M1 (§19): a preparação pela API (usuários, catálogo, templates, empresa e propostas
 * pelo push do sync), os geradores de CPF/CNPJ alfanumérico, a interceptação do Web Share e a leitura do IndexedDB.
 * Tudo o que um teste cria leva um carimbo único (`Date.now()`): o banco local guarda dados de outras rodadas e da
 * importação do SIGEM, e nenhuma afirmação olha para o que o teste não criou.
 */

export const BASE_URL = process.env['E2E_BASE_URL'] ?? 'https://localhost';
export const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@regera.local';
export const ADMIN_SENHA = process.env['E2E_ADMIN_SENHA'] ?? 'admin-local-123';
export const SENHA_E2E = 'aceite-e2e-123';

export type Perfil = 'ADMIN' | 'COMERCIAL' | 'TECNICO';
export type TipoProposta = 'VENDA' | 'SERVICO' | 'MANUTENCAO' | 'LOCACAO';
export const TIPOS: readonly TipoProposta[] = ['VENDA', 'SERVICO', 'MANUTENCAO', 'LOCACAO'];

export interface UsuarioE2E {
  id: string;
  nome: string;
  email: string;
  senha: string;
  perfil: Perfil;
}

export interface ItemE2E {
  id: string;
  version: number;
  dados: DadosItem;
}

interface DadosItem {
  natureza: 'PRODUTO' | 'SERVICO';
  codigo: string;
  nome: string;
  descricao: string | null;
  unidade: string;
  precoCusto: number | null;
  precoVenda: number;
  locavel: boolean;
  precoLocacaoMensal: number | null;
  fotoArquivoId: string | null;
  ativo: boolean;
}

interface ResultadoPush {
  mutationId: string;
  status: 'OK' | 'CONFLITO' | 'REJEITADO';
  version?: number;
  dados?: Record<string, unknown>;
  erro?: { codigo: string; mensagem: string };
}

export interface MudancaServidor {
  entidade: string;
  id: string;
  version: number;
  deleted: boolean;
  dados: Record<string, unknown>;
}

export interface PropostaServidor {
  codigoProvisorio: string;
  numero?: number;
  status: string;
  clienteId: string;
  tecnicoId?: string;
  responsavelId: string;
  prazoExecucao?: string;
  total?: number;
  itens: { itemCatalogoId: string; precoCusto?: number; precoUnitario?: number }[];
  documentos: { id: string; arquivoId: string; codigoExibido: string; revisao: number }[];
  historico: { statusDe?: string; statusPara: string }[];
}

// ---- dígitos verificadores ----

function dv(valores: number[], pesos: number[]): number {
  const resto = pesos.reduce((acc, peso, i) => acc + valores[i] * peso, 0) % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** CPF válido e aleatório (só dígitos). */
export function cpfAleatorio(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (base.every((d) => d === base[0])) base[0] = (base[0] + 1) % 10;
  const d1 = dv(base, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv([...base, d1], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...base, d1, d2].join('');
}

const ALFANUMERICOS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * CNPJ alfanumérico (RFB 2026) válido e aleatório: 12 caracteres [0-9A-Z], com letras de verdade na raiz, e 2 dígitos
 * verificadores pelo módulo 11 com o valor de cada caractere = código ASCII − 48 (a regra do `cnpjValido` do front e
 * do validador do servidor).
 */
export function cnpjAlfanumericoAleatorio(): string {
  const corpo = Array.from({ length: 12 }, () => ALFANUMERICOS[Math.floor(Math.random() * ALFANUMERICOS.length)]);
  corpo[0] = 'A';
  corpo[3] = 'Z';
  const valores = corpo.map((c) => c.charCodeAt(0) - 48);
  const d1 = dv(valores, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv([...valores, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${corpo.join('')}${d1}${d2}`;
}

/** `PROV-` + 6 caracteres do base32 de Crockford (o formato que o servidor aceita). */
export function codigoProvisorioAleatorio(): string {
  const base32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return `PROV-${Array.from({ length: 6 }, () => base32[Math.floor(Math.random() * 32)]).join('')}`;
}

// ---- API ----

/** Cliente HTTP da API com o token de um usuário (login pela própria API). */
export class Api {
  private constructor(
    readonly http: APIRequestContext,
    readonly token: string,
  ) {}

  static async entrar(email: string, senha: string): Promise<Api> {
    const http = await fabricaRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });
    const login = await http.post('/api/auth/login', { data: { email, senha } });
    expect(login.status(), `login de ${email} pela API`).toBe(200);
    const { accessToken } = (await login.json()) as { accessToken: string };
    return new Api(http, accessToken);
  }

  static admin(): Promise<Api> {
    return Api.entrar(ADMIN_EMAIL, ADMIN_SENHA);
  }

  get auth() {
    return { Authorization: `Bearer ${this.token}` };
  }

  async fechar(): Promise<void> {
    await this.http.dispose();
  }

  async criarUsuario(nome: string, email: string, perfil: Perfil): Promise<UsuarioE2E> {
    const r = await this.http.post('/api/usuarios', { headers: this.auth, data: { nome, email, perfil, senha: SENHA_E2E } });
    expect(r.status(), `criar usuário ${perfil}`).toBe(201);
    const { id } = (await r.json()) as { id: string };
    return { id, nome, email, senha: SENHA_E2E, perfil };
  }

  async usuarioPorEmail(email: string): Promise<{ id: string; nome: string; perfil: Perfil; ativo: boolean } | undefined> {
    const r = await this.http.get('/api/usuarios', { headers: this.auth });
    expect(r.ok()).toBeTruthy();
    const lista = (await r.json()) as { id: string; nome: string; email: string; perfil: Perfil; ativo: boolean }[];
    return lista.find((u) => u.email === email);
  }

  async push(entidade: string, id: string, baseVersion: number | null, dados: unknown): Promise<ResultadoPush> {
    const mutationId = randomUUID();
    const r = await this.http.post('/api/sync/push', {
      headers: this.auth,
      data: { mutacoes: [{ mutationId, entidade, id, op: 'UPSERT', baseVersion, dados }] },
    });
    expect(r.ok(), `push de ${entidade}`).toBeTruthy();
    const { resultados } = (await r.json()) as { resultados: ResultadoPush[] };
    return resultados[0];
  }

  async pushOk(entidade: string, id: string, baseVersion: number | null, dados: unknown): Promise<number> {
    const resultado = await this.push(entidade, id, baseVersion, dados);
    expect(resultado.status, `push de ${entidade}: ${JSON.stringify(resultado.erro ?? null)}`).toBe('OK');
    return resultado.version!;
  }

  async criarItem(codigo: string, nome: string, precoCusto: number, precoVenda: number): Promise<ItemE2E> {
    const id = randomUUID();
    const dados: DadosItem = {
      natureza: 'PRODUTO', codigo, nome, descricao: null, unidade: 'un', precoCusto, precoVenda,
      locavel: false, precoLocacaoMensal: null, fotoArquivoId: null, ativo: true,
    };
    const version = await this.pushOk('item_catalogo', id, null, dados);
    return { id, version, dados };
  }

  async inativarItem(item: ItemE2E): Promise<void> {
    const atual = await this.agregado('item_catalogo', item.id);
    expect(atual, 'item no servidor').toBeDefined();
    await this.pushOk('item_catalogo', item.id, atual!.version, { ...item.dados, ativo: false });
  }

  /** Template ativo (não padrão: o padrão de cada tipo no banco compartilhado fica como está). */
  async criarTemplate(nome: string, tipoProposta: TipoProposta): Promise<string> {
    const id = randomUUID();
    const blocos = [
      { id: randomUUID(), tipo: 'CABECALHO', config: { mostrarLogo: true, mostrarDadosEmpresa: true, titulo: 'Proposta {{proposta.numero}}' } },
      {
        id: randomUUID(), tipo: 'TEXTO',
        config: { conteudo: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Aceite ${nome}` }] }] } },
      },
      {
        id: randomUUID(), tipo: 'ITENS',
        config: { colunas: ['codigo', 'descricao', 'quantidade', 'unidade', 'precoUnitario', 'subtotal'], agruparPorNatureza: false },
      },
      { id: randomUUID(), tipo: 'TOTAIS', config: { mostrarDescontos: true } },
      { id: randomUUID(), tipo: 'ASSINATURA', config: { assinantes: ['EMPRESA', 'CLIENTE'] } },
    ];
    await this.pushOk('template_proposta', id, null, { nome, tipoProposta, padrao: false, ativo: true, blocos });
    return id;
  }

  /** Rascunho criado direto no servidor, como o comercial (o responsável é o dono do token). */
  async criarRascunho(responsavelId: string, clienteId: string | null, templateId: string, item: ItemE2E): Promise<{ id: string; codigo: string }> {
    const id = randomUUID();
    const codigo = codigoProvisorioAleatorio();
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    await this.pushOk('proposta', id, null, {
      codigoProvisorio: codigo, tipo: 'VENDA', status: 'RASCUNHO', clienteId, templateId, responsavelId, tecnicoId: null,
      dataEmissao: hoje, validadeAte: null, condicoesPagamento: null, prazoExecucao: null, observacoes: null,
      descontoGeralPercentual: 0,
      itens: [{ id: randomUUID(), itemCatalogoId: item.id, quantidade: 1, precoUnitario: item.dados.precoVenda, descontoPercentual: 0, meses: null }],
    });
    return { id, codigo };
  }

  /** O agregado como o servidor o serializa para o dono do token; undefined = 404 (não existe ou não é visível). */
  async agregado(entidade: string, id: string): Promise<MudancaServidor | undefined> {
    const r = await this.http.get(`/api/sync/agregado/${entidade}/${id}`, { headers: this.auth });
    if (r.status() === 404) return undefined;
    expect(r.ok(), `agregado ${entidade}`).toBeTruthy();
    return (await r.json()) as MudancaServidor;
  }

  async proposta(id: string): Promise<PropostaServidor | undefined> {
    return (await this.agregado('proposta', id))?.dados as PropostaServidor | undefined;
  }

  /** GET /api/arquivos/{id}: o status e, com 200, os 5 primeiros bytes. */
  async baixarArquivo(arquivoId: string): Promise<{ status: number; inicio: string }> {
    const r = await this.http.get(`/api/arquivos/${arquivoId}`, { headers: this.auth });
    const inicio = r.ok() ? (await r.body()).subarray(0, 5).toString('latin1') : '';
    return { status: r.status(), inicio };
  }

  /**
   * §19.1: a empresa do PDF. M8: uma empresa que já existe nunca é alterada (os dados não são do teste) — vale como
   * está, com ou sem logo. Só sem empresa nenhuma o teste cadastra uma dele, com a logo. Devolve o id da logo, ou null
   * se a empresa existente não tem.
   */
  async garantirEmpresa(): Promise<string | null> {
    const atual = await this.http.get('/api/empresa', { headers: this.auth });
    expect([200, 404]).toContain(atual.status());
    if (atual.status() === 200) {
      const { dados } = (await atual.json()) as { dados: Record<string, unknown> };
      const logo = dados['logoArquivoId'];
      return typeof logo === 'string' ? logo : null;
    }
    const upload = await this.http.post('/api/arquivos', {
      headers: this.auth,
      multipart: { arquivo: { name: 'logo-aceite.png', mimeType: 'image/png', buffer: Buffer.from(PNG_LOGO, 'base64') } },
    });
    expect(upload.status(), 'upload da logo').toBe(201);
    const { id: logoArquivoId } = (await upload.json()) as { id: string };
    const salvar = await this.http.put('/api/empresa', {
      headers: this.auth,
      data: {
        version: null,
        dados: {
          razaoSocial: 'Empresa Aceite E2E Ltda', nomeFantasia: 'Aceite E2E', cnpj: null, endereco: 'Rua do Teste, 100',
          telefone: '1130000000', email: 'contato@aceite-e2e.local', site: null, corPrimaria: '#1D4ED8',
          validadePadraoDias: 15, condicoesPagamentoPadrao: 'À vista', logoArquivoId,
        },
      },
    });
    expect(salvar.ok(), 'salvar empresa').toBeTruthy();
    return logoArquivoId;
  }

  /** Cliente PF criado direto no servidor (o carimbo do teste no nome). Devolve o id. */
  async criarClientePf(nome: string, cpf: string): Promise<string> {
    const id = randomUUID();
    await this.pushOk('cliente', id, null, {
      tipo: 'PF', documento: cpf, nome, nomeFantasia: null, inscricaoEstadual: null, inscricaoMunicipal: null, email: null,
      telefone: null, whatsapp: null, contatoNome: null, observacoes: null, enderecos: [],
    });
    return id;
  }
}

/** PNG 8x8 (metade azul, metade transparente). */
const PNG_LOGO =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGOQ9bvxHxkzoIORoQAAU1FIQaOqvhEAAAAASUVORK5CYII=';

// ---- navegador ----

export function novoContexto(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ ...devices['Pixel 7'], baseURL: BASE_URL, ignoreHTTPSErrors: true });
}

/** M7: desktop de 1280 px com mouse (ponteiro fino, sem toque): o kanban em colunas com arrastar e o PDF em iframe. */
export function novoContextoDesktop(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, baseURL: BASE_URL, ignoreHTTPSErrors: true,
  });
}

/** Login pela tela; o admin e o comercial caem no kanban, o técnico nas propostas dele. */
export async function entrar(page: Page, email: string, senha: string, destino = /\/kanban$/): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(destino);
}

/**
 * Login e app pronto para o modo avião: o service worker no controle (sem ele, recarregar offline não abre o app) e
 * a sincronização da abertura concluída (o pull inicial com o banco grande não se mistura com o que o teste faz).
 */
export async function abrirApp(page: Page, email: string, senha: string, destino?: RegExp): Promise<void> {
  await entrar(page, email, senha, destino);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await aguardarSincronizacaoInicial(page);
}

/** Recarrega (abrir o app sincroniza) e espera essa sincronização terminar. */
export async function recarregarESincronizar(page: Page): Promise<void> {
  await page.reload();
  await aguardarSincronizacaoInicial(page);
}

export interface ArquivoCompartilhado {
  nome: string;
  tipo: string;
  tamanho: number;
  inicio: string;
}

/**
 * Substitui o Web Share do contexto (antes do primeiro `goto`): `canShare` responde `podeCompartilhar` e `share`
 * lê o `File` recebido na página (nome, tipo, tamanho e os 5 primeiros bytes) e o repassa ao teste. Com
 * `podeCompartilhar = false`, o app cai no download (`<a download>`). `recusarSemGesto`: as primeiras N chamadas do
 * contexto recusam com `NotAllowedError`, como o navegador sem gesto do usuário (P4c-R8), e não registram nada.
 */
export async function interceptarCompartilhamento(
  context: BrowserContext,
  podeCompartilhar = true,
  recusarSemGesto = 0,
): Promise<ArquivoCompartilhado[]> {
  const compartilhados: ArquivoCompartilhado[] = [];
  let recusas = recusarSemGesto;
  await context.exposeBinding('__registrarCompartilhado', (_origem, arquivo: ArquivoCompartilhado) => {
    compartilhados.push(arquivo);
  });
  // a contagem fica no teste (o contexto inteiro, não cada página): a página só pergunta se deve recusar
  await context.exposeBinding('__recusarSemGesto', () => {
    if (recusas <= 0) return false;
    recusas--;
    return true;
  });
  await context.addInitScript((pode: boolean) => {
    const w = window as unknown as {
      __registrarCompartilhado: (a: unknown) => Promise<void>;
      __recusarSemGesto: () => Promise<boolean>;
    };
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (dados?: ShareData) => pode && !!dados?.files?.length,
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (dados: ShareData) => {
        if (await w.__recusarSemGesto()) throw new DOMException('Must be handling a user gesture to perform a share request.', 'NotAllowedError');
        const arquivo = dados.files![0];
        const bytes = new Uint8Array(await arquivo.arrayBuffer());
        await w.__registrarCompartilhado({
          nome: arquivo.name,
          tipo: arquivo.type,
          tamanho: bytes.length,
          inicio: new TextDecoder('latin1').decode(bytes.slice(0, 5)),
        });
      },
    });
  }, podeCompartilhar);
  return compartilhados;
}

/** Um registro do IndexedDB do app (Dexie `regera`) pela chave; undefined se não existir. */
export function registroNoAparelho<T = Record<string, unknown>>(page: Page, tabela: string, id: string): Promise<T | undefined> {
  return page.evaluate(
    ({ tabela, id }) =>
      new Promise<T | undefined>((resolve, reject) => {
        const abertura = indexedDB.open('regera');
        abertura.onerror = () => reject(abertura.error);
        abertura.onsuccess = () => {
          const db = abertura.result;
          if (!db.objectStoreNames.contains(tabela)) {
            db.close();
            resolve(undefined);
            return;
          }
          const leitura = db.transaction(tabela).objectStore(tabela).get(id);
          leitura.onsuccess = () => {
            db.close();
            resolve(leitura.result as T | undefined);
          };
          leitura.onerror = () => {
            db.close();
            reject(leitura.error);
          };
        };
      }),
    { tabela, id },
  );
}

/** Os registros de uma tabela do IndexedDB do app com `campo` igual a `valor` (só os do teste). */
export function registrosNoAparelho<T = Record<string, unknown>>(page: Page, tabela: string, campo: string, valor: string): Promise<T[]> {
  return page.evaluate(
    ({ tabela, campo, valor }) =>
      new Promise<T[]>((resolve, reject) => {
        const abertura = indexedDB.open('regera');
        abertura.onerror = () => reject(abertura.error);
        abertura.onsuccess = () => {
          const db = abertura.result;
          if (!db.objectStoreNames.contains(tabela)) {
            db.close();
            resolve([]);
            return;
          }
          const leitura = db.transaction(tabela).objectStore(tabela).getAll();
          leitura.onsuccess = () => {
            db.close();
            resolve((leitura.result as Record<string, unknown>[]).filter((r) => r[campo] === valor) as T[]);
          };
          leitura.onerror = () => {
            db.close();
            reject(leitura.error);
          };
        };
      }),
    { tabela, campo, valor },
  );
}

/** O texto visível da página inteira (para afirmar que algo NÃO aparece, como "R$" para o técnico). */
export function textoDaPagina(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

/** Cadastra um cliente pela tela (Clientes → Novo cliente), online ou offline; volta à lista. */
export async function cadastrarCliente(page: Page, tipo: 'PF' | 'PJ', documento: string, nome: string): Promise<void> {
  await page.getByRole('link', { name: 'Clientes' }).click();
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
  await page.getByRole('link', { name: 'Novo cliente' }).click();
  if (tipo === 'PJ') await page.locator('#tipo').selectOption('PJ');
  await page.locator('#documento').fill(documento);
  await page.locator('#nome').fill(nome);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page).toHaveURL(/\/clientes$/);
  await expect(page.getByRole('listitem').filter({ hasText: nome })).toBeVisible();
}
