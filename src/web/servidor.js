// Inicia a tela no navegador: npm run web
//   Local (sem DATABASE_URL): dados no arquivo data/processos.json, sem login, só neste computador.
//   Render (com DATABASE_URL): dados no Neon, com login dos funcionários.
const http = require('node:http');
const config = require('../config');
const { criarApp } = require('./app');
const { criarFonteSgp } = require('../integracoes/sgp');
const { criarArmazenamento } = require('../armazenamento');
const { criarSincronizador } = require('../processos/sincronizador');
const servico = require('../processos/servico');
const { hojeISO } = require('../utils/datas');

const LOCAL = new Set(['127.0.0.1', 'localhost', '::1']);

async function iniciarServidor({ arquivoDados, modoDemo = false } = {}) {
  const armazenamento = await criarArmazenamento({ arquivoDados, forcarArquivo: modoDemo });
  const { host, porta } = config.web;

  // Segurança (LGPD): nunca abrir para a rede sem login.
  if (!armazenamento.usuarios && !LOCAL.has(host)) {
    throw new Error(`Recusado: HOST=${host} deixaria a tela aberta na rede sem login. Configure DATABASE_URL (Neon) para ter login.`);
  }

  const producao = config.ambiente === 'production';
  const cronograma = config.carregarCronograma();
  const criarSgp = (hoje) => criarFonteSgp(config, hoje, { bancoReal: armazenamento.tipo === 'postgres' });
  const sincronizador = criarSincronizador({
    executar: (dia) => servico.sincronizarTudo({ sgp: criarSgp(dia), repositorio: armazenamento.repositorio, cronograma, hoje: dia }),
    hoje: hojeISO,
    horaInicio: config.sgp.horaSincronizacao,
  });
  // Com o SGP real, sincroniza sozinho uma vez por dia (a partir de SGP_HORA_SINCRONIZACAO, padrão 7h).
  if (!modoDemo && config.sgp.modo === 'api' && config.sgp.sincronizacaoAutomatica) {
    sincronizador.iniciarAgenda();
    console.log(`Sincronização automática com o SGP: todo dia a partir das ${config.sgp.horaSincronizacao}h.`);
  }

  // Botão "Criar no SGP": no modo demonstração usa um SGP de mentira; no real, só com SGP_CRIAR_OCORRENCIA=sim.
  let criarOcorrenciaSgp = null;
  if (modoDemo) {
    criarOcorrenciaSgp = async ({ tipoNome }) => ({ protocolo: `DEMO-${Date.now().toString().slice(-6)}`, tipo: tipoNome });
  } else if (config.sgp.modo === 'api' && config.sgp.criarOcorrencia) {
    const { criarApiOcorrencias } = require('../integracoes/sgp/ocorrencias');
    const oc = criarApiOcorrencias({ origem: new URL(config.sgp.uraClientesUrl).origin, app: config.sgp.app, token: config.sgp.token });
    criarOcorrenciaSgp = ({ contrato, tipoNome, conteudo }) => oc.criarOcorrencia({
      contrato, tipoNome, conteudo,
      metodo: config.sgp.metodoOcorrencia, usuario: config.sgp.usuarioOcorrencia, abrirOs: config.sgp.abrirOsJunto,
    });
    console.log('Criar ocorrência no SGP pelo sistema: LIGADO.');
  }

  const app = criarApp({
    criarOcorrenciaSgp,
    repositorio: armazenamento.repositorio,
    usuarios: armazenamento.usuarios,
    cronograma,
    criarSgp,
    sincronizador,
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
