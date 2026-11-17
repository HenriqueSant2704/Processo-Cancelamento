// Configuração central: lê variáveis de ambiente e o cronograma de etapas.
// Credenciais NUNCA ficam no código, só no .env.
const path = require('node:path');
const fs = require('node:fs');

function carregarCronograma() {
  const arquivo = path.join(__dirname, 'cronograma.json');
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
}

module.exports = {
  ambiente: process.env.NODE_ENV || 'development',
  arquivoDados: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'processos.json'),
  sgp: {
    modo: process.env.SGP_MODO || 'exemplo',
    baseUrl: process.env.SGP_BASE_URL || '',
    token: process.env.SGP_TOKEN || '',
    app: process.env.SGP_APP || '',
  },
  carregarCronograma,
};
