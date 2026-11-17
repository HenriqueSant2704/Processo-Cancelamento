// Leitura das OCORRÊNCIAS do SGP (só leitura).
//   Tipos:       GET  {origem}/api/os/ocorrencia/tipo/list/   (corpo JSON com app e token)
//   Ocorrências: POST {origem}/api/ura/ocorrencia/list/       { app, token, tipo: [id], offset, limit <= 1000 }
// O filtro "tipo" usa o ID do tipo (não o código). Status da ocorrência: 0 aberta, 1 encerrada, 2 em execução, 3 pendente.
// Nunca escreve token, app ou a resposta bruta em log ou mensagem de erro.
const https = require('node:https');
const http = require('node:http');
const { ErroSgp } = require('./api');

const LIMITE = 1000;
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const texto = (v, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : '');
const normalizar = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// A rota de tipos é GET com corpo JSON, o que o fetch não permite; por isso usamos http(s) direto.
function getComCorpo(url, corpo, tempoLimiteMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const dados = JSON.stringify(corpo);
    const cliente = u.protocol === 'http:' ? http : https;
    const req = cliente.request({
      host: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados), Accept: 'application/json' },
      timeout: tempoLimiteMs,
    }, (res) => {
      let s = '';
      res.on('data', (d) => { s += d; });
      res.on('end', () => resolve({ status: res.statusCode, texto: s }));
    });
    req.on('timeout', () => req.destroy(new Error('tempo')));
    req.on('error', () => reject(new ErroSgp('Não foi possível conectar ao SGP (tipos de ocorrência).')));
    req.end(dados);
  });
}

// origem: "https://empresa.sgp.net.br" (vem da URL da rota de clientes)
function criarApiOcorrencias({ origem, app, token, buscar = fetch, buscarTipos = getComCorpo, tempoLimiteMs = 120_000 }) {
  if (!origem || !app || !token) throw new ErroSgp('Integração com o SGP não configurada.');

  async function listarTipos() {
    const r = await buscarTipos(`${origem}/api/os/ocorrencia/tipo/list/`, { app, token }, tempoLimiteMs);
    if (r.status === 401 || r.status === 403) throw new ErroSgp(`O SGP recusou o acesso aos tipos de ocorrência (HTTP ${r.status}).`);
    if (r.status !== 200) throw new ErroSgp(`O SGP respondeu com erro ao listar tipos de ocorrência (HTTP ${r.status}).`);
    let lista;
    try { lista = JSON.parse(r.texto); } catch { throw new ErroSgp('O SGP respondeu algo que não é JSON (tipos de ocorrência).'); }
    if (!Array.isArray(lista)) throw new ErroSgp('O SGP respondeu num formato inesperado (tipos de ocorrência).');
    return lista.filter(ehObjeto).map((t) => ({ id: Number(t.id), codigo: Number(t.codigo), descricao: texto(t.descricao), ativo: t.ativo !== false }));
  }

  // Acha o ID de um tipo pelo nome (sem diferenciar acentos e maiúsculas).
  async function idDoTipo(padrao) {
    const tipos = await listarTipos();
    const achado = tipos.find((t) => padrao.test(normalizar(t.descricao)));
    if (!achado) throw new ErroSgp('Tipo de ocorrência não encontrado no SGP.');
    return achado.id;
  }

  async function listarOcorrencias(filtro) {
    const todas = [];
    for (let offset = 0, voltas = 0; voltas < 50; voltas++, offset += LIMITE) {
      let resposta;
      try {
        resposta = await buscar(`${origem}/api/ura/ocorrencia/list/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ app, token, ...filtro, offset, limit: LIMITE }),
          signal: AbortSignal.timeout(tempoLimiteMs),
        });
      } catch {
        throw new ErroSgp('Não foi possível conectar ao SGP (ocorrências).');
      }
      if (!resposta.ok) throw new ErroSgp(`O SGP respondeu com erro ao listar ocorrências (HTTP ${resposta.status}).`);
      let dados;
      try { dados = await resposta.json(); } catch { throw new ErroSgp('O SGP respondeu algo que não é JSON (ocorrências).'); }
      if (!ehObjeto(dados) || !Array.isArray(dados.ocorrencias)) throw new ErroSgp('O SGP respondeu num formato inesperado (ocorrências).');
      todas.push(...dados.ocorrencias);
      const total = Number(dados.paginacao && dados.paginacao.total);
      if (dados.ocorrencias.length < LIMITE || (Number.isFinite(total) && todas.length >= total)) return todas;
    }
    throw new ErroSgp('A leitura de ocorrências passou do limite de páginas.');
  }

  return { listarTipos, idDoTipo, listarOcorrencias };
}

// Ocorrências ABERTAS (não encerradas) -> um item por contrato, ficando com a mais antiga.
// Só guardamos o necessário: contrato, nome, número da ocorrência e data de abertura.
function abertasPorContrato(ocorrencias) {
  const porContrato = new Map();
  for (const o of Array.isArray(ocorrencias) ? ocorrencias : []) {
    if (!ehObjeto(o) || Number(o.status_id) === 1) continue;
    const contrato = texto(o.contrato, 40);
    if (!contrato) continue;
    const abertaEm = texto(o.data_cadastro, 10).match(/^\d{4}-\d{2}-\d{2}$/) ? texto(o.data_cadastro, 10) : null;
    const item = { contrato, nome: texto(o.cliente) || `Contrato ${contrato}`, ocorrencia: { numero: texto(o.numero, 40), abertaEm } };
    const atual = porContrato.get(contrato);
    if (!atual || (abertaEm && (!atual.ocorrencia.abertaEm || abertaEm < atual.ocorrencia.abertaEm))) porContrato.set(contrato, item);
  }
  return [...porContrato.values()];
}

module.exports = { criarApiOcorrencias, abertasPorContrato, getComCorpo };
