// Regras de uso do sistema: sincronizar com o SGP, montar a agenda e concluir tarefas.
const { criarProcesso, concluirTarefa, agendaDoDia } = require('../cronograma/motor');
const { diasEntre } = require('../utils/datas');

// Busca os clientes bloqueados no SGP e abre um processo para quem está
// bloqueado há pelo menos X dias (config) e ainda não tem processo ativo.
async function sincronizar({ sgp, repositorio, cronograma, hoje }) {
  const bloqueados = await sgp.listarClientesBloqueados();
  const minimo = cronograma.entrada.diasBloqueadoMinimo;
  const novos = [];

  for (const cliente of bloqueados) {
    if (diasEntre(cliente.bloqueadoEm, hoje) < minimo) continue;
    if (repositorio.processoAtivoDoCliente(cliente.id)) continue;
    const processo = criarProcesso({
      id: repositorio.proximoId(),
      cliente: { id: String(cliente.id), nome: cliente.nome, contrato: cliente.contrato },
      bloqueadoEm: cliente.bloqueadoEm,
      inicio: hoje,
      cronograma,
    });
    repositorio.adicionar(processo);
    novos.push(processo);
  }

  repositorio.salvar();
  return { totalBloqueados: bloqueados.length, novos };
}

function agenda({ repositorio, hoje }) {
  return agendaDoDia(repositorio.listar(), hoje);
}

function concluir({ repositorio, cronograma, tarefaId, por, data, observacao, resposta }) {
  const processo = repositorio.obterPorTarefa(tarefaId);
  if (!processo) throw new Error(`Tarefa ${tarefaId} não encontrada.`);
  const tarefa = concluirTarefa(processo, tarefaId, { por, data, observacao, resposta }, cronograma);
  repositorio.salvar();
  return { processo, tarefa };
}

module.exports = { sincronizar, agenda, concluir };
