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
    const existente = await repositorio.processoAtivoDoCliente(cliente.id);
    if (existente) {
      if (cliente.financeiro) await repositorio.atualizarFinanceiro(existente.id, { ...cliente.financeiro, em: hoje });
      continue;
    }
    const processo = criarProcesso({
      id: await repositorio.proximoId(),
      cliente: { id: String(cliente.id), nome: cliente.nome, contrato: cliente.contrato },
      bloqueadoEm: cliente.bloqueadoEm,
      inicio: hoje,
      cronograma,
    });
    if (cliente.financeiro) processo.financeiro = { ...cliente.financeiro, em: hoje };
    await repositorio.salvarProcesso(processo);
    novos.push(processo);
  }

  return { totalBloqueados: bloqueados.length, novos };
}

// Abre um processo do fluxo "pos-cancelamento" para cada contrato com ocorrência
// aberta de negativação pós-cancelamento no SGP (um por contrato).
async function sincronizarPosCancelamento({ sgp, repositorio, cronograma, hoje }) {
  const lista = await sgp.listarPosCancelamento();
  const novos = [];
  for (const item of lista) {
    const chave = `pos-${item.contrato}`;
    if (await repositorio.processoAtivoDoCliente(chave)) continue;
    const processo = criarProcesso({
      id: await repositorio.proximoId(),
      fluxo: 'pos-cancelamento',
      cliente: { id: chave, nome: item.nome, contrato: item.contrato },
      bloqueadoEm: item.ocorrencia.abertaEm || hoje,
      ocorrencia: { numero: item.ocorrencia.numero },
      inicio: hoje,
      cronograma,
    });
    await repositorio.salvarProcesso(processo);
    novos.push(processo);
  }
  return { totalPosCancelamento: lista.length, novos };
}

// Pós-cancelamento + suspensos numa rodada só. As duas partes são independentes:
// se uma falhar (ex.: SGP lento), a outra ainda é gravada; o erro é repassado no fim.
async function sincronizarTudo(args) {
  const erros = [];
  let pos = { totalPosCancelamento: 0, novos: [] };
  if (typeof args.sgp.listarPosCancelamento === 'function') {
    try {
      pos = await sincronizarPosCancelamento(args);
    } catch (erro) {
      erros.push(`pós-cancelamento: ${erro.message}`);
    }
  }
  let suspensos = { totalBloqueados: 0, novos: [] };
  try {
    suspensos = await sincronizar(args);
  } catch (erro) {
    erros.push(`suspensos: ${erro.message}`);
  }
  const resultado = { totalBloqueados: suspensos.totalBloqueados, totalPosCancelamento: pos.totalPosCancelamento, novos: [...suspensos.novos, ...pos.novos] };
  if (erros.length) {
    const erro = new Error(`Sincronização incompleta (${erros.join('; ')}). ${resultado.novos.length} novo(s) processo(s) foram gravados.`);
    erro.resultadoParcial = resultado;
    throw erro;
  }
  return resultado;
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

module.exports = { sincronizar, sincronizarPosCancelamento, sincronizarTudo, agenda, concluir };
