const test = require('node:test');
const assert = require('node:assert');
const { carregarCronograma } = require('../src/config');
const { criarProcesso } = require('../src/cronograma/motor');
const { lerCiclo, sugerir, classificar } = require('../src/processos/leitorOcorrencias');
const { RepositorioJson } = require('../src/processos/repositorio');
const { posicionarPeloSgp } = require('../src/processos/servico');

const cronograma = carregarCronograma();
const c = (usuario, data, comentario) => ({ usuario, data_cadastro: `${data} 10:00:00`, comentario });
const REG = 'REGISTRO DE TENTATIVAS DE CONTATO<br>Telefone: x<br>Ligação realizada às 12h28.';
const neg = (comentarios, status = 0) => ({ numero: 'N1', tipo: 'Financeiro - Negativação', status_id: status, data_cadastro: '2026-11-06', comentarios });
const canc = (comentarios) => ({ numero: 'C1', tipo: 'Financeiro - Cancelamento por Inadiplência', status_id: 0, data_cadastro: '2026-11-09', comentarios });

test('classifica os registros da Jéssica, do Lucas e do Rangel', () => {
  assert.strictEqual(classificar(c('jessica_rasteiro', '2026-11-06', REG)).tipo, 'contato');
  assert.strictEqual(classificar(c('admin', '2026-11-12', 'autorizado')).tipo, 'autorizado');
  assert.strictEqual(classificar(c('admin', '2026-11-12', 'ok, aguardar')).tipo, 'aguardar');
  assert.strictEqual(classificar(c('jessica_rasteiro', '2026-11-13', 'Olá, Lucas,<br>Informo que a negativação foi devidamente realizada, bem como...')).tipo, 'negativado');
  const eq = classificar(c('rangel_cardozo', '2026-11-17', 'EQUIPAMENTOS DE CAMERA DEVOLVIDOS PARA O ESTOQUE POR CANCELAMENTO FICOU FALTANDO RETIRAR OS EQUIPAMENTOS DE INTERNET'));
  assert.deepStrictEqual(eq, { tipo: 'equipamentos', parcial: true });
});

test('ciclo: avisos, autorização, negativação, cancelamento e retirada', () => {
  assert.deepStrictEqual(lerCiclo([neg([c('jessica_rasteiro', '2026-11-06', REG), c('jessica_rasteiro', '2026-11-09', REG)])], cronograma).contatosFeitos, 2);
  const tres = [c('jessica_rasteiro', '2026-11-06', REG), c('jessica_rasteiro', '2026-11-09', REG), c('jessica_rasteiro', '2026-11-11', REG)];
  assert.strictEqual(lerCiclo([neg([...tres, c('admin', '2026-11-12', 'autorizado')])], cronograma).etapaId, 'negativacao');
  // Autorizado, mas depois combinaram de aguardar: não avança.
  const espera = lerCiclo([neg([...tres, c('admin', '2026-11-12', 'autorizado'), c('admin', '2026-11-13', 'pode aguarda no maximo.')])], cronograma);
  assert.strictEqual(espera.etapaId, 'notificacao-negativacao');
  assert.match(espera.conferir[0], /aguardar/);
  const negativado = lerCiclo([neg([...tres, c('admin', '2026-11-12', 'autorizado'), c('jessica_rasteiro', '2026-11-13', 'Informo que a negativação foi devidamente realizada')])], cronograma);
  assert.deepStrictEqual([negativado.etapaId, negativado.dataReferencia], ['aguardo-negativado', '2026-11-13']);
  // Negativação já encerrada e cancelamento aberto.
  const negEnc = neg([...tres, c('jessica_rasteiro', '2026-11-13', 'Informo que a negativação foi devidamente realizada')], 1);
  assert.strictEqual(lerCiclo([negEnc, canc([c('jessica_rasteiro', '2026-11-10', REG)])], cronograma).etapaId, 'aviso-cancelamento');
  const retirada = lerCiclo([negEnc, canc([c('jessica_rasteiro', '2026-11-18', 'Informo que o cancelamento foi devidamente realizado'), c('jessica_rasteiro', '2026-11-18', 'Olá, Miguel, Você pode, por gentileza, abrir uma ordem de serviço para a retirada dos equipamentos.')])], cronograma);
  assert.deepStrictEqual([retirada.etapaId, retirada.dataReferencia], ['retirada-equipamentos', '2026-11-18']);
  const devolvido = lerCiclo([negEnc, canc([c('jessica_rasteiro', '2026-11-18', 'Informo que o cancelamento foi devidamente realizado'), c('rangel_cardozo', '2026-11-20', 'EQUIPAMENTOS DEVOLVIDOS PARA O ESTOQUE POR CANCELAMENTO TUDO CERTO')])], cronograma);
  assert.strictEqual(devolvido.etapaId, 'abertura-pos-cancelamento');
  assert.strictEqual(lerCiclo([neg([], 1)], cronograma), null);
});

test('posicionar pelo SGP: só avança, e só com --aplicar', async () => {
  const repositorio = new RepositorioJson(null);
  const p = criarProcesso({ id: '1', cliente: { id: '50', nome: 'Cliente', contrato: '50' }, bloqueadoEm: '2026-11-03', inicio: '2026-11-04', cronograma });
  await repositorio.salvarProcesso(p);
  const sgp = { ocorrenciasComComentarios: async () => new Map([['50', [neg([c('jessica_rasteiro', '2026-11-06', REG), c('jessica_rasteiro', '2026-11-09', REG)])]]]) };
  let r = await posicionarPeloSgp({ sgp, repositorio, cronograma, hoje: '2026-11-19' });
  assert.strictEqual(r[0].acao, 'avancar');
  assert.strictEqual((await repositorio.obter('1')).tarefas.filter((t) => t.tipo === 'contato' && t.status === 'concluida').length, 0);
  r = await posicionarPeloSgp({ sgp, repositorio, cronograma, hoje: '2026-11-19', aplicar: true });
  assert.strictEqual(r[0].aplicado, true);
  const depois = await repositorio.obter('1');
  assert.strictEqual(depois.tarefas.filter((t) => t.tipo === 'contato' && t.status === 'concluida').length, 2);
  assert.ok(depois.historico.some((h) => h.evento === 'etapa-ajustada' && /Lido nos comentários/.test(h.detalhes)));
  assert.strictEqual(sugerir(depois, [neg([c('jessica_rasteiro', '2026-11-06', REG)])], cronograma).acao, 'manter'); // nunca volta
});
