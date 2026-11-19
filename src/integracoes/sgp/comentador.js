// Grava comentário na ocorrência do contrato no SGP, marcando pessoas ("Usuários notificados").
// Preferência: rota da tela com o usuário da integração (funciona com ou sem OS e marca de verdade).
// Sem usuário da integração configurado: tenta a rota da API pela OS da ocorrência (só se ela tiver OS).
const { criarApiOcorrencias, getComCorpo } = require('./ocorrencias');
const { criarSessaoWeb } = require('./sessaoWeb');

function criarComentador({ origem, app, token, usuarioIntegracao, senhaIntegracao }) {
  const oc = criarApiOcorrencias({ origem, app, token });
  const sessao = usuarioIntegracao && senhaIntegracao ? criarSessaoWeb({ origem, usuario: usuarioIntegracao, senha: senhaIntegracao }) : null;
  let mapaUsuarios = null; // username do SGP -> ID (lido dos setores, guardado em memória)

  async function idsDe(usernames) {
    const nomes = usernames.filter(Boolean);
    if (!nomes.length) return [];
    if (!mapaUsuarios) {
      mapaUsuarios = new Map();
      const r = await getComCorpo(`${origem}/api/os/ocorrencia/setor/list/`, { app, token }, 60_000);
      if (r.status === 200) {
        for (const setor of JSON.parse(r.texto)) for (const m of setor.membros || []) mapaUsuarios.set(String(m.username).toLowerCase(), m.id);
      }
    }
    return nomes.map((n) => mapaUsuarios.get(String(n).toLowerCase())).filter((id) => id != null);
  }

  // numero: número (protocolo) da ocorrência; marcar: usernames do SGP a notificar.
  async function comentar({ numero, texto, html, marcar = [] }) {
    if (!sessao) return oc.comentarOcorrencia({ numero, texto: html || texto });
    const alvo = (await oc.listarOcorrencias({ ocorrencia: String(numero) })).find((o) => String(o.numero) === String(numero));
    if (!alvo || !alvo.id) throw new Error(`Ocorrência ${numero} não encontrada no SGP para comentar.`);
    const semMencao = marcar.length ? texto.replace(/\n?@[\w.-]+\s*$/g, '') : texto; // a marcação vai no campo próprio
    return sessao.comentar({ ocorrenciaId: alvo.id, texto: semMencao, html, usuariosIds: await idsDe(marcar) });
  }

  // Print na ocorrência (só pela tela do SGP, com o usuário da integração).
  async function anexar({ numero, nome, tipo, dados, descricao, campos }) {
    if (!sessao) throw new Error('Para anexar print na ocorrência é preciso o usuário da integração (SGP_USUARIO_INTEGRACAO).');
    const alvo = (await oc.listarOcorrencias({ ocorrencia: String(numero) })).find((o) => String(o.numero) === String(numero));
    if (!alvo || !alvo.id) throw new Error(`Ocorrência ${numero} não encontrada no SGP para anexar o print.`);
    return sessao.anexar({ ocorrenciaId: alvo.id, nome, tipo, dados, descricao, campos });
  }

  return { comentar, anexar, usaLogin: Boolean(sessao) };
}

module.exports = { criarComentador };
