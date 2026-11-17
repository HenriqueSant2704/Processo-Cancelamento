const test = require('node:test');
const assert = require('node:assert');
const { carregarCronograma } = require('../src/config');
const { criarProcesso, concluirTarefa, agendaDoDia } = require('../src/cronograma/motor');

const cronograma = carregarCronograma();
const cliente = { id: '1', nome: 'Cliente Teste', contrato: 'C-1' };

function novo(inicio) {
  return criarProcesso({ id: '1', cliente, bloqueadoEm: '2026-11-15', inicio, cronograma });
}
const pendentes = (p, tipo) => p.tarefas.filter((t) => t.status === 'pendente' && (!tipo || t.tipo === tipo));
const datas = (p, tipo) => pendentes(p, tipo).map((t) => t.data);
function concluirTodas(p, tipo, data) {
  for (const t of pendentes(p, tipo)) concluirTarefa(p, t.id, { por: 'Jessica', data }, cronograma);
}
function decidir(p, resposta, data) {
  const [t] = pendentes(p, 'decisao');
  return concluirTarefa(p, t.id, { por: 'Jessica', data, resposta, observacao: 'teste' }, cronograma);
}

test('negativação: 3 contatos em dias úteis alternados (seg, qua, sex) e decisão no dia útil seguinte', () => {
  const p = novo('2026-11-16');
  assert.deepStrictEqual(datas(p, 'contato'), ['2026-11-16', '2026-11-18', '2026-11-20']);
  assert.deepStrictEqual(datas(p, 'acao'), ['2026-11-16']); // abrir ocorrência
  assert.deepStrictEqual(datas(p, 'decisao'), ['2026-11-23']);
});

test('começando na terça, os contatos pulam o fim de semana (ter, qui, seg)', () => {
  const p = novo('2026-11-17');
  assert.deepStrictEqual(datas(p, 'contato'), ['2026-11-17', '2026-11-19', '2026-11-23']);
});

test('cliente bloqueado no sábado começa na segunda', () => {
  assert.deepStrictEqual(datas(novo('2026-11-21'), 'contato'), ['2026-11-23', '2026-11-25', '2026-11-27']);
});

test('regularizou antes do fim: contatos restantes são cancelados e o serviço é liberado', () => {
  const p = novo('2026-11-16');
  decidir(p, 'sim', '2026-11-17');
  assert.strictEqual(p.etapaAtual, 'liberacao');
  assert.strictEqual(pendentes(p, 'contato').length, 0);
  concluirTodas(p, 'acao', '2026-11-17');
  assert.strictEqual(p.status, 'finalizado');
  assert.strictEqual(p.resultado, 'regularizado');
});

test('fluxo completo até o cancelamento', () => {
  const p = novo('2026-11-16');
  concluirTodas(p, 'acao', '2026-11-16');
  concluirTodas(p, 'contato', '2026-11-20');
  decidir(p, 'nao', '2026-11-23');

  assert.strictEqual(p.etapaAtual, 'negativacao');
  concluirTodas(p, 'acao', '2026-11-23');
  assert.strictEqual(p.etapaAtual, 'aguardo-negativado');
  assert.deepStrictEqual(datas(p, 'decisao'), ['2026-12-08']); // 15 dias depois
  decidir(p, 'nao', '2026-12-08');

  assert.strictEqual(p.etapaAtual, 'aviso-cancelamento');
  assert.deepStrictEqual(datas(p, 'contato'), ['2026-12-08', '2026-12-09']);
  assert.deepStrictEqual(datas(p, 'decisao'), ['2026-12-11']); // um dia de pausa
  decidir(p, 'nao', '2026-12-11');

  assert.strictEqual(p.etapaAtual, 'cancelamento');
  concluirTodas(p, 'acao', '2026-12-11');
  assert.strictEqual(p.etapaAtual, 'retirada-equipamentos');
  assert.deepStrictEqual(datas(p, 'decisao'), ['2027-01-11']); // 30 dias (cai no domingo, vai para segunda)
  decidir(p, 'nao', '2027-01-11');

  assert.strictEqual(p.etapaAtual, 'indenizacao');
  concluirTodas(p, 'acao', '2027-01-11');
  concluirTodas(p, 'acao', '2027-01-11');
  assert.strictEqual(p.status, 'finalizado');
  assert.strictEqual(p.resultado, 'cancelado');
});

test('decisão exige resposta e observação', () => {
  const p = novo('2026-11-16');
  const [t] = pendentes(p, 'decisao');
  assert.throws(() => concluirTarefa(p, t.id, { por: 'Jessica', data: '2026-11-23', resposta: 'sim' }, cronograma), /observação/);
  assert.throws(() => concluirTarefa(p, t.id, { por: 'Jessica', data: '2026-11-23', observacao: 'x' }, cronograma), /sim/);
});

test('agenda do dia mostra só o que vence até hoje e marca atrasadas', () => {
  const p = novo('2026-11-16');
  const agenda = agendaDoDia([p], '2026-11-18');
  assert.deepStrictEqual(agenda.map((i) => [i.tarefa.data, i.atrasada]), [
    ['2026-11-16', true],
    ['2026-11-16', true],
    ['2026-11-18', false],
  ]);
});
