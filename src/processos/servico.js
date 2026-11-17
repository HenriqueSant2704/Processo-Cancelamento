// Regras de uso do sistema: sincronizar com o SGP, montar a agenda e concluir tarefas.
const { criarProcesso, concluirTarefa, agendaDoDia } = require('../cronograma/motor');
const { diasEntre } = require('../utils/datas');

// Busca os clientes bloqueados no SGP e abre um processo para quem está
// bloqueado há pelo menos X dias (config) e ainda não tem processo ativo.
async function sincronizar({ sgp, repositorio, cronograma, hoje }) {
  const bloqueados = await sgp.listarClientesBloqueados();
  const minimo = cronograma.entrada.diasBloqueadoMinimo;

  // Sem data de suspensão vinda do SGP: usa o primeiro dia em que o sistema viu o contrato suspenso.
  if (bloqueados.some((c) => !c.bloqueadoEm)) {
    const vistos = await repositorio.registrarSuspensos(bloqueados.map((c) => String(c.id)), hoje, minimo);
    for (const c of bloqueados) if (!c.bloqueadoEm) c.bloqueadoEm = vistos.get(String(c.id));
  }
  const novos = [];

  for (const cliente of bloqueados) {
    if (diasEntre(cliente.bloqueadoEm, hoje) < minimo) continue;
    if (await repositorio.processoAtivoDoCliente(cliente.id)) continue;
    const processo = criarProcesso({
      id: await repositorio.proximoId(),
      cliente: { id: String(cliente.id), nome: cliente.nome, contrato: cliente.contrato },
      bloqueadoEm: cliente.bloqueadoEm,
      inicio: hoje,
      cronograma,
    });
    await repositorio.salvarProcesso(processo);
    novos.push(processo);
  }

  return { totalBloqueados: bloqueados.length, novos };
}

async function agenda({ repositorio, hoje }) {
  return agendaDoDia(await repositorio.listar(), hoje);
}

async function concluir({ repositorio, cronograma, tarefaId, por, data, observacao, resposta }) {
  const processo = await repositorio.obterPorTarefa(tarefaId);
  if (!processo) throw new Error(`Tarefa ${tarefaId} não encontrada.`);
  const tarefa = concluirTarefa(processo, tarefaId, { por, data, observacao, resposta }, cronograma);
  await repositorio.salvarProcesso(processo);
  return { processo, tarefa };
}

module.exports = { sincronizar, agenda, concluir };
