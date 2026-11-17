// Guarda os processos num arquivo JSON local (pasta data/, fora do git).
// Simples para começar; depois pode ser trocado por um banco de dados
// mantendo os mesmos métodos.
const fs = require('node:fs');
const path = require('node:path');

class RepositorioJson {
  constructor(arquivo) {
    this.arquivo = arquivo;
    this.dados = { ultimoId: 0, processos: [] };
    if (arquivo && fs.existsSync(arquivo)) this.dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  }

  listar() {
    return this.dados.processos;
  }

  obter(id) {
    return this.dados.processos.find((p) => p.id === String(id));
  }

  obterPorTarefa(tarefaId) {
    return this.obter(String(tarefaId).split('.')[0]);
  }

  processoAtivoDoCliente(clienteId) {
    return this.dados.processos.find((p) => p.status === 'ativo' && p.cliente.id === String(clienteId));
  }

  proximoId() {
    this.dados.ultimoId += 1;
    return String(this.dados.ultimoId);
  }

  adicionar(processo) {
    this.dados.processos.push(processo);
  }

  salvar() {
    if (!this.arquivo) return; // sem arquivo = só em memória (usado nos testes)
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const temporario = `${this.arquivo}.tmp`;
    fs.writeFileSync(temporario, JSON.stringify(this.dados, null, 2));
    fs.renameSync(temporario, this.arquivo);
  }
}

module.exports = { RepositorioJson };
