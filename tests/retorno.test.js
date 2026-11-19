const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { carregarCronograma } = require('../src/config');
const { criarApp } = require('../src/web/app');
const { RepositorioJson } = require('../src/processos/repositorio');
const { criarFonteExemplo } = require('../src/integracoes/sgp/exemplo');
const { criarProcesso } = require('../src/cronograma/motor');

function subir(t, opcoes) {
  const servidor = http.createServer(criarApp({ cronograma: carregarCronograma(), criarSgp: criarFonteExemplo, modoDemo: true, ...opcoes })).listen(0);
  t.after(() => servidor.close());
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return async (caminho, corpo) => {
    const r = await fetch(base + caminho, { method: corpo ? 'POST' : 'GET', body: corpo ? JSON.stringify(corpo) : undefined, headers: corpo ? { 'Content-Type': 'application/json' } : {} });
    return { status: r.status, json: await r.json() };
  };
}

test('aviso em dois passos: enviei, sem retorno (mais 2h), retorno do cliente e finalizar', async (t) => {
  const cronograma = carregarCronograma();
  const repositorio = new RepositorioJson(null);
  const p = criarProcesso({ id: '1', cliente: { id: '50', nome: 'Cliente', contrato: '50' }, bloqueadoEm: '2026-11-15', inicio: '2026-11-16', cronograma });
  p.ocorrencia = { numero: '999' };
  await repositorio.salvarProcesso(p);
  const comentarios = [];
  let relogio = '2026-11-16T12:00:00.000Z'; // 9h em Brasília
  const chamar = subir(t, { repositorio, agora: () => relogio, comentarOcorrenciaSgp: async (c) => { comentarios.push(c); } });
  const d = '?data=2026-11-16';
  const aviso = p.tarefas.find((x) => x.tipo === 'contato');

  assert.strictEqual((await chamar(`/api/tarefas/${aviso.id}/retorno${d}`, { por: 'Jessica', resultado: 'sem-retorno' })).status, 400); // ainda não enviado
  let r = await chamar(`/api/tarefas/${aviso.id}/enviado${d}`, { por: 'Jessica' });
  assert.strictEqual(r.status, 200);
  let t1 = r.json.tarefas.find((x) => x.id === aviso.id);
  assert.strictEqual(t1.status, 'pendente'); // continua pendente: falta o retorno
  assert.strictEqual(t1.retorno.proximaChecagem, '2026-11-16T14:00:00.000Z');
  assert.strictEqual(r.json.passo.id, 'retorno');
  assert.strictEqual((await chamar(`/api/tarefas/${aviso.id}/enviado${d}`, { por: 'Jessica' })).status, 400); // não duplica

  const painel = (await chamar(`/api/painel${d}`)).json;
  assert.strictEqual(painel.clientes[0].passo.nome, 'Aguardando retorno');

  relogio = '2026-11-16T14:05:00.000Z';
  r = await chamar(`/api/tarefas/${aviso.id}/retorno${d}`, { por: 'Jessica', resultado: 'sem-retorno' });
  t1 = r.json.tarefas.find((x) => x.id === aviso.id);
  assert.strictEqual(t1.retorno.proximaChecagem, '2026-11-16T16:05:00.000Z');
  assert.strictEqual((await chamar(`/api/tarefas/${aviso.id}/retorno${d}`, { por: 'Jessica', resultado: 'retorno', texto: '' })).status, 400);
  r = await chamar(`/api/tarefas/${aviso.id}/retorno${d}`, { por: 'Jessica', resultado: 'retorno', texto: 'Disse que paga sexta' });
  assert.strictEqual(r.json.tarefas.find((x) => x.id === aviso.id).retorno.checagens.length, 2);
  assert.ok(r.json.historico.some((h) => h.evento === 'retorno-cliente' && /paga sexta/.test(h.detalhes)));
  await new Promise((r2) => setTimeout(r2, 20));
  assert.strictEqual(comentarios.length, 1);
  assert.deepStrictEqual(comentarios[0].marcar, []);

  r = await chamar(`/api/tarefas/${aviso.id}/concluir${d}`, { por: 'Jessica', observacao: 'REGISTRO', registro: true });
  assert.strictEqual(r.json.tarefas.find((x) => x.id === aviso.id).status, 'concluida');
  assert.notStrictEqual(r.json.passo.id, 'retorno');
});

test('retorno do cliente exige texto e prova (print ou PDF) quando o print é obrigatório', async (t) => {
  const cronograma = carregarCronograma();
  const repositorio = new RepositorioJson(null);
  const p = criarProcesso({ id: '1', cliente: { id: '50', nome: 'Cliente', contrato: '50' }, bloqueadoEm: '2026-11-15', inicio: '2026-11-16', cronograma });
  await repositorio.salvarProcesso(p);
  const chamar = subir(t, { repositorio, printObrigatorio: true, agora: () => '2026-11-16T12:00:00.000Z' });
  const d = '?data=2026-11-16';
  const aviso = p.tarefas.find((x) => x.tipo === 'contato');
  await chamar(`/api/tarefas/${aviso.id}/enviado${d}`, { por: 'Jessica' });
  let r = await chamar(`/api/tarefas/${aviso.id}/retorno${d}`, { por: 'Jessica', resultado: 'retorno', texto: 'Fez promessa: paga sexta' });
  assert.strictEqual(r.status, 400);
  assert.match(r.json.erro, /prova do retorno/);
  const png = { nome: 'conversa.png', tipo: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' };
  r = await chamar(`/api/tarefas/${aviso.id}/retorno${d}`, { por: 'Jessica', resultado: 'retorno', texto: 'Fez promessa: paga sexta', print: png });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.anexos.length, 1);
  assert.strictEqual(r.json.anexos[0].tarefaId, aviso.id);
  // "Sem retorno" não pede prova.
  assert.strictEqual((await chamar(`/api/tarefas/${aviso.id}/retorno${d}`, { por: 'Jessica', resultado: 'sem-retorno' })).status, 200);
});
