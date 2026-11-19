// Comentários que o sistema grava na ocorrência do contrato no SGP.
// Saem em HTML simples (o campo de comentário do SGP é HTML): título em negrito, dados do
// cliente, o que foi feito, o próximo passo e quem registrou. Sem emoji, para não dar problema no SGP.
// Se a pessoa escreveu uma mensagem própria na tela, ela vai no lugar do texto automático.

const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dataBR = (iso) => {
  const [a, m, d] = String(iso || '').split('-');
  return a && m && d ? `${d}/${m}/${a}` : '';
};
const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const paragrafo = (html) => `<p>${html}</p>`;
const textoComQuebras = (t) => esc(t).replace(/\r?\n/g, '<br>');

// Linha com os dados do cliente (para ninguém precisar abrir a ficha para entender).
function dadosCliente(processo, hoje) {
  if (!processo) return '';
  const partes = [`Cliente: <b>${esc(processo.cliente.nome)}</b>`, `Contrato ${esc(processo.cliente.contrato)}`];
  if (processo.bloqueadoEm && hoje) {
    const dias = Math.round((new Date(hoje) - new Date(processo.bloqueadoEm)) / 86400000);
    if (dias >= 0) partes.push(processo.fluxo === 'pos-cancelamento' ? `ocorrência aberta há ${plural(dias, 'dia', 'dias')}` : `suspenso há ${plural(dias, 'dia', 'dias')}`);
  }
  if (processo.financeiro && processo.financeiro.valorAberto) {
    partes.push(`em aberto: <b>${dinheiro(processo.financeiro.valorAberto)}</b> (${plural(processo.financeiro.faturasAbertas || 0, 'fatura', 'faturas')})`);
  }
  return paragrafo(partes.join(' · '));
}

const saudacao = (nome) => (nome ? `Olá, ${esc(nome)}!<br>` : '');
const rodape = (evento) => paragrafo(`<small>Registrado por ${esc(evento.por)} em ${dataBR(evento.data)} pelo sistema de cobrança (Têmis).</small>`);
const blocoObs = (evento) => (evento.observacao ? paragrafo(`<b>Observação:</b> ${textoComQuebras(evento.observacao)}`) : '');

// evento: { tipo, por, data, observacao, mensagem (texto próprio da pessoa), ... }
// contexto: { processo, hoje, nomeDestinatario }
function htmlComentario(evento, { processo = null, hoje = null, nomeDestinatario = '' } = {}) {
  const cliente = dadosCliente(processo, hoje || evento.data);

  // Mensagem escrita pela própria pessoa: vai ela, com os dados do cliente e o rodapé.
  if (evento.mensagem && String(evento.mensagem).trim()) {
    return [paragrafo(`<b>[Têmis] ${esc(evento.titulo || 'Mensagem do financeiro')}</b>`), cliente, paragrafo(textoComQuebras(evento.mensagem.trim())), rodape(evento)].join('');
  }

  const partes = [];
  switch (evento.tipo) {
    case 'tarefa': {
      const t = evento.tarefa;
      if (t.tipo === 'contato') {
        partes.push(paragrafo(`<b>[Têmis] Notificação enviada ao cliente</b>`), cliente,
          paragrafo(`Feito: <b>${esc(t.descricao)}</b>.`));
      } else {
        partes.push(paragrafo(`<b>[Têmis] Ação concluída</b>`), cliente, paragrafo(`<b>${esc(t.descricao)}</b>: feito.`));
      }
      partes.push(blocoObs(evento));
      break;
    }
    case 'decisao': {
      if (evento.promessa) {
        partes.push(paragrafo(evento.resposta === 'sim' ? '<b>[Têmis] Promessa de pagamento cumprida</b>' : '<b>[Têmis] Promessa de pagamento não cumprida</b>'), cliente,
          paragrafo(evento.resposta === 'sim' ? 'O cliente pagou na data combinada.' : 'O cliente não pagou na data combinada. As notificações foram retomadas a partir de hoje.'));
      } else {
        partes.push(paragrafo(`<b>[Têmis] ${evento.resposta === 'sim' ? 'Cliente regularizado' : 'Cliente não regularizou'}</b>`), cliente);
      }
      partes.push(blocoObs(evento));
      break;
    }
    case 'promessa':
      partes.push(paragrafo('<b>[Têmis] Promessa de pagamento registrada</b>'), cliente,
        paragrafo(`O cliente prometeu pagar até <b>${dataBR(evento.dataPromessa)}</b>. As próximas notificações ficam pausadas até essa data; se o pagamento não acontecer, elas são retomadas no mesmo dia.`),
        blocoObs(evento));
      break;
    case 'ajuste':
      partes.push(paragrafo('<b>[Têmis] Etapa ajustada</b>'), cliente,
        paragrafo(`O processo foi posicionado na etapa <b>${esc(evento.etapa)}</b>, porque parte do atendimento já tinha sido feita antes do sistema.`),
        blocoObs(evento));
      break;
    case 'fim-etapa': {
      partes.push(paragrafo(`${saudacao(nomeDestinatario)}<b>[Têmis] Etapa encerrada: ${esc(evento.etapa)}</b>`), cliente);
      const tentativas = evento.etapaTipo === 'contatos' && evento.contatos
        ? ` Foram feitas <b>${plural(evento.contatos, 'tentativa', 'tentativas')} de contato</b>${evento.datasAvisos ? ` (${esc(evento.datasAvisos)})` : ''}.`
        : '';
      if (evento.resposta === 'sim') partes.push(paragrafo(`Resultado: o cliente <b>regularizou</b> as pendências.${tentativas}`));
      else if (evento.resposta === 'nao') partes.push(paragrafo(`Resultado: o cliente <b>não regularizou</b> as pendências.${tentativas}`));
      else partes.push(paragrafo(`Todas as ações da etapa foram concluídas.${evento.acoes && evento.acoes.length ? `<br>${evento.acoes.map((a) => `- ${esc(a)}`).join('<br>')}` : ''}`));
      partes.push(blocoObs(evento));
      if (evento.proximaEtapa) {
        partes.push(paragrafo(`<b>Próxima etapa:</b> ${esc(evento.proximaEtapa)}.${evento.resposta === 'nao' ? ' <b>Posso dar continuidade?</b>' : ''}`));
      } else if (evento.resultado) {
        const nomesResultado = { regularizado: 'regularizado', cancelado: 'cancelado', negativado: 'encerrado com o cliente negativado' };
        partes.push(paragrafo(`<b>Processo finalizado:</b> ${esc(nomesResultado[evento.resultado] || evento.resultado)}.`));
      }
      break;
    }
    case 'inicio-etapa': {
      const lista = (evento.tarefas || []).map((t) => `- ${esc(t.descricao)} <i>(${dataBR(t.data)})</i>`).join('<br>');
      partes.push(paragrafo(`${saudacao(nomeDestinatario)}<b>[Têmis] Nova etapa: ${esc(evento.etapa)}</b>`), cliente,
        lista ? paragrafo(`<b>O que fazer:</b><br>${lista}`) : '');
      break;
    }
    case 'registro':
      partes.push(paragrafo(`<b>[Têmis] ${esc(evento.titulo || 'Registro')}</b>`), cliente, paragrafo(textoComQuebras(evento.texto)));
      break;
    case 'aviso':
      partes.push(paragrafo(`${saudacao(nomeDestinatario)}<b>[Têmis] ${esc(evento.titulo || 'Aviso')}</b>`), cliente, paragrafo(esc(evento.texto)));
      break;
    default:
      partes.push(paragrafo(`<b>[Têmis] ${esc(evento.descricao || 'Atualização no processo')}</b>`), cliente);
  }
  partes.push(rodape(evento));
  return partes.filter(Boolean).join('');
}

// Versão em texto simples (usada só quando não há HTML, ex.: testes e log).
const textoComentario = (evento, contexto) => htmlComentario(evento, contexto).replace(/<br>/g, '\n').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

module.exports = { htmlComentario, textoComentario };
