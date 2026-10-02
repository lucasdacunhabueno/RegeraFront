import { vi } from 'vitest';
import { gravarRascunhoOs, lerRascunhoOs, limparRascunhosOs } from './rascunho-os';

describe('rascunho da OS (sessionStorage)', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('guarda o resumo e a nota por usuário e por OS', () => {
    gravarRascunhoOs('u1', 'o1', 'resumo', 'Troquei o quadro');
    gravarRascunhoOs('u1', 'o1', 'nota', 'Falta o disjuntor');
    gravarRascunhoOs('u1', 'o2', 'nota', 'Outra OS');
    gravarRascunhoOs('u2', 'o1', 'resumo', 'Outro usuário');
    expect(lerRascunhoOs('u1', 'o1')).toEqual({ resumo: 'Troquei o quadro', nota: 'Falta o disjuntor' });
    expect(lerRascunhoOs('u1', 'o2')).toEqual({ nota: 'Outra OS' });
    expect(lerRascunhoOs('u2', 'o1')).toEqual({ resumo: 'Outro usuário' });
    expect(lerRascunhoOs('u2', 'o2')).toEqual({});
  });

  it('só os dois textos: nada além de resumo e nota fica guardado', () => {
    gravarRascunhoOs('u1', 'o1', 'resumo', 'Feito');
    const chaves = Object.keys(sessionStorage);
    expect(chaves).toHaveLength(1);
    expect(JSON.parse(sessionStorage.getItem(chaves[0])!)).toEqual({ resumo: 'Feito' });
    // um valor estranho na chave (outra versão, ou editado à mão) não passa adiante
    sessionStorage.setItem(chaves[0], JSON.stringify({ resumo: 'Feito', cpf: '123', nota: 5 }));
    expect(lerRascunhoOs('u1', 'o1')).toEqual({ resumo: 'Feito' });
    sessionStorage.setItem(chaves[0], '{quebrado');
    expect(lerRascunhoOs('u1', 'o1')).toEqual({});
  });

  it('null limpa o campo; sem nenhum campo, a chave sai; a nota vazia não se guarda', () => {
    gravarRascunhoOs('u1', 'o1', 'resumo', 'Feito');
    gravarRascunhoOs('u1', 'o1', 'nota', 'Nota');
    gravarRascunhoOs('u1', 'o1', 'nota', null);
    expect(lerRascunhoOs('u1', 'o1')).toEqual({ resumo: 'Feito' });
    gravarRascunhoOs('u1', 'o1', 'nota', '');
    expect(lerRascunhoOs('u1', 'o1')).toEqual({ resumo: 'Feito' });
    // o resumo apagado de propósito (a OS reaberta vem com o anterior) fica, vazio
    gravarRascunhoOs('u1', 'o1', 'resumo', '');
    expect(lerRascunhoOs('u1', 'o1')).toEqual({ resumo: '' });
    gravarRascunhoOs('u1', 'o1', 'resumo', null);
    expect(Object.keys(sessionStorage)).toHaveLength(0);
  });

  it('limparRascunhosOs com exceto apaga os rascunhos dos outros usuários e mantém os daquele', () => {
    gravarRascunhoOs('u1', 'o1', 'resumo', 'Meu');
    gravarRascunhoOs('u10', 'o1', 'resumo', 'Outro, com o id começando igual');
    gravarRascunhoOs('u2', 'o2', 'nota', 'De outro');
    sessionStorage.setItem('outra-chave', 'x');
    limparRascunhosOs('u1');
    expect(lerRascunhoOs('u1', 'o1')).toEqual({ resumo: 'Meu' });
    expect(lerRascunhoOs('u10', 'o1')).toEqual({});
    expect(lerRascunhoOs('u2', 'o2')).toEqual({});
    expect(sessionStorage.getItem('outra-chave')).toBe('x');
  });

  it('limparRascunhosOs (logout) apaga só os rascunhos da OS', () => {
    sessionStorage.setItem('outra-coisa', 'fica');
    gravarRascunhoOs('u1', 'o1', 'resumo', 'Feito');
    gravarRascunhoOs('u2', 'o9', 'nota', 'Nota');
    limparRascunhosOs();
    expect(lerRascunhoOs('u1', 'o1')).toEqual({});
    expect(lerRascunhoOs('u2', 'o9')).toEqual({});
    expect(sessionStorage.getItem('outra-coisa')).toBe('fica');
  });

  it('o armazenamento indisponível ou cheio não quebra nada (try/catch em todo acesso)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cheio', 'QuotaExceededError');
    });
    expect(() => gravarRascunhoOs('u1', 'o1', 'resumo', 'Feito')).not.toThrow();
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    expect(lerRascunhoOs('u1', 'o1')).toEqual({});
    expect(() => gravarRascunhoOs('u1', 'o1', 'nota', 'x')).not.toThrow();
    expect(() => limparRascunhosOs()).not.toThrow();
    vi.restoreAllMocks();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')!;
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => { throw new DOMException('negado', 'SecurityError'); } });
    try {
      expect(lerRascunhoOs('u1', 'o1')).toEqual({});
      expect(() => gravarRascunhoOs('u1', 'o1', 'nota', 'x')).not.toThrow();
      expect(() => limparRascunhosOs()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'sessionStorage', original);
    }
  });
});
