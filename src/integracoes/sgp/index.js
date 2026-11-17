// Fonte dos clientes bloqueados. Toda fonte tem:
//   listarClientesBloqueados() -> [{ id, nome, contrato, bloqueadoEm: 'AAAA-MM-DD' | null }]
// (bloqueadoEm null = o SGP não informou a data; o sistema usa o primeiro dia em que viu o contrato suspenso)
//
// SGP_MODO=exemplo  -> clientes fictícios (só para demonstração e testes)
// SGP_MODO=api      -> SGP real, pela rota URA de clientes
const { criarFonteExemplo } = require('./exemplo');
const { criarApiSgp } = require('./api');
const { contratosSuspensos } = require('./contratos');
const { criarApiOcorrencias, abertasPorContrato } = require('./ocorrencias');

// Nome do tipo de ocorrência que origina o fluxo pós-cancelamento ("Financeiro - Negativação pós Cancelamento").
const TIPO_POS_CANCELAMENTO = /negativacao pos cancelamento/;

function criarFonteApi(config, opcoesApi = {}) {
  const api = criarApiSgp({ url: config.sgp.uraClientesUrl, app: config.sgp.app, token: config.sgp.token, ...opcoesApi });
  return {
    // Contratos com ocorrência ABERTA de negativação pós-cancelamento.
    async listarPosCancelamento() {
      const origem = new URL(config.sgp.uraClientesUrl).origin;
      const oc = criarApiOcorrencias({ origem, app: config.sgp.app, token: config.sgp.token, ...(opcoesApi.ocorrencias || {}) });
      const tipo = config.sgp.tipoPosCancelamento || (await oc.idDoTipo(TIPO_POS_CANCELAMENTO));
      return abertasPorContrato(await oc.listarOcorrencias({ tipo: [tipo] }));
    },
    async listarClientesBloqueados() {
      const { clientes } = await api.lerTodosClientes();
      return contratosSuspensos(clientes, {
        statusSuspenso: config.sgp.statusSuspenso,
        motivos: config.sgp.motivos,
        campoData: config.sgp.campoDataSuspensao,
        diasBloqueioAposVencimento: config.sgp.diasBloqueioAposVencimento,
      }).map((c) => ({ id: c.id, nome: c.nome, contrato: c.contrato, bloqueadoEm: c.dataSuspensao, financeiro: { valorAberto: c.valorAberto, faturasAbertas: c.faturasAbertas } }));
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
