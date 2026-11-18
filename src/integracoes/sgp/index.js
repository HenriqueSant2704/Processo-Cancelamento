// Fonte dos clientes bloqueados. Toda fonte tem:
//   listarClientesBloqueados() -> [{ id, nome, contrato, bloqueadoEm: 'AAAA-MM-DD' | null }]
// (bloqueadoEm null = o SGP não informou a data; o sistema usa o primeiro dia em que viu o contrato suspenso)
//
// SGP_MODO=exemplo  -> clientes fictícios (só para demonstração e testes)
// SGP_MODO=api      -> SGP real, pela rota URA de clientes
const { criarFonteExemplo } = require('./exemplo');
const { criarApiSgp } = require('./api');
const { contratosSuspensos, lerData } = require('./contratos');
const { criarApiOcorrencias, abertasPorContrato } = require('./ocorrencias');

// Nome do tipo de ocorrência que origina o fluxo pós-cancelamento ("Financeiro - Negativação pós Cancelamento").
const TIPO_POS_CANCELAMENTO = /negativacao pos cancelamento/;

// Contratos suspensos e a data em que ficaram suspensos (Map contrato -> 'AAAA-MM-DD').
async function lerDatasDeSuspensao(config, buscar) {
  const origem = new URL(config.sgp.uraClientesUrl).origin;
  let resposta;
  try {
    resposta = await buscar(`${origem}/api/ura/listacontrato/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ app: config.sgp.app, token: config.sgp.token, status: 4 }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error('não foi possível conectar ao SGP (contratos)');
  }
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status} (contratos)`);
  const lista = await resposta.json();
  if (!Array.isArray(lista)) throw new Error('formato inesperado (contratos)');
  const datas = new Map();
  for (const c of lista) {
    const data = lerData(c && c.data_status);
    if (c && c.id_contrato != null && data) datas.set(String(c.id_contrato), data);
  }
  return datas;
}

function criarFonteApi(config, opcoesApi = {}) {
  const api = criarApiSgp({ url: config.sgp.uraClientesUrl, app: config.sgp.app, token: config.sgp.token, ...opcoesApi });
  return {
    // Ocorrência ABERTA mais recente de "Financeiro - Negativação" ou "Cancelamento por Inadiplência" de cada contrato.
    async listarOcorrenciasDoFluxoPrincipal() {
      const origem = new URL(config.sgp.uraClientesUrl).origin;
      const oc = criarApiOcorrencias({ origem, app: config.sgp.app, token: config.sgp.token, ...(opcoesApi.ocorrencias || {}) });
      const sem = (t) => String(t).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
      const ids = (await oc.listarTipos()).filter((t) => /^financeiro - (negativacao|cancelamento por inadiplencia)$/.test(sem(t.descricao))).map((t) => t.id);
      if (!ids.length) return new Map();
      const porContrato = new Map();
      for (const o of await oc.listarOcorrencias({ tipo: ids })) {
        if (!o || Number(o.status_id) === 1 || o.contrato == null || !o.numero) continue;
        const atual = porContrato.get(String(o.contrato));
        if (!atual || String(o.data_cadastro || '') > atual.abertaEm) porContrato.set(String(o.contrato), { numero: String(o.numero), abertaEm: String(o.data_cadastro || '') });
      }
      return porContrato;
    },
    // Contratos com ocorrência ABERTA de negativação pós-cancelamento.
    async listarPosCancelamento() {
      const origem = new URL(config.sgp.uraClientesUrl).origin;
      const oc = criarApiOcorrencias({ origem, app: config.sgp.app, token: config.sgp.token, ...(opcoesApi.ocorrencias || {}) });
      const tipo = config.sgp.tipoPosCancelamento || (await oc.idDoTipo(TIPO_POS_CANCELAMENTO));
      return abertasPorContrato(await oc.listarOcorrencias({ tipo: [tipo] }));
    },
    async listarClientesBloqueados() {
      // Data REAL da suspensão: "data_status" da rota URA Contrato – Listar (status 4 = suspenso).
      // Se essa leitura falhar, cai na estimativa pela fatura em aberto mais antiga.
      let datasReais = new Map();
      try {
        datasReais = await lerDatasDeSuspensao(config, opcoesApi.buscar || fetch);
      } catch (erro) {
        console.error(`Data de suspensão do SGP indisponível, usando a estimativa pelas faturas: ${erro.message}`);
      }
      const { clientes } = await api.lerTodosClientes();
      return contratosSuspensos(clientes, {
        statusSuspenso: config.sgp.statusSuspenso,
        motivos: config.sgp.motivos,
        campoData: config.sgp.campoDataSuspensao,
        diasBloqueioAposVencimento: config.sgp.diasBloqueioAposVencimento,
      }).map((c) => ({
        id: c.id,
        nome: c.nome,
        contrato: c.contrato,
        bloqueadoEm: datasReais.get(String(c.contrato)) || c.dataSuspensao,
        dataReal: datasReais.has(String(c.contrato)),
        financeiro: { valorAberto: c.valorAberto, faturasAbertas: c.faturasAbertas },
      }));
    },
  };
}

// bancoReal = true quando os dados vão para o Neon: aí não deixamos entrar cliente fictício.
function criarFonteSgp(config, hoje, { bancoReal = false } = {}) {
  if (config.sgp.modo === 'exemplo') {
    if (bancoReal) {
      const erro = async () => {
        throw new Error('O SGP está no modo "exemplo" (clientes fictícios). Com o banco Neon, use SGP_MODO=api para não misturar dados de teste com os reais.');
      };
      return { listarClientesBloqueados: erro, listarPosCancelamento: erro };
    }
    return criarFonteExemplo(hoje);
  }
  if (config.sgp.modo === 'api') return criarFonteApi(config);
  throw new Error(`SGP_MODO inválido: "${config.sgp.modo}". Use "exemplo" ou "api".`);
}

module.exports = { criarFonteSgp, criarFonteApi };
