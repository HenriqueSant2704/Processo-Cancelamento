// Fonte de dados do SGP. Toda fonte precisa ter:
//   listarClientesBloqueados() -> [{ id, nome, contrato, bloqueadoEm: 'AAAA-MM-DD' }]
// SGP_MODO=exemplo usa dados fictícios; SGP_MODO=api usará a API real (a implementar).
const { criarFonteExemplo } = require('./exemplo');

// bancoReal = true quando os dados vão para o Neon: aí não deixamos entrar cliente fictício.
function criarFonteSgp(config, hoje, { bancoReal = false } = {}) {
  if (config.sgp.modo === 'exemplo') {
    if (bancoReal) {
      return {
        async listarClientesBloqueados() {
          throw new Error('A integração com o SGP ainda não está pronta. Com o banco Neon, a sincronização com clientes fictícios fica desligada para não misturar dados de teste com os reais.');
        },
      };
    }
    return criarFonteExemplo(hoje);
  }
  if (config.sgp.modo === 'api') {
    return {
      async listarClientesBloqueados() {
        throw new Error('Integração com a API do SGP ainda não implementada. Use SGP_MODO=exemplo por enquanto.');
      },
    };
  }
  throw new Error(`SGP_MODO inválido: "${config.sgp.modo}". Use "exemplo" ou "api".`);
}

module.exports = { criarFonteSgp };
