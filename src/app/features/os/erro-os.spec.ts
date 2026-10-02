import { ErroCampo } from '../../core/util/erro-campo';
import { ErroOs } from './erro-os';

describe('ErroOs', () => {
  it('é um ErroCampo com código, campo e mensagem', () => {
    const e = new ErroOs('FOTO_GRANDE', 'foto', 'A foto ficou grande demais.');
    expect(e).toBeInstanceOf(ErroCampo);
    expect(e).toBeInstanceOf(ErroOs);
    expect(e.codigo).toBe('FOTO_GRANDE');
    expect(e.campo).toBe('foto');
    expect(e.message).toBe('A foto ficou grande demais.');
  });

  it('de(): o primeiro campo da recusa vira o campo do erro, e todos ficam em campos', () => {
    const e = ErroOs.de({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos.', campos: { tecnicoId: 'Escolha o técnico.', 'notas[0].texto': 'Longo.' } });
    expect(e.codigo).toBe('VALIDACAO');
    expect(e.campo).toBe('tecnicoId');
    expect(e.message).toBe('Escolha o técnico.');
    expect(e.campos).toEqual({ tecnicoId: 'Escolha o técnico.', 'notas[0].texto': 'Longo.' });
  });

  it('de(): sem campos, o erro é da OS com a mensagem da recusa', () => {
    const e = ErroOs.de({ codigo: 'ACESSO_NEGADO', mensagem: 'Esta OS não está mais com você.' });
    expect(e.campo).toBe('os');
    expect(e.message).toBe('Esta OS não está mais com você.');
    expect(e.campos).toBeUndefined();
  });
});
