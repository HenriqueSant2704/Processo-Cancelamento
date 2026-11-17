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

test('tenta de novo quando a conexão falha e desiste depois de 3 tentativas', async () => {
  const ok = sgpFalso([cliente(1, [])], { falhas: 2 });
  assert.strictEqual((await api(ok).lerTodosClientes()).clientes.length, 1);

  const ruim = sgpFalso([cliente(1, [])], { falhas: 5 });
  await assert.rejects(api(ruim).lerTodosClientes(), /Não foi possível conectar/);
  assert.strictEqual(ruim.pedidos.length, 3);
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
