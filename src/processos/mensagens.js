// Mensagens prontas de cada passo (src/config/mensagens.json), já com os dados do cliente.
// A tela mostra o texto para a pessoa editar; o que ela salvar vai para a ocorrência.
const fs = require('node:fs');
const path = require('node:path');

function carregarModelos() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'mensagens.json'), 'utf8'));
}

const dataBR = (iso) => { const [a, m, d] = String(iso || '').split('-'); return a && m && d ? `${d}/${m}/${a}` : ''; };
const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function preencher(texto, campos) {
  return String(texto || '').replace(/\{(\w+)\}/g, (inteiro, nome) => (campos[nome] != null && campos[nome] !== '' ? String(campos[nome]) : inteiro));
}

// Modelos para o que está pendente hoje no processo:
//   { [tarefaId]: texto } para ações, { [tarefaId]: { sim, nao } } para perguntas "regularizou?",
//   e também promessa e autorizacao (pedido ao supervisor).
function modelosDoProcesso(processo, { cronograma, hoje, modelos = carregarModelos() }) {
  const etapaDe = (id) => cronograma.etapas.find((e) => e.id === id) || null;
  const base = {
    cliente: processo.cliente.nome,
    contrato: processo.cliente.contrato,
    valor: processo.financeiro && processo.financeiro.valorAberto ? dinheiro(processo.financeiro.valorAberto) : '',
    hoje: dataBR(hoje),
  };
  const resultado = {};
  for (const t of processo.tarefas.filter((x) => x.status === 'pendente')) {
    const etapa = etapaDe(t.etapa);
    if (!etapa) continue;
    if (t.tipo === 'decisao') {
      const contatos = processo.tarefas.filter((x) => x.etapa === etapa.id && x.tipo === 'contato' && x.status === 'concluida').length;
      const campos = { ...base, etapa: etapa.nome, tentativas: contatos ? `${contatos} ${contatos === 1 ? 'tentativa' : 'tentativas'} de contato` : 'sem retorno aos avisos' };
      const proximo = (r) => { const e = etapa.decisao && etapaDe(etapa.decisao[r]); return e ? e.nome : ''; };
      resultado[t.id] = {
        sim: preencher(modelos[`decisao:sim:${etapa.id}`] ?? modelos['decisao:sim'] ?? '', { ...campos, proximaEtapa: proximo('sim') }),
        nao: preencher(modelos[`decisao:nao:${etapa.id}`] ?? modelos['decisao:nao'] ?? '', { ...campos, proximaEtapa: proximo('nao') }),
      };
    } else if (t.tipo === 'acao') {
      const campos = { ...base, etapa: etapa.nome, acao: t.descricao };
      const daAcao = modelos[`acao:${t.descricao}`];
      // Última ação pendente da etapa: a mensagem de fim da etapa (ex.: "negativação realizada").
      const ultima = processo.tarefas.filter((x) => x.etapa === etapa.id && x.status === 'pendente').length === 1;
      const fim = ultima ? modelos[`fim-etapa:${etapa.id}`] : null;
      const texto = [fim, daAcao].filter(Boolean).join('\n\n') || modelos.acao || '';
      resultado[t.id] = preencher(texto, campos);
    }
  }
  const atual = processo.etapaAtual ? etapaDe(processo.etapaAtual) : null;
  resultado.promessa = preencher(modelos.promessa || '', { ...base, etapa: atual ? atual.nome : '' });
  const aut = processo.autorizacao;
  if (aut) {
    resultado.autorizacao = preencher(modelos.autorizacao || '', { ...base, etapa: (etapaDe(aut.etapaAnterior) || {}).nome || '', proximaEtapa: (etapaDe(aut.etapa) || {}).nome || '' });
  }
  return resultado;
}

module.exports = { modelosDoProcesso, carregarModelos, preencher };
