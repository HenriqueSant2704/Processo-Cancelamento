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

  return { totalBloqueados: bloqueados.length, novos, suspensos: new Set(bloqueados.map((c) => String(c.contrato))) };
}

// Abre um processo do fluxo "pos-cancelamento" para cada contrato com ocorrência
// aberta de negativação pós-cancelamento no SGP (um por contrato).
async function sincronizarPosCancelamento({ sgp, repositorio, cronograma, hoje }) {
  const lista = await sgp.listarPosCancelamento();
  const novos = [];
  // Contratos cujo processo principal já está na fase pós-cancelamento (a ocorrência foi aberta
  // pelo próprio sistema depois da retirada de equipamentos): não abre um segundo processo.
  const { obterEtapa } = require('../cronograma/motor');
  const jaNoPrincipal = new Set();
  for (const p of await repositorio.listar()) {
    if (p.status !== 'ativo' || (p.fluxo || 'principal') !== 'principal' || !p.etapaAtual) continue;
    if (obterEtapa(cronograma, p.etapaAtual).fase === 'Pós-cancelamento') jaNoPrincipal.add(String(p.cliente.contrato));
  }
  for (const item of lista) {
    const chave = `pos-${item.contrato}`;
    if (jaNoPrincipal.has(String(item.contrato))) continue;
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

// Avisos na ocorrência para outra pessoa (cronograma: etapa.avisarSgp). Cada tarefa avisa UMA vez,
// quando fica pendente para hoje ou antes. destinatarios: { os: 'username_no_sgp' }.
async function enviarAvisosPendentes({ repositorio, cronograma, hoje, comentar, destinatarios = {}, nomes = {} }) {
  if (typeof comentar !== 'function') return 0;
  const { obterEtapa } = require('../cronograma/motor');
  let enviados = 0;
  for (const resumo of await repositorio.listar()) {
    if (resumo.status !== 'ativo') continue;
    const candidatas = resumo.tarefas.filter((t) => t.status === 'pendente' && t.data <= hoje && !t.avisadoEm);
    if (!candidatas.length) continue;
    const processo = await repositorio.obter(resumo.id);
    if (!processo || !processo.ocorrencia || !processo.ocorrencia.numero) continue;
    let mudou = false;
    for (const t of processo.tarefas) {
      if (t.status !== 'pendente' || t.data > hoje || t.avisadoEm) continue;
      const regra = (obterEtapa(cronograma, t.etapa).avisarSgp || []).find((a) => a.acao === t.descricao);
      if (!regra) continue;
      const para = destinatarios[regra.para];
      const texto = `[Têmis] ${regra.texto}\nContrato ${processo.cliente.contrato}.${para ? `\n@${para}` : ''}`;
      const { htmlComentario } = require('./comentarios');
      const html = htmlComentario({ tipo: 'aviso', titulo: t.descricao, texto: regra.texto, por: 'sistema', data: hoje }, { processo, hoje, nomeDestinatario: (nomes || {})[para] || '' });
      await comentar({ numero: processo.ocorrencia.numero, texto, html, marcar: [para] });
      t.avisadoEm = hoje;
      mudou = true;
      enviados++;
    }
    if (mudou) await repositorio.salvarProcesso(processo);
  }
  return enviados;
}

// Junta os feriados do SGP aos do cronograma (o motor usa cronograma.feriados).
function atualizarFeriados(cronograma, datas) {
  cronograma.feriados = [...new Set([...(cronograma.feriados || []), ...datas])].sort();
}

// Reajusta a agenda dos processos ativos:
//  - tarefa pendente marcada para sábado, domingo ou feriado vai para o próximo dia útil;
//  - pergunta de etapa de espera (ex.: 10 dias depois da negativação) é recalculada se o prazo mudou.
async function reajustarAgenda({ repositorio, cronograma, hoje }) {
  const { obterEtapa } = require('../cronograma/motor');
  const { proximoDiaUtil, adicionarDias, ehDiaUtil } = require('../utils/datas');
  const feriados = cronograma.feriados || [];
  let ajustadas = 0;
  for (const resumo of await repositorio.listar()) {
    if (resumo.status !== 'ativo') continue;
    const precisa = resumo.tarefas.some((t) => t.status === 'pendente' && (t.tipo === 'decisao' || (t.data >= hoje && !ehDiaUtil(t.data, feriados))));
    if (!precisa) continue;
    const processo = await repositorio.obter(resumo.id);
    if (!processo) continue;
    let mudou = false;
    for (const t of processo.tarefas) {
      if (t.status !== 'pendente') continue;
      let nova = t.data;
      const etapa = obterEtapa(cronograma, t.etapa);
      if (t.tipo === 'decisao' && etapa.tipo === 'aguardo' && !t.promessa) {
        const inicio = [...processo.historico].reverse().find((h) => h.evento === 'etapa-iniciada' && h.detalhes === etapa.nome);
        if (inicio) nova = proximoDiaUtil(adicionarDias(inicio.data, etapa.dias), feriados);
      } else if (t.data >= hoje && !ehDiaUtil(t.data, feriados)) {
        nova = proximoDiaUtil(t.data, feriados);
      }
      if (nova !== t.data) { t.data = nova; mudou = true; ajustadas++; }
    }
    if (mudou) await repositorio.salvarProcesso(processo);
  }
  return ajustadas;
}

// Tira do processo quem NÃO está mais suspenso no SGP e NÃO tem ocorrência aberta (regra do Miguel, 19/11):
// ex.: pagou ou fez promessa antes de abrir a ocorrência, ou o contrato foi encerrado. Se for suspenso de novo,
// a sincronização abre um processo novo. Com ocorrência aberta (ex.: promessa feita no meio da notificação), fica.
// Só vale para as fases antes do cancelamento (depois dele o contrato fica cancelado mesmo).
const FASES_COM_SUSPENSAO = ['Notificação', 'Negativação', 'Negativado', 'Aviso de cancelamento'];
async function retirarQuemSaiu({ repositorio, cronograma, hoje, suspensos, abertas }) {
  const { obterEtapa } = require('../cronograma/motor');
  const { registrar } = require('../auditoria/historico');
  const retirados = [];
  for (const resumo of await repositorio.listar()) {
    if (resumo.status !== 'ativo' || (resumo.fluxo || 'principal') !== 'principal' || !resumo.etapaAtual) continue;
    const contrato = String(resumo.cliente.contrato);
    if (suspensos.has(contrato) || abertas.has(contrato)) continue;
    if (!FASES_COM_SUSPENSAO.includes(obterEtapa(cronograma, resumo.etapaAtual).fase)) continue;
    const processo = await repositorio.obter(resumo.id);
    for (const t of processo.tarefas) if (t.status === 'pendente') Object.assign(t, { status: 'cancelada', canceladaEm: hoje });
    Object.assign(processo, { status: 'finalizado', resultado: 'saiu-da-suspensao', etapaAtual: null, finalizadoEm: hoje, autorizacao: null });
    registrar(processo, { data: hoje, por: 'sistema', evento: 'saiu-da-suspensao', detalhes: 'O contrato não está mais suspenso no SGP e não há ocorrência aberta. Se for suspenso de novo, um processo novo começa.' });
    await repositorio.salvarProcesso(processo);
    retirados.push(processo);
  }
  return retirados;
}

// Liga cada processo de suspenso à ocorrência aberta do contrato no SGP (para os comentários automáticos).
async function vincularOcorrencias({ sgp, repositorio, porContrato: lido }) {
  const porContrato = lido || await sgp.listarOcorrenciasDoFluxoPrincipal();
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

// Lê os comentários do supervisor (Lucas) nas ocorrências dos clientes ativos.
//  - Cliente parado esperando autorização: a resposta dele libera (ou não) SÓ aquele cliente.
//  - Qualquer outro cliente: um comentário novo dele vira aviso no sino ("Lucas comentou").
// todos=false lê só os clientes parados (leitura rápida). Devolve os processos cuja autorização mudou
// (para comentar o início da etapa) e, em .comentarios, os que só ganharam aviso de comentário.
async function lerAutorizacoes({ sgp, repositorio, cronograma, hoje, supervisor, usuarioSistema, todos = true }) {
  const { acharResposta, classificarResposta, aplicarResposta, bloqueada, ehDoSupervisor, chaveComentario, textoPuro } = require('./autorizacao');
  const { adicionarDias } = require('../utils/datas');
  const mudaram = [];
  mudaram.comentarios = [];
  mudaram.lidos = 0;
  mudaram.erros = [];
  if (!supervisor || typeof sgp.comentariosDaOcorrencia !== 'function') return mudaram;
  // Na primeira leitura de um cliente, só avisa comentários dos últimos dias (não inunda o sino com coisa antiga).
  const recente = adicionarDias(hoje, -3);
  for (const resumo of await repositorio.listar()) {
    if (resumo.status !== 'ativo' || !resumo.ocorrencia || !resumo.ocorrencia.numero) continue;
    if (!todos && !bloqueada(resumo)) continue;
    let comentarios;
    try {
      comentarios = await sgp.comentariosDaOcorrencia(resumo.ocorrencia.numero);
    } catch (erro) {
      mudaram.erros.push(`${resumo.cliente.nome}: ${erro.message}`);
      continue;
    }
    mudaram.lidos++;
    const doSupervisor = (comentarios || []).filter((c) => ehDoSupervisor(c, supervisor) && textoPuro(c.comentario));
    const jaLidos = new Set((resumo.supervisor && resumo.supervisor.lidos) || []);
    const novos = doSupervisor.filter((c) => !jaLidos.has(chaveComentario(c)));
    if (!novos.length) continue;

    const processo = await repositorio.obter(resumo.id);
    if (!processo || processo.status !== 'ativo') continue;
    const primeiraVez = !processo.supervisor;
    const sup = processo.supervisor || {};
    let autorizacaoMudou = false;

    const a = processo.autorizacao;
    if (bloqueada(processo)) {
      // Esperando: vale a resposta depois do pedido. Já negado/sem entender: só um comentário NOVO dele muda.
      const ignorar = new Set([...(a.ignorar || []), ...(a.status === 'aguardando' ? [] : (primeiraVez ? doSupervisor.map(chaveComentario) : [...jaLidos]))]);
      if (a.respostaChave) ignorar.add(a.respostaChave);
      const resposta = acharResposta(comentarios, { supervisor, usuarioSistema, pedidoEm: a.pedidoEm, ignorar });
      if (resposta) {
        aplicarResposta(processo, { status: classificarResposta(resposta.texto), texto: resposta.texto, por: resposta.por, em: resposta.em, chave: resposta.chave, origem: 'sgp' }, cronograma, hoje);
        autorizacaoMudou = true;
      }
    }
    if (!autorizacaoMudou) {
      const avisar = novos.filter((c) => !primeiraVez || String(c.data_cadastro || '').slice(0, 10) >= recente);
      const ultimo = avisar[avisar.length - 1];
      if (ultimo) {
        Object.assign(sup, {
          ultimo: { texto: textoPuro(ultimo.comentario).slice(0, 2000), por: ultimo.usuario, em: String(ultimo.data_cadastro || '').slice(0, 16) || hoje, novos: avisar.length },
          avisadoEm: hoje, vistoPor: [],
        });
        mudaram.comentarios.push(processo);
      }
    }
    sup.lidos = [...jaLidos, ...novos.map(chaveComentario)].slice(-60);
    processo.supervisor = sup;
    await repositorio.salvarProcesso(processo);
    if (autorizacaoMudou) mudaram.push(processo);
  }
  return mudaram;
}

// Posiciona cada cliente no passo em que a Jéssica realmente parou, lendo os comentários das
// ocorrências no SGP (leitorOcorrencias). Só AVANÇA, nunca volta. aplicar=false só mostra o que faria.
async function posicionarPeloSgp({ sgp, repositorio, cronograma, hoje, aplicar = false, por = 'Têmis (leitura do SGP)' }) {
  const { sugerir } = require('./leitorOcorrencias');
  const { posicionar } = require('../cronograma/motor');
  const porContrato = await sgp.ocorrenciasComComentarios();
  const resultado = [];
  for (const resumo of await repositorio.listar()) {
    if (resumo.status !== 'ativo') continue;
    let s = sugerir(resumo, porContrato.get(String(resumo.cliente.contrato)) || [], cronograma);
    if (!s) continue;
    // Recomeço: confere de novo com o histórico completo (a lista não traz o histórico).
    if (s.acao === 'recomecar') s = sugerir(await repositorio.obter(resumo.id), porContrato.get(String(resumo.cliente.contrato)) || [], cronograma) || s;
    const item = { id: resumo.id, cliente: resumo.cliente, etapaAtual: resumo.etapaAtual, ...s, aplicado: false };
    if (aplicar && (s.acao === 'avancar' || s.acao === 'recomecar')) {
      const processo = await repositorio.obter(resumo.id);
      try {
        posicionar(processo, {
          etapaId: s.etapaId, contatosFeitos: s.contatosFeitos || 0, dataReferencia: s.dataReferencia, por, data: hoje,
          observacao: `${s.acao === 'recomecar' ? 'Recomeço' : 'Lido nos comentários da ocorrência no SGP'}: ${s.evidencias.join('; ')}`,
        }, cronograma);
        // A autorização pendente era da etapa anterior: o SGP já mostra que o processo andou.
        if (processo.autorizacao && processo.autorizacao.status !== 'autorizado') processo.autorizacao = null;
        await repositorio.salvarProcesso(processo);
        item.aplicado = true;
      } catch (erro) {
        item.erro = erro.message;
      }
    }
    resultado.push(item);
  }
  return resultado;
}

// Dados do cliente (CPF, contatos, plano, faturas) para os contratos com processo ativo.
async function atualizarFichas({ sgp, repositorio, hoje }) {
  const contratos = [...new Set((await repositorio.listar()).filter((p) => p.status === 'ativo').map((p) => String(p.cliente.contrato)))];
  if (!contratos.length) return 0;
  const fichas = await sgp.listarFichas(contratos, hoje);
  await repositorio.salvarFichas(fichas, hoje);
  return fichas.size;
}

// Pós-cancelamento + suspensos numa rodada só. As duas partes são independentes:
// se uma falhar (ex.: SGP lento), a outra ainda é gravada; o erro é repassado no fim.
async function sincronizarTudo(args) {
  const erros = [];
  if (typeof args.sgp.listarFeriados === 'function') {
    try {
      atualizarFeriados(args.cronograma, await args.sgp.listarFeriados());
    } catch (erro) {
      erros.push(`feriados: ${erro.message}`);
    }
  }
  let pos = { totalPosCancelamento: 0, novos: [] };
  if (typeof args.sgp.listarPosCancelamento === 'function') {
    try {
      pos = await sincronizarPosCancelamento(args);
    } catch (erro) {
      erros.push(`pós-cancelamento: ${erro.message}`);
    }
  }
  let suspensos = { totalBloqueados: 0, novos: [], suspensos: null };
  try {
    suspensos = await sincronizar(args);
  } catch (erro) {
    erros.push(`suspensos: ${erro.message}`);
  }
  let abertas = null;
  if (typeof args.sgp.listarOcorrenciasDoFluxoPrincipal === 'function') {
    try {
      abertas = await args.sgp.listarOcorrenciasDoFluxoPrincipal();
      await vincularOcorrencias({ ...args, porContrato: abertas });
    } catch (erro) {
      erros.push(`ocorrências: ${erro.message}`);
    }
  }
  // Só tira alguém quando as DUAS leituras deram certo (nunca por falha do SGP).
  let retirados = [];
  if (suspensos.suspensos && suspensos.suspensos.size && abertas) {
    try {
      retirados = await retirarQuemSaiu({ ...args, suspensos: suspensos.suspensos, abertas });
    } catch (erro) {
      erros.push(`saída de quem não está mais suspenso: ${erro.message}`);
    }
  }
  if (typeof args.sgp.listarFichas === 'function') {
    try {
      await atualizarFichas(args);
    } catch (erro) {
      erros.push(`dados dos clientes: ${erro.message}`);
    }
  }
  try {
    await reajustarAgenda(args);
  } catch (erro) {
    erros.push(`reajuste da agenda: ${erro.message}`);
  }
  const resultado = { totalBloqueados: suspensos.totalBloqueados, totalPosCancelamento: pos.totalPosCancelamento, novos: [...suspensos.novos, ...pos.novos], retirados: retirados.length };
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

module.exports = { retirarQuemSaiu, posicionarPeloSgp, lerAutorizacoes, atualizarFichas, atualizarFeriados, reajustarAgenda, enviarAvisosPendentes, sincronizar, sincronizarPosCancelamento, sincronizarTudo, criarOcorrenciaDaTarefa, agenda, concluir };
