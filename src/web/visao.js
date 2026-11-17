// Monta os dados já "mastigados" para a tela: o que fazer hoje, atrasados,
// decisões pendentes, próximos dias e o resumo de cada cliente.
const { diasEntre, adicionarDiasUteis } = require('../utils/datas');
const { obterEtapa } = require('../cronograma/motor');

const porData = (a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id, undefined, { numeric: true });

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
    etapa: etapa ? { id: etapa.id, nome: etapa.nome, fase: etapa.fase, tipo: etapa.tipo } : null,
    faseIndice: etapa ? cronograma.fases.indexOf(etapa.fase) : -1,
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
  for (let i = 0; i < 5; i++) {
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
    resumo: {
      paraHoje: tarefas.filter((t) => !t.atrasada).length,
      atrasadas: tarefas.filter((t) => t.atrasada).length,
      decisoes: tarefas.filter((t) => t.tipo === 'decisao').length,
      clientesHoje: visoes.filter((v) => v.paraHoje.length).length,
      ativos: ativos.length,
      regularizados: processos.filter((p) => p.resultado === 'regularizado').length,
      cancelados: processos.filter((p) => p.resultado === 'cancelado').length,
    },
    clientes: visoes
      .filter((v) => v.paraHoje.length)
      .sort((a, b) => prioridade(a) - prioridade(b) || a.cliente.nome.localeCompare(b.cliente.nome)),
    proximosDias,
  };
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
    tarefas: [...processo.tarefas].sort(porData).map((t) => ({ ...t, etapaNome: nomes[t.etapa] || t.etapa })),
    historico: [...processo.historico].reverse(),
  };
}

module.exports = { painel, listaProcessos, detalheProcesso, visaoProcesso };
