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
  assert.deepStrictEqual(datas(p, 'decisao'), ['2026-12-03']); // 10 dias corridos depois
  decidir(p, 'nao', '2026-12-03');

  assert.strictEqual(p.etapaAtual, 'aviso-cancelamento');
  assert.deepStrictEqual(datas(p, 'contato'), ['2026-12-03', '2026-12-07']); // dia sim, dia não (pula o fim de semana)
  assert.deepStrictEqual(datas(p, 'decisao'), ['2026-12-08']); // dia útil seguinte ao último aviso
  decidir(p, 'nao', '2026-12-08');

  assert.strictEqual(p.etapaAtual, 'cancelamento');
  concluirTodas(p, 'acao', '2026-12-08');
  assert.strictEqual(p.etapaAtual, 'retirada-equipamentos');
  assert.deepStrictEqual(datas(p, 'decisao'), ['2027-01-07']); // 30 dias
  decidir(p, 'nao', '2027-01-11');

  assert.strictEqual(p.etapaAtual, 'indenizacao');
  concluirTodas(p, 'acao', '2027-01-11'); // indenização
  assert.strictEqual(p.etapaAtual, 'abertura-pos-cancelamento');
  concluirTodas(p, 'acao', '2027-01-11'); // abre a ocorrência de pós-cancelamento
  assert.strictEqual(p.etapaAtual, 'notificacao-pos-cancelamento');
  concluirTodas(p, 'contato', '2027-01-15');
  decidir(p, 'nao', '2027-01-18');
  concluirTodas(p, 'acao', '2027-01-18'); // encerra a ocorrência
  assert.strictEqual(p.status, 'finalizado');
  assert.strictEqual(p.resultado, 'negativado');
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

test('ajustar etapa: cliente que já recebeu 2 avisos antes do sistema', () => {
  const { posicionar } = require('../src/cronograma/motor');
  const p = novo('2026-11-17'); // tudo começaria hoje
  posicionar(p, { etapaId: 'notificacao-negativacao', contatosFeitos: 2, dataReferencia: '2026-11-12', por: 'Jessica', data: '2026-11-17' }, cronograma);
  const contatos = p.tarefas.filter((t) => t.etapa === 'notificacao-negativacao' && t.tipo === 'contato' && t.status !== 'cancelada');
  // 1º aviso em 10/11 (2 dias úteis antes de 12/11), 2º em 12/11 (feitos); 3º em 14/11 -> cai em 16/11 (seg)
  assert.deepStrictEqual(contatos.map((t) => [t.data, t.status]), [['2026-11-10', 'concluida'], ['2026-11-12', 'concluida'], ['2026-11-16', 'pendente']]);
  // O 3º aviso já passou: aparece como atrasado hoje
  assert.ok(agendaDoDia([p], '2026-11-17').some((i) => i.tarefa.data === '2026-11-16' && i.atrasada));
  assert.ok(p.historico.some((h) => h.evento === 'etapa-ajustada'));
});

test('ajustar etapa: cliente já negativado, espera conta da data real', () => {
  const { posicionar } = require('../src/cronograma/motor');
  const p = novo('2026-11-17');
  posicionar(p, { etapaId: 'aguardo-negativado', dataReferencia: '2026-11-05', por: 'Jessica', data: '2026-11-17' }, cronograma);
  assert.strictEqual(p.etapaAtual, 'aguardo-negativado');
  assert.deepStrictEqual(datas(p, 'decisao'), ['2026-11-16']); // 05/11 + 10 dias = 15/11 (domingo) -> segunda
  assert.strictEqual(datas(p, 'contato').length, 0); // avisos antigos cancelados
});

test('ajustar etapa: validações', () => {
  const { posicionar } = require('../src/cronograma/motor');
  const p = novo('2026-11-17');
  const base = { por: 'Jessica', data: '2026-11-17' };
  assert.throws(() => posicionar(p, { ...base, etapaId: 'notificacao-negativacao', contatosFeitos: 4, dataReferencia: '2026-11-10' }, cronograma), /de 0 a 3/);
  assert.throws(() => posicionar(p, { ...base, etapaId: 'notificacao-negativacao', contatosFeitos: 1 }, cronograma), /data do último aviso/);
  assert.throws(() => posicionar(p, { ...base, etapaId: 'aguardo-negativado', dataReferencia: '2026-12-01' }, cronograma), /futuro/);
  assert.throws(() => posicionar(p, { ...base, etapaId: 'liberacao' }, cronograma), /Escolha uma etapa/);
});

test('promessa de pagamento: pausa os avisos e, se não pagar, retoma no dia', () => {
  const { registrarPromessa } = require('../src/cronograma/motor');
  const p = novo('2026-11-16'); // avisos 16, 18, 20
  concluirTodas(p, 'acao', '2026-11-16');
  concluirTarefa(p, pendentes(p, 'contato')[0].id, { por: 'Jessica', data: '2026-11-16' }, cronograma);
  registrarPromessa(p, { dataPromessa: '2026-11-25', por: 'Jessica', data: '2026-11-17', observacao: 'Vai pagar dia 25' }, cronograma);
  assert.strictEqual(pendentes(p, 'contato').length, 0); // pausados
  assert.deepStrictEqual(datas(p, 'decisao'), ['2026-11-25']);
  assert.strictEqual(agendaDoDia([p], '2026-11-24').length, 0); // some da agenda até lá
  decidir(p, 'nao', '2026-11-25');
  // 2º aviso no próprio dia 25 (qua), 3º em 27 (sex), "regularizou?" em 30 (seg)
  assert.deepStrictEqual(datas(p, 'contato'), ['2026-11-25', '2026-11-27']);
  assert.deepStrictEqual(datas(p, 'decisao'), ['2026-11-30']);
  assert.ok(pendentes(p, 'contato')[0].descricao.includes('2ª de 3'));
  assert.strictEqual(p.etapaAtual, 'notificacao-negativacao');
});

test('promessa cumprida vai para a liberação; data no passado é recusada', () => {
  const { registrarPromessa } = require('../src/cronograma/motor');
  const p = novo('2026-11-16');
  assert.throws(() => registrarPromessa(p, { dataPromessa: '2026-11-10', por: 'J', data: '2026-11-17' }, cronograma), /passado/);
  registrarPromessa(p, { dataPromessa: '2026-11-20', por: 'J', data: '2026-11-17' }, cronograma);
  decidir(p, 'sim', '2026-11-20');
  assert.strictEqual(p.etapaAtual, 'liberacao');
});

test('depois da retirada de equipamentos o processo segue para a negativação pós-cancelamento', () => {
  const { posicionar } = require('../src/cronograma/motor');
  for (const resposta of ['sim', 'nao']) {
    const p = novo('2026-11-16');
    posicionar(p, { etapaId: 'retirada-equipamentos', dataReferencia: '2026-11-10', por: 'J', data: '2026-11-18' }, cronograma);
    decidir(p, resposta, '2026-11-18');
    if (resposta === 'nao') {
      assert.strictEqual(p.etapaAtual, 'indenizacao');
      concluirTodas(p, 'acao', '2026-11-18');
    }
    assert.strictEqual(p.etapaAtual, 'abertura-pos-cancelamento');
    assert.ok(pendentes(p, 'acao').some((t) => t.descricao === 'Abrir ocorrência de negativação pós-cancelamento no SGP'));
    concluirTodas(p, 'acao', '2026-11-18');
    assert.strictEqual(p.etapaAtual, 'notificacao-pos-cancelamento');
    assert.deepStrictEqual(datas(p, 'contato'), ['2026-11-18', '2026-11-20', '2026-11-24']);
  }
});

test('aviso feito atrasado: os próximos são recalculados a partir do dia real', () => {
  const p = novo('2026-11-16'); // avisos 16, 18, 20; pergunta 23
  concluirTodas(p, 'acao', '2026-11-16');
  const primeiro = pendentes(p, 'contato')[0];
  concluirTarefa(p, primeiro.id, { por: 'Jessica', data: '2026-11-17' }, cronograma); // fez um dia depois
  assert.deepStrictEqual(datas(p, 'contato'), ['2026-11-19', '2026-11-23']); // 17 + 2 úteis = 19; 19 + 2 úteis = 23
  assert.deepStrictEqual(datas(p, 'decisao'), ['2026-11-24']);
});

test('ajustar etapa de novo não conta avisos em dobro (o que estava feito na etapa é desfeito)', () => {
  const { criarProcesso, concluirTarefa, posicionar } = require('../src/cronograma/motor');
  const { visaoProcesso } = require('../src/web/visao');
  const cronograma = require('../src/config').carregarCronograma();
  const p = criarProcesso({ id: '1', cliente: { id: '1', nome: 'C', contrato: '1' }, bloqueadoEm: '2026-11-10', inicio: '2026-11-17', cronograma });
  for (const t of p.tarefas.filter((x) => x.tipo !== 'decisao').slice(0, 2)) concluirTarefa(p, t.id, { por: 'J', data: '2026-11-19' }, cronograma);
  posicionar(p, { etapaId: 'notificacao-negativacao', contatosFeitos: 0, por: 'J', data: '2026-11-19' }, cronograma);
  posicionar(p, { etapaId: 'notificacao-negativacao', contatosFeitos: 1, dataReferencia: '2026-11-19', por: 'J', data: '2026-11-19' }, cronograma);
  posicionar(p, { etapaId: 'notificacao-negativacao', contatosFeitos: 1, dataReferencia: '2026-11-19', por: 'J', data: '2026-11-19' }, cronograma);
  const v = visaoProcesso(p, '2026-11-19', cronograma);
  assert.deepStrictEqual(v.contatos, { feitos: 1, total: 3 });
  assert.strictEqual(v.passo.id, 'msg-2');
  assert.strictEqual(p.tarefas.filter((t) => t.status === 'concluida' && t.tipo === 'contato').length, 1);
});
