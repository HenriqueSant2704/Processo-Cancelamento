// Transforma a lista bruta de clientes do SGP nos contratos SUSPENSOS que
// interessam ao processo de cobrança. Função pura: sem rede e sem banco.
//
// Cada contrato suspenso vira um item:
//   { id, contrato, nome, clienteSgpId, motivo, dataSuspensao | null }
// "id" é o número do contrato: um cliente com dois contratos suspensos
// tem dois processos, um para cada contrato.
const { ErroSgp } = require('./api');

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const texto = (v, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : '');

function lerId(valor, onde) {
  const t = texto(valor, 40);
  if (!t) throw new ErroSgp(`O SGP respondeu num formato inesperado (${onde} sem identificador).`);
  return t;
}

// Aceita 'AAAA-MM-DD', 'AAAA-MM-DD hh:mm:ss', 'AAAA-MM-DDThh:mm...' e 'DD/MM/AAAA'.
function lerData(valor) {
  const t = texto(valor, 40);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

// Faturas em aberto deste contrato.
function faturasAbertas(titulos, contratoId) {
  if (!Array.isArray(titulos)) return [];
  return titulos.filter((t) => ehObjeto(t) && texto(t.clientecontrato_id, 40) === contratoId && texto(t.status, 20).toLowerCase() === 'aberto' && lerData(t.dataVencimento));
}

function bloqueioPelasFaturas(titulos, contratoId, dias) {
  const vencimentos = faturasAbertas(titulos, contratoId).map((t) => lerData(t.dataVencimento)).sort();
  if (!vencimentos.length) return null;
  const [a, m, d] = vencimentos[0].split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

// Quantas faturas em aberto e o total (só números, para a tela).
function resumoFaturas(titulos, contratoId) {
  const abertas = faturasAbertas(titulos, contratoId);
  const total = abertas.reduce((soma, t) => soma + (Number(t.valorCorrigido) || Number(t.valor) || 0), 0);
  return { faturasAbertas: abertas.length, valorAberto: Math.round(total * 100) / 100 };
}

// opcoes:
//   statusSuspenso: lista de status que contam como suspenso (padrão ['SUSPENSO'])
//   motivos: lista de motivo_status aceitos (vazio = todos)
//   campoData: nome do campo do contrato com a data da suspensão (vazio = não há)
//   diasBloqueioAposVencimento: sem campoData, estima o bloqueio pela fatura em aberto
//     mais antiga do contrato: vencimento + N dias (venceu dia 1, bloqueia dia 16; o processo começa no dia 17)
function contratosSuspensos(clientes, { statusSuspenso = ['SUSPENSO'], motivos = [], campoData = '', diasBloqueioAposVencimento = 15 } = {}) {
  if (!Array.isArray(clientes)) throw new ErroSgp('O SGP respondeu num formato inesperado (lista de clientes).');
  const aceitaStatus = new Set(statusSuspenso.map((s) => s.toUpperCase()));
  const aceitaMotivo = new Set(motivos.map((s) => s.toUpperCase()));
  const vistos = new Set();
  const lista = [];

  for (const cliente of clientes) {
    if (!ehObjeto(cliente)) throw new ErroSgp('O SGP respondeu num formato inesperado (cliente).');
    const clienteSgpId = lerId(cliente.id, 'cliente');
    const contratos = cliente.contratos ?? [];
    if (!Array.isArray(contratos)) throw new ErroSgp('O SGP respondeu num formato inesperado (contratos).');

    for (const contrato of contratos) {
      if (!ehObjeto(contrato)) throw new ErroSgp('O SGP respondeu num formato inesperado (contrato).');
      const status = texto(contrato.status, 40).toUpperCase();
      if (!aceitaStatus.has(status)) continue;
      const motivo = texto(contrato.motivo_status, 80).toUpperCase();
      if (aceitaMotivo.size && !aceitaMotivo.has(motivo)) continue;
      const id = lerId(contrato.id, 'contrato');
      if (vistos.has(id)) continue;
      vistos.add(id);
      lista.push({
        id,
        contrato: id,
        nome: texto(cliente.nome) || `Cliente ${clienteSgpId}`,
        clienteSgpId,
        motivo: motivo || null,
        dataSuspensao: campoData ? lerData(contrato[campoData]) : bloqueioPelasFaturas(cliente.titulos, id, diasBloqueioAposVencimento),
        ...resumoFaturas(cliente.titulos, id),
      });
    }
  }
  return lista;
}

// Ficha do cliente para a tela da Jéssica (só o que ela precisa para cobrar):
// documento, telefones, e-mails, plano, dia de vencimento e o comportamento de pagamento
// das faturas do contrato nos últimos 12 meses. Nada de senha, login, Wi-Fi ou endereço.
function fichaDoContrato(cliente, contratoId, hoje) {
  if (!ehObjeto(cliente)) return null;
  const id = String(contratoId);
  const contrato = (Array.isArray(cliente.contratos) ? cliente.contratos : []).find((c) => ehObjeto(c) && texto(c.id, 40) === id);
  if (!contrato) return null;
  const contatos = ehObjeto(cliente.contatos) ? cliente.contatos : {};
  const lista = (v, max) => (Array.isArray(v) ? v : []).map((x) => texto(x, max)).filter(Boolean);
  const servicos = (Array.isArray(contrato.servicos) ? contrato.servicos : []).filter(ehObjeto);
  const ativos = servicos.filter((s) => texto(s.status, 20).toLowerCase() === 'ativo');
  const planos = [...new Set((ativos.length ? ativos : servicos).map((s) => (ehObjeto(s.plano) ? texto(s.plano.descricao, 120) : '')).filter(Boolean))];
  const dias = (de, ate) => Math.round((Date.parse(ate) - Date.parse(de)) / 864e5);

  // Faturas do contrato (sem as canceladas), da mais recente para a mais antiga.
  const faturas = (Array.isArray(cliente.titulos) ? cliente.titulos : [])
    .filter((t) => ehObjeto(t) && texto(t.clientecontrato_id, 40) === id && lerData(t.dataVencimento))
    .map((t) => {
      const status = texto(t.status, 20).toLowerCase();
      const vencimento = lerData(t.dataVencimento);
      const pagoEm = status === 'pago' ? lerData(t.dataPagamento) : null;
      const diasAtraso = pagoEm ? Math.max(0, dias(vencimento, pagoEm)) : status === 'aberto' && vencimento < hoje ? dias(vencimento, hoje) : 0;
      return { vencimento, valor: Number(t.valorCorrigido) || Number(t.valor) || 0, status, pagoEm, diasAtraso };
    })
    .filter((f) => f.status === 'pago' || f.status === 'aberto')
    .sort((a, b) => b.vencimento.localeCompare(a.vencimento));

  // Frequência: faturas que venceram nos últimos 12 meses.
  const [a, m, d] = hoje.split('-').map(Number);
  const umAno = new Date(Date.UTC(a - 1, m - 1, d)).toISOString().slice(0, 10);
  const doAno = faturas.filter((f) => f.vencimento >= umAno && f.vencimento <= hoje);
  const pagasAtrasadas = doAno.filter((f) => f.status === 'pago' && f.diasAtraso > 0);
  const vencidas = doAno.filter((f) => f.status === 'aberto').length;
  const proporcao = doAno.length ? (pagasAtrasadas.length + vencidas) / doAno.length : 0;
  const nivel = !doAno.length ? 'sem-historico' : proporcao <= 0.2 ? 'raro' : proporcao <= 0.5 ? 'as-vezes' : 'frequente';

  return {
    documento: texto(cliente.cpfcnpj, 30) || null,
    tipoPessoa: texto(cliente.tipo, 10) || null,
    telefones: [...new Set([...lista(contatos.celulares, 30), ...lista(contatos.telefones, 30)])].slice(0, 6),
    emails: [...new Set(lista(contatos.emails, 120))].slice(0, 4),
    plano: planos.join(' + ') || null,
    diaVencimento: Number(contrato.vencimento) || null,
    formaCobranca: texto(contrato.formaCobranca, 60) || null,
    clienteDesde: lerData(contrato.dataCadastro) || lerData(cliente.dataCadastro),
    faturas: faturas.slice(0, 12),
    frequencia: {
      nivel,
      faturas: doAno.length,
      emDia: doAno.filter((f) => f.status === 'pago' && f.diasAtraso === 0).length,
      pagasComAtraso: pagasAtrasadas.length,
      emAberto: vencidas,
      atrasoMedio: pagasAtrasadas.length ? Math.round(pagasAtrasadas.reduce((s, f) => s + f.diasAtraso, 0) / pagasAtrasadas.length) : 0,
    },
  };
}

// Resumo SEM dados pessoais, para entender o que o SGP devolve:
// nomes dos campos, quantos contratos por status e os motivos de cada status.
function diagnosticar(clientes) {
  const camposCliente = new Map();
  const camposContrato = new Map();
  const camposServico = new Map();
  const porStatus = new Map();
  const conta = (mapa, chave) => mapa.set(chave, (mapa.get(chave) || 0) + 1);
  const camposComData = new Map();

  for (const cliente of clientes) {
    if (!ehObjeto(cliente)) continue;
    Object.keys(cliente).forEach((k) => conta(camposCliente, k));
    for (const contrato of Array.isArray(cliente.contratos) ? cliente.contratos : []) {
      if (!ehObjeto(contrato)) continue;
      Object.keys(contrato).forEach((k) => {
        conta(camposContrato, k);
        if (lerData(contrato[k])) conta(camposComData, k);
      });
      const status = texto(contrato.status, 40).toUpperCase() || '(vazio)';
      if (!porStatus.has(status)) porStatus.set(status, { total: 0, motivos: new Map() });
      const s = porStatus.get(status);
      s.total += 1;
      conta(s.motivos, texto(contrato.motivo_status, 80).toUpperCase() || '(sem motivo)');
      for (const servico of Array.isArray(contrato.servicos) ? contrato.servicos : []) {
        if (ehObjeto(servico)) Object.keys(servico).forEach((k) => conta(camposServico, k));
      }
    }
  }

  const ordenar = (mapa) => [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  return {
    totalClientes: clientes.length,
    camposCliente: ordenar(camposCliente),
    camposContrato: ordenar(camposContrato),
    camposServico: ordenar(camposServico),
    camposDoContratoComData: ordenar(camposComData),
    status: [...porStatus.entries()].map(([status, s]) => ({ status, total: s.total, motivos: ordenar(s.motivos) })).sort((a, b) => b.total - a.total),
  };
}

module.exports = { contratosSuspensos, diagnosticar, lerData, fichaDoContrato };
