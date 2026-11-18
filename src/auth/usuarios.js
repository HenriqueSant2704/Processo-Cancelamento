// Login dos funcionários: usuários e sessões guardados no Postgres.
// Senhas nunca são guardadas, só o hash (scrypt). Sessões também: guardamos
// só o hash do token que fica no cookie do navegador.
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const HORAS_SESSAO = 12;

async function gerarHash(senha) {
  const sal = crypto.randomBytes(16);
  const hash = await scrypt(senha, sal, 64);
  return `scrypt$${sal.toString('base64')}$${hash.toString('base64')}`;
}

async function conferirSenha(senha, guardado) {
  const [algoritmo, sal, hash] = String(guardado).split('$');
  if (algoritmo !== 'scrypt' || !sal || !hash) return false;
  const calculado = await scrypt(senha, Buffer.from(sal, 'base64'), 64);
  const esperado = Buffer.from(hash, 'base64');
  return esperado.length === calculado.length && crypto.timingSafeEqual(esperado, calculado);
}

const gerarSenhaTemporaria = () => crypto.randomBytes(9).toString('base64url');
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const HASH_FALSO = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

class Usuarios {
  constructor(banco) {
    this.banco = banco;
  }

  // Cria o usuário com uma senha temporária aleatória (mostrada uma única vez).
  async criar({ login, nome }) {
    login = String(login || '').trim().toLowerCase();
    nome = String(nome || '').trim();
    if (!/^[a-z0-9._-]{3,40}$/.test(login)) throw new Error('Login inválido: use de 3 a 40 letras minúsculas, números, ponto, hífen ou _.');
    if (!nome) throw new Error('Informe o nome (--nome "Nome Sobrenome").');
    const senha = gerarSenhaTemporaria();
    try {
      await this.banco.query('insert into usuarios (login, nome, senha_hash) values ($1, $2, $3)', [login, nome, await gerarHash(senha)]);
    } catch (erro) {
      if (erro.code === '23505' || /unique|duplicate/i.test(erro.message)) throw new Error(`Já existe um usuário com o login "${login}".`);
      throw erro;
    }
    return { login, nome, senha };
  }

  async redefinirSenha(login) {
    const senha = gerarSenhaTemporaria();
    const r = await this.banco.query('update usuarios set senha_hash = $2, ativo = true where login = $1 returning login', [String(login).toLowerCase(), await gerarHash(senha)]);
    if (!r.rows.length) throw new Error(`Usuário "${login}" não encontrado.`);
    await this.banco.query('delete from sessoes where usuario_id = (select id from usuarios where login = $1)', [String(login).toLowerCase()]);
    return { login, senha };
  }

  async trocarSenha(usuarioId, senhaAtual, novaSenha) {
    if (typeof novaSenha !== 'string' || novaSenha.length < 8) throw new Error('A nova senha precisa ter pelo menos 8 caracteres.');
    const { rows } = await this.banco.query('select senha_hash from usuarios where id = $1', [usuarioId]);
    if (!rows.length || !(await conferirSenha(String(senhaAtual || ''), rows[0].senha_hash))) throw new Error('Senha atual incorreta.');
    await this.banco.query('update usuarios set senha_hash = $2 where id = $1', [usuarioId, await gerarHash(novaSenha)]);
  }

  async desativar(login) {
    const r = await this.banco.query('update usuarios set ativo = false where login = $1 returning id', [String(login).toLowerCase()]);
    if (!r.rows.length) throw new Error(`Usuário "${login}" não encontrado.`);
    await this.banco.query('delete from sessoes where usuario_id = $1', [r.rows[0].id]);
  }

  // Liga o usuário do sistema ao username dele no SGP (vazio = usa o padrão do token).
  async definirSgp(login, sgpLogin) {
    const valor = String(sgpLogin || '').trim();
    if (valor && !/^[A-Za-z0-9._@-]{2,60}$/.test(valor)) throw new Error('Username do SGP inválido.');
    const r = await this.banco.query('update usuarios set sgp_login = $2 where login = $1 returning login', [String(login).toLowerCase(), valor || null]);
    if (!r.rows.length) throw new Error(`Usuário "${login}" não encontrado.`);
  }

  async listar() {
    const { rows } = await this.banco.query('select login, nome, ativo, sgp_login from usuarios order by nome');
    return rows;
  }

  // Devolve o usuário se login e senha conferem; senão null.
  async autenticar(login, senha) {
    const { rows } = await this.banco.query('select id::text as id, login, nome, senha_hash, ativo from usuarios where login = $1', [String(login || '').trim().toLowerCase()]);
    const usuario = rows[0];
    const confere = await conferirSenha(String(senha || ''), usuario ? usuario.senha_hash : HASH_FALSO); // mesmo tempo com ou sem usuário
    if (!usuario || !usuario.ativo || !confere) return null;
    return { id: usuario.id, login: usuario.login, nome: usuario.nome };
  }

  async criarSessao(usuarioId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await this.banco.query(`delete from sessoes where expira_em < now()`);
    await this.banco.query(
      `insert into sessoes (token_hash, usuario_id, expira_em) values ($1, $2, now() + make_interval(hours => $3))`,
      [hashToken(token), usuarioId, HORAS_SESSAO],
    );
    return { token, segundos: HORAS_SESSAO * 3600 };
  }

  async usuarioDaSessao(token) {
    if (!token) return null;
    const { rows } = await this.banco.query(
      `select u.id::text as id, u.login, u.nome, u.sgp_login as "sgpLogin" from sessoes s join usuarios u on u.id = s.usuario_id
        where s.token_hash = $1 and s.expira_em > now() and u.ativo`,
      [hashToken(token)],
    );
    return rows[0] || null;
  }

  async encerrarSessao(token) {
    if (token) await this.banco.query('delete from sessoes where token_hash = $1', [hashToken(token)]);
  }
}

module.exports = { Usuarios, gerarHash, conferirSenha };
