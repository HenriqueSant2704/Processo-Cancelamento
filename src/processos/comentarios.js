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
    // Fim de etapa: comunicado ao supervisor, pedindo autorização para seguir quando for o caso.
    case 'fim-etapa': {
      const tentativas = evento.etapaTipo === 'contatos' && evento.contatos ? ` Foram feitas ${evento.contatos} tentativas de contato.` : '';
      if (evento.resposta === 'sim') {
        corpo = `[Têmis] Etapa "${evento.etapa}" encerrada: o cliente REGULARIZOU as pendências.${tentativas}`;
      } else if (evento.resposta === 'nao') {
        corpo = `[Têmis] Etapa "${evento.etapa}" encerrada: o cliente NÃO regularizou as pendências.${tentativas}`
          + (evento.proximaEtapa ? `\nPróxima etapa: ${evento.proximaEtapa}. Posso dar continuidade?` : '');
      } else {
        corpo = `[Têmis] Etapa "${evento.etapa}" concluída.` + (evento.proximaEtapa ? `\nPróxima etapa: ${evento.proximaEtapa}.` : '');
      }
      if (!evento.proximaEtapa && evento.resultado) corpo += `\nProcesso finalizado: ${evento.resultado}.`;
      corpo += `\nRegistrado por ${quem}.`;
      break;
    }
    // Início de etapa: comunicado à responsável com o que fazer.
    case 'inicio-etapa': {
      const lista = (evento.tarefas || []).map((t) => `- ${t.descricao} (${dataBR(t.data)})`).join('\n');
      corpo = `[Têmis] Nova etapa iniciada: "${evento.etapa}".${lista ? `\nA fazer:\n${lista}` : ''}`;
      break;
    }
    default:
      corpo = `[Têmis] ${evento.descricao || 'Atualização no processo'}.\nRegistrado por ${quem}.`;
  }
  return `${corpo}${obs}${marca}`;
}

module.exports = { textoComentario };
