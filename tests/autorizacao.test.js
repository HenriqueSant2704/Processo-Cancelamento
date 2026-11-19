const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { carregarCronograma } = require('../src/config');
const { criarProcesso, concluirTarefa } = require('../src/cronograma/motor');
const { RepositorioJson } = require('../src/processos/repositorio');
const { criarApp } = require('../src/web/app');
const { criarFonteExemplo } = require('../src/integracoes/sgp/exemplo');
const { classificarResposta, acharResposta, remarcarEtapa } = require('../src/processos/autorizacao');
const { lerAutorizacoes } = require('../src/processos/servico');

const cronograma = carregarCronograma();

test('classifica a resposta do Lucas', () => {
  for (const t of ['Pode seguir', 'autorizado', 'Ok, pode dar continuidade', '<p>Sim, segue com a negativação</p>', 'pode']) assert.strictEqual(classificarResposta(t), 'autorizado', t);
  for (const t of ['Não, aguarda mais uma semana', 'Segura esse, vou falar com ele', 'negado', 'Ainda não', 'não pode seguir']) assert.strictEqual(classificarResposta(t), 'negado', t);
  assert.strictEqual(classificarResposta('Me liga quando puder'), 'respondido');
});

test('acha a resposta do supervisor depois do pedido do sistema', () => {
  const comentarios = [
    { usuario: 'admin', comentario: 'comentário antigo', data_cadastro: '2026-11-18' },
    { usuario: 'temis_integracao', comentario: '<p>Etapa encerrada... <b>Posso dar continuidade?</b></p>', data_cadastro: '2026-11-18' },
    { usuario: 'jessica_rasteiro', comentario: 'liguei de novo', data_cadastro: '2026-11-18' },
    { usuario: 'admin', comentario: '<p>Pode seguir</p>', data_cadastro: '2026-11-19' },
  ];
  const r = acharResposta(comentarios, { supervisor: 'admin', usuarioSistema: 'temis_integracao', pedidoEm: '2026-11-18' });
  assert.deepStrictEqual(r, { texto: '<p>Pode seguir</p>', por: 'admin', em: '2026-11-19' });
  assert.strictEqual(acharResposta(comentarios.slice(0, 3), { supervisor: 'admin', usuarioSistema: 'temis_integracao', pedidoEm: '2026-11-18' }), null);
});

test('etapa liberada começa no dia da autorização, mantendo os dias alternados', () => {
  const p = criarProcesso({ id: '1', cliente: { id: '1', nome: 'C', contrato: '1' }, bloqueadoEm: '2026-11-15', inicio: '2026-11-16', cronograma });
  remarcarEtapa(p, 'notificacao-negativacao', '2026-11-19', []);
  assert.deepStrictEqual(p.tarefas.filter((t) => t.tipo === 'contato').map((t) => t.data), ['2026-11-19', '2026-11-23', '2026-11-25']);
});

function subir(t, opcoes) {
  const servidor = http.createServer(criarApp({ cronograma, criarSgp: criarFonteExemplo, modoDemo: true, ...opcoes })).listen(0);
  t.after(() => servidor.close());
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return async (caminho, corpo) => {
    const r = await fetch(base + caminho, { method: corpo ? 'POST' : 'GET', body: corpo ? JSON.stringify(corpo) : undefined, headers: corpo ? { 'Content-Type': 'application/json' } : {} });
    return { status: r.status, json: await r.json() };
  };
}

// Processo na negativação com os 3 avisos feitos; falta só o "regularizou?" de 23/11.
async function prepararNaoRegularizou(repositorio) {
  const p = criarProcesso({ id: '1', cliente: { id: '50', nome: 'Cliente', contrato: '50' }, bloqueadoEm: '2026-11-15', inicio: '2026-11-16', cronograma });
  p.ocorrencia = { numero: '999' };
  for (const t of p.tarefas.filter((x) => x.tipo !== 'decisao')) concluirTarefa(p, t.id, { por: 'Jessica', data: t.data }, cronograma);
  await repositorio.salvarProcesso(p);
  return p;
}

test('"não regularizou": cliente para em Aguardando autorização até o Lucas responder na ocorrência', async (t) => {
  const repositorio = new RepositorioJson(null);
  const p = await prepararNaoRegularizou(repositorio);
  const comentarios = [];
  let aoAutorizar = null;
  const chamar = subir(t, { repositorio, exigirAutorizacao: true, responsavelSgp: 'jessica_rasteiro', supervisorSgp: 'admin', comentarOcorrenciaSgp: async (c) => { comentarios.push(c); }, registrarAoAutorizar: (fn) => { aoAutorizar = fn; } });
  const decisao = p.tarefas.find((x) => x.tipo === 'decisao' && x.status === 'pendente');
  await chamar(`/api/tarefas/${decisao.id}/concluir?data=2026-11-23`, { por: 'Jessica', resposta: 'nao', observacao: 'Sem retorno' });

  let painel = (await chamar('/api/painel?data=2026-11-23')).json;
  assert.strictEqual(painel.resumo.aguardandoAutorizacao, 1);
  assert.strictEqual(painel.resumo.paraHoje, 0); // nada da negativação aparece para fazer
  assert.strictEqual(painel.clientes[0].passo.nome, 'Aguardando autorização');
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(comentarios.length, 1); // só o pedido para o Lucas; o início da etapa espera
  assert.deepStrictEqual(comentarios[0].marcar, ['admin']);
  assert.match(comentarios[0].texto, /Posso dar continuidade\?/);

  // Lucas responde na ocorrência; a leitura automática acha e libera.
  const sgp = { comentariosDaOcorrencia: async () => [
    { usuario: 'temis_integracao', comentario: comentarios[0].html, data_cadastro: '2026-11-23' },
    { usuario: 'admin', comentario: 'Pode seguir com a negativação', data_cadastro: '2026-11-24' },
  ] };
  const mudaram = await lerAutorizacoes({ sgp, repositorio, cronograma, hoje: '2026-11-24', supervisor: 'admin', usuarioSistema: 'temis_integracao' });
  assert.strictEqual(mudaram.length, 1);
  aoAutorizar(mudaram[0]);
  painel = (await chamar('/api/painel?data=2026-11-24')).json;
  assert.strictEqual(painel.resumo.aguardandoAutorizacao, 0);
  assert.strictEqual(painel.resumo.autorizados, 1);
  assert.ok(painel.resumo.paraHoje > 0); // a negativação começa no dia da autorização
  assert.strictEqual(painel.notificacoes.length, 1); // sino da Jéssica
  assert.match(painel.notificacoes[0].resposta.texto, /Pode seguir/);
  await new Promise((r) => setTimeout(r, 20));
  assert.match(comentarios[1].texto, /Nova etapa/);
  assert.deepStrictEqual(comentarios[1].marcar, ['jessica_rasteiro']);

  await chamar('/api/processos/1/autorizacao?data=2026-11-24', { por: 'Jessica', acao: 'visto' });
  assert.strictEqual((await chamar('/api/painel?data=2026-11-24')).json.notificacoes.length, 0);
});

test('negado: continua parado; a Jéssica pode pedir de novo ou confirmar pela tela', async (t) => {
  const repositorio = new RepositorioJson(null);
  const p = await prepararNaoRegularizou(repositorio);
  const comentarios = [];
  const chamar = subir(t, { repositorio, exigirAutorizacao: true, responsavelSgp: 'jessica_rasteiro', supervisorSgp: 'admin', comentarOcorrenciaSgp: async (c) => { comentarios.push(c); } });
  const decisao = p.tarefas.find((x) => x.tipo === 'decisao' && x.status === 'pendente');
  await chamar(`/api/tarefas/${decisao.id}/concluir?data=2026-11-23`, { por: 'Jessica', resposta: 'nao', observacao: 'Sem retorno' });
  const sgp = { comentariosDaOcorrencia: async () => [{ usuario: 'admin', comentario: 'Não, aguarda até sexta', data_cadastro: '2026-11-23' }] };
  await lerAutorizacoes({ sgp, repositorio, cronograma, hoje: '2026-11-23', supervisor: 'admin', usuarioSistema: 'temis_integracao' });
  let d = (await chamar('/api/processos/1?data=2026-11-23')).json;
  assert.strictEqual(d.autorizacao.status, 'negado');
  assert.strictEqual(d.paraHoje.length, 0);
  assert.match(d.autorizacao.resposta.texto, /aguarda até sexta/);

  d = (await chamar('/api/processos/1/autorizacao?data=2026-11-27', { por: 'Jessica', acao: 'pedir', observacao: 'Cliente seguiu sem pagar.' })).json;
  assert.strictEqual(d.autorizacao.status, 'aguardando');
  d = (await chamar('/api/processos/1/autorizacao?data=2026-11-30', { por: 'Jessica', acao: 'autorizar', observacao: 'Lucas autorizou por telefone' })).json;
  assert.strictEqual(d.autorizacao.status, 'autorizado');
  assert.ok(d.paraHoje.length > 0);
  assert.ok(d.paraHoje.every((x) => x.data === '2026-11-30'));
  assert.strictEqual((await chamar('/api/processos/1/autorizacao?data=2026-11-30', { por: 'Jessica', acao: 'xyz' })).status, 400);
});

test('sem a exigência ligada, o processo segue direto como antes', async (t) => {
  const repositorio = new RepositorioJson(null);
  const p = await prepararNaoRegularizou(repositorio);
  const chamar = subir(t, { repositorio });
  const decisao = p.tarefas.find((x) => x.tipo === 'decisao' && x.status === 'pendente');
  const d = (await chamar(`/api/tarefas/${decisao.id}/concluir?data=2026-11-23`, { por: 'Jessica', resposta: 'nao', observacao: 'Sem retorno' })).json;
  assert.strictEqual(d.autorizacao, null);
  assert.ok(d.paraHoje.length > 0);
});

test('regra do Pendente: "não regularizou" só passa com a ocorrência Pendente no SGP', async (t) => {
  const repositorio = new RepositorioJson(null);
  const p = await prepararNaoRegularizou(repositorio);
  let status = 0;
  const consultas = [];
  const chamar = subir(t, { repositorio, statusOcorrenciaSgp: async (n) => { consultas.push(n); return status; } });
  const decisao = p.tarefas.find((x) => x.tipo === 'decisao' && x.status === 'pendente');
  const caminho = `/api/tarefas/${decisao.id}/concluir?data=2026-11-23`;

  let r = await chamar(caminho, { por: 'Jessica', resposta: 'nao', observacao: 'Sem retorno' });
  assert.strictEqual(r.status, 409);
  assert.match(r.json.erro, /coloque a ocorrência 999 como Pendente no SGP\. Verifiquei agora e ela ainda está Aberta/);
  assert.deepStrictEqual(consultas, ['999']);
  assert.strictEqual((await repositorio.obter('1')).tarefas.find((x) => x.id === decisao.id).status, 'pendente');

  status = 3;
  r = await chamar(caminho, { por: 'Jessica', resposta: 'nao', observacao: 'Sem retorno' });
  assert.strictEqual(r.status, 200);
  assert.notStrictEqual(r.json.etapaAtual, decisao.etapa);
});

test('regra do Pendente: "regularizou" não depende do status e SGP fora do ar dá aviso claro', async (t) => {
  const repositorio = new RepositorioJson(null);
  const p = await prepararNaoRegularizou(repositorio);
  const chamar = subir(t, { repositorio, statusOcorrenciaSgp: async () => { throw new Error('fora'); } });
  const decisao = p.tarefas.find((x) => x.tipo === 'decisao' && x.status === 'pendente');
  const r = await chamar(`/api/tarefas/${decisao.id}/concluir?data=2026-11-23`, { por: 'Jessica', resposta: 'nao', observacao: 'x' });
  assert.strictEqual(r.status, 503);
  assert.match(r.json.erro, /Não consegui conferir/);
  const ok = await chamar(`/api/tarefas/${decisao.id}/concluir?data=2026-11-23`, { por: 'Jessica', resposta: 'sim', observacao: 'Pagou' });
  assert.strictEqual(ok.status, 200);
});
