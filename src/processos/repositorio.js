// Onde os processos ficam guardados. Existem duas implementações com os
// mesmos métodos (todos assíncronos):
//   - RepositorioJson: arquivo local (modo demonstração e testes)
//   - RepositorioPostgres: banco Neon (uso real), em repositorioPostgres.js
//
// Métodos: listar(), obter(id), obterPorTarefa(tarefaId),
//          processoAtivoDoCliente(clienteId), proximoId(), salvarProcesso(processo)
const fs = require('node:fs');
const path = require('node:path');

class ErroConflito extends Error {}

class RepositorioJson {
  constructor(arquivo) {
    this.arquivo = arquivo;
    this.dados = { ultimoId: 0, processos: [] };
    if (arquivo && fs.existsSync(arquivo)) this.dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  }

  async listar() {
    return this.dados.processos;
  }

  async obter(id) {
    return this.dados.processos.find((p) => p.id === String(id)) || null;
  }

  async obterPorTarefa(tarefaId) {
    return this.obter(String(tarefaId).split('.')[0]);
  }

  async processoAtivoDoCliente(clienteId) {
    return this.dados.processos.find((p) => p.status === 'ativo' && p.cliente.id === String(clienteId)) || null;
  }

  async proximoId() {
    this.dados.ultimoId += 1;
    return String(this.dados.ultimoId);
  }

  async salvarProcesso(processo) {
    if (!this.dados.processos.includes(processo)) {
      const i = this.dados.processos.findIndex((p) => p.id === processo.id);
      if (i >= 0) this.dados.processos[i] = processo;
      else this.dados.processos.push(processo);
    }
    this.gravarArquivo();
  }

  gravarArquivo() {
    if (!this.arquivo) return; // sem arquivo = só em memória (testes)
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const temporario = `${this.arquivo}.tmp`;
    fs.writeFileSync(temporario, JSON.stringify(this.dados, null, 2));
    fs.renameSync(temporario, this.arquivo);
  }
}

module.exports = { RepositorioJson, ErroConflito };
