// Servidor web (só o módulo http do Node): entrega a tela (pasta publico/)
// e a API em JSON usada por ela. Quando há usuários (banco Neon), exige login.
const fs = require('node:fs');
const path = require('node:path');
const servico = require('../processos/servico');
const { ErroConflito } = require('../processos/repositorio');
const { hojeISO } = require('../utils/datas');
const visao = require('./visao');
const { posicionar, registrarPromessa, obterEtapa } = require('../cronograma/motor');
const { registrar } = require('../auditoria/historico');
const { bloqueada, pedirAutorizacao, aplicarResposta, pedirDeNovo } = require('../processos/autorizacao');
const { htmlComentario, textoComentario } = require('../processos/comentarios');
const { criarSincronizador } = require('../processos/sincronizador');
const { lerPrint } = require('../processos/prints');
const { marcarEnviado, registrarChecagem } = require('../processos/retorno');
const { modelosDoProcesso } = require('../processos/mensagens');

const PUBLICO = path.join(__dirname, 'publico');
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const PUBLICOS_SEM_LOGIN = new Set(['/login.html', '/login.js', '/estilo.css', '/icone.svg']);
const COOKIE = 'temis_sessao';
const SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function responderJson(res, status, dados, cabecalhos = {}) {
  res.writeHead(status, { ...SEGURANCA, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cabecalhos });
  res.end(JSON.stringify(dados));
}

function redirecionar(res, destino) {
  res.writeHead(302, { ...SEGURANCA, Location: destino });
  res.end();
}

function lerCorpo(req, limite = 20_000) {
  return new Promise((resolve, reject) => {
    // Só aceita JSON: isso também impede envios disfarçados vindos de outros sites (CSRF).
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      reject(new ErroHttp(415, 'Envie os dados em JSON.'));
      req.resume();
      return;
    }
    let corpo = '';
    req.on('data', (parte) => {
      corpo += parte;
      if (corpo.length > limite) {
        reject(new ErroHttp(413, 'Requisição grande demais.'));
        corpo = '';
        req.removeAllListeners('data');
        req.resume();
      }
    });
    req.on('end', () => {
      try {
        resolve(corpo ? JSON.parse(corpo) : {});
      } catch {
        reject(new ErroHttp(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function lerCookie(req, nome) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const [chave, ...valor] = parte.trim().split('=');
    if (chave === nome) return decodeURIComponent(valor.join('='));
  }
  return null;
}

function servirArquivo(res, caminhoUrl) {
  let relativo;
  try {
    relativo = caminhoUrl === '/' ? 'index.html' : decodeURIComponent(caminhoUrl).replace(/^\/+/, '');
  } catch {
    relativo = '';
  }
  const arquivo = path.resolve(PUBLICO, relativo);
  if (!relativo || !arquivo.startsWith(PUBLICO + path.sep) || !fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) {
    res.writeHead(404, { ...SEGURANCA, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
    return;
  }
  res.writeHead(200, { ...SEGURANCA, 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(arquivo).pipe(res);
}

// Limite simples de tentativas de login por IP (10 a cada 15 minutos).
function criarLimitador(maximo = 10, janelaMs = 15 * 60 * 1000) {
  const tentativas = new Map();
  return {
    bloqueado(ip) {
      const agora = Date.now();
      const t = tentativas.get(ip);
      if (!t || agora - t.inicio > janelaMs) return false;
      return t.quantidade >= maximo;
    },
    falhou(ip) {
      const agora = Date.now();
      const t = tentativas.get(ip);
      if (!t || agora - t.inicio > janelaMs) tentativas.set(ip, { inicio: agora, quantidade: 1 });
      else t.quantidade += 1;
    },
    limpar(ip) {
      tentativas.delete(ip);
    },
  };
}

// opcoes: { repositorio, usuarios (null = sem login), cronograma, criarSgp(hoje), sincronizador, modoDemo, cookieSeguro, atrasDeProxy,
//           criarOcorrenciaSgp (null = botão "Criar no SGP" desligado),
//           comentarOcorrenciaSgp ({ numero, texto }) (null = sem comentários automáticos), responsavelSgp }
function criarApp(opcoes) {
  const { repositorio, usuarios = null, cronograma, criarSgp, modoDemo = false, cookieSeguro = false, atrasDeProxy = false, criarOcorrenciaSgp = null, comentarOcorrenciaSgp = null, anexarOcorrenciaSgp = null, printObrigatorio = false, responsavelSgp = '', supervisorSgp = '', nomes = {} } = opcoes;
  // Nome de quem é marcado, para a saudação do comentário (ex.: { admin: 'Lucas', jessica_rasteiro: 'Jéssica' }).
  const nomeDe = (username) => nomes[username] || '';
  // Pessoas que a tela oferece para marcar na ocorrência. Ninguém é marcado sem ser escolhido.
  const pessoas = [...new Set([...Object.keys(nomes), supervisorSgp, responsavelSgp, opcoes.responsavelOsSgp].filter(Boolean))]
    .map((username) => ({ username, nome: nomes[username] || username }));
  const marcadosDe = (corpo) => [...new Set((Array.isArray(corpo.marcar) ? corpo.marcar : []).map(String))].filter((u) => pessoas.some((p) => p.username === u)).slice(0, 6);
  const mensagemDe = (corpo) => (typeof corpo.mensagem === 'string' ? corpo.mensagem.trim().slice(0, 3000) : '');
  // Detalhe do processo para a ficha, com os dados do cliente vindos do SGP (se já sincronizados).
  const detalhe = async (processo, dia) => {
    const dados = typeof repositorio.obterFicha === 'function' ? await repositorio.obterFicha(processo.cliente.contrato) : null;
    const anexos = typeof repositorio.listarAnexos === 'function' ? await repositorio.listarAnexos(processo.id) : [];
    return { ...visao.detalheProcesso(processo, dia, cronograma), dadosCliente: dados, anexos, modelos: modelosDoProcesso(processo, { cronograma, hoje: dia }) };
  };
  // Print do aviso na ocorrência do SGP (melhor esforço, na mesma fila dos comentários).
  const enviarPrint = (processo, anexoId, print, descricao) => {
    if (!anexarOcorrenciaSgp || !processo.ocorrencia || !processo.ocorrencia.numero) return;
    const numero = processo.ocorrencia.numero;
    fila = fila.then(() => anexarOcorrenciaSgp({ numero, nome: print.nome, tipo: print.tipo, dados: print.dados, descricao }))
      .then(() => repositorio.marcarAnexoEnviado(anexoId, hojeISO()))
      .catch((erro) => console.error(`Print na ocorrência ${numero} falhou: ${erro.message}`));
  };
  // Comentário automático na ocorrência do contrato (melhor esforço: não atrasa nem quebra a ação na tela).
  // Os comentários de um mesmo processo saem em ordem (fim de etapa antes do início da próxima).
  let fila = Promise.resolve();
  const comentar = (processo, evento) => {
    // Depois de qualquer ação, confere avisos pendentes (ex.: OS de retirada que acabou de ficar para hoje).
    if (typeof opcoes.aposAcao === 'function') Promise.resolve().then(opcoes.aposAcao).catch(() => {});
    if (!comentarOcorrenciaSgp || !processo.ocorrencia || !processo.ocorrencia.numero) return;
    const marcar = (evento.marcar || []).filter(Boolean); // só quem a pessoa escolheu
    const contexto = { processo, hoje: hoje(), nomeDestinatario: nomeDe(marcar[0]) };
    const html = htmlComentario(evento, contexto);
    const texto = textoComentario(evento, contexto);
    const numero = processo.ocorrencia.numero;
    fila = fila.then(() => comentarOcorrenciaSgp({ numero, html, texto, marcar }))
      .catch((erro) => console.error(`Comentário na ocorrência ${numero} falhou: ${erro.message}`));
  };
  // Mudou de etapa: avisa o supervisor (fim da etapa) e a responsável (início da próxima).
  // mensagem: texto próprio que a pessoa escreveu para o supervisor (substitui o automático).
  const avisarTrocaDeEtapa = (processo, { etapaAnteriorId, tarefa, por, mensagem, marcar = [] }) => {
    const anterior = obterEtapa(cronograma, etapaAnteriorId);
    const nova = processo.etapaAtual ? obterEtapa(cronograma, processo.etapaAtual) : null;
    const avisos = processo.tarefas.filter((t) => t.etapa === anterior.id && t.tipo === 'contato' && t.status === 'concluida');
    const datas = avisos.map((t) => String(t.concluidaEm || '').split('-').reverse().slice(0, 2).join('/'));
    comentar(processo, {
      tipo: 'fim-etapa', etapa: anterior.nome, etapaTipo: anterior.tipo, contatos: avisos.length,
      datasAvisos: datas.length > 1 ? `${datas.slice(0, -1).join(', ')} e ${datas[datas.length - 1]}` : datas[0],
      acoes: anterior.tipo === 'acao' ? anterior.acoes : null,
      resposta: tarefa.resposta, proximaEtapa: nova ? nova.nome : null, resultado: processo.resultado,
      por, data: hoje(), observacao: tarefa.observacao,
      mensagem, titulo: `Etapa encerrada: ${anterior.nome}`,
      marcar,
    });
    // Esperando o supervisor: o início da próxima etapa só é comentado quando ele autorizar.
    if (nova && !bloqueada(processo)) comentarInicioDaEtapa(processo, por);
  };
  const comentarInicioDaEtapa = (processo, por) => {
    const nova = processo.etapaAtual ? obterEtapa(cronograma, processo.etapaAtual) : null;
    if (!nova) return;
    const afazer = processo.tarefas.filter((t) => t.etapa === nova.id && t.status === 'pendente');
    comentar(processo, { tipo: 'inicio-etapa', etapa: nova.nome, tarefas: afazer, por, data: hoje(), marcar: [] });
  };
  // A leitura automática (servidor) achou "autorizado": comenta o início da etapa para a Jéssica.
  if (typeof opcoes.registrarAoAutorizar === 'function') {
    opcoes.registrarAoAutorizar((processo) => {
      if (processo.autorizacao && processo.autorizacao.status === 'autorizado') comentarInicioDaEtapa(processo, 'sistema');
    });
  }
  // Regra do Pendente: encerrar uma etapa com "não regularizou" só depois que a Jéssica colocar
  // a ocorrência como Pendente no SGP. O sistema confere o status na hora e explica o que falta.
  const NOMES_STATUS = { 0: 'Aberta', 1: 'Encerrada', 2: 'Em execução', 3: 'Pendente' };
  const conferirPendente = async (tarefaId) => {
    if (typeof opcoes.statusOcorrenciaSgp !== 'function') return;
    const processo = await repositorio.obterPorTarefa(tarefaId);
    const tarefa = processo && processo.tarefas.find((t) => t.id === tarefaId);
    // Só a pergunta "regularizou?" que encerra a etapa (promessa não cumprida volta aos avisos da mesma etapa).
    if (!tarefa || tarefa.tipo !== 'decisao' || tarefa.status !== 'pendente' || tarefa.promessa) return;
    if (!processo.ocorrencia || !processo.ocorrencia.numero) return; // sem ocorrência ligada não há o que conferir
    let status;
    try {
      status = await opcoes.statusOcorrenciaSgp(processo.ocorrencia.numero);
    } catch {
      throw new ErroHttp(503, `Não consegui conferir no SGP se a ocorrência ${processo.ocorrencia.numero} está Pendente. Tente de novo em instantes.`);
    }
    if (status === 3) return;
    const agora = status == null ? 'não encontrei a ocorrência no SGP' : `ela ainda está ${NOMES_STATUS[status] || `com status ${status}`}`;
    throw new ErroHttp(409, `Para encerrar essa etapa, coloque a ocorrência ${processo.ocorrencia.numero} como Pendente no SGP. Verifiquei agora e ${agora}.`);
  };
  const hoje = () => hojeISO();
  const agora = opcoes.agora || (() => new Date().toISOString()); // hora do registro (testes podem fixar)
  const limitador = criarLimitador();
  const sincronizador = opcoes.sincronizador || criarSincronizador({
    executar: (dia) => servico.sincronizarTudo({ sgp: criarSgp(dia), repositorio, cronograma, hoje: dia }),
    hoje: hojeISO,
  });
  const ipDe = (req) => (atrasDeProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
  const cookieSessao = (valor, segundos) =>
    `${COOKIE}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${segundos}${cookieSeguro ? '; Secure' : ''}`;

  return async function app(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let m;
    try {
      if (url.pathname === '/saude') return responderJson(res, 200, { ok: true });

      // ----- Login -----
      if (usuarios && req.method === 'POST' && url.pathname === '/api/login') {
        const ip = ipDe(req);
        if (limitador.bloqueado(ip)) throw new ErroHttp(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
        const corpo = await lerCorpo(req);
        const usuario = await usuarios.autenticar(corpo.login, corpo.senha);
        if (!usuario) {
          limitador.falhou(ip);
          throw new ErroHttp(401, 'Login ou senha incorretos.');
        }
        limitador.limpar(ip);
        const { token, segundos } = await usuarios.criarSessao(usuario.id);
        return responderJson(res, 200, { nome: usuario.nome }, { 'Set-Cookie': cookieSessao(token, segundos) });
      }

      const usuario = usuarios ? await usuarios.usuarioDaSessao(lerCookie(req, COOKIE)) : null;

      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') throw new ErroHttp(405, 'Método não permitido.');
        if (usuarios && !usuario && !PUBLICOS_SEM_LOGIN.has(url.pathname)) return redirecionar(res, '/login.html');
        if (usuarios && usuario && url.pathname === '/login.html') return redirecionar(res, '/');
        return servirArquivo(res, url.pathname);
      }

      if (usuarios && !usuario) throw new ErroHttp(401, 'Sessão expirada. Entre de novo.');

      // ----- API -----
      if (req.method === 'POST' && url.pathname === '/api/sair') {
        await usuarios?.encerrarSessao(lerCookie(req, COOKIE));
        return responderJson(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao('', 0) });
      }
      if (req.method === 'GET' && url.pathname === '/api/eu') {
        return responderJson(res, 200, { comLogin: Boolean(usuarios), nome: usuario ? usuario.nome : null, login: usuario ? usuario.login : null, criarOcorrencia: Boolean(criarOcorrenciaSgp), printObrigatorio: Boolean(printObrigatorio), pessoas });
      }
      // Imagem de um print guardado (só tipos de imagem conhecidos, nunca HTML).
      if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/anexos\/(\d+)$/))) {
        const anexo = typeof repositorio.obterAnexo === 'function' ? await repositorio.obterAnexo(m[1]) : null;
        if (!anexo || !/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(anexo.tipo)) throw new ErroHttp(404, 'Arquivo não encontrado.');
        res.writeHead(200, { ...SEGURANCA, 'Content-Type': anexo.tipo, 'Content-Length': anexo.dados.length, 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': `inline; filename="${anexo.nome.replace(/"/g, '')}"` });
        return res.end(anexo.dados);
      }
      // Cria no SGP a ocorrência da tarefa "Abrir ocorrência ... no SGP" (GRAVA no SGP).
      if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/tarefas\/(\d+\.\d+)\/ocorrencia$/))) {
        if (!criarOcorrenciaSgp) throw new ErroHttp(403, 'Criar ocorrência pelo sistema está desligado (SGP_CRIAR_OCORRENCIA).');
        const corpo = await lerCorpo(req);
        try {
          const { processo, protocolo, aviso } = await servico.criarOcorrenciaDaTarefa({
            repositorio,
            cronograma,
            tarefaId: m[1],
            conteudo: typeof corpo.conteudo === 'string' ? corpo.conteudo.slice(0, 2000) : '',
            por: usuario ? usuario.nome : (typeof corpo.por === 'string' ? corpo.por.trim().slice(0, 80) : undefined),
            data: hojeISO(),
            criar: (dados) => criarOcorrenciaSgp({ ...dados, usuarioSgp: usuario && usuario.sgpLogin ? usuario.sgpLogin : null, por: usuario ? usuario.nome : corpo.por }),
          });
          return responderJson(res, 200, { protocolo, aviso, detalhe: await detalhe(processo, hojeISO()) });
        } catch (erro) {
          console.error(`Criar ocorrência (tarefa ${m[1]}): ${erro.message}`);
          throw new ErroHttp(400, erro.message);
        }
      }
      if (usuarios && req.method === 'POST' && url.pathname === '/api/senha') {
        const corpo = await lerCorpo(req);
        try {
          await usuarios.trocarSenha(usuario.id, corpo.senhaAtual, corpo.novaSenha);
        } catch (erro) {
          throw new ErroHttp(400, erro.message);
        }
        return responderJson(res, 200, { ok: true });
      }

      // Simular outro dia só é permitido no modo demonstração.
      const dataParam = url.searchParams.get('data');
      if (dataParam && !/^\d{4}-\d{2}-\d{2}$/.test(dataParam)) throw new ErroHttp(400, 'Data inválida.');
      const hoje = modoDemo && dataParam ? dataParam : hojeISO();

      if (req.method === 'GET' && url.pathname === '/api/painel') {
        return responderJson(res, 200, { ...visao.painel(await repositorio.listar(), hoje, cronograma), modoDemo, hojeReal: hojeISO() });
      }
      if (req.method === 'GET' && url.pathname === '/api/agenda') {
        const dia = url.searchParams.get('dia');
        if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new ErroHttp(400, 'Informe o dia (AAAA-MM-DD).');
        return responderJson(res, 200, { dia, hoje, clientes: visao.agendaDoDia(await repositorio.listar(), dia, hoje, cronograma) });
      }
      if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/processos\/(\d+)\/ajustar$/))) {
        const corpo = await lerCorpo(req);
        const processo = await repositorio.obter(m[1]);
        if (!processo) throw new ErroHttp(404, 'Processo não encontrado.');
        try {
          const dadosAjuste = {
            etapaId: String(corpo.etapa || ''),
            contatosFeitos: Number(corpo.contatosFeitos || 0),
            dataReferencia: corpo.dataReferencia || undefined,
            observacao: typeof corpo.observacao === 'string' ? corpo.observacao.trim().slice(0, 1000) : undefined,
            por: usuario ? usuario.nome : (typeof corpo.por === 'string' ? corpo.por.trim().slice(0, 80) : undefined),
            data: hoje,
          };
          posicionar(processo, dadosAjuste, cronograma);
          await repositorio.salvarProcesso(processo);
          comentar(processo, { tipo: 'ajuste', etapa: obterEtapa(cronograma, dadosAjuste.etapaId).nome, por: dadosAjuste.por, data: hoje, observacao: dadosAjuste.observacao });
        } catch (erro) {
          if (erro instanceof ErroConflito) throw new ErroHttp(409, erro.message);
          throw new ErroHttp(400, erro.message);
        }
        return responderJson(res, 200, await detalhe(processo, hoje));
      }
      // Autorização do supervisor: a Jéssica confirma (autorizado/negado), pede de novo ou marca o aviso como visto.
      if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/processos\/(\d+)\/autorizacao$/))) {
        const corpo = await lerCorpo(req);
        const processo = await repositorio.obter(m[1]);
        if (!processo) throw new ErroHttp(404, 'Processo não encontrado.');
        if (!processo.autorizacao) throw new ErroHttp(400, 'Este cliente não está aguardando autorização.');
        const por = usuario ? usuario.nome : (typeof corpo.por === 'string' ? corpo.por.trim().slice(0, 80) : '');
        if (!por) throw new ErroHttp(400, 'Informe quem está registrando.');
        const observacao = typeof corpo.observacao === 'string' ? corpo.observacao.trim().slice(0, 1000) : '';
        const antes = processo.autorizacao.status;
        if (corpo.acao === 'autorizar' || corpo.acao === 'negar') {
          aplicarResposta(processo, { status: corpo.acao === 'autorizar' ? 'autorizado' : 'negado', texto: observacao || undefined, por, origem: por }, cronograma, hoje);
        } else if (corpo.acao === 'pedir') {
          pedirDeNovo(processo, { por, data: hoje });
        } else if (corpo.acao === 'visto') {
          processo.autorizacao.visto = true;
        } else {
          throw new ErroHttp(400, 'Ação de autorização inválida.');
        }
        try {
          await repositorio.salvarProcesso(processo);
        } catch (erro) {
          if (erro instanceof ErroConflito) throw new ErroHttp(409, erro.message);
          throw erro;
        }
        if (corpo.acao === 'autorizar' && antes !== 'autorizado') comentarInicioDaEtapa(processo, por);
        if (corpo.acao === 'pedir') {
          comentar(processo, { tipo: 'aviso', titulo: 'Pedido de autorização', texto: `${observacao ? `${observacao} ` : ''}Posso dar continuidade? A próxima etapa só começa depois da sua resposta aqui na ocorrência.`, mensagem: mensagemDe(corpo), por, data: hoje, marcar: marcadosDe(corpo) });
        }
        return responderJson(res, 200, await detalhe(processo, hoje));
      }
      // Anotação livre do financeiro: fica no histórico e vai para a ocorrência sem marcar ninguém.
      if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/processos\/(\d+)\/registro$/))) {
        const corpo = await lerCorpo(req);
        const processo = await repositorio.obter(m[1]);
        if (!processo) throw new ErroHttp(404, 'Processo não encontrado.');
        const texto = typeof corpo.texto === 'string' ? corpo.texto.trim().slice(0, 3000) : '';
        if (texto.length < 3) throw new ErroHttp(400, 'Escreva o que quer registrar.');
        const por = usuario ? usuario.nome : (typeof corpo.por === 'string' ? corpo.por.trim().slice(0, 80) : '');
        if (!por) throw new ErroHttp(400, 'Informe quem está registrando.');
        registrar(processo, { data: hoje, por, evento: 'registro', detalhes: texto });
        try {
          await repositorio.salvarProcesso(processo);
        } catch (erro) {
          if (erro instanceof ErroConflito) throw new ErroHttp(409, erro.message);
          throw erro;
        }
        comentar(processo, { tipo: 'registro', titulo: 'Registro do financeiro', texto, por, data: hoje, marcar: marcadosDe(corpo) });
        return responderJson(res, 200, await detalhe(processo, hoje));
      }
      if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/processos\/(\d+)\/promessa$/))) {
        const corpo = await lerCorpo(req);
        const processo = await repositorio.obter(m[1]);
        if (!processo) throw new ErroHttp(404, 'Processo não encontrado.');
        try {
          const dadosPromessa = {
            dataPromessa: String(corpo.dataPromessa || ''),
            observacao: typeof corpo.observacao === 'string' ? corpo.observacao.trim().slice(0, 1000) : undefined,
            por: usuario ? usuario.nome : (typeof corpo.por === 'string' ? corpo.por.trim().slice(0, 80) : undefined),
            data: hoje,
          };
          registrarPromessa(processo, dadosPromessa, cronograma);
          await repositorio.salvarProcesso(processo);
          comentar(processo, { tipo: 'promessa', ...dadosPromessa, mensagem: mensagemDe(corpo), titulo: 'Promessa de pagamento', marcar: marcadosDe(corpo) });
        } catch (erro) {
          if (erro instanceof ErroConflito) throw new ErroHttp(409, erro.message);
          throw new ErroHttp(400, erro.message);
        }
        return responderJson(res, 200, await detalhe(processo, hoje));
      }
      if (req.method === 'GET' && url.pathname === '/api/processos') {
        return responderJson(res, 200, { hoje, fases: cronograma.fases, etapas: visao.mapaEtapas(cronograma), processos: visao.listaProcessos(await repositorio.listar(), hoje, cronograma) });
      }
      if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/processos\/(\d+)$/))) {
        const processo = await repositorio.obter(m[1]);
        if (!processo) throw new ErroHttp(404, 'Processo não encontrado.');
        return responderJson(res, 200, await detalhe(processo, hoje));
      }
      // Sincronizar só dispara, em segundo plano (a leitura do SGP pode levar minutos);
      // a tela acompanha pelo GET /api/sincronizacao.
      if (req.method === 'POST' && url.pathname === '/api/sincronizar') {
        await lerCorpo(req);
        sincronizador.rodar(usuario ? `manual (${usuario.nome})` : 'manual', modoDemo && dataParam ? hoje : null);
        return responderJson(res, 202, sincronizador.status());
      }
      if (req.method === 'GET' && url.pathname === '/api/sincronizacao') {
        return responderJson(res, 200, sincronizador.status());
      }
      // Aviso em dois passos: "Enviei" e, depois, "Teve retorno?" a cada X horas.
      if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/tarefas\/(\d+\.\d+)\/(enviado|retorno)$/))) {
        const corpo = await lerCorpo(req);
        const por = usuario ? usuario.nome : (typeof corpo.por === 'string' ? corpo.por.trim().slice(0, 80) : '');
        const processo = await repositorio.obterPorTarefa(m[1]);
        if (!processo) throw new ErroHttp(404, `Tarefa ${m[1]} não encontrada.`);
        const momento = agora();
        try {
          if (m[2] === 'enviado') {
            marcarEnviado(processo, m[1], { por, agora: momento, data: hoje }, cronograma);
          } else {
            const tarefa = registrarChecagem(processo, m[1], { por, agora: momento, data: hoje, resultado: corpo.resultado, texto: corpo.texto }, cronograma);
            await repositorio.salvarProcesso(processo);
            if (corpo.resultado === 'retorno') {
              comentar(processo, { tipo: 'registro', titulo: `Retorno do cliente: ${tarefa.descricao}`, texto: tarefa.retorno.checagens.at(-1).texto, por, data: hoje, marcar: marcadosDe(corpo) });
            }
            return responderJson(res, 200, await detalhe(processo, hoje));
          }
          await repositorio.salvarProcesso(processo);
          return responderJson(res, 200, await detalhe(processo, hoje));
        } catch (erro) {
          if (erro instanceof ErroConflito) throw new ErroHttp(409, erro.message);
          if (erro.status) throw erro;
          throw new ErroHttp(400, erro.message);
        }
      }
      if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/tarefas\/(\d+\.\d+)\/concluir$/))) {
        const corpo = await lerCorpo(req, 6_000_000); // cabe o print do aviso (até 4 MB em base64)
        const texto = (v, max = 1000) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
        if (corpo.resposta === 'nao') await conferirPendente(m[1]);
        // Print do aviso: obrigatório para marcar um aviso (contato) como feito, quando ligado.
        let print = null;
        if (corpo.print) {
          try { print = lerPrint(corpo.print); } catch (erro) { throw new ErroHttp(400, erro.message); }
        } else if (printObrigatorio) {
          const p = await repositorio.obterPorTarefa(m[1]);
          const t = p && p.tarefas.find((x) => x.id === m[1]);
          if (t && t.tipo === 'contato' && t.status === 'pendente') throw new ErroHttp(400, 'Anexe o print do aviso para marcar como feito.');
        }
        if (!print) {
          // Ações que exigem arquivo (ex.: negativar, retirar a negativação): sem anexo não fica feita.
          const p = await repositorio.obterPorTarefa(m[1]);
          const t = p && p.tarefas.find((x) => x.id === m[1]);
          const e = t && cronograma.etapas.find((x) => x.id === t.etapa);
          if (t && t.status === 'pendente' && e && (e.anexoObrigatorio || []).includes(t.descricao)) throw new ErroHttp(400, `Anexe o arquivo (print ou PDF) de "${t.descricao}" para marcar como feito.`);
        }
        // Registro de tentativas de contato (ligação, mensagem, e-mail...): fica na tarefa e vai para a
        // ocorrência só como registro, sem marcar ninguém.
        const registro = corpo.registro === true;
        try {
          const { processo, tarefa } = await servico.concluir({
            repositorio,
            cronograma,
            tarefaId: m[1],
            // Com login, o nome vem da sessão (ninguém registra em nome de outra pessoa).
            por: usuario ? usuario.nome : texto(corpo.por),
            observacao: texto(corpo.observacao, registro ? 3000 : 1000),
            resposta: corpo.resposta,
            data: hoje,
          });
          const trocouEtapa = processo.etapaAtual !== tarefa.etapa;
          const mensagem = mensagemDe(corpo);
          const marcar = marcadosDe(corpo);
          const eventoTarefa = registro && tarefa.tipo !== 'decisao' && tarefa.observacao
            ? { tipo: 'registro', titulo: `Registro: ${tarefa.descricao}`, texto: tarefa.observacao, por: tarefa.concluidaPor, data: hoje, marcar }
            : { tipo: 'tarefa', tarefa, por: tarefa.concluidaPor, data: hoje, observacao: tarefa.observacao, mensagem, titulo: tarefa.descricao, marcar };
          if (trocouEtapa) {
            // "Não regularizou" e há próxima etapa: espera a autorização do supervisor antes de começar.
            if (opcoes.exigirAutorizacao && tarefa.resposta === 'nao' && processo.status === 'ativo' && processo.etapaAtual) {
              pedirAutorizacao(processo, { etapaAnterior: tarefa.etapa, etapa: processo.etapaAtual, data: hoje, por: tarefa.concluidaPor });
              await repositorio.salvarProcesso(processo);
            }
            // Fim de etapa: comentário para o supervisor (Lucas) e, se houver, início da próxima para a Jéssica.
            // Com mensagem escrita, ela vai uma vez só, no comentário de fim da etapa.
            if (tarefa.tipo !== 'decisao' && (!mensagem || registro)) comentar(processo, registro ? eventoTarefa : { ...eventoTarefa, marcar: [] });
            avisarTrocaDeEtapa(processo, { etapaAnteriorId: tarefa.etapa, tarefa, por: tarefa.concluidaPor, mensagem: registro ? '' : mensagem, marcar: registro ? [] : marcar });
          } else {
            comentar(processo, tarefa.tipo === 'decisao'
              ? { tipo: 'decisao', resposta: tarefa.resposta, promessa: Boolean(tarefa.promessa), por: tarefa.concluidaPor, data: hoje, observacao: tarefa.observacao, mensagem, marcar, titulo: tarefa.resposta === 'sim' ? 'Cliente regularizado' : 'Atualização do cliente' }
              : eventoTarefa);
          }
          if (print && typeof repositorio.salvarAnexo === 'function') {
            const anexoId = await repositorio.salvarAnexo({ processoId: processo.id, tarefaId: tarefa.id, ...print, em: hoje, por: tarefa.concluidaPor });
            enviarPrint(processo, anexoId, print, `${print.tipo === 'application/pdf' ? 'Arquivo' : 'Print'}: ${tarefa.descricao}`);
          }
          return responderJson(res, 200, await detalhe(processo, hoje));
        } catch (erro) {
          if (erro instanceof ErroConflito) throw new ErroHttp(409, erro.message);
          if (erro.status) throw erro;
          if (/não encontrad|já está|finalizado|Responda|Explique|Informe/.test(erro.message)) throw new ErroHttp(400, erro.message);
          throw erro;
        }
      }
      throw new ErroHttp(404, 'Rota não encontrada.');
    } catch (erro) {
      const status = erro.status || 500;
      if (status === 500) console.error(erro);
      return responderJson(res, status, { erro: status === 500 ? 'Erro interno no servidor.' : erro.message });
    }
  };
}

module.exports = { criarApp };
