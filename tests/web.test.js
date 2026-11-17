const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { carregarCronograma } = require('../src/config');
const { criarApp } = require('../src/web/app');
const { criarFonteExemplo } = require('../src/integracoes/sgp/exemplo');

test('API da tela: sincronizar, painel, concluir e decidir', async (t) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'temis-'));
  const app = criarApp({ arquivoDados: path.join(pasta, 'p.json'), cronograma: carregarCronograma(), criarSgp: criarFonteExemplo });
  const servidor = http.createServer(app).listen(0);
  t.after(() => { servidor.close(); fs.rmSync(pasta, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = async (caminho, corpo) => {
    const r = await fetch(base + caminho + '?data=2026-11-16', corpo ? { method: 'POST', body: JSON.stringify(corpo) } : undefined);
    return { status: r.status, json: await r.json() };
  };

  assert.strictEqual((await chamar('/api/sincronizar', {})).json.novos.length, 2);

  const painel = (await chamar('/api/painel')).json;
  assert.strictEqual(painel.resumo.clientesHoje, 2);
  assert.strictEqual(painel.resumo.paraHoje, 4); // 2 clientes x (abrir ocorrência + 1º aviso)
  assert.strictEqual(painel.proximosDias.length, 5);

  const tarefa = painel.clientes[0].paraHoje[0];
  const feito = await chamar(`/api/tarefas/${tarefa.id}/concluir`, { por: 'Jessica' });
  assert.strictEqual(feito.status, 200);
  assert.strictEqual(feito.json.tarefas.find((x) => x.id === tarefa.id).status, 'concluida');

  const decisao = feito.json.tarefas.find((x) => x.tipo === 'decisao');
  const semObs = await chamar(`/api/tarefas/${decisao.id}/concluir`, { por: 'Jessica', resposta: 'sim' });
  assert.strictEqual(semObs.status, 400);
  const ok = await chamar(`/api/tarefas/${decisao.id}/concluir`, { por: 'Jessica', resposta: 'sim', observacao: 'Pagou' });
  assert.strictEqual(ok.json.etapa.id, 'liberacao');

  assert.strictEqual((await chamar('/api/processos/999')).status, 404);
  assert.strictEqual((await fetch(base + '/../package.json')).status, 404);
  const pagina = await fetch(base + '/');
  assert.match(await pagina.text(), /Têmis/);
});
