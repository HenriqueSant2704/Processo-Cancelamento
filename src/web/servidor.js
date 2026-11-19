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
    executar: async (dia) => {
      const r = await servico.sincronizarTudo({ sgp: criarSgp(dia), repositorio: armazenamento.repositorio, cronograma, hoje: dia });
      await avisosPendentes(dia);
      return r;
    },
    hoje: hojeISO,
    horaInicio: config.sgp.horaSincronizacao,
  });

  // Quem grava comentários nas ocorrências: com o usuário da integração (rota da tela, marca de verdade)
  // ou, sem ele, pela API via OS da ocorrência.
  const comentador = !modoDemo && config.sgp.modo === 'api'
    ? require('../integracoes/sgp/comentador').criarComentador({
      origem: new URL(config.sgp.uraClientesUrl).origin, app: config.sgp.app, token: config.sgp.token,
      usuarioIntegracao: config.sgp.usuarioIntegracao, senhaIntegracao: config.sgp.senhaIntegracao,
    })
    : null;

  // Botão "Criar no SGP": no modo demonstração usa um SGP de mentira; no real, só com SGP_CRIAR_OCORRENCIA=sim.
  let criarOcorrenciaSgp = null;
  if (modoDemo) {
    criarOcorrenciaSgp = async ({ tipoNome }) => ({ protocolo: `DEMO-${Date.now().toString().slice(-6)}`, tipo: tipoNome });
  } else if (config.sgp.modo === 'api' && config.sgp.criarOcorrencia) {
    const { criarApiOcorrencias } = require('../integracoes/sgp/ocorrencias');
    const oc = criarApiOcorrencias({ origem: new URL(config.sgp.uraClientesUrl).origin, app: config.sgp.app, token: config.sgp.token });
    criarOcorrenciaSgp = async ({ contrato, tipoNome, conteudo, usuarioSgp, por }) => {
      const responsavel = config.sgp.responsavelOcorrencia;
      const criada = await oc.criarOcorrencia({
        contrato, tipoNome, conteudo, responsavel,
        metodo: config.sgp.metodoOcorrencia, usuario: usuarioSgp || config.sgp.usuarioOcorrencia, abrirOs: config.sgp.abrirOsJunto,
      });
      try {
        const { htmlComentario } = require('../processos/comentarios');
        const nome = config.sgp.nomes[responsavel] || '';
        await comentador.comentar({
          numero: criada.protocolo,
          html: htmlComentario({ tipo: 'aviso', titulo: `Ocorrência aberta pelo sistema (${tipoNome})`, texto: `Esta ocorrência foi aberta pelo sistema de cobrança. Os próximos passos e as notificações ao cliente serão registrados aqui.`, por: por || 'usuário do sistema', data: new Date().toISOString().slice(0, 10) }, { nomeDestinatario: nome }),
          texto: `[Têmis] Ocorrência criada pelo sistema de cobrança por ${por || 'usuário do sistema'}.`,
          marcar: [responsavel],
        });
      } catch (erro) {
        criada.aviso = `A ocorrência foi criada, mas o comentário não: ${erro.message}`;
        console.error(criada.aviso);
      }
      return criada;
    };
    console.log('Criar ocorrência no SGP pelo sistema: LIGADO.');
  }

  // Comentários automáticos na ocorrência do contrato (GRAVA no SGP): SGP_COMENTAR_OCORRENCIA=sim.
  let comentarOcorrenciaSgp = null;
  if (!modoDemo && config.sgp.modo === 'api' && config.sgp.comentarOcorrencia) {
    comentarOcorrenciaSgp = (dados) => comentador.comentar(dados);
    console.log(`Comentários automáticos nas ocorrências do SGP: LIGADO (${comentador.usaLogin ? 'usuário da integração' : 'API, só ocorrências com OS'}).`);
  }

  // Print do aviso anexado na ocorrência (GRAVA no SGP): SGP_ENVIAR_PRINT=sim.
  let anexarOcorrenciaSgp = null;
  if (!modoDemo && config.sgp.modo === 'api' && config.sgp.enviarPrint && comentador.usaLogin) {
    anexarOcorrenciaSgp = (dados) => comentador.anexar({ ...dados, campos: config.sgp.camposAnexo });
    console.log('Print dos avisos anexado nas ocorrências do SGP: LIGADO.');
  }

  // Avisos pendentes na ocorrência (ex.: marcar quem abre a OS de retirada). Só com comentários ligados.
  async function avisosPendentes(dia) {
    if (!comentarOcorrenciaSgp) return;
    try {
      const n = await servico.enviarAvisosPendentes({
        repositorio: armazenamento.repositorio, cronograma, hoje: dia, comentar: comentarOcorrenciaSgp, destinatarios: { os: config.sgp.responsavelOs }, nomes: config.sgp.nomes,
      });
      if (n) console.log(`Avisos enviados nas ocorrências: ${n}`);
    } catch (erro) {
      console.error(`Avisos nas ocorrências falharam: ${erro.message}`);
    }
  }

  // Feriados do SGP já ao iniciar (a sincronização diária atualiza de novo).
  if (!modoDemo && config.sgp.modo === 'api') {
    Promise.resolve(criarSgp(hojeISO()).listarFeriados())
      .then((datas) => { servico.atualizarFeriados(cronograma, datas); console.log(`Feriados do SGP carregados: ${datas.length}.`); })
      .catch((erro) => console.error(`Não consegui ler os feriados do SGP: ${erro.message}`));
  }

  // Com o SGP real, sincroniza sozinho uma vez por dia (a partir de SGP_HORA_SINCRONIZACAO, padrão 7h).
  if (!modoDemo && config.sgp.modo === 'api' && config.sgp.sincronizacaoAutomatica) {
    sincronizador.iniciarAgenda();
    console.log(`Sincronização automática com o SGP: todo dia a partir das ${config.sgp.horaSincronizacao}h.`);
  }

  // Autorização do supervisor: só faz sentido com comentários ligados (é por eles que o Lucas é perguntado).
  const exigirAutorizacao = Boolean(comentarOcorrenciaSgp && config.sgp.supervisor && config.sgp.exigirAutorizacao);
  let aoAutorizar = null; // definido pela tela (comenta o início da etapa liberada)
  async function lerAutorizacoes() {
    try {
      const mudaram = await servico.lerAutorizacoes({
        sgp: criarSgp(hojeISO()), repositorio: armazenamento.repositorio, cronograma, hoje: hojeISO(),
        supervisor: config.sgp.supervisor, usuarioSistema: config.sgp.usuarioIntegracao,
      });
      if (mudaram.length) console.log(`Respostas de autorização lidas no SGP: ${mudaram.length}`);
      if (aoAutorizar) for (const p of mudaram) aoAutorizar(p);
    } catch (erro) {
      console.error(`Leitura das autorizações falhou: ${erro.message}`);
    }
  }
  if (exigirAutorizacao) {
    setInterval(lerAutorizacoes, 10 * 60 * 1000).unref();
    console.log('Autorização do supervisor entre etapas: LIGADA (lê a resposta na ocorrência a cada 10 minutos).');
  }

  // Regra do Pendente: só com o SGP real (é lá que a Jéssica muda o status da ocorrência).
  const statusOcorrenciaSgp = !modoDemo && config.sgp.modo === 'api' && config.sgp.exigirPendente
    ? (numero) => criarSgp(hojeISO()).statusDaOcorrencia(numero)
    : null;
  if (statusOcorrenciaSgp) console.log('Regra do Pendente: LIGADA (para encerrar etapa com "não regularizou", a ocorrência precisa estar Pendente).');

  const app = criarApp({
    exigirAutorizacao,
    statusOcorrenciaSgp,
    anexarOcorrenciaSgp,
    printObrigatorio: config.printObrigatorio,
    lerAutorizacoes: exigirAutorizacao ? lerAutorizacoes : null,
    registrarAoAutorizar: (fn) => { aoAutorizar = fn; },
    aposAcao: () => avisosPendentes(hojeISO()),
    criarOcorrenciaSgp,
    comentarOcorrenciaSgp,
    responsavelSgp: config.sgp.responsavelOcorrencia,
    supervisorSgp: config.sgp.supervisor,
    nomes: config.sgp.nomes,
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
