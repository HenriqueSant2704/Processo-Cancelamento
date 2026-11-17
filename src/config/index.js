// Configuração central: lê variáveis de ambiente e o cronograma de etapas.
// Credenciais NUNCA ficam no código, só no .env (local) ou no painel do Render.
const path = require('node:path');
const fs = require('node:fs');

function carregarCronograma() {
  const arquivo = path.join(__dirname, 'cronograma.json');
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
}

const ambiente = process.env.NODE_ENV || 'development';

module.exports = {
  ambiente,
  databaseUrl: process.env.DATABASE_URL || '',
  arquivoDados: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'processos.json'),
  web: {
    porta: Number(process.env.PORT) || 3000,
    // Local: só este computador. Produção (Render): aceita conexões externas.
    host: process.env.HOST || (ambiente === 'production' ? '0.0.0.0' : '127.0.0.1'),
  },
  sgp: {
    modo: process.env.SGP_MODO || 'exemplo',
    baseUrl: process.env.SGP_BASE_URL || '',
    token: process.env.SGP_TOKEN || '',
    app: process.env.SGP_APP || '',
  },
  carregarCronograma,
};
