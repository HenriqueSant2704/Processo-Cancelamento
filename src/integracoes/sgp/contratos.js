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

// opcoes:
//   statusSuspenso: lista de status que contam como suspenso (padrão ['SUSPENSO'])
//   motivos: lista de motivo_status aceitos (vazio = todos)
//   campoData: nome do campo do contrato com a data da suspensão (vazio = não há)
function contratosSuspensos(clientes, { statusSuspenso = ['SUSPENSO'], motivos = [], campoData = '' } = {}) {
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
        dataSuspensao: campoData ? lerData(contrato[campoData]) : null,
      });
    }
  }
  return lista;
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

module.exports = { contratosSuspensos, diagnosticar, lerData };
