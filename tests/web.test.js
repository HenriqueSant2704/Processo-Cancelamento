const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { carregarCronograma } = require('../src/config');
const { criarApp } = require('../src/web/app');
const { RepositorioJson } = require('../src/processos/repositorio');
const { criarFonteExemplo } = require('../src/integracoes/sgp/exemplo');

function subir(t, opcoes) {
  const servidor = http.createServer(criarApp({ cronograma: carregarCronograma(), criarSgp: criarFonteExemplo, ...opcoes })).listen(0);
  t.after(() => servidor.close());
  const base = `http://127.0.0.1:${servidor.address().port}`;
  let cookie = '';
  const chamar = async (caminho, corpo) => {
    const r = await fetch(base + caminho, {
      method: corpo ? 'POST' : 'GET',
      body: corpo ? JSON.stringify(corpo) : undefined,
      headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      redirect: 'manual',
    });
    const setCookie = r.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* html */ }
    return { status: r.status, json, texto, headers: r.headers };
  };
  return { base, chamar };
}

test('API da tela (modo demonstração, sem login): sincronizar, painel, concluir e decidir', async (t) => {
  const { base, chamar } = subir(t, { repositorio: new RepositorioJson(null), modoDemo: true });
  const d = '?data=2026-11-16';

  const disparo = await chamar('/api/sincronizar' + d, {});
  assert.strictEqual(disparo.status, 202); // roda em segundo plano
  let status = disparo.json;
  while (status.emAndamento) status = (await chamar('/api/sincronizacao')).json;
  assert.strictEqual(status.ultima.ok, true);
  assert.strictEqual(status.ultima.novos.length, 3); // 2 suspensos + 1 pós-cancelamento

  const painel = (await chamar('/api/painel' + d)).json;
  assert.strictEqual(painel.resumo.clientesHoje, 3);
  assert.strictEqual(painel.resumo.paraHoje, 5); // 2 suspensos x (abrir ocorrência + 1º aviso) + 1º aviso do pós-cancelamento
  assert.strictEqual(painel.proximosDias.length, 10);

  const tarefa = painel.clientes[0].paraHoje[0];
  const feito = await chamar(`/api/tarefas/${tarefa.id}/concluir${d}`, { por: 'Jessica' });
  assert.strictEqual(feito.status, 200);
  assert.strictEqual(feito.json.tarefas.find((x) => x.id === tarefa.id).status, 'concluida');

  const decisao = feito.json.tarefas.find((x) => x.tipo === 'decisao');
  assert.strictEqual((await chamar(`/api/tarefas/${decisao.id}/concluir${d}`, { por: 'Jessica', resposta: 'sim' })).status, 400);
  const ok = await chamar(`/api/tarefas/${decisao.id}/concluir${d}`, { por: 'Jessica', resposta: 'sim', observacao: 'Pagou' });
  assert.strictEqual(ok.json.etapa.id, 'liberacao');

  assert.strictEqual((await chamar('/api/processos/999')).status, 404);
  assert.strictEqual((await fetch(base + '/%2e%2e/package.json')).status, 404);
  assert.match((await chamar('/')).texto, /Têmis/);
  assert.strictEqual((await chamar('/saude')).status, 200);

  // POST que não é JSON é recusado (proteção contra envios de outros sites).
  const form = await fetch(base + '/api/sincronizar', { method: 'POST', body: 'a=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.strictEqual(form.status, 415);
});

test('fora do modo demonstração não dá para simular outro dia', async (t) => {
  const { chamar } = subir(t, { repositorio: new RepositorioJson(null) });
  const painel = (await chamar('/api/painel?data=2020-01-01')).json;
  assert.notStrictEqual(painel.hoje, '2020-01-01');
});

test('agenda de um dia futuro e ajuste de etapa pela API', async (t) => {
  const { chamar } = subir(t, { repositorio: new RepositorioJson(null), modoDemo: true });
  const d = '?data=2026-11-16';
  let s = (await chamar('/api/sincronizar' + d, {})).json;
  while (s.emAndamento) s = (await chamar('/api/sincronizacao')).json;

  const agenda = (await chamar('/api/agenda' + d + '&dia=2026-11-18')).json;
  assert.strictEqual(agenda.clientes.length, 3); // 2º aviso dos três clientes cai na quarta
  assert.ok(agenda.clientes.every((c) => c.paraHoje.every((x) => x.data === '2026-11-18')));
  assert.strictEqual((await chamar('/api/agenda' + d)).status, 400);

  const id = agenda.clientes[0].id;
  const ajuste = await chamar(`/api/processos/${id}/ajustar${d}`, { por: 'Jessica', etapa: 'notificacao-negativacao', contatosFeitos: 1, dataReferencia: '2026-11-13' });
  assert.strictEqual(ajuste.status, 200);
  assert.ok(ajuste.json.etapasAjustaveis.length >= 4);
  const ruim = await chamar(`/api/processos/${id}/ajustar${d}`, { por: 'Jessica', etapa: 'aguardo-negativado' });
  assert.strictEqual(ruim.status, 400);
});
