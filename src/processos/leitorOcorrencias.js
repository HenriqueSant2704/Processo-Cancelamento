// Lê os comentários das ocorrências do contrato no SGP e descobre em que passo o cliente
// realmente está (tudo o que a Jéssica faz ela registra na ocorrência). Só SUGERE: quem aplica
// é o comando "posicionar-pelo-sgp", e nunca para trás.
//
// Ciclo atual = a ocorrência de "Financeiro - Negativação" mais recente que ainda não foi encerrada
// e a de "Cancelamento por Inadiplência" aberta depois dela.
const TIPO_NEGATIVACAO = /^financeiro - negativacao$/;
const TIPO_CANCELAMENTO = /cancelamento por inadiplencia/;
const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const textoPuro = (t) => String(t || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').trim();

// O que cada comentário representa.
function classificar(c) {
  const t = semAcento(textoPuro(c.comentario ?? c.t));
  const u = String(c.usuario ?? c.u ?? '').toLowerCase();
  if (/rangel/.test(u) || /devolvid\w* para o estoque|equipamentos? (foram )?devolvid/.test(t)) {
    if (/devolvid|retirad/.test(t)) return { tipo: 'equipamentos', parcial: /faltand|faltou|ficou faltando|a serem devolvid/.test(t) };
  }
  if (/negativacao foi devidamente realizada|ja foi negativad|cliente (foi )?negativad/.test(t)) return { tipo: 'negativado' };
  if (/cancelamento foi devidamente realizado/.test(t)) return { tipo: 'cancelado' };
  if (/ordem de servico para a retirada|abrir (a |uma )?os de retirada/.test(t) && !/temis\]/.test(t)) return { tipo: 'os-pedida' };
  if (/e?gistro de tentativas de contato|ligacao realizada|mensagem encaminhada|whatsapp encaminhad|notificacao enviada: enviar mensagem/.test(t)) return { tipo: 'contato' };
  if (u === 'admin' && /autoriz|pode (seguir|sim|continuar)|seguir (o fluxo|com)|^ok\b/.test(t) && !/aguard|nao/.test(t)) return { tipo: 'autorizado' };
  // Autorizou a ESPERAR o cliente (não a seguir).
  if (/aguard\w* (ate|o pagamento|a cliente|o cliente|no maximo)|pode aguarda|autorizou a aguardar|ok, aguardar|vou aguardar/.test(t)) return { tipo: 'aguardar' };
  if (/^(ola,? lucas,?)?\s*(o )?(cliente )?(ja )?(realizou o pagamento|pagamento (foi )?realizado|pagou)/.test(t)) return { tipo: 'pagou' };
  return null;
}

const diaDe = (c) => String(c.data_cadastro ?? c.d ?? '').slice(0, 10);

// ocorrencias: as do contrato, como vêm do SGP (tipo, status_id, data_cadastro, comentarios[]).
// Devolve { etapaId, contatosFeitos, dataReferencia, evidencias[], conferir } ou null (sem ciclo aberto).
function lerCiclo(ocorrencias, cronograma) {
  const lista = (ocorrencias || []).map((o) => ({ ...o, tipoN: semAcento(o.tipo), status: Number(o.status_id ?? o.status), aberta: String(o.data_cadastro ?? o.aberta ?? '').slice(0, 10) }))
    .sort((a, b) => a.aberta.localeCompare(b.aberta));
  // Cancelamento em aberto: o ciclo é ele + a negativação mais recente antes dele (que já pode estar encerrada).
  const cancAberto = [...lista].reverse().find((o) => TIPO_CANCELAMENTO.test(o.tipoN) && o.status !== 1);
  const neg = cancAberto
    ? [...lista].reverse().find((o) => TIPO_NEGATIVACAO.test(o.tipoN) && o.aberta <= cancAberto.aberta) || { comentarios: [], aberta: cancAberto.aberta }
    : [...lista].reverse().find((o) => TIPO_NEGATIVACAO.test(o.tipoN) && o.status !== 1);
  if (!neg) return null;
  const canc = cancAberto || lista.find((o) => TIPO_CANCELAMENTO.test(o.tipoN) && o.aberta >= neg.aberta) || null;
  const eventos = (o) => (o ? (o.comentarios || []).map((c) => ({ dia: diaDe(c), ...(classificar(c) || {}) })).filter((e) => e.tipo) : []);
  const evNeg = eventos(neg);
  const evCanc = eventos(canc);
  const todos = [...evNeg, ...evCanc];
  const ultimo = (tipo, ev = todos) => [...ev].reverse().find((e) => e.tipo === tipo) || null;
  const diasContato = (ev) => [...new Set(ev.filter((e) => e.tipo === 'contato').map((e) => e.dia))].sort();
  const etapa = (id) => cronograma.etapas.find((e) => e.id === id);
  const evid = [];
  const conferir = [];
  const pagou = ultimo('pagou');
  if (pagou) conferir.push(`a Jéssica registrou pagamento em ${pagou.dia}`);
  // Lucas autorizou, mas depois combinaram de esperar o cliente: não é para seguir ainda.
  const autorizouSeguir = (ev, depoisDe) => {
    const aut = ultimo('autorizado', ev);
    if (!aut || aut.dia < depoisDe) return null;
    const espera = ev.find((e) => e.tipo === 'aguardar' && e.dia >= aut.dia);
    if (espera) { conferir.push(`depois do "autorizado" ficou combinado aguardar o cliente (${espera.dia})`); return null; }
    return aut;
  };

  const equip = ultimo('equipamentos', evCanc.length ? evCanc : todos);
  const cancelado = ultimo('cancelado');
  const os = ultimo('os-pedida');
  if (equip && (cancelado || os)) {
    evid.push(`equipamentos devolvidos em ${equip.dia}${equip.parcial ? ' (faltando parte)' : ''}`);
    if (equip.parcial) {
      conferir.push('o Rangel informou que ficou faltando parte dos equipamentos');
      return { etapaId: 'retirada-equipamentos', dataReferencia: (cancelado || os).dia, evidencias: evid, conferir };
    }
    return { etapaId: 'abertura-pos-cancelamento', evidencias: evid, conferir };
  }
  if (cancelado || os) {
    if (cancelado) evid.push(`cancelamento realizado em ${cancelado.dia}`);
    if (os) evid.push(`OS de retirada pedida em ${os.dia}`);
    if (cancelado && os) return { etapaId: 'retirada-equipamentos', dataReferencia: (os.dia > cancelado.dia ? os : cancelado).dia, evidencias: evid, conferir };
    if (!os) conferir.push('falta pedir a OS de retirada');
    return { etapaId: 'cancelamento', evidencias: evid, conferir };
  }
  if (canc) {
    const dias = diasContato(evCanc);
    const tent = etapa('aviso-cancelamento').tentativas;
    evid.push(`ocorrência de cancelamento aberta em ${canc.aberta}`, `${dias.length} aviso(s) de cancelamento${dias.length ? ` (${dias.join(', ')})` : ''}`);
    const aut = dias.length >= tent ? autorizouSeguir(evCanc, dias[dias.length - 1]) : null;
    if (aut) {
      evid.push(`Lucas autorizou em ${aut.dia}`);
      return { etapaId: 'cancelamento', evidencias: evid, conferir };
    }
    return { etapaId: 'aviso-cancelamento', contatosFeitos: Math.min(dias.length, tent), dataReferencia: dias.length ? dias[Math.min(dias.length, tent) - 1] : undefined, evidencias: evid, conferir };
  }
  const negativado = ultimo('negativado', evNeg);
  if (negativado) {
    evid.push(`negativação realizada em ${negativado.dia}`);
    return { etapaId: 'aguardo-negativado', dataReferencia: negativado.dia, evidencias: evid, conferir };
  }
  const dias = diasContato(evNeg);
  const tent = etapa('notificacao-negativacao').tentativas;
  evid.push(`${dias.length} aviso(s) de negativação${dias.length ? ` (${dias.join(', ')})` : ''}`);
  const aut = dias.length >= tent ? autorizouSeguir(evNeg, dias[dias.length - 1]) : null;
  if (aut) {
    evid.push(`Lucas autorizou em ${aut.dia}`);
    return { etapaId: 'negativacao', evidencias: evid, conferir };
  }
  return { etapaId: 'notificacao-negativacao', contatosFeitos: Math.min(dias.length, tent), dataReferencia: dias.length ? dias[Math.min(dias.length, tent) - 1] : undefined, evidencias: evid, conferir };
}

// Pós-cancelamento: conta os avisos registrados na ocorrência de negativação pós-cancelamento aberta.
function lerPosCancelamento(ocorrencias, numero, cronograma) {
  const abertas = (ocorrencias || []).filter((o) => /negativacao pos cancelamento/.test(semAcento(o.tipo)) && Number(o.status_id ?? o.status) !== 1);
  const oc = abertas.find((o) => String(o.numero) === String(numero)) || abertas[0];
  if (!oc) return null;
  const dias = [...new Set((oc.comentarios || []).filter((c) => (classificar(c) || {}).tipo === 'contato').map(diaDe))].sort();
  const tent = cronograma.etapas.find((e) => e.id === 'notificacao-pos-cancelamento').tentativas;
  const n = Math.min(dias.length, tent);
  return { etapaId: 'notificacao-pos-cancelamento', contatosFeitos: n, dataReferencia: n ? dias[n - 1] : undefined, evidencias: [`${dias.length} aviso(s) na ocorrência pós-cancelamento${dias.length ? ` (${dias.join(', ')})` : ''}`], conferir: [] };
}

// Compara com onde o processo está hoje. Só sugere AVANÇAR (mesma etapa com mais avisos, ou etapa adiante).
function sugerir(processo, ocorrencias, cronograma) {
  if (processo.status !== 'ativo') return null;
  const pos = (processo.fluxo || 'principal') === 'pos-cancelamento';
  const lido = pos ? lerPosCancelamento(ocorrencias, processo.ocorrencia && processo.ocorrencia.numero, cronograma) : lerCiclo(ocorrencias, cronograma);
  if (!lido) return { acao: 'sem-ciclo', motivo: pos ? 'ocorrência pós-cancelamento não está aberta' : 'nenhuma ocorrência de negativação aberta no SGP' };
  const ordem = cronograma.etapas.map((e) => e.id);
  const atual = processo.etapaAtual;
  const feitosAtual = processo.tarefas.filter((t) => t.etapa === atual && t.tipo === 'contato' && t.status === 'concluida').length;
  const iAtual = ordem.indexOf(atual);
  const iNovo = ordem.indexOf(lido.etapaId);
  // Ramos que não estão na sequência simples (liberação/retirada da negativação): não mexe.
  const fora = ['liberacao', 'retirada-negativacao', 'indenizacao', 'finalizacao-cancelamento'];
  if (fora.includes(atual)) return { acao: 'manter', ...lido, motivo: 'cliente num ramo de regularização/encerramento' };
  if (iNovo < iAtual) return { acao: 'atras', ...lido, motivo: 'o sistema já está adiante do que está no SGP' };
  if (iNovo === iAtual && (lido.contatosFeitos || 0) <= feitosAtual) return { acao: lido.conferir.length ? 'conferir' : 'manter', ...lido };
  if (lido.conferir.length) return { acao: 'conferir', ...lido };
  return { acao: 'avancar', ...lido };
}

module.exports = { classificar, lerCiclo, lerPosCancelamento, sugerir };
