// Servidor web (só o módulo http do Node): entrega a tela (pasta publico/)
// e a API em JSON usada por ela. Quando há usuários (banco Neon), exige login.
const fs = require('node:fs');
const path = require('node:path');
const servico = require('../processos/servico');
const { ErroConflito } = require('../processos/repositorio');
const { hojeISO } = require('../utils/datas');
const visao = require('./visao');
const { posicionar } = require('../cronograma/motor');
const { criarSincronizador } = require('../processos/sincronizador');

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

function lerCorpo(req) {
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
      if (corpo.length > 20_000) reject(new ErroHttp(413, 'Requisição grande demais.'));
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
//           criarOcorrenciaSgp (null = botão "Criar no SGP" desligado) }
function criarApp(opcoes) {
  const { repositorio, usuarios = null, cronograma, criarSgp, modoDemo = false, cookieSeguro = false, atrasDeProxy = false, criarOcorrenciaSgp = null } = opcoes;
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
        return responderJson(res, 200, { comLogin: Boolean(usuarios), nome: usuario ? usuario.nome : null, login: usuario ? usuario.login : null, criarOcorrencia: Boolean(criarOcorrenciaSgp) });
      }
      // Cria no SGP a ocorrência da tarefa "Abrir ocorrência ... no SGP" (GRAVA no SGP).
      if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/tarefas\/(\d+\.\d+)\/ocorrencia$/))) {
        if (!criarOcorrenciaSgp) throw new ErroHttp(403, 'Criar ocorrência pelo sistema está desligado (SGP_CRIAR_OCORRENCIA).');
        const corpo = await lerCorpo(req);
        try {
          const { processo, protocolo } = await servico.criarOcorrenciaDaTarefa({
            repositorio,
            cronograma,
            tarefaId: m[1],
            conteudo: typeof corpo.conteudo === 'string' ? corpo.conteudo.slice(0, 2000) : '',
            por: usuario ? usuario.nome : (typeof corpo.por === 'string' ? corpo.por.trim().slice(0, 80) : undefined),
            data: hojeISO(),
            criar: criarOcorrenciaSgp,
          });
          return responderJson(res, 200, { protocolo, detalhe: visao.detalheProcesso(processo, hojeISO(), cronograma) });
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
          posicionar(processo, {
            etapaId: String(corpo.etapa || ''),
            contatosFeitos: Number(corpo.contatosFeitos || 0),
            dataReferencia: corpo.dataReferencia || undefined,
            observacao: typeof corpo.observacao === 'string' ? corpo.observacao.trim().slice(0, 1000) : undefined,
            por: usuario ? usuario.nome : (typeof corpo.por === 'string' ? corpo.por.trim().slice(0, 80) : undefined),
            data: hoje,
          }, cronograma);
          await repositorio.salvarProcesso(processo);
        } catch (erro) {
          if (erro instanceof ErroConflito) throw new ErroHttp(409, erro.message);
          throw new ErroHttp(400, erro.message);
        }
        return responderJson(res, 200, visao.detalheProcesso(processo, hoje, cronograma));
      }
      if (req.method === 'GET' && url.pathname === '/api/processos') {
        return responderJson(res, 200, { hoje, fases: cronograma.fases, etapas: visao.mapaEtapas(cronograma), processos: visao.listaProcessos(await repositorio.listar(), hoje, cronograma) });
      }
      if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/processos\/(\d+)$/))) {
        const processo = await repositorio.obter(m[1]);
        if (!processo) throw new ErroHttp(404, 'Processo não encontrado.');
        return responderJson(res, 200, visao.detalheProcesso(processo, hoje, cronograma));
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
      if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/tarefas\/(\d+\.\d+)\/concluir$/))) {
        const corpo = await lerCorpo(req);
        const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 1000) : undefined);
        try {
          const { processo } = await servico.concluir({
            repositorio,
            cronograma,
            tarefaId: m[1],
            // Com login, o nome vem da sessão (ninguém registra em nome de outra pessoa).
            por: usuario ? usuario.nome : texto(corpo.por),
            observacao: texto(corpo.observacao),
            resposta: corpo.resposta,
            data: hoje,
          });
          return responderJson(res, 200, visao.detalheProcesso(processo, hoje, cronograma));
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
