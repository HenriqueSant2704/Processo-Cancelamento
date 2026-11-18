// Integração com o SGP usando um SGP FALSO (nunca o real).
const test = require('node:test');
const assert = require('node:assert');
const { criarApiSgp } = require('../src/integracoes/sgp/api');
const { contratosSuspensos, diagnosticar, lerData } = require('../src/integracoes/sgp/contratos');
const { RepositorioJson } = require('../src/processos/repositorio');
const { sincronizar } = require('../src/processos/servico');
const { carregarCronograma } = require('../src/config');

const cliente = (id, contratos) => ({ id, nome: `Cliente ${id}`, cpfcnpj: '000', contratos });
const contrato = (id, status, extra = {}) => ({ id, status, motivo_status: 'FINANCEIRO', servicos: [{ id: 1, plano: { id: 9 } }], ...extra });

// SGP falso: guarda os pedidos e devolve páginas a partir de uma lista.
function sgpFalso(todos, { falhas = 0, status = 200 } = {}) {
  const pedidos = [];
  let falhasRestantes = falhas;
  const buscar = async (url, opcoes) => {
    const corpo = JSON.parse(opcoes.body);
    pedidos.push(corpo);
    if (falhasRestantes > 0) {
      falhasRestantes--;
      throw new TypeError('fetch failed');
    }
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    const clientes = todos.slice(corpo.offset, corpo.offset + corpo.limit);
    return { ok: true, status: 200, json: async () => ({ clientes, paginacao: { total: todos.length, offset: corpo.offset, limit: corpo.limit } }) };
  };
  return { buscar, pedidos };
}

const api = (falso, extra = {}) => criarApiSgp({ url: 'https://sgp.teste/api/ura/clientes/', app: 'app', token: 'segredo', buscar: falso.buscar, esperar: async () => {}, ...extra });

test('lê todas as páginas de 100 em 100 com app e token no corpo', async () => {
  const todos = Array.from({ length: 250 }, (_, i) => cliente(i + 1, []));
  const falso = sgpFalso(todos);
  const { clientes, paginas } = await api(falso).lerTodosClientes();
  assert.strictEqual(clientes.length, 250);
  assert.strictEqual(paginas, 3);
  assert.deepStrictEqual(falso.pedidos.map((p) => p.offset), [0, 100, 200]);
  assert.ok(falso.pedidos.every((p) => p.app === 'app' && p.token === 'segredo' && p.limit === 100));
});

test('tenta de novo quando a conexão falha e desiste depois de 4 tentativas', async () => {
  const ok = sgpFalso([cliente(1, [])], { falhas: 2 });
  assert.strictEqual((await api(ok).lerTodosClientes()).clientes.length, 1);

  const ruim = sgpFalso([cliente(1, [])], { falhas: 5 });
  await assert.rejects(api(ruim).lerTodosClientes(), /Não foi possível conectar/);
  assert.strictEqual(ruim.pedidos.length, 4);
});

test('token errado: mensagem clara, sem repetir e sem vazar o token', async () => {
  const falso = sgpFalso([], { status: 401 });
  await assert.rejects(api(falso).lerTodosClientes(), (erro) => {
    assert.match(erro.message, /recusou o acesso/);
    assert.doesNotMatch(erro.message, /segredo/);
    return true;
  });
  assert.strictEqual(falso.pedidos.length, 1);
});

test('sem configuração: diz o que falta no .env', () => {
  assert.throws(() => criarApiSgp({ url: '', app: 'a', token: '' }), /SGP_URA_CLIENTES_URL, SGP_TOKEN/);
});

test('só contratos SUSPENSOS entram, um item por contrato', () => {
  const clientes = [
    cliente(1, [contrato(10, 'ATIVO'), contrato(11, 'SUSPENSO')]),
    cliente(2, [contrato(20, 'suspenso', { motivo_status: 'A PEDIDO' }), contrato(21, 'CANCELADO')]),
    cliente(3, []),
  ];
  assert.deepStrictEqual(contratosSuspensos(clientes).map((c) => c.id), ['11', '20']);
  // Filtrando pelo motivo (ex.: só suspensão financeira)
  assert.deepStrictEqual(contratosSuspensos(clientes, { motivos: ['FINANCEIRO'] }).map((c) => c.id), ['11']);
  // Data da suspensão, quando o SGP manda
  const comData = [cliente(4, [contrato(40, 'SUSPENSO', { data_suspensao: '16/11/2026' })])];
  assert.strictEqual(contratosSuspensos(comData, { campoData: 'data_suspensao' })[0].dataSuspensao, '2026-11-16');
});

test('resposta fora do formato é recusada', () => {
  assert.throws(() => contratosSuspensos([{ id: 1, contratos: 'x' }]), /formato inesperado/);
  assert.throws(() => contratosSuspensos([{ id: 1, contratos: [{ status: 'SUSPENSO' }] }]), /contrato sem identificador/);
});

test('lerData entende os formatos comuns', () => {
  assert.strictEqual(lerData('2026-11-16 10:30:00'), '2026-11-16');
  assert.strictEqual(lerData('2026-11-16T10:30:00Z'), '2026-11-16');
  assert.strictEqual(lerData('16/11/2026'), '2026-11-16');
  assert.strictEqual(lerData('ontem'), null);
});

test('diagnóstico mostra só nomes de campos e contagens, sem dados pessoais', () => {
  const d = diagnosticar([cliente(1, [contrato(10, 'SUSPENSO', { data_status: '2026-11-10' })])]);
  const texto = JSON.stringify(d);
  assert.doesNotMatch(texto, /Cliente 1/);
  assert.ok(d.camposContrato.some(([k]) => k === 'motivo_status'));
  assert.deepStrictEqual(d.camposDoContratoComData, [['data_status', 1]]);
  assert.strictEqual(d.status[0].status, 'SUSPENSO');
});

test('sem data no SGP: conta a partir do 1º dia em que o contrato foi visto suspenso', async () => {
  const cronograma = carregarCronograma();
  const repositorio = new RepositorioJson(null);
  let lista = [{ id: '11', nome: 'A', contrato: '11', bloqueadoEm: null }];
  const sgp = { listarClientesBloqueados: async () => lista.map((c) => ({ ...c })) };

  // 1ª sincronização de todas: quem já estava suspenso entra direto.
  assert.strictEqual((await sincronizar({ sgp, repositorio, cronograma, hoje: '2026-11-16' })).novos.length, 1);

  // Contrato suspenso pela 1ª vez depois disso: só entra no dia seguinte.
  lista = [...lista, { id: '22', nome: 'B', contrato: '22', bloqueadoEm: null }];
  assert.strictEqual((await sincronizar({ sgp, repositorio, cronograma, hoje: '2026-11-17' })).novos.length, 0);
  const amanha = await sincronizar({ sgp, repositorio, cronograma, hoje: '2026-11-18' });
  assert.deepStrictEqual(amanha.novos.map((p) => p.cliente.id), ['22']);
  assert.strictEqual(amanha.novos[0].bloqueadoEm, '2026-11-17');
});

test('sem campo de data: bloqueio = fatura em aberto mais antiga do contrato + 15 dias', () => {
  const titulos = [
    { clientecontrato_id: 11, status: 'aberto', dataVencimento: '2026-10-20', valorCorrigido: 99.9 },
    { clientecontrato_id: 11, status: 'aberto', dataVencimento: '2026-10-10', valorCorrigido: 100 },
    { clientecontrato_id: 11, status: 'pago', dataVencimento: '2026-09-10', valorCorrigido: 100 },
    { clientecontrato_id: 99, status: 'aberto', dataVencimento: '2026-08-01', valorCorrigido: 100 },
  ];
  const [c] = contratosSuspensos([{ ...cliente(1, [contrato(11, 'SUSPENSO')]), titulos }]);
  assert.strictEqual(c.dataSuspensao, '2026-10-25');
  assert.strictEqual(c.faturasAbertas, 2);
  assert.strictEqual(c.valorAberto, 199.9);
  // Sem fatura em aberto: sem data (o sistema usa o 1º dia em que viu suspenso)
  assert.strictEqual(contratosSuspensos([cliente(2, [contrato(20, 'SUSPENSO')])])[0].dataSuspensao, null);
});

test('sincronizador: uma rodada por vez, guarda o resultado e a agenda diária', async () => {
  const { criarSincronizador } = require('../src/processos/sincronizador');
  let chamadas = 0;
  let liberar;
  const s = criarSincronizador({
    executar: () => { chamadas++; return new Promise((r) => { liberar = () => r({ totalBloqueados: 3, novos: [{ cliente: { nome: 'A' } }] }); }); },
    hoje: () => '2026-11-17',
    horaInicio: 0,
  });
  const p1 = s.rodar();
  const p2 = s.rodar(); // não abre uma segunda
  assert.strictEqual(chamadas, 1);
  assert.strictEqual(s.status().emAndamento, true);
  liberar();
  await Promise.all([p1, p2]);
  assert.deepStrictEqual(s.status().ultima.novos, ['A']);
  // A agenda não roda de novo no mesmo dia em que já sincronizou.
  const parar = s.iniciarAgenda();
  assert.strictEqual(chamadas, 1);
  parar();
});

test('ocorrências: lê o tipo pelo nome e traz só as abertas, uma por contrato', async () => {
  const { criarApiOcorrencias, abertasPorContrato } = require('../src/integracoes/sgp/ocorrencias');
  const pedidos = [];
  const buscarTipos = async () => ({ status: 200, texto: JSON.stringify([{ id: 36, codigo: 32, descricao: 'Financeiro - Negativação' }, { id: 66, codigo: 31, descricao: 'Financeiro - Negativação pós Cancelamento' }]) });
  const buscar = async (url, op) => {
    const corpo = JSON.parse(op.body);
    pedidos.push(corpo);
    const ocorrencias = [
      { contrato: 10, cliente: 'A', numero: '111', status_id: 0, data_cadastro: '2026-11-01', comentarios: [] },
      { contrato: 10, cliente: 'A', numero: '100', status_id: 3, data_cadastro: '2026-10-20' },
      { contrato: 20, cliente: 'B', numero: '222', status_id: 1, data_cadastro: '2026-10-01' }, // encerrada
    ];
    return { ok: true, status: 200, json: async () => ({ paginacao: { total: ocorrencias.length }, ocorrencias }) };
  };
  const oc = criarApiOcorrencias({ origem: 'https://sgp.teste', app: 'a', token: 't', buscar, buscarTipos });
  assert.strictEqual(await oc.idDoTipo(/negativacao pos cancelamento/), 66);
  const lista = abertasPorContrato(await oc.listarOcorrencias({ tipo: [66] }));
  assert.deepStrictEqual(pedidos[0].tipo, [66]);
  assert.deepStrictEqual(lista, [{ contrato: '10', nome: 'A', ocorrencia: { numero: '100', abertaEm: '2026-10-20' } }]);
});

test('sincronização cria processos do fluxo pós-cancelamento sem duplicar', async () => {
  const { sincronizarTudo } = require('../src/processos/servico');
  const cronograma = carregarCronograma();
  const repositorio = new RepositorioJson(null);
  const sgp = {
    listarClientesBloqueados: async () => [],
    listarPosCancelamento: async () => [{ contrato: '77', nome: 'Cliente Cancelado', ocorrencia: { numero: '555', abertaEm: '2026-11-10' } }],
  };
  const r = await sincronizarTudo({ sgp, repositorio, cronograma, hoje: '2026-11-17' });
  assert.strictEqual(r.totalPosCancelamento, 1);
  const [p] = r.novos;
  assert.strictEqual(p.fluxo, 'pos-cancelamento');
  assert.strictEqual(p.etapaAtual, 'notificacao-pos-cancelamento');
  assert.deepStrictEqual(p.tarefas.filter((t) => t.tipo === 'contato').map((t) => t.data), ['2026-11-17', '2026-11-19', '2026-11-23']);
  assert.strictEqual((await sincronizarTudo({ sgp, repositorio, cronograma, hoje: '2026-11-17' })).novos.length, 0);
});

test('criar ocorrência no SGP: usa o código do tipo, não abre OS e devolve o protocolo', async () => {
  const { criarApiOcorrencias } = require('../src/integracoes/sgp/ocorrencias');
  let enviado;
  const buscarTipos = async () => ({ status: 200, texto: JSON.stringify([{ id: 36, codigo: 32, descricao: 'Financeiro - Negativação' }]) });
  const buscar = async (url, op) => { enviado = { url, corpo: JSON.parse(op.body) }; return { ok: true, status: 200, json: async () => ({ status: 1, protocolo: '2611170001', msg: '' }) }; };
  const oc = criarApiOcorrencias({ origem: 'https://sgp.teste', app: 'a', token: 't', buscar, buscarTipos });
  const r = await oc.criarOcorrencia({ contrato: '1053', tipoNome: 'Financeiro - Negativação', conteudo: 'texto' });
  assert.strictEqual(r.protocolo, '2611170001');
  assert.strictEqual(enviado.url, 'https://sgp.teste/api/ura/chamado/');
  assert.strictEqual(enviado.corpo.ocorrenciatipo, 32);
  assert.strictEqual(enviado.corpo.contrato, 1053);
  assert.strictEqual(enviado.corpo.desativa_os, 1);
  // SGP recusando
  const recusa = criarApiOcorrencias({ origem: 'https://sgp.teste', app: 'a', token: 't', buscarTipos, buscar: async () => ({ ok: true, status: 200, json: async () => ({ status: 0, msg: 'Contrato inválido' }) }) });
  await assert.rejects(recusa.criarOcorrencia({ contrato: '1', tipoNome: 'Financeiro - Negativação', conteudo: 'x' }), /Contrato inválido/);
});

test('comentar ocorrência: usa o ID da OS da ocorrência', async () => {
  const { criarApiOcorrencias } = require('../src/integracoes/sgp/ocorrencias');
  const chamadas = [];
  const buscar = async (url, op) => {
    const corpo = JSON.parse(op.body);
    chamadas.push({ url, corpo });
    if (url.endsWith('/api/ura/ocorrencia/list/')) return { ok: true, status: 200, json: async () => ({ paginacao: { total: 1 }, ocorrencias: [{ id: 4321, numero: '2611170001', status_id: 0, ordens_servicos: [{ id: 8765 }] }] }) };
    return { ok: true, status: 200, json: async () => ({ anotacao_id: 1 }) };
  };
  const oc = criarApiOcorrencias({ origem: 'https://sgp.teste', app: 'a', token: 't', buscar, buscarTipos: async () => ({ status: 200, texto: '[]' }) });
  await oc.comentarOcorrencia({ numero: '2611170001', texto: 'Criada pelo sistema. @jessica_rasteiro' });
  assert.strictEqual(chamadas[0].corpo.ocorrencia, '2611170001');
  assert.strictEqual(chamadas[1].url, 'https://sgp.teste/api/os/ocorrencia/comentario/add/id/8765/');
  assert.match(chamadas[1].corpo.anotacao, /@jessica_rasteiro/);
});

test('data real da suspensão (Contrato – Listar) tem prioridade e corrige processos existentes', async () => {
  const { criarFonteApi } = require('../src/integracoes/sgp');
  const { sincronizar } = require('../src/processos/servico');
  const config = { sgp: { uraClientesUrl: 'https://sgp.teste/api/ura/clientes/', app: 'a', token: 't', statusSuspenso: ['SUSPENSO'], motivos: [], campoDataSuspensao: '', diasBloqueioAposVencimento: 15 } };
  const clientes = [{ id: 1, nome: 'A', contratos: [{ id: 11, status: 'SUSPENSO', motivo_status: 'FINANCEIRO' }], titulos: [{ clientecontrato_id: 11, status: 'aberto', dataVencimento: '2026-09-01', valorCorrigido: 50 }] }];
  const buscar = async (url) => {
    if (url.endsWith('/api/ura/listacontrato/')) return { ok: true, status: 200, json: async () => [{ id_contrato: 11, data_status: '2026-11-10 08:00:00', status: 'Suspenso' }] };
    return { ok: true, status: 200, json: async () => ({ clientes, paginacao: { total: 1 } }) };
  };
  const fonte = criarFonteApi(config, { buscar, esperar: async () => {} });
  const [c] = await fonte.listarClientesBloqueados();
  assert.strictEqual(c.bloqueadoEm, '2026-11-10'); // e não 16/09 (fatura + 15)
  assert.strictEqual(c.dataReal, true);

  const repositorio = new RepositorioJson(null);
  const cronograma = carregarCronograma();
  const errado = { listarClientesBloqueados: async () => [{ ...c, bloqueadoEm: '2026-09-16', dataReal: false }] };
  const [p] = (await sincronizar({ sgp: errado, repositorio, cronograma, hoje: '2026-11-17' })).novos;
  assert.strictEqual(p.bloqueadoEm, '2026-09-16');
  await sincronizar({ sgp: { listarClientesBloqueados: async () => [c] }, repositorio, cronograma, hoje: '2026-11-18' });
  assert.strictEqual((await repositorio.obter(p.id)).bloqueadoEm, '2026-11-10');
});

test('aviso de OS de retirada: comenta uma vez na ocorrência marcando o responsável', async () => {
  const { enviarAvisosPendentes } = require('../src/processos/servico');
  const { criarProcesso, posicionar } = require('../src/cronograma/motor');
  const cronograma = carregarCronograma();
  const repositorio = new RepositorioJson(null);
  const p = criarProcesso({ id: '1', cliente: { id: '11473', nome: 'X', contrato: '11473' }, bloqueadoEm: '2026-10-01', inicio: '2026-11-17', cronograma });
  posicionar(p, { etapaId: 'cancelamento', por: 'Jessica', data: '2026-11-17' }, cronograma);
  p.ocorrencia = { numero: '261106095100' }; // ocorrência criada à mão no SGP
  await repositorio.salvarProcesso(p);
  const comentarios = [];
  const comentar = async (c) => { comentarios.push(c); };
  assert.strictEqual(await enviarAvisosPendentes({ repositorio, cronograma, hoje: '2026-11-18', comentar, destinatarios: { os: 'miguel_sgp' } }), 1);
  assert.strictEqual(comentarios[0].numero, '261106095100');
  assert.match(comentarios[0].texto, /ABRIR A OS DE RETIRADA/);
  assert.match(comentarios[0].texto, /@miguel_sgp/);
  // Não repete
  assert.strictEqual(await enviarAvisosPendentes({ repositorio, cronograma, hoje: '2026-11-19', comentar, destinatarios: { os: 'miguel_sgp' } }), 0);
});

test('não duplica: contrato cujo processo principal já está no pós-cancelamento', async () => {
  const { sincronizarPosCancelamento } = require('../src/processos/servico');
  const { criarProcesso, posicionar } = require('../src/cronograma/motor');
  const cronograma = carregarCronograma();
  const repositorio = new RepositorioJson(null);
  const p = criarProcesso({ id: '1', cliente: { id: '77', nome: 'X', contrato: '77' }, bloqueadoEm: '2026-10-01', inicio: '2026-11-17', cronograma });
  posicionar(p, { etapaId: 'notificacao-pos-cancelamento', por: 'J', data: '2026-11-18' }, cronograma);
  await repositorio.salvarProcesso(p);
  const sgp = { listarPosCancelamento: async () => [{ contrato: '77', nome: 'X', ocorrencia: { numero: '1', abertaEm: '2026-11-18' } }] };
  assert.strictEqual((await sincronizarPosCancelamento({ sgp, repositorio, cronograma, hoje: '2026-11-18' })).novos.length, 0);
});

test('feriado do SGP: avisos marcados no feriado vão para o próximo dia útil', async () => {
  const { atualizarFeriados, reajustarAgenda } = require('../src/processos/servico');
  const { criarProcesso } = require('../src/cronograma/motor');
  const cronograma = JSON.parse(JSON.stringify(carregarCronograma()));
  const repositorio = new RepositorioJson(null);
  const p = criarProcesso({ id: '1', cliente: { id: '1', nome: 'A', contrato: '1' }, bloqueadoEm: '2026-11-15', inicio: '2026-11-18', cronograma });
  await repositorio.salvarProcesso(p); // avisos 18 (qua), 20 (sex), 24 (ter)
  atualizarFeriados(cronograma, ['2026-11-20']); // Consciência Negra
  assert.strictEqual(await reajustarAgenda({ repositorio, cronograma, hoje: '2026-11-18' }), 1);
  const datasContato = (await repositorio.obter('1')).tarefas.filter((t) => t.tipo === 'contato').map((t) => t.data);
  assert.deepStrictEqual(datasContato, ['2026-11-18', '2026-11-23', '2026-11-24']);
});
