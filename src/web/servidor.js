// Inicia a tela no navegador: npm run web  (abre em http://localhost:3000)
const http = require('node:http');
const config = require('../config');
const { criarApp } = require('./app');
const { criarFonteSgp } = require('../integracoes/sgp');

function iniciarServidor({ arquivoDados = config.arquivoDados, modoDemo = false } = {}) {
  const app = criarApp({
    arquivoDados,
    cronograma: config.carregarCronograma(),
    criarSgp: (hoje) => criarFonteSgp(config, hoje),
    modoDemo,
  });
  // Por padrão só aceita acessos deste computador (HOST=127.0.0.1).
  // Liberar para a rede (HOST=0.0.0.0) só depois de termos login, por causa da LGPD.
  const host = process.env.HOST || '127.0.0.1';
  const porta = Number(process.env.PORT) || 3000;
  const servidor = http.createServer(app);
  servidor.listen(porta, host, () => {
    console.log(`Tela do financeiro: http://localhost:${porta}${modoDemo ? '  (modo demonstração)' : ''}`);
  });
  return servidor;
}

if (require.main === module) iniciarServidor();

module.exports = { iniciarServidor };
