// Decide onde guardar os dados:
//   - com DATABASE_URL (Neon): Postgres + login dos funcionários
//   - sem DATABASE_URL: arquivo JSON local, sem login (só para uso local e demonstração)
const config = require('./config');
const { RepositorioJson } = require('./processos/repositorio');

async function criarArmazenamento({ arquivoDados = config.arquivoDados, forcarArquivo = false } = {}) {
  if (forcarArquivo || !config.databaseUrl) {
    if (config.ambiente === 'production' && !forcarArquivo) {
      throw new Error('Em produção é obrigatório configurar DATABASE_URL (banco Neon).');
    }
    return { tipo: 'arquivo', repositorio: new RepositorioJson(arquivoDados), usuarios: null, fechar: async () => {} };
  }

  const { criarBancoPostgres, migrar } = require('./banco/conexao');
  const { RepositorioPostgres } = require('./processos/repositorioPostgres');
  const { Usuarios } = require('./auth/usuarios');
  const banco = criarBancoPostgres(config.databaseUrl);
  await migrar(banco);
  return { tipo: 'postgres', repositorio: new RepositorioPostgres(banco), usuarios: new Usuarios(banco), fechar: () => banco.fechar() };
}

module.exports = { criarArmazenamento };
