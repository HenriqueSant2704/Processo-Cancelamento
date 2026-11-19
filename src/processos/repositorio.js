// Onde os processos ficam guardados. Existem duas implementações com os
// mesmos métodos (todos assíncronos):
//   - RepositorioJson: arquivo local (modo demonstração e testes)
//   - RepositorioPostgres: banco Neon (uso real), em repositorioPostgres.js
//
// Métodos: listar(), obter(id), obterPorTarefa(tarefaId),
//          processoAtivoDoCliente(clienteId), proximoId(), salvarProcesso(processo),
//          registrarSuspensos(contratoIds, hoje, diasPrimeiraVez)
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

  async atualizarOcorrencia(processoId, numero) {
    const p = await this.obter(processoId);
    if (p) { p.ocorrencia = { numero }; this.gravarArquivo(); }
  }

  async atualizarBloqueio(processoId, data) {
    const p = await this.obter(processoId);
    if (p) { p.bloqueadoEm = data; this.gravarArquivo(); }
  }

  // Fichas dos clientes (dados do SGP), por contrato.
  async salvarFichas(fichas, em) {
    this.dados.fichas = this.dados.fichas || {};
    for (const [contrato, dados] of fichas) this.dados.fichas[contrato] = { ...dados, em };
    this.gravarArquivo();
  }

  async obterFicha(contrato) {
    return (this.dados.fichas || {})[String(contrato)] || null;
  }

  // Prints dos avisos (no arquivo local ficam em base64).
  async salvarAnexo({ processoId, tarefaId, nome, tipo, dados, em, por }) {
    this.dados.anexos = this.dados.anexos || [];
    const id = String(this.dados.anexos.length + 1);
    this.dados.anexos.push({ id, processoId: String(processoId), tarefaId: tarefaId || null, nome, tipo, tamanho: dados.length, base64: dados.toString('base64'), em, por: por || null, enviadoSgpEm: null });
    this.gravarArquivo();
    return id;
  }

  async listarAnexos(processoId) {
    return (this.dados.anexos || []).filter((a) => a.processoId === String(processoId)).map(({ base64, ...resto }) => resto);
  }

  async obterAnexo(id) {
    const a = (this.dados.anexos || []).find((x) => x.id === String(id));
    return a ? { id: a.id, processoId: a.processoId, nome: a.nome, tipo: a.tipo, dados: Buffer.from(a.base64, 'base64') } : null;
  }

  async marcarAnexoEnviado(id, em) {
    const a = (this.dados.anexos || []).find((x) => x.id === String(id));
    if (a) { a.enviadoSgpEm = em; this.gravarArquivo(); }
  }

  async atualizarFinanceiro(processoId, financeiro) {
    const p = await this.obter(processoId);
    if (p) { p.financeiro = financeiro; this.gravarArquivo(); }
  }

  // Ver explicação em repositorioPostgres.js (registrarSuspensos).
  async registrarSuspensos(ids, hoje, diasPrimeiraVez) {
    const { adicionarDias } = require('../utils/datas');
    const atuais = this.dados.suspensoes || {};
    const primeiraVez = Object.keys(atuais).length === 0 && this.dados.processos.length === 0;
    const novos = {};
    for (const id of ids) novos[id] = atuais[id] || (primeiraVez ? adicionarDias(hoje, -diasPrimeiraVez) : hoje);
    this.dados.suspensoes = novos;
    this.gravarArquivo();
    return new Map(Object.entries(novos));
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
