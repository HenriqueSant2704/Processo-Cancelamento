// Testa o banco de verdade (Postgres) usando o PGlite, um Postgres que roda em memória.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { PGlite } = require('@electric-sql/pglite');
const { criarBancoPglite, migrar } = require('../src/banco/conexao');
const { RepositorioPostgres } = require('../src/processos/repositorioPostgres');
const { Usuarios } = require('../src/auth/usuarios');
const { carregarCronograma } = require('../src/config');
const { criarProcesso, concluirTarefa } = require('../src/cronograma/motor');
const { sincronizar } = require('../src/processos/servico');
const { criarFonteExemplo } = require('../src/integracoes/sgp/exemplo');
const { criarApp } = require('../src/web/app');

const cronograma = carregarCronograma();

async function novoBanco(t) {
  const banco = criarBancoPglite(new PGlite());
  await migrar(banco);
  await migrar(banco); // rodar duas vezes não pode dar erro
  t.after(() => banco.fechar());
  return banco;
}

test('repositório Postgres: salva, lê e avança o processo', async (t) => {
  const repo = new RepositorioPostgres(await novoBanco(t));
  const id = await repo.proximoId();
  const p = criarProcesso({ id, cliente: { id: '55', nome: 'Cliente Teste', contrato: 'C-55' }, bloqueadoEm: '2026-11-15', inicio: '2026-11-16', cronograma });
  await repo.salvarProcesso(p);

  assert.ok(await repo.processoAtivoDoCliente('55'));
  const lido = await repo.obter(id);
  assert.strictEqual(lido.cliente.nome, 'Cliente Teste');
  assert.deepStrictEqual(lido.tarefas.map((t) => t.data), p.tarefas.map((t) => t.data));
  assert.strictEqual(lido.historico.length, 2);

  const decisao = lido.tarefas.find((t) => t.tipo === 'decisao');
  concluirTarefa(lido, decisao.id, { por: 'Jessica', data: '2026-11-23', resposta: 'nao', observacao: 'Não atendeu' }, cronograma);
  await repo.salvarProcesso(lido);

  const depois = await repo.obter(id);
  assert.strictEqual(depois.etapaAtual, 'negativacao');
  assert.strictEqual(depois.tarefas.find((t) => t.id === decisao.id).resposta, 'nao');
  assert.ok(depois.tarefas.some((t) => t.descricao === 'Negativar o cliente' && t.status === 'pendente'));
  assert.strictEqual((await repo.listar()).length, 1);
});

test('repositório Postgres: duas pessoas salvando o mesmo cliente ao mesmo tempo', async (t) => {
  const repo = new RepositorioPostgres(await novoBanco(t));
  const p = criarProcesso({ id: await repo.proximoId(), cliente: { id: '1', nome: 'A', contrato: 'C-1' }, bloqueadoEm: '2026-11-15', inicio: '2026-11-16', cronograma });
  await repo.salvarProcesso(p);

  const daJessica = await repo.obter(p.id);
  const doRafael = await repo.obter(p.id);
  concluirTarefa(daJessica, daJessica.tarefas[0].id, { por: 'Jessica', data: '2026-11-16' }, cronograma);
  await repo.salvarProcesso(daJessica);
  concluirTarefa(doRafael, doRafael.tarefas[1].id, { por: 'Rafael', data: '2026-11-16' }, cronograma);
  await assert.rejects(repo.salvarProcesso(doRafael), /Outra pessoa atualizou/);
});

test('sincronizar com Postgres não duplica clientes', async (t) => {
  const repo = new RepositorioPostgres(await novoBanco(t));
  const hoje = '2026-11-17';
  assert.strictEqual((await sincronizar({ sgp: criarFonteExemplo(hoje), repositorio: repo, cronograma, hoje })).novos.length, 2);
  assert.strictEqual((await sincronizar({ sgp: criarFonteExemplo(hoje), repositorio: repo, cronograma, hoje })).novos.length, 0);
});

test('login: usuário, senha, sessão e proteção da tela', async (t) => {
  const banco = await novoBanco(t);
  const usuarios = new Usuarios(banco);
  const { senha } = await usuarios.criar({ login: 'jessica', nome: 'Jessica Silva' });
  assert.ok(senha.length >= 10);
  await assert.rejects(usuarios.criar({ login: 'jessica', nome: 'Outra' }), /Já existe/);
  assert.strictEqual(await usuarios.autenticar('jessica', 'errada'), null);
  assert.strictEqual((await usuarios.autenticar('JESSICA', senha)).nome, 'Jessica Silva');

  const app = criarApp({ repositorio: new RepositorioPostgres(banco), usuarios, cronograma, criarSgp: criarFonteExemplo });
  const servidor = http.createServer(app).listen(0);
  t.after(() => servidor.close());
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const json = { 'Content-Type': 'application/json' };

  // Sem login: tela redireciona e API recusa.
  const tela = await fetch(base + '/', { redirect: 'manual' });
  assert.strictEqual(tela.status, 302);
  assert.strictEqual(tela.headers.get('location'), '/login.html');
  assert.strictEqual((await fetch(base + '/api/painel')).status, 401);
  assert.strictEqual((await fetch(base + '/login.html')).status, 200);

  const errado = await fetch(base + '/api/login', { method: 'POST', headers: json, body: JSON.stringify({ login: 'jessica', senha: 'x' }) });
  assert.strictEqual(errado.status, 401);

  const certo = await fetch(base + '/api/login', { method: 'POST', headers: json, body: JSON.stringify({ login: 'jessica', senha }) });
  assert.strictEqual(certo.status, 200);
  const cookieBruto = certo.headers.get('set-cookie');
  assert.match(cookieBruto, /HttpOnly/);
  const cookie = cookieBruto.split(';')[0];

  assert.strictEqual((await (await fetch(base + '/api/eu', { headers: { Cookie: cookie } })).json()).nome, 'Jessica Silva');
  await fetch(base + '/api/sincronizar', { method: 'POST', headers: { ...json, Cookie: cookie }, body: '{}' });
  for (let s = { emAndamento: true }; s.emAndamento; ) s = await (await fetch(base + '/api/sincronizacao', { headers: { Cookie: cookie } })).json();
  const painel = await (await fetch(base + '/api/painel', { headers: { Cookie: cookie } })).json();
  const tarefa = painel.clientes[0].paraHoje[0];

  // O nome registrado vem da sessão, não do que o navegador manda.
  const r = await fetch(`${base}/api/tarefas/${tarefa.id}/concluir`, { method: 'POST', headers: { ...json, Cookie: cookie }, body: JSON.stringify({ por: 'Outra Pessoa' }) });
  const detalhe = await r.json();
  assert.strictEqual(detalhe.tarefas.find((x) => x.id === tarefa.id).concluidaPor, 'Jessica Silva');

  // Trocar senha e sair.
  const troca = await fetch(base + '/api/senha', { method: 'POST', headers: { ...json, Cookie: cookie }, body: JSON.stringify({ senhaAtual: senha, novaSenha: 'nova-senha-123' }) });
  assert.strictEqual(troca.status, 200);
  await fetch(base + '/api/sair', { method: 'POST', headers: { ...json, Cookie: cookie }, body: '{}' });
  assert.strictEqual((await fetch(base + '/api/painel', { headers: { Cookie: cookie } })).status, 401);
  assert.ok(await usuarios.autenticar('jessica', 'nova-senha-123'));

  // Usuário desativado não entra mais.
  await usuarios.desativar('jessica');
  assert.strictEqual(await usuarios.autenticar('jessica', 'nova-senha-123'), null);
});

test('Postgres: anota o 1º dia em que cada contrato foi visto suspenso', async (t) => {
  const repo = new RepositorioPostgres(await novoBanco(t));
  let vistos = await repo.registrarSuspensos(['11', '12'], '2026-11-16', 1);
  assert.strictEqual(vistos.get('11'), '2026-11-15'); // 1ª vez: já conta como suspenso há 1 dia
  vistos = await repo.registrarSuspensos(['11', '13'], '2026-11-17', 1);
  assert.strictEqual(vistos.get('11'), '2026-11-15'); // mantém a data
  assert.strictEqual(vistos.get('13'), '2026-11-17'); // novo conta a partir de hoje
  assert.strictEqual(vistos.has('12'), false); // deixou de estar suspenso
});

test('usuário ligado ao username do SGP aparece na sessão', async (t) => {
  const usuarios = new Usuarios(await novoBanco(t));
  const { senha } = await usuarios.criar({ login: 'jessica', nome: 'Jessica' });
  await usuarios.definirSgp('jessica', 'jessica_rasteiro');
  const u = await usuarios.autenticar('jessica', senha);
  const { token } = await usuarios.criarSessao(u.id);
  assert.strictEqual((await usuarios.usuarioDaSessao(token)).sgpLogin, 'jessica_rasteiro');
  await assert.rejects(usuarios.definirSgp('jessica', 'nome com espaço'), /inválido/);
});

test('Postgres: guarda e atualiza a ficha do cliente por contrato', async (t) => {
  const repo = new RepositorioPostgres(await novoBanco(t));
  assert.strictEqual(await repo.obterFicha('C-1'), null);
  await repo.salvarFichas(new Map([['C-1', { plano: 'A', telefones: ['1'] }], ['C-2', { plano: 'B' }]]), '2026-11-18');
  await repo.salvarFichas(new Map([['C-1', { plano: 'C', telefones: [] }]]), '2026-11-19');
  assert.deepStrictEqual(await repo.obterFicha('C-1'), { plano: 'C', telefones: [], em: '2026-11-19' });
  assert.deepStrictEqual(await repo.obterFicha('C-2'), { plano: 'B', em: '2026-11-18' });
});
