// Motor do cronograma: cria o processo de um cliente, gera as tarefas de cada
// etapa com as datas certas e avança conforme o funcionário conclui as tarefas.
// Todas as regras (prazos, tentativas, intervalos) vêm do cronograma.json.
const { proximoDiaUtil, adicionarDias, adicionarDiasUteis } = require('../utils/datas');
const { registrar } = require('../auditoria/historico');

function obterEtapa(cronograma, id) {
  const etapa = cronograma.etapas.find((e) => e.id === id);
  if (!etapa) throw new Error(`Etapa "${id}" não existe no cronograma.`);
  return etapa;
}

function novaTarefa(processo, dados) {
  const tarefa = {
    id: `${processo.id}.${processo.tarefas.length + 1}`,
    status: 'pendente',
    ...dados,
  };
  processo.tarefas.push(tarefa);
  return tarefa;
}

function criarProcesso({ id, cliente, bloqueadoEm, inicio, cronograma }) {
  const processo = {
    id: String(id),
    cliente,
    bloqueadoEm,
    iniciadoEm: inicio,
    status: 'ativo',
    resultado: null,
    etapaAtual: null,
    tarefas: [],
    historico: [],
  };
  registrar(processo, {
    data: inicio,
    por: 'sistema',
    evento: 'processo-iniciado',
    detalhes: `Cliente bloqueado no SGP desde ${bloqueadoEm}.`,
  });
  iniciarEtapa(processo, cronograma.inicio, inicio, cronograma);
  return processo;
}

function iniciarEtapa(processo, etapaId, dataBase, cronograma) {
  const etapa = obterEtapa(cronograma, etapaId);
  const feriados = cronograma.feriados || [];
  const primeiroDia = proximoDiaUtil(dataBase, feriados);

  processo.etapaAtual = etapa.id;
  registrar(processo, { data: dataBase, por: 'sistema', evento: 'etapa-iniciada', detalhes: etapa.nome });

  for (const acao of etapa.acoes || []) {
    novaTarefa(processo, { etapa: etapa.id, tipo: 'acao', descricao: acao, data: primeiroDia });
  }

  if (etapa.tipo === 'contatos') {
    let dia = primeiroDia;
    let ultimoContato = dia;
    for (let i = 1; i <= etapa.tentativas; i++) {
      novaTarefa(processo, {
        etapa: etapa.id,
        tipo: 'contato',
        descricao: `${etapa.mensagem} (${i}ª de ${etapa.tentativas})`,
        data: dia,
      });
      ultimoContato = dia;
      dia = adicionarDiasUteis(dia, etapa.intervaloDiasUteis, feriados);
    }
    novaTarefa(processo, {
      etapa: etapa.id,
      tipo: 'decisao',
      descricao: etapa.decisao.pergunta,
      data: adicionarDiasUteis(ultimoContato, etapa.decisao.diasUteisAposUltimoContato || 0, feriados),
    });
  } else if (etapa.tipo === 'aguardo') {
    novaTarefa(processo, {
      etapa: etapa.id,
      tipo: 'decisao',
      descricao: etapa.decisao.pergunta,
      data: proximoDiaUtil(adicionarDias(dataBase, etapa.dias), feriados),
    });
  } else if (etapa.tipo === 'acao' || etapa.tipo === 'final') {
    if (!(etapa.acoes || []).length) concluirEtapaSemDecisao(processo, etapa, dataBase, 'sistema', cronograma);
  } else {
    throw new Error(`Tipo de etapa desconhecido: "${etapa.tipo}".`);
  }
}

function concluirEtapaSemDecisao(processo, etapa, data, por, cronograma) {
  if (etapa.tipo === 'final') {
    processo.status = 'finalizado';
    processo.resultado = etapa.resultado;
    processo.etapaAtual = null;
    processo.finalizadoEm = data;
    registrar(processo, { data, por, evento: 'processo-finalizado', detalhes: `Resultado: ${etapa.resultado}` });
  } else {
    iniciarEtapa(processo, etapa.proxima, data, cronograma);
  }
}

// Conclui uma tarefa. Para tarefas de decisão, informe resposta 'sim' ou 'nao'
// e uma observação (o que foi feito / por quê). Uma decisão pode ser respondida
// antes da data prevista (ex.: o cliente pagou depois do 1º contato); nesse caso
// os contatos que faltavam daquela etapa são cancelados.
function concluirTarefa(processo, tarefaId, { por, data, observacao, resposta }, cronograma) {
  if (processo.status !== 'ativo') throw new Error(`O processo ${processo.id} já foi finalizado.`);
  const tarefa = processo.tarefas.find((t) => t.id === tarefaId);
  if (!tarefa) throw new Error(`Tarefa ${tarefaId} não encontrada.`);
  if (tarefa.status !== 'pendente') throw new Error(`A tarefa ${tarefaId} já está ${tarefa.status}.`);
  if (!por) throw new Error('Informe quem concluiu a tarefa.');

  if (tarefa.tipo === 'decisao') {
    if (!['sim', 'nao'].includes(resposta)) throw new Error('Responda a decisão com "sim" ou "nao".');
    if (!observacao) throw new Error('Explique o que foi feito ou o motivo (observação obrigatória na decisão).');
  }

  Object.assign(tarefa, { status: 'concluida', concluidaEm: data, concluidaPor: por, observacao: observacao || null });
  if (tarefa.tipo === 'decisao') tarefa.resposta = resposta;
  registrar(processo, {
    data,
    por,
    evento: 'tarefa-concluida',
    detalhes: `${tarefa.descricao}${resposta ? ` -> ${resposta}` : ''}${observacao ? ` | ${observacao}` : ''}`,
  });

  const etapa = obterEtapa(cronograma, tarefa.etapa);

  if (tarefa.tipo === 'decisao') {
    for (const t of processo.tarefas) {
      if (t.etapa === etapa.id && t.status === 'pendente') {
        t.status = 'cancelada';
        t.canceladaEm = data;
      }
    }
    iniciarEtapa(processo, resposta === 'sim' ? etapa.decisao.sim : etapa.decisao.nao, data, cronograma);
    return tarefa;
  }

  const faltam = processo.tarefas.some((t) => t.etapa === etapa.id && t.status === 'pendente');
  if (!faltam && (etapa.tipo === 'acao' || etapa.tipo === 'final')) {
    concluirEtapaSemDecisao(processo, etapa, data, por, cronograma);
  }
  return tarefa;
}

// Tarefas pendentes até a data informada, agrupadas por cliente
// (as de dias anteriores aparecem como atrasadas).
function agendaDoDia(processos, hoje) {
  const itens = [];
  for (const processo of processos) {
    if (processo.status !== 'ativo') continue;
    for (const tarefa of processo.tarefas) {
      if (tarefa.status === 'pendente' && tarefa.data <= hoje) {
        itens.push({ processo, tarefa, atrasada: tarefa.data < hoje });
      }
    }
  }
  return itens.sort(
    (a, b) =>
      a.processo.cliente.nome.localeCompare(b.processo.cliente.nome) ||
      a.processo.id.localeCompare(b.processo.id) ||
      a.tarefa.data.localeCompare(b.tarefa.data),
  );
}

module.exports = { criarProcesso, iniciarEtapa, concluirTarefa, agendaDoDia, obterEtapa };
