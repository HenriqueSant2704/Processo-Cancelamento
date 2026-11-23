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
const { adicionarDiasUteis, proximoDiaUtil, ehDiaUtil, proximoAviso } = require('../utils/datas');

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
  // Avisos: entre um e outro precisa ter um dia de folga (pode ser fim de semana ou feriado) e a
  // pergunta "regularizou?" fica para o dia útil seguinte ao último aviso.
  let anterior = null;
  for (const t of pendentes) {
    if (t.tipo === 'contato') {
      if (anterior && t.data < proximoAviso(anterior, 2, feriados)) t.data = proximoAviso(anterior, 2, feriados);
      anterior = t.data;
    } else if (t.tipo === 'decisao' && anterior && t.data <= anterior) {
      t.data = adicionarDiasUteis(anterior, 1, feriados);
    }
  }
}

function pedirAutorizacao(processo, { etapaAnterior, etapa, data, por }) {
  processo.autorizacao = { status: 'aguardando', etapa, etapaAnterior, pedidoEm: data, visto: true };
  registrar(processo, { data, por: 'sistema', evento: 'autorizacao-pedida', detalhes: `Aguardando autorização do supervisor para continuar (pedido após ação de ${por})` });
}

// status: autorizado | negado | respondido. origem: 'sgp' (leitura da ocorrência) ou o nome de quem confirmou na tela.
function aplicarResposta(processo, { status, texto, por, em, origem, chave }, cronograma, hoje) {
  const a = processo.autorizacao;
  if (!a) throw new Error('Este cliente não está aguardando autorização.');
  if (!['autorizado', 'negado', 'respondido'].includes(status)) throw new Error('Resposta de autorização inválida.');
  const anterior = a.status;
  Object.assign(a, { status, decididoEm: hoje, visto: origem !== 'sgp', vistoPor: origem !== 'sgp' ? [origem] : [] });
  if (texto) a.resposta = { texto: textoPuro(texto).slice(0, 2000), por: por || null, em: em || hoje };
  if (chave) a.respostaChave = chave;
  if (origem !== 'sgp') a.confirmadoPor = origem;
  if (status === 'autorizado' && anterior !== 'autorizado') remarcarEtapa(processo, a.etapa, hoje, cronograma.feriados || []);
  const quem = origem === 'sgp' ? `${por || 'supervisor'} (comentário no SGP)` : origem;
  registrar(processo, { data: hoje, por: origem === 'sgp' ? 'sistema' : origem, evento: `autorizacao-${status}`, detalhes: `${NOMES[status]} por ${quem}${a.resposta && a.resposta.texto ? ` | ${a.resposta.texto.slice(0, 300)}` : ''}` });
}

function pedirDeNovo(processo, { por, data }) {
  const a = processo.autorizacao;
  if (!a) throw new Error('Este cliente não está aguardando autorização.');
  Object.assign(a, { status: 'aguardando', pedidoEm: data, visto: true, resposta: null, decididoEm: null });
  // A resposta antiga não vale para o novo pedido.
  if (a.respostaChave) a.ignorar = [...(a.ignorar || []), a.respostaChave].slice(-20);
  registrar(processo, { data, por, evento: 'autorizacao-pedida', detalhes: 'Autorização pedida de novo ao supervisor' });
}

// Usernames do supervisor no SGP. SGP_SUPERVISOR aceita mais de um, separados por vírgula.
const listaSupervisores = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const ehDoSupervisor = (c, supervisor) => listaSupervisores(supervisor).includes(String(c.usuario ?? '').trim().toLowerCase());
const diaDe = (c) => String(c.data_cadastro || '').slice(0, 10);
// Identifica um comentário entre uma leitura e outra (para não avisar duas vezes do mesmo).
const chaveComentario = (c) => (c.id != null && c.id !== '' ? `id:${c.id}` : `${c.data_cadastro || ''}|${String(c.usuario || '').toLowerCase()}|${textoPuro(c.comentario).slice(0, 80)}`);

// Procura a resposta do supervisor nos comentários da ocorrência: o comentário MAIS RECENTE dele
// depois do pedido do sistema. O pedido é o primeiro comentário do sistema a partir do dia do pedido
// (comentários do sistema depois dele, como um registro da Jéssica, não escondem a resposta).
// ignorar: chaves de comentários já lidos (ex.: a resposta antiga quando a Jéssica pede de novo).
function acharResposta(comentarios, { supervisor, usuarioSistema, pedidoEm, ignorar }) {
  const lista = Array.isArray(comentarios) ? comentarios : [];
  const sistema = String(usuarioSistema || '').trim().toLowerCase();
  const doSistema = (c) => Boolean(sistema) && String(c.usuario || '').trim().toLowerCase() === sistema;
  // Pedido = o último comentário do sistema (a partir do dia do pedido) que pergunta se pode continuar;
  // sem achar a pergunta (o texto é editável), o primeiro comentário do sistema a partir desse dia.
  let inicio = -1;
  lista.forEach((c, i) => { if (doSistema(c) && diaDe(c) >= pedidoEm && /continuidade|posso (seguir|continuar|prosseguir)|autoriza/i.test(textoPuro(c.comentario))) inicio = i; });
  if (inicio < 0) inicio = lista.findIndex((c) => doSistema(c) && diaDe(c) >= pedidoEm);
  if (inicio < 0) lista.forEach((c, i) => { if (doSistema(c) && /posso dar continuidade/i.test(c.comentario || '')) inicio = i; });
  const vistos = ignorar instanceof Set ? ignorar : new Set(ignorar || []);
  const candidatos = lista
    .map((c, i) => ({ ...c, i }))
    .filter((c) => ehDoSupervisor(c, supervisor) && (inicio >= 0 ? c.i > inicio : diaDe(c) >= pedidoEm))
    .filter((c) => textoPuro(c.comentario).length > 0 && !vistos.has(chaveComentario(c)));
  const resposta = candidatos[candidatos.length - 1];
  return resposta ? { texto: resposta.comentario, por: resposta.usuario, em: diaDe(resposta) || null, chave: chaveComentario(resposta) } : null;
}

// Marca como visto por uma pessoa (cada um tem o seu sino: abrir no usuário do Miguel não apaga o da Jéssica).
function marcarVisto(aviso, quem) {
  if (!aviso || !quem) return;
  const lista = Array.isArray(aviso.vistoPor) ? aviso.vistoPor : [];
  if (!lista.includes(quem)) lista.push(quem);
  aviso.vistoPor = lista;
}
const vistoPor = (aviso, quem) => Boolean(aviso && quem && Array.isArray(aviso.vistoPor) && aviso.vistoPor.includes(quem));

module.exports = { listaSupervisores, ehDoSupervisor, chaveComentario, marcarVisto, vistoPor, bloqueada, classificarResposta, remarcarEtapa, pedirAutorizacao, aplicarResposta, pedirDeNovo, acharResposta, textoPuro, NOMES };
