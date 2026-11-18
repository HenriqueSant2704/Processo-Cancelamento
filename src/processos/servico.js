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
      // Data real da suspensão (SGP) diferente da que temos: corrige.
      if (cliente.dataReal && existente.bloqueadoEm && existente.bloqueadoEm !== cliente.bloqueadoEm) await repositorio.atualizarBloqueio(existente.id, cliente.bloqueadoEm);
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

// Liga cada processo de suspenso à ocorrência aberta do contrato no SGP (para os comentários automáticos).
async function vincularOcorrencias({ sgp, repositorio }) {
  const porContrato = await sgp.listarOcorrenciasDoFluxoPrincipal();
  let ligados = 0;
  for (const p of await repositorio.listar()) {
    if (p.status !== 'ativo' || (p.fluxo || 'principal') !== 'principal') continue;
    const achada = porContrato.get(String(p.cliente.contrato));
    if (achada && (!p.ocorrencia || p.ocorrencia.numero !== achada.numero)) {
      await repositorio.atualizarOcorrencia(p.id, achada.numero);
      ligados++;
    }
  }
  return ligados;
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
  if (typeof args.sgp.listarOcorrenciasDoFluxoPrincipal === 'function') {
    try {
      await vincularOcorrencias(args);
    } catch (erro) {
      erros.push(`ocorrências: ${erro.message}`);
    }
  }
  const resultado = { totalBloqueados: suspensos.totalBloqueados, totalPosCancelamento: pos.totalPosCancelamento, novos: [...suspensos.novos, ...pos.novos] };
  if (erros.length) {
    const erro = new Error(`Sincronização incompleta (${erros.join('; ')}). ${resultado.novos.length} novo(s) processo(s) foram gravados.`);
    erro.resultadoParcial = resultado;
    throw erro;
  }
  return resultado;
}

// Cria no SGP a ocorrência ligada a uma tarefa ("Abrir ocorrência ... no SGP") e marca a tarefa como feita.
// criar: função que grava no SGP e devolve { protocolo, tipo }.
async function criarOcorrenciaDaTarefa({ repositorio, cronograma, tarefaId, conteudo, por, data, criar }) {
  const { obterEtapa } = require('../cronograma/motor');
  const preparar = async () => {
    const processo = await repositorio.obterPorTarefa(tarefaId);
    if (!processo) throw new Error(`Tarefa ${tarefaId} não encontrada.`);
    const tarefa = processo.tarefas.find((t) => t.id === tarefaId);
    if (!tarefa || tarefa.status !== 'pendente') throw new Error('Essa tarefa não está pendente.');
    const etapa = obterEtapa(cronograma, tarefa.etapa);
    if (!etapa.ocorrenciaSgp || etapa.ocorrenciaSgp.acao !== tarefa.descricao) throw new Error('Essa tarefa não cria ocorrência no SGP.');
    return { processo, etapa };
  };
  if (!por) throw new Error('Informe quem está criando a ocorrência.');
  if (typeof conteudo !== 'string' || conteudo.trim().length < 5) throw new Error('Escreva o texto da ocorrência.');

  const { processo, etapa } = await preparar();
  const criada = await criar({ contrato: processo.cliente.contrato, tipoNome: etapa.ocorrenciaSgp.tipo, conteudo: conteudo.trim() });
  const observacao = `Ocorrência ${criada.protocolo} (${criada.tipo}) criada no SGP pelo sistema.`;

  // A ocorrência já existe no SGP: grava aqui; se outra pessoa mexeu no cliente ao mesmo tempo, tenta de novo.
  for (let tentativa = 1; ; tentativa++) {
    const atual = tentativa === 1 ? processo : (await preparar()).processo;
    try {
      concluirTarefa(atual, tarefaId, { por, data, observacao }, cronograma);
      atual.ocorrencia = { numero: criada.protocolo };
      await repositorio.salvarProcesso(atual);
      return { processo: atual, protocolo: criada.protocolo, aviso: criada.aviso || null };
    } catch (erro) {
      if (tentativa >= 3) throw new Error(`${observacao} Mas não consegui registrar aqui: ${erro.message} Marque a tarefa como feita manualmente.`);
    }
  }
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

module.exports = { sincronizar, sincronizarPosCancelamento, sincronizarTudo, criarOcorrenciaDaTarefa, agenda, concluir };
