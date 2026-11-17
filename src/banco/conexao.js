// Conexão com o Postgres (Neon). O resto do sistema só usa esta "interface":
//   query(sql, params) -> { rows, rowCount }
//   transacao(async (query) => ...)   tudo ou nada
//   executarScript(sql)               vários comandos de uma vez (migração)
//   fechar()
const fs = require('node:fs');
const path = require('node:path');

function criarBancoPostgres(urlConexao) {
  const { Pool } = require('pg');
  // O Neon entrega "sslmode=require"; deixamos explícita a verificação completa
  // do certificado (o comportamento seguro que o pg já usa hoje), sem aviso no console.
  const url = urlConexao.replace(/sslmode=(require|prefer|verify-ca)\b/, 'sslmode=verify-full');
  const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
  return {
    query: (sql, params) => pool.query(sql, params),
    async transacao(fn) {
      const cliente = await pool.connect();
      try {
        await cliente.query('begin');
        const resultado = await fn((sql, params) => cliente.query(sql, params));
        await cliente.query('commit');
        return resultado;
      } catch (erro) {
        await cliente.query('rollback').catch(() => {});
        throw erro;
      } finally {
        cliente.release();
      }
    },
    executarScript: (sql) => pool.query(sql),
    fechar: () => pool.end(),
  };
}

// Mesmo formato, mas com o PGlite (Postgres em memória), usado nos testes.
function criarBancoPglite(db) {
  return {
    query: (sql, params) => db.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length })),
    transacao: (fn) => db.transaction((tx) => fn((sql, params) => tx.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length })))),
    executarScript: (sql) => db.exec(sql),
    fechar: () => db.close(),
  };
}

async function migrar(banco) {
  const sql = fs.readFileSync(path.join(__dirname, 'esquema.sql'), 'utf8');
  await banco.executarScript(sql);
}

module.exports = { criarBancoPostgres, criarBancoPglite, migrar };
