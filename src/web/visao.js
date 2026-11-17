// Monta os dados já "mastigados" para a tela: o que fazer hoje, atrasados,
// decisões pendentes, próximos dias e o resumo de cada cliente.
const { diasEntre, adicionarDiasUteis } = require('../utils/datas');
const { obterEtapa } = require('../cronograma/motor');

const porData = (a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id, undefined, { numeric: true });

// Passos de cada etapa, para a tela "Etapas" (ex.: "2ª mensagem", "Regularizou?").
function passosDaEtapa(etapa) {
  if (etapa.tipo === 'contatos') {
    return [...Array.from({ length: etapa.tentativas }, (_, i) => ({ id: `msg-${i + 1}`, nome: `${i + 1}ª mensagem` })), { id: 'decisao', nome: 'Regularizou?' }];
  }
  if (etapa.tipo === 'aguardo') return [{ id: 'espera', nome: 'Em espera' }, { id: 'decisao', nome: 'Regularizou?' }];
  return [{ id: 'acoes', nome: 'Ações no SGP' }];
}

function mapaEtapas(cronograma) {
  return cronograma.etapas
    .filter((e) => e.tipo !== 'final')
    .map((e) => ({ id: e.id, nome: e.nome, fase: e.fase, faseIndice: cronograma.fases.indexOf(e.fase), passos: passosDaEtapa(e) }));
}

// Em que passo da etapa atual o processo está.
function passoAtual(processo, etapa, hoje) {
  if (!etapa) return null;
  const daEtapa = processo.tarefas.filter((t) => t.etapa === etapa.id && t.status !== 'cancelada');
  const passos = passosDaEtapa(etapa);
  const pega = (id) => passos.find((p) => p.id === id);
  if (etapa.tipo === 'contatos') {
    const contatos = daEtapa.filter((t) => t.tipo === 'contato');
    const proximo = contatos.findIndex((t) => t.status === 'pendente');
    return proximo >= 0 ? pega(`msg-${proximo + 1}`) : pega('decisao');
  }
  if (etapa.tipo === 'aguardo') {
    const decisao = daEtapa.find((t) => t.tipo === 'decisao' && t.status === 'pendente');
    return decisao && decisao.data <= hoje ? pega('decisao') : { ...pega('espera'), ate: decisao ? decisao.data : null };
  }
  return pega('acoes');
}

function visaoProcesso(processo, hoje, cronograma) {
  const etapa = processo.etapaAtual ? obterEtapa(cronograma, processo.etapaAtual) : null;
  const pendentes = processo.tarefas.filter((t) => t.status === 'pendente').sort(porData);
  const contatos = processo.tarefas.filter((t) => t.etapa === processo.etapaAtual && t.tipo === 'contato');

  return {
    id: processo.id,
    cliente: processo.cliente,
    bloqueadoEm: processo.bloqueadoEm,
    diasBloqueado: diasEntre(processo.bloqueadoEm, hoje),
    iniciadoEm: processo.iniciadoEm,
    status: processo.status,
    resultado: processo.resultado,
    finalizadoEm: processo.finalizadoEm || null,
    financeiro: processo.financeiro || null,
    etapa: etapa ? { id: etapa.id, nome: etapa.nome, fase: etapa.fase, tipo: etapa.tipo } : null,
    faseIndice: etapa ? cronograma.fases.indexOf(etapa.fase) : -1,
    passo: passoAtual(processo, etapa, hoje),
    contatos: {
      feitos: contatos.filter((t) => t.status === 'concluida').length,
      total: contatos.filter((t) => t.status !== 'cancelada').length,
    },
    paraHoje: pendentes.filter((t) => t.data <= hoje).map((t) => ({ ...t, atrasada: t.data < hoje })),
    proxima: pendentes.find((t) => t.data > hoje) || null,
  };
}

// Ordem de prioridade na tela: quem tem atrasadas, depois quem tem decisão, depois o resto.
function prioridade(v) {
  if (v.paraHoje.some((t) => t.atrasada)) return 0;
  if (v.paraHoje.some((t) => t.tipo === 'decisao')) return 1;
  return 2;
}

function painel(processos, hoje, cronograma) {
  const feriados = cronograma.feriados || [];
  const ativos = processos.filter((p) => p.status === 'ativo');
  const visoes = ativos.map((p) => visaoProcesso(p, hoje, cronograma));
  const tarefas = visoes.flatMap((v) => v.paraHoje);

  const proximosDias = [];
  let dia = hoje;
  for (let i = 0; i < 10; i++) {
    dia = adicionarDiasUteis(dia, 1, feriados);
    const doDia = ativos.flatMap((p) => p.tarefas.filter((t) => t.status === 'pendente' && t.data === dia));
    proximosDias.push({
      data: dia,
      total: doDia.length,
      contatos: doDia.filter((t) => t.tipo === 'contato').length,
      decisoes: doDia.filter((t) => t.tipo === 'decisao').length,
      clientes: new Set(doDia.map((t) => t.id.split('.')[0])).size,
    });
  }

  return {
    hoje,
    fases: cronograma.fases,
    // Quantos processos ativos estão em cada fase (para o funil da tela).
    funil: cronograma.fases.map((fase) => ({ fase, total: visoes.filter((v) => v.etapa && v.etapa.fase === fase).length })),
    resumo: {
      paraHoje: tarefas.filter((t) => !t.atrasada).length,
      atrasadas: tarefas.filter((t) => t.atrasada).length,
      decisoes: tarefas.filter((t) => t.tipo === 'decisao').length,
      clientesHoje: visoes.filter((v) => v.paraHoje.length).length,
      ativos: ativos.length,
      regularizados: processos.filter((p) => p.resultado === 'regularizado').length,
      valorAberto: Math.round(ativos.reduce((s, p) => s + ((p.financeiro && p.financeiro.valorAberto) || 0), 0) * 100) / 100,
      cancelados: processos.filter((p) => p.resultado === 'cancelado').length,
    },
    clientes: visoes
      .filter((v) => v.paraHoje.length)
      .sort((a, b) => prioridade(a) - prioridade(b) || a.cliente.nome.localeCompare(b.cliente.nome)),
    proximosDias,
  };
}

// Agenda de um dia (futuro ou hoje): clientes com tarefas marcadas para aquele dia.
// Usa o mesmo formato da fila ("paraHoje" = tarefas daquele dia).
function agendaDoDia(processos, dia, hoje, cronograma) {
  return processos
    .filter((p) => p.status === 'ativo')
    .map((p) => {
      const v = visaoProcesso(p, hoje, cronograma);
      const doDia = p.tarefas.filter((t) => t.status === 'pendente' && t.data === dia).map((t) => ({ ...t, atrasada: false }));
      return { ...v, paraHoje: doDia };
    })
    .filter((v) => v.paraHoje.length);
}

function listaProcessos(processos, hoje, cronograma) {
  return processos
    .map((p) => visaoProcesso(p, hoje, cronograma))
    .sort((a, b) => (a.status === b.status ? a.cliente.nome.localeCompare(b.cliente.nome) : a.status === 'ativo' ? -1 : 1));
}

function detalheProcesso(processo, hoje, cronograma) {
  const nomes = Object.fromEntries(cronograma.etapas.map((e) => [e.id, e.nome]));
  return {
    ...visaoProcesso(processo, hoje, cronograma),
    fases: cronograma.fases,
    etapasAjustaveis: cronograma.etapas.filter((e) => ['contatos', 'aguardo', 'acao'].includes(e.tipo)).map((e) => ({ id: e.id, nome: e.nome, tipo: e.tipo, tentativas: e.tentativas || 0 })),
    tarefas: [...processo.tarefas].sort(porData).map((t) => ({ ...t, etapaNome: nomes[t.etapa] || t.etapa })),
    historico: [...processo.historico].reverse(),
  };
}

module.exports = { mapaEtapas, painel, agendaDoDia, listaProcessos, detalheProcesso, visaoProcesso };
