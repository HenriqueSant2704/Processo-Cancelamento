// Servidor web (sem dependências, só o módulo http do Node):
// entrega a tela (pasta publico/) e a API em JSON usada por ela.
const fs = require('node:fs');
const path = require('node:path');
const { RepositorioJson } = require('../processos/repositorio');
const servico = require('../processos/servico');
const { hojeISO } = require('../utils/datas');
const visao = require('./visao');

const PUBLICO = path.join(__dirname, 'publico');
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function responderJson(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
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

function servirArquivo(res, caminhoUrl) {
  const relativo = caminhoUrl === '/' ? 'index.html' : decodeURIComponent(caminhoUrl).replace(/^\/+/, '');
  const arquivo = path.resolve(PUBLICO, relativo);
  if (!arquivo.startsWith(PUBLICO + path.sep) || !fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
    return;
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' });
  fs.createReadStream(arquivo).pipe(res);
}

// opcoes: { arquivoDados, cronograma, criarSgp(hoje), modoDemo }
function criarApp(opcoes) {
  const { arquivoDados, cronograma, criarSgp, modoDemo = false } = opcoes;

  return async function app(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') throw new ErroHttp(405, 'Método não permitido.');
        return servirArquivo(res, url.pathname);
      }

      const dataParam = url.searchParams.get('data');
      if (dataParam && !/^\d{4}-\d{2}-\d{2}$/.test(dataParam)) throw new ErroHttp(400, 'Data inválida.');
      const hoje = dataParam || hojeISO();
      const repositorio = new RepositorioJson(arquivoDados);
      const rota = `${req.method} ${url.pathname}`;
      let m;

      if (rota === 'GET /api/painel') {
        return responderJson(res, 200, { ...visao.painel(repositorio.listar(), hoje, cronograma), modoDemo, hojeReal: hojeISO() });
      }
      if (rota === 'GET /api/processos') {
        return responderJson(res, 200, { hoje, fases: cronograma.fases, processos: visao.listaProcessos(repositorio.listar(), hoje, cronograma) });
      }
      if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/processos\/(\d+)$/))) {
        const processo = repositorio.obter(m[1]);
        if (!processo) throw new ErroHttp(404, 'Processo não encontrado.');
        return responderJson(res, 200, visao.detalheProcesso(processo, hoje, cronograma));
      }
      if (rota === 'POST /api/sincronizar') {
        const { totalBloqueados, novos } = await servico.sincronizar({ sgp: criarSgp(hoje), repositorio, cronograma, hoje });
        return responderJson(res, 200, { totalBloqueados, novos: novos.map((p) => ({ id: p.id, nome: p.cliente.nome })) });
      }
      if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/tarefas\/(\d+\.\d+)\/concluir$/))) {
        const corpo = await lerCorpo(req);
        const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 1000) : undefined);
        try {
          const { processo } = servico.concluir({
            repositorio,
            cronograma,
            tarefaId: m[1],
            por: texto(corpo.por),
            observacao: texto(corpo.observacao),
            resposta: corpo.resposta,
            data: hoje,
          });
          return responderJson(res, 200, visao.detalheProcesso(processo, hoje, cronograma));
        } catch (erro) {
          throw new ErroHttp(400, erro.message);
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
