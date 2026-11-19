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
