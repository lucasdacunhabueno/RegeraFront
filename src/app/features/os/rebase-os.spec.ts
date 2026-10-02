import type { Perfil } from '../../core/auth/auth-models';
import {
  CampoEdicaoOs, dadosDaOs, OsDados, OsLocal, paraOsLocal, StatusOs, validarMutacaoOs,
} from './os-models';
import { manterMinhaOs, quemNoServidor, rebaseFilaOs, rebaseOs, rebaseOsLocal } from './rebase-os';

const COM = 'u-com';
const TEC = 'u-tec';
const ADM = 'u-adm';

/** A OS como o servidor a manda: numerada, da proposta p1, do comercial, com o técnico atribuído. */
const servidor = (status: StatusOs, extra: Partial<OsDados> = {}): OsDados => ({
  codigoProvisorio: 'OSP-0Z9XY7', numero: 123, revisao: 1, propostaId: 'p1', propostaNumero: 277, propostaCodigoExibido: '000277',
  clienteId: 'c1', tipo: 'INSTALACAO', status, responsavelId: COM, tecnicoId: TEC, dataPrevista: '2026-10-09', urgente: true,
  concluiProposta: false, descricao: 'Do escritório', enderecoCep: '01310100', enderecoLogradouro: 'Av. Nova', enderecoNumero: '9',
  enderecoCidade: 'São Paulo', enderecoUf: 'SP', resumoExecucao: 'Resumo do escritório', assinaturaRecusada: false,
  itens: [{ id: 'l1', itemCatalogoId: 'i1', codigo: 'P-1', nome: 'Painel', unidade: 'un', natureza: 'PRODUTO', quantidadePrevista: 3, ordem: 0 }],
  notas: [{ id: 'n0', texto: 'Do escritório', autorId: ADM, criadaEm: '2026-10-01T10:00:00Z' }],
  anexos: [], historico: [], atualizadoEm: '2026-10-01T10:00:00Z', ...extra,
});

/** O que o aparelho mandou (o `paraEnvio` da OS de proposta): a versão antiga do cabeçalho e `responsavelId` null. */
function meu(status: StatusOs, extra: Partial<OsDados> = {}): OsDados {
  const local = paraOsLocal('o1', 4, servidor(status, {
    dataPrevista: '2026-10-05', urgente: false, concluiProposta: true, descricao: 'Antiga', enderecoLogradouro: 'Av. Velha',
    resumoExecucao: null, atualizadoEm: '2026-09-30T10:00:00Z',
    itens: [{ id: 'l1', itemCatalogoId: 'i1', codigo: 'P-1', nome: 'Painel', unidade: 'un', natureza: 'PRODUTO', quantidadePrevista: 2, ordem: 0 }],
    notas: [],
  }));
  return { ...dadosDaOs(local), responsavelId: null, ...extra };
}

/** Os campos do `EdicaoOs` que o servidor veria alterados (o `alterados()` do `OsSyncHandler`, para estes dados). */
function alteradosNoServidor(s: OsDados, d: OsDados): CampoEdicaoOs[] {
  const r: CampoEdicaoOs[] = [];
  const se = (campo: CampoEdicaoOs, condicao: boolean) => condicao && r.push(campo);
  const ou = <T>(x: T | null | undefined) => x ?? null;
  const endereco = (x: OsDados) => JSON.stringify([x.enderecoCep, x.enderecoLogradouro, x.enderecoNumero, x.enderecoComplemento,
    x.enderecoBairro, x.enderecoCidade, x.enderecoUf].map(ou));
  const linhas = (x: OsDados) => JSON.stringify(x.itens.map((l) => [l.id, ou(l.itemCatalogoId), l.codigo, l.nome, l.unidade,
    l.natureza, Number(l.quantidadePrevista)]));
  se('propostaId', ou(s.propostaId) !== ou(d.propostaId));
  se('clienteId', d.clienteId != null && d.clienteId !== s.clienteId);
  se('tipo', s.tipo !== d.tipo);
  se('descricao', ou(s.descricao) !== ou(d.descricao));
  se('dataPrevista', ou(s.dataPrevista) !== ou(d.dataPrevista));
  se('urgente', s.urgente !== d.urgente);
  se('tecnicoId', ou(s.tecnicoId) !== ou(d.tecnicoId));
  se('endereco', endereco(s) !== endereco(d));
  se('itens', linhas(s) !== linhas(d));
  se('concluiProposta', s.concluiProposta !== d.concluiProposta);
  se('resumoExecucao', ou(s.resumoExecucao) !== ou(d.resumoExecucao));
  se('assinaturaRecusada', s.assinaturaRecusada !== d.assinaturaRecusada);
  se('motivoRecusa', ou(s.motivoRecusa) !== ou(d.motivoRecusa));
  const existentes = new Set(s.notas.map((n) => n.id));
  se('notas', d.notas.some((n) => !existentes.has(n.id)));
  se('responsavelId', d.responsavelId != null && d.responsavelId !== s.responsavelId);
  se('aceitarTrabalho', d.aceitarTrabalho === true);
  return r;
}

/** O servidor aceitaria o envio com a base dele: a transição primeiro e a edição depois (M2P1-R13), na matriz espelhada. */
function aceito(s: OsDados, d: OsDados, perfil: Perfil, usuarioId: string): boolean {
  const erro = validarMutacaoOs(s.status, d.status, perfil, s.responsavelId === usuarioId, s.tecnicoId === usuarioId, {
    temTecnico: d.tecnicoId != null, resumoExecucao: d.resumoExecucao ?? null, temAssinatura: s.assinaturaAnexoId != null,
    assinaturaRecusada: d.assinaturaRecusada, motivoRecusa: d.motivoRecusa ?? null,
    motivo: d.status === 'CANCELADA' ? d.motivoCancelamento ?? null : d.motivoReabertura ?? null,
  }, alteradosNoServidor(s, d));
  if (erro) throw new Error(`recusado: ${JSON.stringify(erro)}`);
  return true;
}

describe('rebase da OS', () => {
  describe('manterMinhaOs (M2P1-R19)', () => {
    it('técnico: o que ele não edita vem do servidor, o que edita fica o dele; notas unidas; responsavelId null', () => {
      const s = servidor('EM_ANDAMENTO');
      const enviado = meu('EM_ANDAMENTO', {
        resumoExecucao: 'Meu resumo', notas: [{ id: 'n1', texto: 'Cheguei', autorId: null, criadaEm: null }],
      });
      const r = manterMinhaOs(enviado, s, 'TECNICO', TEC);
      expect(r).toMatchObject({
        status: 'EM_ANDAMENTO', dataPrevista: '2026-10-09', urgente: true, descricao: 'Do escritório', enderecoLogradouro: 'Av. Nova',
        tecnicoId: TEC, numero: 123, revisao: 1, responsavelId: null,
        // editáveis pelo técnico em andamento (Q21 inclui o "Precisa voltar")
        resumoExecucao: 'Meu resumo', concluiProposta: true,
      });
      expect(r.itens.map((l) => l.quantidadePrevista)).toEqual([3]);
      expect(r.notas.map((n) => n.id)).toEqual(['n0', 'n1']);
      expect(r.notas[0]).toEqual({ id: 'n0', texto: 'Do escritório', autorId: ADM, criadaEm: '2026-10-01T10:00:00Z' });
      expect(aceito(s, r, 'TECNICO', TEC)).toBe(true);
      // sem o rebase, o servidor recusaria o envio do técnico (data, descrição, endereço e linhas)
      expect(() => aceito(s, { ...enviado, resumoExecucao: 'Meu resumo' }, 'TECNICO', TEC)).toThrow('OS_NAO_EDITAVEL');
    });

    it('técnico em ABERTA: o "Precisa voltar" ainda é do escritório e fica o do servidor; o iniciar continua', () => {
      const s = servidor('ABERTA', { resumoExecucao: null });
      const r = manterMinhaOs(meu('EM_ANDAMENTO'), s, 'TECNICO', TEC);
      expect(r).toMatchObject({ status: 'EM_ANDAMENTO', concluiProposta: false, dataPrevista: '2026-10-09' });
      expect(aceito(s, r, 'TECNICO', TEC)).toBe(true);
    });

    it('comercial em andamento: data e técnico ficam os dele; descrição, endereço e linhas, os do servidor; o status não volta', () => {
      const s = servidor('EM_ANDAMENTO');
      // editado offline com a OS ainda aberta; o técnico iniciou nesse meio-tempo
      const enviado = meu('ABERTA', { dataPrevista: '2026-10-20', descricao: 'Minha descrição' });
      const r = manterMinhaOs(enviado, s, 'COMERCIAL', COM);
      expect(r).toMatchObject({
        status: 'EM_ANDAMENTO', dataPrevista: '2026-10-20', urgente: false, descricao: 'Do escritório',
        enderecoLogradouro: 'Av. Nova', resumoExecucao: 'Resumo do escritório', concluiProposta: false, responsavelId: null,
      });
      expect(aceito(s, r, 'COMERCIAL', COM)).toBe(true);
    });

    it('R30 V1: a OS foi reaberta depois (revisão do aparelho menor): a conclusão da fila não volta; o resumo dele fica', () => {
      const s = servidor('EM_ANDAMENTO', { revisao: 2 });
      const r = manterMinhaOs(meu('CONCLUIDA', { resumoExecucao: 'Feito', assinaturaRecusada: true, motivoRecusa: 'Ausente' }), s, 'TECNICO', TEC);
      expect(r).toMatchObject({ status: 'EM_ANDAMENTO', revisao: 2, resumoExecucao: 'Feito', assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      expect(aceito(s, r, 'TECNICO', TEC)).toBe(true);
    });

    it('a transição que o usuário fez continua: o cancelamento e a reabertura do ADMIN, com o motivo', () => {
      const s = servidor('EM_ANDAMENTO');
      const cancelada = manterMinhaOs(meu('CANCELADA', { motivoCancelamento: 'Cliente desistiu' }), s, 'ADMIN', ADM);
      expect(cancelada).toMatchObject({ status: 'CANCELADA', motivoCancelamento: 'Cliente desistiu' });
      expect(aceito(s, cancelada, 'ADMIN', ADM)).toBe(true);

      const concluida = servidor('CONCLUIDA');
      const reaberta = manterMinhaOs(meu('EM_ANDAMENTO', { motivoReabertura: 'Faltou o teste' }), concluida, 'ADMIN', ADM);
      expect(reaberta).toMatchObject({ status: 'EM_ANDAMENTO', motivoReabertura: 'Faltou o teste' });
      expect(aceito(concluida, reaberta, 'ADMIN', ADM)).toBe(true);
      // sem o motivo, EM_ANDAMENTO numa OS concluída é só o status antigo: fica o do servidor
      expect(manterMinhaOs(meu('EM_ANDAMENTO'), concluida, 'ADMIN', ADM).status).toBe('CONCLUIDA');
    });

    it('responsável: null na OS de proposta (R18); na avulsa, a troca do ADMIN vai; o aceite só do ADMIN', () => {
      const s = servidor('ABERTA');
      expect(manterMinhaOs(meu('ABERTA', { responsavelId: 'u-outro' }), s, 'ADMIN', ADM).responsavelId).toBeNull();
      const avulsa = servidor('ABERTA', { propostaId: null, propostaNumero: null, propostaCodigoExibido: null });
      const troca = manterMinhaOs(meu('ABERTA', { propostaId: null, responsavelId: 'u-outro' }), avulsa, 'ADMIN', ADM);
      expect(troca.responsavelId).toBe('u-outro');
      expect(manterMinhaOs(meu('ABERTA', { propostaId: null, responsavelId: COM }), avulsa, 'ADMIN', ADM).responsavelId).toBeNull();
      expect(manterMinhaOs(meu('ABERTA', { propostaId: null, responsavelId: 'u-outro' }), avulsa, 'COMERCIAL', COM).responsavelId).toBeNull();
      expect(manterMinhaOs(meu('ABERTA', { aceitarTrabalho: true }), s, 'ADMIN', ADM).aceitarTrabalho).toBe(true);
    });

    it('com as notas fora do alcance do perfil (comercial na OS concluída), ficam só as do servidor', () => {
      const s = servidor('CONCLUIDA');
      const r = manterMinhaOs(meu('CONCLUIDA', { notas: [{ id: 'n1', texto: 'Minha', autorId: null, criadaEm: null }] }), s, 'COMERCIAL', COM);
      expect(r.notas.map((n) => n.id)).toEqual(['n0']);
      expect(aceito(s, r, 'COMERCIAL', COM)).toBe(true);
    });

    it('não leva para a rede o que um servidor mais novo mandar a mais', () => {
      const s = { ...servidor('EM_ANDAMENTO'), campoNovo: 1 } as OsDados;
      expect('campoNovo' in manterMinhaOs(meu('EM_ANDAMENTO'), s, 'TECNICO', TEC)).toBe(false);
    });
  });

  describe('rebaseOs: a mutação seguinte sobre o resultado da anterior', () => {
    it('o que não mudou desde o envio anterior passa a ser o do servidor; o que o usuário mudou depois fica', () => {
      const base = meu('EM_ANDAMENTO', { notas: [{ id: 'n1', texto: 'a', autorId: null, criadaEm: null }] });
      const seguinte = { ...base, resumoExecucao: 'Depois', notas: [...base.notas, { id: 'n2', texto: 'b', autorId: null, criadaEm: null }] };
      // R30: o servidor ficou com o cabeçalho do escritório e o "Precisa voltar" desmarcado por ele
      const s = servidor('EM_ANDAMENTO', { resumoExecucao: null, notas: [...servidor('EM_ANDAMENTO').notas,
        { id: 'n1', texto: 'a', autorId: TEC, criadaEm: '2026-10-01T12:00:00Z' }] });
      const r = rebaseOs(seguinte, base, s);
      expect(r).toMatchObject({
        dataPrevista: '2026-10-09', descricao: 'Do escritório', concluiProposta: false, resumoExecucao: 'Depois', responsavelId: null,
      });
      expect(r.notas.map((n) => n.id)).toEqual(['n0', 'n1', 'n2']);
      expect(aceito(s, r, 'TECNICO', TEC)).toBe(true);
    });

    it('status: sem transição própria desde o envio anterior, o do servidor; a transição dele continua; nunca volta', () => {
      const base = meu('ABERTA');
      expect(rebaseOs(meu('ABERTA'), base, servidor('EM_ANDAMENTO')).status).toBe('EM_ANDAMENTO');
      expect(rebaseOs(meu('EM_ANDAMENTO'), base, servidor('ABERTA')).status).toBe('EM_ANDAMENTO');
      // R26: o escritório cancelou; a conclusão da fila não passa de cancelada para concluída
      const s = servidor('CANCELADA');
      const r = rebaseOs(meu('CONCLUIDA', { resumoExecucao: 'Feito' }), meu('EM_ANDAMENTO'), s);
      expect(r.status).toBe('CANCELADA');
      // reaberta aqui: a reabertura e a edição seguinte (com a revisão nova do aparelho) continuam em andamento
      const concluida = servidor('CONCLUIDA');
      expect(rebaseOs(meu('EM_ANDAMENTO', { motivoReabertura: 'x' }), meu('CONCLUIDA'), concluida).status).toBe('EM_ANDAMENTO');
      expect(rebaseOs(meu('EM_ANDAMENTO', { revisao: 2 }), meu('CONCLUIDA'), concluida).status).toBe('EM_ANDAMENTO');
      // reaberta lá (R30 V1): a seguinte da revisão antiga fica com o status do servidor
      expect(rebaseOs(meu('CONCLUIDA'), meu('EM_ANDAMENTO'), servidor('EM_ANDAMENTO', { revisao: 2 })).status).toBe('EM_ANDAMENTO');
    });

    it('com a posse: o que o perfil não altera no status do servidor fica o do servidor, como no R26', () => {
      const tecnico = quemNoServidor(servidor('CANCELADA'), 'TECNICO', TEC);
      const s = servidor('CANCELADA', { resumoExecucao: null });
      const concluir = meu('CONCLUIDA', { resumoExecucao: 'Feito', notas: [{ id: 'n1', texto: 'a', autorId: null, criadaEm: null }] });
      const r = rebaseOs(concluir, meu('EM_ANDAMENTO'), s, tecnico);
      expect(r).toMatchObject({ status: 'CANCELADA', resumoExecucao: null });
      expect(r.notas.map((n) => n.id)).toEqual(['n0', 'n1']);
      expect(aceito(s, r, 'TECNICO', TEC)).toBe(true);
      // sem o filtro, o servidor recusaria o resumo do técnico na OS cancelada
      expect(() => aceito(s, rebaseOs(concluir, meu('EM_ANDAMENTO'), s), 'TECNICO', TEC)).toThrow('OS_NAO_EDITAVEL');
      // o comercial na OS concluída não acrescenta nota; o aceite só vai do ADMIN
      const concluida = servidor('CONCLUIDA');
      const doComercial = rebaseOs(meu('CONCLUIDA', { notas: [{ id: 'n9', texto: 'x', autorId: null, criadaEm: null }], aceitarTrabalho: true }),
        meu('CONCLUIDA'), concluida, quemNoServidor(concluida, 'COMERCIAL', COM));
      expect(doComercial.notas.map((n) => n.id)).toEqual(['n0']);
      expect('aceitarTrabalho' in doComercial).toBe(false);
    });

    it('sem a posse (o técnico que perdeu a atribuição, M2-R3), nada é tirado: o servidor aceita as notas pelo caminho dele', () => {
      const s = servidor('EM_ANDAMENTO', { tecnicoId: 'u-outro' });
      const r = rebaseOs(meu('EM_ANDAMENTO', { resumoExecucao: 'Feito', notas: [{ id: 'n1', texto: 'a', autorId: null, criadaEm: null }] }),
        meu('EM_ANDAMENTO'), s, quemNoServidor(s, 'TECNICO', TEC));
      expect(r).toMatchObject({ resumoExecucao: 'Feito', tecnicoId: 'u-outro' });
      expect(r.notas.map((n) => n.id)).toEqual(['n0', 'n1']);
    });

    it('rebaseFilaOs: cada uma sobre o estado que a anterior deixa (a reabertura no meio vale para a edição depois dela)', () => {
      const admin = quemNoServidor(servidor('CONCLUIDA'), 'ADMIN', ADM);
      const concluir = meu('CONCLUIDA', { resumoExecucao: 'Feito', assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      const reabrir = { ...concluir, status: 'EM_ANDAMENTO' as const, motivoReabertura: 'Faltou o teste' };
      const editar = { ...concluir, status: 'EM_ANDAMENTO' as const, revisao: 2, resumoExecucao: 'Feito de novo' };
      const s = servidor('CONCLUIDA', { resumoExecucao: 'Feito', assinaturaRecusada: true, motivoRecusa: 'Ausente' });
      const [r1, r2] = rebaseFilaOs(concluir, s, [reabrir, editar], admin);
      expect(r1).toMatchObject({ status: 'EM_ANDAMENTO', motivoReabertura: 'Faltou o teste', dataPrevista: '2026-10-09' });
      expect(aceito(s, r1, 'ADMIN', ADM)).toBe(true);
      // na OS concluída o ADMIN não altera o resumo; depois da reabertura, sim: a edição dele fica
      expect(r2).toMatchObject({ status: 'EM_ANDAMENTO', resumoExecucao: 'Feito de novo', dataPrevista: '2026-10-09' });
      expect(aceito({ ...r1, revisao: 2 }, r2, 'ADMIN', ADM)).toBe(true);
    });

    it('M4a: sem transição própria desde o envio, a seguinte leva o status do servidor, mesmo atrás do enviado (M2-R3)', () => {
      // o técnico que perdeu a atribuição: o servidor aceita só as notas e fica em andamento, sem a conclusão enviada
      const s = servidor('EM_ANDAMENTO', { tecnicoId: 'u-outro' });
      const concluir = meu('CONCLUIDA', { resumoExecucao: 'Feito' });
      const nota = { ...concluir, notas: [{ id: 'n1', texto: 'Depois', autorId: null, criadaEm: null }] };
      expect(rebaseOs(nota, concluir, s, quemNoServidor(s, 'TECNICO', TEC)).status).toBe('EM_ANDAMENTO');
      // com transição própria depois do envio, a dele (que o servidor confere)
      expect(rebaseOs(concluir, meu('EM_ANDAMENTO'), servidor('EM_ANDAMENTO')).status).toBe('CONCLUIDA');
    });

    it('M4b: com a posse, responsavelId que o perfil não altera no status do servidor vai null (= manter), nunca o do aparelho', () => {
      // a troca do ADMIN numa avulsa em andamento, na fila; o técnico concluiu lá antes de ela chegar
      const avulsa = (status: StatusOs, extra: Partial<OsDados> = {}) =>
        meu(status, { propostaId: null, responsavelId: COM, ...extra });
      const s = servidor('CONCLUIDA', { propostaId: null, propostaNumero: null, propostaCodigoExibido: null });
      const admin = quemNoServidor(s, 'ADMIN', ADM);
      const troca = avulsa('EM_ANDAMENTO', { responsavelId: 'u-meu' });
      const r = rebaseOs(troca, avulsa('EM_ANDAMENTO'), s, admin);
      expect(r).toMatchObject({ status: 'CONCLUIDA', responsavelId: null });
      expect(aceito(s, r, 'ADMIN', ADM)).toBe(true);
      // sem o filtro, a troca iria e o servidor a recusaria (o ADMIN não troca o responsável da OS concluída)
      expect(() => aceito(s, rebaseOs(troca, avulsa('EM_ANDAMENTO'), s), 'ADMIN', ADM)).toThrow('OS_NAO_EDITAVEL');
    });

    it('M2P2-R11: revisão = a maior das duas (com a conclusão do servidor quando sobe); o número entra quando falta', () => {
      const reaberta = servidor('EM_ANDAMENTO', { revisao: 2, concluidaEm: null });
      const velha = meu('EM_ANDAMENTO', { revisao: 1, numero: null, concluidaEm: '2026-09-30T18:00:00Z' });
      expect(rebaseOs(velha, velha, reaberta)).toMatchObject({ revisao: 2, numero: 123, concluidaEm: null });
      // a reabertura pendente aqui já subiu a revisão: fica
      const pendente = meu('EM_ANDAMENTO', { revisao: 3, concluidaEm: null });
      expect(rebaseOs(pendente, meu('CONCLUIDA'), servidor('CONCLUIDA', { revisao: 2, concluidaEm: '2026-10-01T10:00:00Z' })))
        .toMatchObject({ revisao: 3, concluidaEm: null, status: 'EM_ANDAMENTO' });
      const local = paraOsLocal('o1', 4, velha);
      expect(rebaseOsLocal(local, velha, reaberta)).toMatchObject({ revisao: 2, numero: 123, concluidaEm: null });
      expect(rebaseOsLocal({ ...local, revisao: 3 }, velha, reaberta).revisao).toBe(3);
    });

    it('na avulsa, a troca de responsável feita depois fica; a que não mudou segue o servidor', () => {
      const avulsa = (extra: Partial<OsDados> = {}) => meu('ABERTA', { propostaId: null, responsavelId: COM, ...extra });
      const s = servidor('ABERTA', { propostaId: null, responsavelId: 'u-novo' });
      expect(rebaseOs(avulsa(), avulsa(), s).responsavelId).toBe('u-novo');
      expect(rebaseOs(avulsa({ responsavelId: 'u-meu' }), avulsa(), s).responsavelId).toBe('u-meu');
    });
  });

  describe('rebaseOsLocal', () => {
    it('o registro segue a mesma regra e guarda o que é só do aparelho', () => {
      const base = meu('EM_ANDAMENTO');
      const local: OsLocal = {
        ...paraOsLocal('o1', 4, { ...base, resumoExecucao: 'Depois' }),
        numero: null, iniciadaLocalEm: '2026-10-01T09:00:00Z',
        notas: [{ id: 'n2', texto: 'b', autorId: null, criadaEm: null, autorLocalId: TEC, criadaLocalEm: '2026-10-01T12:00:00Z' }],
      };
      const r = rebaseOsLocal(local, base, servidor('EM_ANDAMENTO'));
      expect(r).toMatchObject({
        // M2P2-R11: o número do servidor entra no registro que não o tinha
        id: 'o1', version: 4, numero: 123, iniciadaLocalEm: '2026-10-01T09:00:00Z', status: 'EM_ANDAMENTO',
        dataPrevista: '2026-10-09', descricao: 'Do escritório', enderecoLogradouro: 'Av. Nova', concluiProposta: false,
        resumoExecucao: 'Depois', responsavelId: COM,
      });
      expect(r.itens[0].quantidadePrevistaMilesimos).toBe(3000);
      expect(r.notas).toEqual([
        { id: 'n0', texto: 'Do escritório', autorId: ADM, criadaEm: '2026-10-01T10:00:00Z' },
        { id: 'n2', texto: 'b', autorId: null, criadaEm: null, autorLocalId: TEC, criadaLocalEm: '2026-10-01T12:00:00Z' },
      ]);
      // sobre uma mutação rebaseada (responsavelId null = manter), o responsável do registro fica
      const rebaseada = manterMinhaOs(base, servidor('EM_ANDAMENTO'), 'TECNICO', TEC);
      expect(rebaseOsLocal({ ...local, responsavelId: COM }, base, rebaseada).responsavelId).toBe(COM);
    });
  });
});
