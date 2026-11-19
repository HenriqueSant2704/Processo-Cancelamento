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

  // Anexo (print) na ocorrência pela tela do SGP:
  //   GET  {origem}/admin/atendimento/ocorrencia/{id}/anexo/add/  -> pega o dpb_token (evita envio duplicado)
  //   POST a mesma página, multipart, no formato de "formset" do SGP (lido no formulário em 19/11/2026):
  //     anexos-TOTAL_FORMS, anexos-INITIAL_FORMS=0, anexos-MIN_NUM_FORMS=0, anexos-MAX_NUM_FORMS=1000,
  //     anexos-N-id (vazio), anexos-N-arquivo (arquivo), anexos-N-descricao (até 200), anexos-N-observacao
  //   Sucesso = 302 para fora do /anexo/add/. Vários arquivos vão num envio só.
  // arquivos: [{ nome, tipo, dados (Buffer), descricao }]. Aceita também um arquivo solto (formato antigo).
  async function anexar({ ocorrenciaId, arquivos, nome, tipo, dados, descricao = '' }) {
    const lista = Array.isArray(arquivos) && arquivos.length ? arquivos : [{ nome, tipo, dados, descricao }];
    const pagina = `${origem}/admin/atendimento/ocorrencia/${encodeURIComponent(ocorrenciaId)}/anexo/add/`;
    const cabecalhos = () => ({ Cookie: cabecalhoCookie(cookies), Referer: pagina, Origin: origem });
    const redirecionouPara = (r) => String(r.headers.get('location') || '');
    const conferirBloqueio = (destino) => {
      if (/password_change/.test(destino)) throw new ErroSgp('O SGP está pedindo para trocar a senha do usuário da integração. Entre no SGP com ele e troque a senha.');
      if (/\/403\//.test(destino)) throw new ErroSgp(`O usuário da integração não tem permissão para anexar no SGP (${decodeURIComponent(destino.split('perm_name=')[1] || 'atendimento')}).`);
    };
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      if (!logado) await entrar();
      const formulario = await buscar(pagina, { redirect: 'manual', headers: cabecalhos(), signal: AbortSignal.timeout(tempoLimiteMs) });
      lerCookies(formulario, cookies);
      conferirBloqueio(redirecionouPara(formulario));
      if (formulario.status !== 200) { if (tentativa === 1) { logado = false; continue; } throw new ErroSgp(`Não consegui abrir o formulário de anexo do SGP (HTTP ${formulario.status}).`); }
      const html = await formulario.text();
      const dpb = (html.match(/name=['"]dpb_token['"]\s+value=['"]([^'"]+)['"]/) || [])[1] || '';
      const form = new FormData();
      form.append('csrfmiddlewaretoken', cookies.get('csrftoken') || '');
      if (dpb) form.append('dpb_token', dpb);
      form.append('anexos-TOTAL_FORMS', String(lista.length));
      form.append('anexos-INITIAL_FORMS', '0');
      form.append('anexos-MIN_NUM_FORMS', '0');
      form.append('anexos-MAX_NUM_FORMS', '1000');
      lista.forEach((a, i) => {
        form.append(`anexos-${i}-id`, '');
        form.append(`anexos-${i}-arquivo`, new Blob([a.dados], { type: a.tipo }), a.nome);
        form.append(`anexos-${i}-descricao`, String(a.descricao || '').slice(0, 200));
        form.append(`anexos-${i}-observacao`, '');
      });
      const r = await buscar(pagina, {
        method: 'POST',
        redirect: 'manual',
        headers: { ...cabecalhos(), 'X-CSRFToken': cookies.get('csrftoken') || '' },
        body: form,
        signal: AbortSignal.timeout(tempoLimiteMs),
      });
      lerCookies(r, cookies);
      const destino = redirecionouPara(r);
      conferirBloqueio(destino);
      if ((/accounts\/login/.test(destino) || r.status === 403) && tentativa === 1) { logado = false; continue; }
      if (r.status === 302 && destino && !/anexo\/add/.test(destino) && !/accounts\/login/.test(destino)) return { ok: true, enviados: lista.length };
      throw new ErroSgp(`O SGP não aceitou o anexo (HTTP ${r.status}).`);
    }
    throw new ErroSgp('O SGP não aceitou o anexo mesmo após entrar de novo.');
  }

  // Quem pode ser marcado ("Usuários notificados") na tela da ocorrência: Map username -> ID.
  // É a lista completa do SGP (inclui o admin, que não aparece nos setores da API).
  async function usuariosNotificaveis(ocorrenciaId) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      if (!logado) await entrar();
      const r = await buscar(`${origem}/admin/atendimento/ocorrencia/${encodeURIComponent(ocorrenciaId)}/edit/`, { redirect: 'manual', headers: { Cookie: cabecalhoCookie(cookies) }, signal: AbortSignal.timeout(tempoLimiteMs) });
      lerCookies(r, cookies);
      if (r.status !== 200) { if (tentativa === 1) { logado = false; continue; } return new Map(); }
      const html = await r.text();
      const mapa = new Map();
      for (const m of html.matchAll(/<option[^>]*value=["']usuario_(d+)["'][^>]*>s*(?:Usu[aá]rio:s*)?([^<s]+)/g)) mapa.set(m[2].toLowerCase(), Number(m[1]));
      return mapa;
    }
    return new Map();
  }

  return { comentar, anexar, entrar, usuariosNotificaveis };
}

module.exports = { criarSessaoWeb };
