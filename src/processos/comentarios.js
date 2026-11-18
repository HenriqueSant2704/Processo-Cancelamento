// Textos dos comentários automáticos que o sistema grava na ocorrência do contrato no SGP
// a cada ação feita na tela. Só texto simples (sem emoji), para não dar problema no SGP.
const dataBR = (iso) => {
  const [a, m, d] = String(iso || '').split('-');
  return a && m && d ? `${d}/${m}/${a}` : '';
};

// evento: { tipo: 'tarefa' | 'decisao' | 'promessa' | 'ajuste', por, data, ... }
function textoComentario(evento, { responsavel } = {}) {
  const quem = `${evento.por} em ${dataBR(evento.data)}`;
  const obs = evento.observacao ? `\nObservação: ${evento.observacao}` : '';
  const marca = responsavel ? `\n@${responsavel}` : '';
  let corpo;
  switch (evento.tipo) {
    case 'tarefa':
      corpo = evento.tarefa.tipo === 'contato'
        ? `[Têmis] Notificação enviada: ${evento.tarefa.descricao}.\nRegistrado por ${quem}.`
        : `[Têmis] Concluído: ${evento.tarefa.descricao}.\nRegistrado por ${quem}.`;
      break;
    case 'decisao':
      if (evento.promessa) {
        corpo = evento.resposta === 'sim'
          ? `[Têmis] Promessa de pagamento CUMPRIDA: cliente regularizou.\nRegistrado por ${quem}.`
          : `[Têmis] Promessa de pagamento NÃO cumprida. As notificações foram retomadas.\nRegistrado por ${quem}.`;
      } else {
        corpo = evento.resposta === 'sim'
          ? `[Têmis] Cliente REGULARIZADO.\nRegistrado por ${quem}.`
          : `[Têmis] Cliente não regularizou. Processo seguiu para: ${evento.proximaEtapa || 'próxima etapa'}.\nRegistrado por ${quem}.`;
      }
      break;
    case 'promessa':
      corpo = `[Têmis] Promessa de pagamento para ${dataBR(evento.dataPromessa)}. As notificações ficam pausadas até essa data.\nRegistrado por ${quem}.`;
      break;
    case 'ajuste':
      corpo = `[Têmis] Etapa ajustada para "${evento.etapa}" (atendimento feito antes do sistema).\nRegistrado por ${quem}.`;
      break;
    default:
      corpo = `[Têmis] ${evento.descricao || 'Atualização no processo'}.\nRegistrado por ${quem}.`;
  }
  return `${corpo}${obs}${marca}`;
}

module.exports = { textoComentario };
