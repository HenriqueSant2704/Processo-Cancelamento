// Inicia a tela no navegador: npm run web
//   Local (sem DATABASE_URL): dados no arquivo data/processos.json, sem login, só neste computador.
//   Render (com DATABASE_URL): dados no Neon, com login dos funcionários.
const http = require('node:http');
const config = require('../config');
const { criarApp } = require('./app');
const { criarFonteSgp } = require('../integracoes/sgp');
const { criarArmazenamento } = require('../armazenamento');

const LOCAL = new Set(['127.0.0.1', 'localhost', '::1']);

async function iniciarServidor({ arquivoDados, modoDemo = false } = {}) {
  const armazenamento = await criarArmazenamento({ arquivoDados, forcarArquivo: modoDemo });
  const { host, porta } = config.web;

  // Segurança (LGPD): nunca abrir para a rede sem login.
  if (!armazenamento.usuarios && !LOCAL.has(host)) {
    throw new Error(`Recusado: HOST=${host} deixaria a tela aberta na rede sem login. Configure DATABASE_URL (Neon) para ter login.`);
  }

  const producao = config.ambiente === 'production';
  const app = criarApp({
    repositorio: armazenamento.repositorio,
    usuarios: armazenamento.usuarios,
    cronograma: config.carregarCronograma(),
    criarSgp: (hoje) => criarFonteSgp(config, hoje, { bancoReal: armazenamento.tipo === 'postgres' }),
    modoDemo,
    cookieSeguro: producao,
    atrasDeProxy: producao,
  });

  const servidor = http.createServer(app);
  servidor.listen(porta, host, () => {
    const extra = modoDemo ? '  (modo demonstração)' : armazenamento.usuarios ? '  (banco Neon, com login)' : '  (arquivo local, sem login)';
    console.log(`Tela do financeiro: http://localhost:${porta}${extra}`);
  });
  servidor.on('close', () => armazenamento.fechar());
  return servidor;
}

if (require.main === module) {
  iniciarServidor().catch((erro) => {
    console.error(`Erro ao iniciar: ${erro.message}`);
    process.exit(1);
  });
}

module.exports = { iniciarServidor };
