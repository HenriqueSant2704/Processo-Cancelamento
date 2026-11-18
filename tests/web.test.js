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

  const id = agenda.clientes.find((c) => c.fluxo === 'principal').id;
  const ajuste = await chamar(`/api/processos/${id}/ajustar${d}`, { por: 'Jessica', etapa: 'notificacao-negativacao', contatosFeitos: 1, dataReferencia: '2026-11-13' });
  assert.strictEqual(ajuste.status, 200);
  assert.ok(ajuste.json.etapasAjustaveis.length >= 4);
  const ruim = await chamar(`/api/processos/${id}/ajustar${d}`, { por: 'Jessica', etapa: 'aguardo-negativado' });
  assert.strictEqual(ruim.status, 400);
});

test('botão Criar no SGP: desligado por padrão; ligado cria, guarda o número e conclui a tarefa', async (t) => {
  const repositorio = new RepositorioJson(null);
  const desligado = subir(t, { repositorio, modoDemo: true });
  let s = (await desligado.chamar('/api/sincronizar?data=2026-11-16', {})).json;
  while (s.emAndamento) s = (await desligado.chamar('/api/sincronizacao')).json;
  const painel = (await desligado.chamar('/api/painel?data=2026-11-16')).json;
  const cliente = painel.clientes.find((c) => c.fluxo === 'principal');
  const detalhe = (await desligado.chamar(`/api/processos/${cliente.id}?data=2026-11-16`)).json;
  const tarefa = detalhe.paraHoje.find((x) => x.ocorrenciaTipo);
  assert.strictEqual(tarefa.ocorrenciaTipo, 'Financeiro - Negativação');
  assert.strictEqual((await desligado.chamar('/api/eu')).json.criarOcorrencia, false);
  assert.strictEqual((await desligado.chamar(`/api/tarefas/${tarefa.id}/ocorrencia`, { por: 'Jessica', conteudo: 'texto ok' })).status, 403);

  const pedidos = [];
  const ligado = subir(t, { repositorio, modoDemo: true, criarOcorrenciaSgp: async (p) => { pedidos.push(p); return { protocolo: '777', tipo: p.tipoNome }; } });
  const r = await ligado.chamar(`/api/tarefas/${tarefa.id}/ocorrencia`, { por: 'Jessica', conteudo: 'Cliente suspenso, abrindo negativação.' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.protocolo, '777');
  assert.strictEqual(pedidos[0].contrato, cliente.cliente.contrato);
  assert.strictEqual(r.json.detalhe.ocorrencia.numero, '777');
  assert.strictEqual(r.json.detalhe.tarefas.find((x) => x.id === tarefa.id).status, 'concluida');
  // Tarefa que não é de ocorrência é recusada
  const outra = r.json.detalhe.paraHoje.find((x) => !x.ocorrenciaTipo);
  assert.strictEqual((await ligado.chamar(`/api/tarefas/${outra.id}/ocorrencia`, { por: 'Jessica', conteudo: 'texto ok' })).status, 400);
});

test('promessa de pagamento pela API', async (t) => {
  const { chamar } = subir(t, { repositorio: new RepositorioJson(null), modoDemo: true });
  const d = '?data=2026-11-16';
  let s = (await chamar('/api/sincronizar' + d, {})).json;
  while (s.emAndamento) s = (await chamar('/api/sincronizacao')).json;
  const painel = (await chamar('/api/painel' + d)).json;
  const id = painel.clientes.find((c) => c.fluxo === 'principal').id;
  const r = await chamar(`/api/processos/${id}/promessa${d}`, { por: 'Jessica', dataPromessa: '2026-11-20', observacao: 'paga sexta' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.passo.id, 'promessa');
  assert.ok(r.json.tarefas.some((x) => x.promessa && x.data === '2026-11-20'));
  assert.strictEqual((await chamar(`/api/processos/${id}/promessa${d}`, { por: 'Jessica', dataPromessa: '2026-11-01' })).status, 400);
});

test('comentários automáticos na ocorrência a cada ação (quando ligado)', async (t) => {
  const { criarProcesso } = require('../src/cronograma/motor');
  const repositorio = new RepositorioJson(null);
  const cronograma = carregarCronograma();
  const p = criarProcesso({ id: '1', cliente: { id: '50', nome: 'Cliente', contrato: '50' }, bloqueadoEm: '2026-11-15', inicio: '2026-11-16', cronograma });
  p.ocorrencia = { numero: '999' };
  await repositorio.salvarProcesso(p);
  const comentarios = [];
  const { chamar } = subir(t, { repositorio, modoDemo: true, responsavelSgp: 'jessica_rasteiro', comentarOcorrenciaSgp: async (c) => { comentarios.push(c); } });
  const d = '?data=2026-11-16';
  const aviso = p.tarefas.find((x) => x.tipo === 'contato');
  await chamar(`/api/tarefas/${aviso.id}/concluir${d}`, { por: 'Jessica' });
  await chamar(`/api/processos/1/promessa${d}`, { por: 'Jessica', dataPromessa: '2026-11-20', observacao: 'paga sexta' });
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(comentarios.length, 2);
  assert.strictEqual(comentarios[0].numero, '999');
  assert.match(comentarios[0].texto, /Notificação enviada ao cliente/);
  assert.match(comentarios[0].texto, /1ª de 3/);
  assert.match(comentarios[0].texto, /Jessica/);
  assert.match(comentarios[0].html, /<b>/);
  assert.deepStrictEqual(comentarios[0].marcar, ['jessica_rasteiro']);
  assert.match(comentarios[1].texto, /Promessa de pagamento registrada/);
  assert.match(comentarios[1].texto, /20\/11\/2026/);
});

test('fim de etapa marca o supervisor e o início da próxima marca a responsável', async (t) => {
  const { criarProcesso } = require('../src/cronograma/motor');
  const repositorio = new RepositorioJson(null);
  const cronograma = carregarCronograma();
  const p = criarProcesso({ id: '1', cliente: { id: '50', nome: 'Cliente', contrato: '50' }, bloqueadoEm: '2026-11-15', inicio: '2026-11-16', cronograma });
  p.ocorrencia = { numero: '999' };
  await repositorio.salvarProcesso(p);
  const comentarios = [];
  const { chamar } = subir(t, { repositorio, modoDemo: true, responsavelSgp: 'jessica_rasteiro', supervisorSgp: 'lucas_sgp', comentarOcorrenciaSgp: async (c) => { comentarios.push(c); } });
  const decisao = p.tarefas.find((x) => x.tipo === 'decisao');
  await chamar(`/api/tarefas/${decisao.id}/concluir?data=2026-11-23`, { por: 'Jessica', resposta: 'nao', observacao: 'Sem retorno nas 3 tentativas' });
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(comentarios.length, 2);
  assert.deepStrictEqual(comentarios[0].marcar, ['lucas_sgp']);
  assert.match(comentarios[0].texto, /não regularizou/);
  assert.match(comentarios[0].texto, /Posso dar continuidade\?/);
  assert.deepStrictEqual(comentarios[1].marcar, ['jessica_rasteiro']);
  assert.match(comentarios[1].texto, /Nova etapa: Negativação/);
  assert.match(comentarios[1].texto, /Negativar o cliente/);
});

test('mensagem própria da Jéssica substitui o texto automático no comentário', async (t) => {
  const { criarProcesso } = require('../src/cronograma/motor');
  const repositorio = new RepositorioJson(null);
  const cronograma = carregarCronograma();
  const p = criarProcesso({ id: '1', cliente: { id: '50', nome: 'Cliente', contrato: '50' }, bloqueadoEm: '2026-11-15', inicio: '2026-11-16', cronograma });
  p.ocorrencia = { numero: '999' };
  await repositorio.salvarProcesso(p);
  const comentarios = [];
  const { chamar } = subir(t, { repositorio, modoDemo: true, responsavelSgp: 'jessica_rasteiro', supervisorSgp: 'admin', nomes: { admin: 'Lucas' }, comentarOcorrenciaSgp: async (c) => { comentarios.push(c); } });
  const decisao = p.tarefas.find((x) => x.tipo === 'decisao');
  await chamar(`/api/tarefas/${decisao.id}/concluir?data=2026-11-17`, { por: 'Jessica', resposta: 'sim', observacao: 'Pagou', mensagem: 'Lucas, o cliente pagou com o desconto que você autorizou.' });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepStrictEqual(comentarios[0].marcar, ['admin']);
  assert.match(comentarios[0].texto, /o cliente pagou com o desconto que você autorizou/);
  assert.doesNotMatch(comentarios[0].texto, /Resultado:/);
});
