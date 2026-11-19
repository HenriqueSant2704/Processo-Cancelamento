// Autorização do supervisor (Lucas) entre uma etapa e outra.
//
// Quando uma etapa termina com "não regularizou", o sistema pergunta na ocorrência
// "Posso dar continuidade?" e o processo fica AGUARDANDO: as tarefas da próxima etapa
// não aparecem na fila. O sistema lê os comentários da ocorrência e, quando o supervisor
// responde, classifica a resposta:
//   autorizado  -> a próxima etapa começa no dia da resposta
//   negado      -> continua parado; a Jéssica vê o texto do Lucas e decide o que fazer
//   respondido  -> não deu para entender sozinho; a Jéssica confirma (autorizado ou negado)
// A Jéssica é avisada no sino da tela (autorizacao.visto = false).
const { registrar } = require('../auditoria/historico');
const { adicionarDiasUteis, proximoDiaUtil, ehDiaUtil } = require('../utils/datas');

const BLOQUEIA = new Set(['aguardando', 'negado', 'respondido']);
const NOMES = { aguardando: 'Aguardando autorização', negado: 'Autorização negada', respondido: 'Lucas respondeu', autorizado: 'Autorizado' };

const bloqueada = (processo) => Boolean(processo.autorizacao && BLOQUEIA.has(processo.autorizacao.status));

const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const textoPuro = (html) => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// Lê a intenção da resposta. Na dúvida, devolve "respondido" (a Jéssica confirma).
function classificarResposta(texto) {
  const t = semAcento(textoPuro(texto));
  const nega = /\b(nao (autoriz\w*|pode\w*|segu\w*|continu\w*|prossig\w*|avanc\w*|da (continuidade|seguimento))|negad\w*|negativo|aguard\w*|segur[ae]\w*|esper[ae]\w*|suspend\w*|par[ae] (por enquanto|ai)|ainda nao)\b/;
  const autoriza = /\b(autoriz\w*|pode (seguir|continuar|prosseguir|dar continuidade|avancar|cancelar|negativar|fazer|seguir com)|pode sim|segue|siga|segue com|prossiga|prosseguir|continua|continue|ok|okay|sim|liberad\w*|de continuidade|manda ver|pode)\b/;
  if (nega.test(t)) return 'negado';
  if (autoriza.test(t)) return 'autorizado';
  return 'respondido';
}

// Dias úteis entre duas datas (a < b). Usado para manter o espaçamento das tarefas ao remarcar.
function diasUteisEntre(a, b, feriados) {
  let n = 0;
  for (let d = a; d < b; n++) d = adicionarDiasUteis(d, 1, feriados);
  return n;
}

// A etapa liberada começa no dia da autorização: remarca as tarefas pendentes dela,
// mantendo o espaçamento em dias úteis (ex.: avisos em dias alternados).
function remarcarEtapa(processo, etapaId, inicio, feriados = []) {
  const pendentes = processo.tarefas.filter((t) => t.etapa === etapaId && t.status === 'pendente').sort((a, b) => a.data.localeCompare(b.data));
  if (!pendentes.length) return;
  const primeira = pendentes[0].data;
  const comeco = ehDiaUtil(inicio, feriados) ? inicio : proximoDiaUtil(inicio, feriados);
  if (primeira >= comeco) return; // já está no futuro: não mexe
  for (const t of pendentes) {
    const desloc = t.data > primeira ? diasUteisEntre(primeira, t.data, feriados) : 0;
    t.data = desloc ? adicionarDiasUteis(comeco, desloc, feriados) : comeco;
  }
}

function pedirAutorizacao(processo, { etapaAnterior, etapa, data, por }) {
  processo.autorizacao = { status: 'aguardando', etapa, etapaAnterior, pedidoEm: data, visto: true };
  registrar(processo, { data, por: 'sistema', evento: 'autorizacao-pedida', detalhes: `Aguardando autorização do supervisor para continuar (pedido após ação de ${por})` });
}

// status: autorizado | negado | respondido. origem: 'sgp' (leitura da ocorrência) ou o nome de quem confirmou na tela.
function aplicarResposta(processo, { status, texto, por, em, origem }, cronograma, hoje) {
  const a = processo.autorizacao;
  if (!a) throw new Error('Este cliente não está aguardando autorização.');
  if (!['autorizado', 'negado', 'respondido'].includes(status)) throw new Error('Resposta de autorização inválida.');
  const anterior = a.status;
  Object.assign(a, { status, decididoEm: hoje, visto: origem !== 'sgp' });
  if (texto) a.resposta = { texto: textoPuro(texto).slice(0, 2000), por: por || null, em: em || hoje };
  if (origem !== 'sgp') a.confirmadoPor = origem;
  if (status === 'autorizado' && anterior !== 'autorizado') remarcarEtapa(processo, a.etapa, hoje, cronograma.feriados || []);
  const quem = origem === 'sgp' ? `${por || 'supervisor'} (comentário no SGP)` : origem;
  registrar(processo, { data: hoje, por: origem === 'sgp' ? 'sistema' : origem, evento: `autorizacao-${status}`, detalhes: `${NOMES[status]} por ${quem}${a.resposta && a.resposta.texto ? ` | ${a.resposta.texto.slice(0, 300)}` : ''}` });
}

function pedirDeNovo(processo, { por, data }) {
  const a = processo.autorizacao;
  if (!a) throw new Error('Este cliente não está aguardando autorização.');
  Object.assign(a, { status: 'aguardando', pedidoEm: data, visto: true, resposta: null, decididoEm: null });
  registrar(processo, { data, por, evento: 'autorizacao-pedida', detalhes: 'Autorização pedida de novo ao supervisor' });
}

// Procura a resposta do supervisor nos comentários da ocorrência: o primeiro comentário dele
// DEPOIS do último pedido "Posso dar continuidade?" do sistema (ou, sem achar o pedido, a partir do dia do pedido).
function acharResposta(comentarios, { supervisor, usuarioSistema, pedidoEm }) {
  const lista = Array.isArray(comentarios) ? comentarios : [];
  const sup = String(supervisor || '').toLowerCase();
  let inicio = -1;
  lista.forEach((c, i) => {
    if (String(c.usuario || '').toLowerCase() === String(usuarioSistema || '').toLowerCase() && /posso dar continuidade/i.test(c.comentario || '')) inicio = i;
  });
  const candidatos = lista
    .map((c, i) => ({ ...c, i }))
    .filter((c) => String(c.usuario || '').toLowerCase() === sup && (inicio >= 0 ? c.i > inicio : String(c.data_cadastro || '').slice(0, 10) >= pedidoEm));
  const resposta = candidatos.find((c) => textoPuro(c.comentario).length > 0);
  return resposta ? { texto: resposta.comentario, por: resposta.usuario, em: String(resposta.data_cadastro || '').slice(0, 10) || null } : null;
}

module.exports = { bloqueada, classificarResposta, remarcarEtapa, pedirAutorizacao, aplicarResposta, pedirDeNovo, acharResposta, textoPuro, NOMES };
