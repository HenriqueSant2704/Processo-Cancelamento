const test = require('node:test');
const assert = require('node:assert');
const { carregarCronograma } = require('../src/config');
const { RepositorioJson } = require('../src/processos/repositorio');
const { sincronizar } = require('../src/processos/servico');
const { criarFonteExemplo } = require('../src/integracoes/sgp/exemplo');

test('sincronizar abre processo só para bloqueados há 1 dia ou mais, sem duplicar', async () => {
  const cronograma = carregarCronograma();
  const repositorio = new RepositorioJson(null);
  const hoje = '2026-11-17';
  const sgp = criarFonteExemplo(hoje);

  const primeira = await sincronizar({ sgp, repositorio, cronograma, hoje });
  assert.strictEqual(primeira.totalBloqueados, 3);
  assert.deepStrictEqual(primeira.novos.map((p) => p.cliente.nome), ['Cliente Exemplo B', 'Cliente Exemplo C']);

  const segunda = await sincronizar({ sgp, repositorio, cronograma, hoje });
  assert.strictEqual(segunda.novos.length, 0);
});

test('sincronização grava a ficha do cliente e a API devolve junto com o processo', async () => {
  const { sincronizarTudo } = require('../src/processos/servico');
  const cronograma = carregarCronograma();
  const repositorio = new RepositorioJson(null);
  const hoje = '2026-11-17';
  await sincronizarTudo({ sgp: criarFonteExemplo(hoje), repositorio, cronograma, hoje });
  const [p] = (await repositorio.listar()).filter((x) => x.cliente.contrato === 'C-9002');
  const ficha = await repositorio.obterFicha(p.cliente.contrato);
  assert.strictEqual(ficha.plano, 'Plano Exemplo 300 MB');
  assert.strictEqual(ficha.em, hoje);
});

test('sai do processo quem não está mais suspenso e não tem ocorrência aberta', async () => {
  const { carregarCronograma } = require('../src/config');
  const { criarProcesso, posicionar } = require('../src/cronograma/motor');
  const { RepositorioJson } = require('../src/processos/repositorio');
  const { sincronizarTudo } = require('../src/processos/servico');
  const cronograma = carregarCronograma();
  const repositorio = new RepositorioJson(null);
  const novo = (id, contrato) => criarProcesso({ id, cliente: { id: contrato, nome: `C${id}`, contrato }, bloqueadoEm: '2026-11-01', inicio: '2026-11-02', cronograma });
  const suspenso = novo('1', '100');
  const pagouSemOcorrencia = novo('2', '200');
  const promessaComOcorrencia = novo('3', '300');
  const jaCancelado = novo('4', '400');
  posicionar(jaCancelado, { etapaId: 'cancelamento', por: 'J', data: '2026-11-10' }, cronograma);
  for (const p of [suspenso, pagouSemOcorrencia, promessaComOcorrencia, jaCancelado]) await repositorio.salvarProcesso(p);
  repositorio.dados.ultimoId = 4;
  const sgp = {
    listarClientesBloqueados: async () => [{ id: '100', nome: 'C1', contrato: '100', bloqueadoEm: '2026-11-01' }],
    listarOcorrenciasDoFluxoPrincipal: async () => new Map([['300', { numero: 'X', abertaEm: '2026-11-05' }]]),
  };
  const r = await sincronizarTudo({ sgp, repositorio, cronograma, hoje: '2026-11-19' });
  assert.strictEqual(r.retirados, 1);
  assert.strictEqual((await repositorio.obter('2')).resultado, 'saiu-da-suspensao');
  assert.ok((await repositorio.obter('2')).tarefas.every((t) => t.status !== 'pendente'));
  for (const id of ['1', '3', '4']) assert.strictEqual((await repositorio.obter(id)).status, 'ativo');
  // Falha na leitura das ocorrências: ninguém sai.
  const r2 = await sincronizarTudo({ sgp: { ...sgp, listarOcorrenciasDoFluxoPrincipal: async () => { throw new Error('fora'); } }, repositorio, cronograma, hoje: '2026-11-19' }).catch((e) => e.resultadoParcial);
  assert.strictEqual(r2.retirados, 0);
});
