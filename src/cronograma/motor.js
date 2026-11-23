// Motor do cronograma: cria o processo de um cliente, gera as tarefas de cada
// etapa com as datas certas e avança conforme o funcionário conclui as tarefas.
// Todas as regras (prazos, tentativas, intervalos) vêm do cronograma.json.
const { proximoDiaUtil, adicionarDias, adicionarDiasUteis, proximoAviso, avisoAnterior } = require('../utils/datas');
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

// Gera os avisos de uma etapa de contatos a partir do aviso nº "deIndice" (1 = todos),
// dia sim, dia não (o dia de folga pode ser fim de semana ou feriado), e a pergunta "regularizou?" depois do último.
function gerarContatos(processo, etapa, primeiroDia, deIndice, feriados) {
  let dia = primeiroDia;
  let ultimoContato = dia;
  for (let i = deIndice; i <= etapa.tentativas; i++) {
    novaTarefa(processo, { etapa: etapa.id, tipo: 'contato', descricao: `${etapa.mensagem} (${i}ª de ${etapa.tentativas})`, data: dia });
    ultimoContato = dia;
    dia = proximoAviso(dia, etapa.intervaloDiasUteis, feriados);
  }
  novaTarefa(processo, {
    etapa: etapa.id,
    tipo: 'decisao',
    descricao: etapa.decisao.pergunta,
    data: deIndice > etapa.tentativas ? primeiroDia : adicionarDiasUteis(ultimoContato, etapa.decisao.diasUteisAposUltimoContato || 0, feriados),
  });
}

// Promessa de pagamento: pausa os avisos que faltam da etapa atual até a data prometida.
// No dia, aparece "Promessa para dd/mm: o cliente pagou?". Sim -> segue como regularizado;
// Não -> o próximo aviso entra no mesmo dia e os seguintes voltam ao ritmo normal.
function registrarPromessa(processo, { dataPromessa, por, data, observacao }, cronograma) {
  if (processo.status !== 'ativo') throw new Error(`O processo ${processo.id} já foi finalizado.`);
  if (!por) throw new Error('Informe quem registrou a promessa.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataPromessa || ''))) throw new Error('Informe a data prometida pelo cliente.');
  if (dataPromessa < data) throw new Error('A data da promessa não pode ser no passado.');
  const etapa = obterEtapa(cronograma, processo.etapaAtual);
  if (etapa.tipo !== 'contatos') throw new Error('Promessa de pagamento só pode ser registrada durante os avisos.');
  const feriados = cronograma.feriados || [];

  // Pausa só os avisos e a pergunta; ações (ex.: abrir ocorrência) continuam pendentes.
  const daEtapa = processo.tarefas.filter((t) => t.etapa === etapa.id && t.status === 'pendente' && t.tipo !== 'acao');
  const contatosFeitos = processo.tarefas.filter((t) => t.etapa === etapa.id && t.tipo === 'contato' && t.status === 'concluida').length;
  for (const t of daEtapa) Object.assign(t, { status: 'cancelada', canceladaEm: data });

  const [a, m, d] = dataPromessa.split('-');
  novaTarefa(processo, {
    etapa: etapa.id,
    tipo: 'decisao',
    promessa: Math.min(contatosFeitos + 1, etapa.tentativas + 1), // aviso que volta se não pagar
    descricao: `Promessa de pagamento para ${d}/${m}/${a}: o cliente pagou?`,
    data: proximoDiaUtil(dataPromessa, feriados),
  });
  registrar(processo, { data, por, evento: 'promessa-registrada', detalhes: `Promessa de pagamento para ${d}/${m}/${a}${observacao ? ` | ${observacao}` : ''}` });
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
    gerarContatos(processo, etapa, primeiroDia, 1, feriados);
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

  // Aviso feito DEPOIS do dia marcado: os próximos avisos e a pergunta "regularizou?"
  // são recalculados a partir do dia em que ele foi realmente feito.
  // O dia real é o dia em que o aviso foi ENVIADO ("Enviei"), mesmo que ela finalize depois.
  const diaEnvio = tarefa.retorno && tarefa.retorno.enviadoEm ? new Date(tarefa.retorno.enviadoEm).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : null;
  const diaReal = diaEnvio && diaEnvio <= data ? diaEnvio : data;
  if (tarefa.tipo === 'contato' && etapa.tipo === 'contatos' && diaReal > tarefa.data) {
    const feriados = cronograma.feriados || [];
    const restantes = processo.tarefas
      .filter((t) => t.etapa === etapa.id && t.status === 'pendente' && t.tipo === 'contato')
      .sort((a, b) => a.data.localeCompare(b.data));
    let dia = proximoAviso(diaReal, etapa.intervaloDiasUteis, feriados);
    let ultimo = diaReal;
    for (const t of restantes) {
      t.data = dia;
      ultimo = dia;
      dia = proximoAviso(dia, etapa.intervaloDiasUteis, feriados);
    }
    const pergunta = processo.tarefas.find((t) => t.etapa === etapa.id && t.status === 'pendente' && t.tipo === 'decisao' && !t.promessa);
    if (pergunta) pergunta.data = adicionarDiasUteis(ultimo, etapa.decisao.diasUteisAposUltimoContato || 0, feriados);
  }

  if (tarefa.tipo === 'decisao') {
    for (const t of processo.tarefas) {
      if (t.etapa === etapa.id && t.status === 'pendente') {
        t.status = 'cancelada';
        t.canceladaEm = data;
      }
    }
    // Promessa não cumprida: retoma os avisos a partir de hoje (e não pula para a próxima etapa).
    if (tarefa.promessa && resposta === 'nao') {
      gerarContatos(processo, etapa, proximoDiaUtil(data, cronograma.feriados || []), tarefa.promessa, cronograma.feriados || []);
      return tarefa;
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
      base = dataReferencia;
      for (let i = 1; i < feitos; i++) base = avisoAnterior(base, etapa.intervaloDiasUteis, feriados);
    }
  } else if (etapa.tipo === 'aguardo') {
    if (!dataReferencia) throw new Error('Informe a data em que a espera começou (ex.: dia da negativação).');
    base = dataReferencia;
  }

  // O ajuste refaz a etapa escolhida do zero: o que já estava feito NELA (e nas seguintes) é desfeito,
  // senão os avisos contavam em dobro (ex.: "4 de 3") e a tela se perdia. Fica no cronograma como cancelado.
  const ordemEtapas = cronograma.etapas.map((e) => e.id);
  const desdeEtapa = ordemEtapas.indexOf(etapa.id);
  for (const t of processo.tarefas) {
    if (t.status === 'pendente') Object.assign(t, { status: 'cancelada', canceladaEm: data });
    else if (t.status === 'concluida' && ordemEtapas.indexOf(t.etapa) >= desdeEtapa) Object.assign(t, { status: 'cancelada', canceladaEm: data, desfeitaNoAjuste: true });
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

// Regra nova (23/11): o dia de folga entre avisos pode ser fim de semana ou feriado. Os processos que já
// estavam em andamento tinham os próximos avisos calculados pela regra antiga (sempre pulando um dia útil).
// Aqui eles são refeitos pela regra nova, a partir do último aviso enviado. Só mexe no aviso que bate com a
// regra antiga (não mexe em datas ajustadas à mão nem em avisos retomados depois de promessa) e nunca joga
// um aviso para antes de hoje. Pode rodar várias vezes: depois de ajustado, não muda mais.
function realinharAvisos(processo, cronograma, hoje) {
  if (processo.status !== 'ativo' || !processo.etapaAtual) return false;
  const etapa = obterEtapa(cronograma, processo.etapaAtual);
  if (etapa.tipo !== 'contatos') return false;
  const feriados = cronograma.feriados || [];
  const intervalo = etapa.intervaloDiasUteis;
  const daEtapa = processo.tarefas.filter((t) => t.etapa === etapa.id);
  if (daEtapa.some((t) => t.tipo === 'decisao' && t.promessa)) return false;

  const diaDoEnvio = (t) => (t.retorno && t.retorno.enviadoEm ? new Date(t.retorno.enviadoEm).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : null);
  const enviados = daEtapa.filter((t) => t.tipo === 'contato' && (t.status === 'concluida' || (t.status === 'pendente' && diaDoEnvio(t))));
  const pendentes = daEtapa.filter((t) => t.tipo === 'contato' && t.status === 'pendente' && !diaDoEnvio(t)).sort((a, b) => a.data.localeCompare(b.data));
  if (!pendentes.length) return false;

  // Ponto de partida: o último aviso enviado (dia marcado ou dia real do "Enviei", o que for depois).
  let fila = pendentes;
  let anteriores;
  if (enviados.length) {
    const ultimo = [...enviados].sort((a, b) => a.data.localeCompare(b.data)).pop();
    const real = diaDoEnvio(ultimo);
    anteriores = [...new Set([real && real > ultimo.data ? real : ultimo.data, ultimo.data])];
  } else {
    anteriores = [pendentes[0].data];
    fila = pendentes.slice(1);
  }
  const ancoraAntiga = anteriores.find((d) => fila.length && fila[0].data === adicionarDiasUteis(d, intervalo, feriados));
  if (!ancoraAntiga) return false;

  const minimo = proximoDiaUtil(hoje, feriados);
  let antigo = ancoraAntiga;
  let novo = ancoraAntiga;
  let mudou = false;
  let ultimoContato = null;
  for (const t of fila) {
    if (t.data !== adicionarDiasUteis(antigo, intervalo, feriados)) break;
    let data = proximoAviso(novo, intervalo, feriados);
    if (data < minimo && t.data >= minimo) data = minimo;
    antigo = t.data;
    novo = data;
    ultimoContato = data;
    if (data !== t.data) { t.data = data; mudou = true; }
  }
  if (!mudou) return false;
  const todos = daEtapa.filter((t) => t.tipo === 'contato' && t.status === 'pendente').map((t) => t.data).sort();
  const pergunta = daEtapa.find((t) => t.tipo === 'decisao' && t.status === 'pendente');
  if (pergunta && ultimoContato) pergunta.data = adicionarDiasUteis(todos[todos.length - 1], etapa.decisao.diasUteisAposUltimoContato || 0, feriados);
  return true;
}

// Garante a folga entre avisos depois que algum aviso foi empurrado (ex.: feriado novo vindo do SGP):
// se dois avisos ficaram colados ou no mesmo dia, o de depois vai para o próximo dia de aviso.
function espacarAvisos(processo, cronograma) {
  if (processo.status !== 'ativo' || !processo.etapaAtual) return false;
  const etapa = obterEtapa(cronograma, processo.etapaAtual);
  if (etapa.tipo !== 'contatos') return false;
  const feriados = cronograma.feriados || [];
  const contatos = processo.tarefas.filter((t) => t.etapa === etapa.id && t.tipo === 'contato' && t.status !== 'cancelada').sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id));
  let mudou = false;
  for (let i = 1; i < contatos.length; i++) {
    const t = contatos[i];
    if (t.status !== 'pendente' || (t.retorno && t.retorno.enviadoEm)) continue;
    const minimo = proximoAviso(contatos[i - 1].data, etapa.intervaloDiasUteis, feriados);
    if (t.data < minimo) { t.data = minimo; mudou = true; }
  }
  if (!mudou) return false;
  const ultimo = contatos[contatos.length - 1].data;
  const pergunta = processo.tarefas.find((t) => t.etapa === etapa.id && t.tipo === 'decisao' && t.status === 'pendente' && !t.promessa);
  if (pergunta) {
    const data = adicionarDiasUteis(ultimo, etapa.decisao.diasUteisAposUltimoContato || 0, feriados);
    if (pergunta.data < data) pergunta.data = data;
  }
  return true;
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

module.exports = { realinharAvisos, espacarAvisos, criarProcesso, iniciarEtapa, concluirTarefa, posicionar, registrarPromessa, agendaDoDia, obterEtapa, obterFluxo };
