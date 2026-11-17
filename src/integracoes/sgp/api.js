// Leitura dos clientes do SGP pela rota URA de clientes.
//   POST <SGP_URA_CLIENTES_URL>   corpo JSON { app, token, offset, limit }
//   resposta { clientes: [...], paginacao: { total, offset, limit } }
//
// Cuidados:
// - só lê, nunca altera nada no SGP;
// - nunca escreve token, app ou a resposta bruta em log ou mensagem de erro;
// - 100 clientes por página, até 3 tentativas por página e tempo limite por pedido;
// - se qualquer página falhar ou vier fora do formato, a leitura inteira é descartada.

class ErroSgp extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroSgp';
  }
}

const PADROES = { tamanhoPagina: 100, maximoPaginas: 300, tentativas: 3, tempoLimiteMs: 60_000, esperasMs: [2_000, 5_000] };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function criarApiSgp({ url, app, token, buscar = fetch, esperar = dormir, ...opcoes }) {
  const cfg = { ...PADROES, ...opcoes };
  const faltando = [!url && 'SGP_URA_CLIENTES_URL', !app && 'SGP_APP', !token && 'SGP_TOKEN'].filter(Boolean);
  if (faltando.length) throw new ErroSgp(`Integração com o SGP não configurada. Falta no .env: ${faltando.join(', ')}.`);

  async function pedir(offset) {
    let resposta;
    try {
      resposta = await buscar(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ app, token, offset, limit: cfg.tamanhoPagina }),
        signal: AbortSignal.timeout(cfg.tempoLimiteMs),
      });
    } catch (erro) {
      const tempo = erro && (erro.name === 'TimeoutError' || erro.name === 'AbortError');
      throw new ErroSgp(tempo ? 'O SGP demorou demais para responder.' : 'Não foi possível conectar ao SGP.');
    }
    if (resposta.status === 401 || resposta.status === 403) throw new ErroSgp(`O SGP recusou o acesso (HTTP ${resposta.status}). Confira SGP_APP e SGP_TOKEN.`);
    if (!resposta.ok) throw new ErroSgp(`O SGP respondeu com erro (HTTP ${resposta.status}).`);
    let dados;
    try {
      dados = await resposta.json();
    } catch {
      throw new ErroSgp('O SGP respondeu algo que não é JSON.');
    }
    if (!ehObjeto(dados) || !Array.isArray(dados.clientes)) throw new ErroSgp('O SGP respondeu num formato inesperado.');
    return { clientes: dados.clientes, paginacao: ehObjeto(dados.paginacao) ? dados.paginacao : {} };
  }

  async function pagina(offset) {
    let ultimoErro;
    for (let tentativa = 1; tentativa <= cfg.tentativas; tentativa++) {
      try {
        return await pedir(offset);
      } catch (erro) {
        ultimoErro = erro instanceof ErroSgp ? erro : new ErroSgp('Falha inesperada ao ler o SGP.');
        if (/recusou o acesso/.test(ultimoErro.message)) break; // token errado não melhora tentando de novo
        if (tentativa < cfg.tentativas) await esperar(cfg.esperasMs[tentativa - 1] ?? 5_000);
      }
    }
    throw ultimoErro;
  }

  // Lê todas as páginas e devolve a lista bruta de clientes.
  async function lerTodosClientes() {
    const clientes = [];
    let offset = 0;
    for (let paginas = 1; ; paginas++) {
      if (paginas > cfg.maximoPaginas) throw new ErroSgp(`A leitura passou de ${cfg.maximoPaginas} páginas e foi interrompida.`);
      const lida = await pagina(offset);
      clientes.push(...lida.clientes);
      const total = Number(lida.paginacao.total);
      if (!lida.clientes.length || (Number.isFinite(total) && clientes.length >= total)) return { clientes, paginas };
      offset += lida.clientes.length;
    }
  }

  return { lerTodosClientes };
}

module.exports = { criarApiSgp, ErroSgp };
