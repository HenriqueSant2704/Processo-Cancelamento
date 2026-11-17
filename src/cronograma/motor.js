// Motor do cronograma: cria o processo de um cliente, gera as tarefas de cada
// etapa com as datas certas e avança conforme o funcionário conclui as tarefas.
// Todas as regras (prazos, tentativas, intervalos) vêm do cronograma.json.
const { proximoDiaUtil, adicionarDias, adicionarDiasUteis, subtrairDiasUteis } = require('../utils/datas');
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

// Fluxo do processo: "principal" (suspensos) ou "pos-cancelamento".
function obterFluxo(cronograma, id = 'principal') {
  const fluxos = cronograma.fluxos || [{ id: 'principal', inicio: cronograma.inicio, fases: cronograma.fases }];
  const fluxo = fluxos.find((f) => f.id === id);
  if (!fluxo) throw new Error(`Fluxo "${id}" não existe no cronograma.`);
  return fluxo;
}

// ocorrencia (opcional): { numero, abertaEm } da ocorrência do SGP que originou o processo.
function criarProcesso({ id, cliente, bloqueadoEm, inicio, cronograma, fluxo = 'principal', ocorrencia = null }) {
  const definicao = obterFluxo(cronograma, fluxo);
  const processo = {
    id: String(id),
    fluxo: definicao.id,
    cliente,
    bloqueadoEm,
    iniciadoEm: inicio,
    status: 'ativo',
    resultado: null,
    etapaAtual: null,
    ocorrencia,
    tarefas: [],
    historico: [],
  };
  registrar(processo, {
    data: inicio,
    por: 'sistema',
    evento: 'processo-iniciado',
    detalhes: ocorrencia
      ? `Ocorrência ${ocorrencia.numero} aberta no SGP em ${bloqueadoEm}.`
      : `Cliente bloqueado no SGP desde ${bloqueadoEm}.`,
  });
  iniciarEtapa(processo, definicao.inicio, inicio, cronograma);
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

// Ajuste de etapa: coloca o processo na etapa certa para clientes que já foram
// tratados ANTES do sistema. O que estava pendente é cancelado e a etapa escolhida
// é montada a partir da data real informada, para os próximos dias saírem certos.
//   etapaId: etapa onde o cliente está
//   contatosFeitos: (etapa de contatos) quantos avisos dela já foram enviados
//   dataReferencia: data do último aviso enviado (contatos) ou do início da espera (aguardo)
function posicionar(processo, { etapaId, contatosFeitos = 0, dataReferencia, por, data, observacao }, cronograma) {
  if (processo.status !== 'ativo') throw new Error(`O processo ${processo.id} já foi finalizado.`);
  if (!por) throw new Error('Informe quem fez o ajuste.');
  const etapa = obterEtapa(cronograma, etapaId);
  if (!['contatos', 'aguardo', 'acao'].includes(etapa.tipo)) throw new Error('Escolha uma etapa de avisos, de espera ou de ação.');
  if (!obterFluxo(cronograma, processo.fluxo || 'principal').fases.includes(etapa.fase)) throw new Error('Essa etapa não faz parte do fluxo deste cliente.');
  if (dataReferencia && !/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)) throw new Error('Data inválida.');
  if (dataReferencia && dataReferencia > data) throw new Error('A data informada não pode ser no futuro.');
  const feriados = cronograma.feriados || [];
  const feitos = Number(contatosFeitos) || 0;

  let base = data;
  if (etapa.tipo === 'contatos') {
    if (!Number.isInteger(feitos) || feitos < 0 || feitos > etapa.tentativas) throw new Error(`Avisos já enviados: de 0 a ${etapa.tentativas}.`);
    if (feitos > 0) {
      if (!dataReferencia) throw new Error('Informe a data do último aviso enviado.');
      base = subtrairDiasUteis(dataReferencia, (feitos - 1) * etapa.intervaloDiasUteis, feriados);
    }
  } else if (etapa.tipo === 'aguardo') {
    if (!dataReferencia) throw new Error('Informe a data em que a espera começou (ex.: dia da negativação).');
    base = dataReferencia;
  }

  for (const t of processo.tarefas) {
    if (t.status === 'pendente') Object.assign(t, { status: 'cancelada', canceladaEm: data });
  }
  const detalhe = etapa.tipo === 'contatos' ? ` · ${feitos} de ${etapa.tentativas} avisos já enviados${feitos ? ` (último em ${dataReferencia})` : ''}` : etapa.tipo === 'aguardo' ? ` · espera desde ${dataReferencia}` : '';
  registrar(processo, { data, por, evento: 'etapa-ajustada', detalhes: `Ajuste manual para "${etapa.nome}"${detalhe}${observacao ? ` | ${observacao}` : ''}` });

  const antes = processo.tarefas.length;
  iniciarEtapa(processo, etapa.id, base, cronograma);
  if (etapa.tipo === 'contatos' && feitos > 0) {
    const novas = processo.tarefas.slice(antes);
    const jaFeitas = [...novas.filter((t) => t.tipo === 'acao'), ...novas.filter((t) => t.tipo === 'contato').slice(0, feitos)];
    for (const t of jaFeitas) {
      Object.assign(t, { status: 'concluida', concluidaEm: t.data, concluidaPor: por, observacao: observacao || 'Feito antes do sistema (registrado no ajuste de etapa).' });
    }
  }
  return processo;
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

module.exports = { criarProcesso, iniciarEtapa, concluirTarefa, posicionar, agendaDoDia, obterEtapa, obterFluxo };
