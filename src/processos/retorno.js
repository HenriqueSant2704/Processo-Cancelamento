// Aviso em dois passos:
//   1) "Enviei": a Jéssica mandou o aviso. A tarefa continua pendente, agora esperando o retorno do cliente.
//   2) A cada X horas (cronograma.retorno.horasEntrePerguntas) o sistema pergunta "Teve retorno?".
//      Sem retorno -> pergunta de novo daqui a X horas. Com retorno -> registra o que o cliente disse.
//      Quando ela decide encerrar, "Finalizar aviso" registra as tentativas e o print (concluir a tarefa).
const { registrar } = require('../auditoria/historico');

const horasEntrePerguntas = (cronograma) => Number((cronograma.retorno || {}).horasEntrePerguntas) || 2;
const somarHoras = (iso, horas) => new Date(new Date(iso).getTime() + horas * 3600_000).toISOString();
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

function tarefaDoAviso(processo, tarefaId) {
  if (processo.status !== 'ativo') throw new Error(`O processo ${processo.id} já foi finalizado.`);
  const tarefa = processo.tarefas.find((t) => t.id === tarefaId);
  if (!tarefa) throw new Error(`Tarefa ${tarefaId} não encontrada.`);
  if (tarefa.tipo !== 'contato') throw new Error('Só avisos ao cliente esperam retorno.');
  if (tarefa.status !== 'pendente') throw new Error(`A tarefa ${tarefaId} já está ${tarefa.status}.`);
  return tarefa;
}

// agora: ISO com hora (ex.: new Date().toISOString()); data: dia do registro (AAAA-MM-DD).
function marcarEnviado(processo, tarefaId, { por, agora, data }, cronograma) {
  if (!por) throw new Error('Informe quem enviou o aviso.');
  const tarefa = tarefaDoAviso(processo, tarefaId);
  if (tarefa.retorno && tarefa.retorno.enviadoEm) throw new Error('Esse aviso já foi marcado como enviado.');
  tarefa.retorno = { enviadoEm: agora, enviadoPor: por, proximaChecagem: somarHoras(agora, horasEntrePerguntas(cronograma)), checagens: [] };
  registrar(processo, { data, por, evento: 'aviso-enviado', detalhes: `${tarefa.descricao}: enviado às ${hora(agora)}. Aguardando retorno do cliente.` });
  return tarefa;
}

// resultado: 'sem-retorno' (aguardar mais X horas) ou 'retorno' (texto obrigatório com o que o cliente disse).
function registrarChecagem(processo, tarefaId, { por, agora, data, resultado, texto }, cronograma) {
  if (!por) throw new Error('Informe quem registrou.');
  const tarefa = tarefaDoAviso(processo, tarefaId);
  if (!tarefa.retorno || !tarefa.retorno.enviadoEm) throw new Error('Marque primeiro que o aviso foi enviado.');
  if (!['sem-retorno', 'retorno'].includes(resultado)) throw new Error('Resposta inválida.');
  const limpo = typeof texto === 'string' ? texto.trim().slice(0, 2000) : '';
  if (resultado === 'retorno' && limpo.length < 3) throw new Error('Escreva o que o cliente respondeu.');
  const horas = horasEntrePerguntas(cronograma);
  tarefa.retorno.checagens = [...(tarefa.retorno.checagens || []), { em: agora, por, resultado, texto: limpo || null }];
  tarefa.retorno.proximaChecagem = somarHoras(agora, horas);
  registrar(processo, {
    data, por, evento: resultado === 'retorno' ? 'retorno-cliente' : 'sem-retorno',
    detalhes: resultado === 'retorno' ? `Retorno do cliente (${tarefa.descricao}): ${limpo}` : `${tarefa.descricao}: sem retorno às ${hora(agora)}, aguardando mais ${horas}h.`,
  });
  return tarefa;
}

module.exports = { marcarEnviado, registrarChecagem, horasEntrePerguntas };
