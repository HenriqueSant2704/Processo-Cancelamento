// Comentário na ocorrência pela rota da TELA do SGP, entrando com um usuário próprio da
// integração (a API com token não tem rota de comentário em ocorrência sem OS).
//   Login:      GET/POST {origem}/accounts/login/   (username, password, csrf do cookie)
//   Comentário: POST {origem}/crm/atendimento/ocorrencia/{id_ocorrencia}/comentario/
//               campos: comentario (HTML), publico=0, notificacao_usuarios (IDs dos usuários marcados)
// Usuário e senha vêm só do ambiente (SGP_USUARIO_INTEGRACAO / SGP_SENHA_INTEGRACAO).
// Nunca escreve senha, cookies ou tokens em log ou mensagem de erro.
const { ErroSgp } = require('./api');

function lerCookies(resposta, pote) {
  const lista = typeof resposta.headers.getSetCookie === 'function' ? resposta.headers.getSetCookie() : [];
  for (const c of lista) {
    const [par] = c.split(';');
    const i = par.indexOf('=');
    if (i > 0) pote.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
}
const cabecalhoCookie = (pote) => [...pote.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
const escaparHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function criarSessaoWeb({ origem, usuario, senha, buscar = fetch, tempoLimiteMs = 60_000 }) {
  if (!origem || !usuario || !senha) throw new ErroSgp('Usuário da integração com o SGP não configurado (SGP_USUARIO_INTEGRACAO / SGP_SENHA_INTEGRACAO).');
  const cookies = new Map();
  let logado = false;

  async function entrar() {
    cookies.clear();
    const pagina = await buscar(`${origem}/accounts/login/`, { redirect: 'manual', signal: AbortSignal.timeout(tempoLimiteMs) });
    lerCookies(pagina, cookies);
    const csrf = cookies.get('csrftoken');
    if (!csrf) throw new ErroSgp('Não consegui iniciar o login no SGP (sem token de segurança).');
    const r = await buscar(`${origem}/accounts/login/`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cabecalhoCookie(cookies), Referer: `${origem}/accounts/login/`, Origin: origem },
      body: new URLSearchParams({ username: usuario, password: senha, next: '/admin/', csrfmiddlewaretoken: csrf }),
      signal: AbortSignal.timeout(tempoLimiteMs),
    });
    lerCookies(r, cookies);
    if (!cookies.get('sessionid') || r.status === 200) throw new ErroSgp('O SGP recusou o login do usuário da integração. Confira usuário e senha.');
    logado = true;
  }

  // usuariosIds: IDs do SGP de quem deve ser marcado ("Usuários notificados").
  async function comentar({ ocorrenciaId, texto, html, usuariosIds = [] }) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      if (!logado) await entrar();
      const corpo = new URLSearchParams({ comentario: html || `<p>${escaparHtml(texto).replace(/\n/g, '<br>')}</p>`, publico: '0' });
      // Formato da tela: notificacao_usuarios=usuario_<ID> (um campo por pessoa marcada).
      for (const id of usuariosIds) corpo.append('notificacao_usuarios', `usuario_${id}`);
      const r = await buscar(`${origem}/crm/atendimento/ocorrencia/${encodeURIComponent(ocorrenciaId)}/comentario/`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': cookies.get('csrftoken') || '',
          Cookie: cabecalhoCookie(cookies),
          Referer: `${origem}/admin/atendimento/ocorrencia/${encodeURIComponent(ocorrenciaId)}/edit/`,
          Origin: origem,
        },
        body: corpo,
        signal: AbortSignal.timeout(tempoLimiteMs),
      });
      lerCookies(r, cookies);
      // Sessão expirada costuma voltar como redirecionamento para o login ou 403: entra de novo uma vez.
      if ((r.status === 302 || r.status === 403) && tentativa === 1) { logado = false; continue; }
      if (!r.ok) {
        let msg = '';
        try { msg = (await r.json()).error || ''; } catch { /* sem corpo */ }
        throw new ErroSgp(`O SGP não gravou o comentário (HTTP ${r.status}${msg ? `: ${msg}` : ''}).`);
      }
      const dados = await r.json().catch(() => ({}));
      return { comentarioId: dados.id || null, marcados: Array.isArray(dados.usuarios) ? dados.usuarios : [] };
    }
    throw new ErroSgp('O SGP não aceitou o comentário mesmo após entrar de novo.');
  }

  return { comentar, entrar };
}

module.exports = { criarSessaoWeb };
