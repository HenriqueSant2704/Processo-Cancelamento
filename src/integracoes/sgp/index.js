// Fonte dos clientes bloqueados. Toda fonte tem:
//   listarClientesBloqueados() -> [{ id, nome, contrato, bloqueadoEm: 'AAAA-MM-DD' | null }]
// (bloqueadoEm null = o SGP não informou a data; o sistema usa o primeiro dia em que viu o contrato suspenso)
//
// SGP_MODO=exemplo  -> clientes fictícios (só para demonstração e testes)
// SGP_MODO=api      -> SGP real, pela rota URA de clientes
const { criarFonteExemplo } = require('./exemplo');
const { criarApiSgp } = require('./api');
const { contratosSuspensos } = require('./contratos');

function criarFonteApi(config, opcoesApi = {}) {
  const api = criarApiSgp({ url: config.sgp.uraClientesUrl, app: config.sgp.app, token: config.sgp.token, ...opcoesApi });
  return {
    async listarClientesBloqueados() {
      const { clientes } = await api.lerTodosClientes();
      return contratosSuspensos(clientes, {
        statusSuspenso: config.sgp.statusSuspenso,
        motivos: config.sgp.motivos,
        campoData: config.sgp.campoDataSuspensao,
        diasBloqueioAposVencimento: config.sgp.diasBloqueioAposVencimento,
      }).map((c) => ({ id: c.id, nome: c.nome, contrato: c.contrato, bloqueadoEm: c.dataSuspensao }));
    },
  };
}

// bancoReal = true quando os dados vão para o Neon: aí não deixamos entrar cliente fictício.
function criarFonteSgp(config, hoje, { bancoReal = false } = {}) {
  if (config.sgp.modo === 'exemplo') {
    if (bancoReal) {
      return {
        async listarClientesBloqueados() {
          throw new Error('O SGP está no modo "exemplo" (clientes fictícios). Com o banco Neon, use SGP_MODO=api para não misturar dados de teste com os reais.');
        },
      };
    }
    return criarFonteExemplo(hoje);
  }
  if (config.sgp.modo === 'api') return criarFonteApi(config);
  throw new Error(`SGP_MODO inválido: "${config.sgp.modo}". Use "exemplo" ou "api".`);
}

module.exports = { criarFonteSgp, criarFonteApi };
