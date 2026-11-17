// Processos guardados no Postgres (Neon). Mesmos métodos do RepositorioJson.
const { ErroConflito } = require('./repositorio');

const COLUNAS_PROCESSO = `
  id::text as id, cliente_id, cliente_nome, cliente_contrato,
  bloqueado_em::text as bloqueado_em, iniciado_em::text as iniciado_em,
  status, resultado, etapa_atual, finalizado_em::text as finalizado_em, versao`;

const COLUNAS_TAREFA = `
  id, processo_id::text as processo_id, etapa, tipo, descricao, data::text as data, status,
  concluida_em::text as concluida_em, concluida_por, observacao, resposta, cancelada_em::text as cancelada_em`;

function linhaParaProcesso(l) {
  return {
    id: l.id,
    cliente: { id: l.cliente_id, nome: l.cliente_nome, contrato: l.cliente_contrato },
    bloqueadoEm: l.bloqueado_em,
    iniciadoEm: l.iniciado_em,
    status: l.status,
    resultado: l.resultado,
    etapaAtual: l.etapa_atual,
    finalizadoEm: l.finalizado_em,
    versao: l.versao,
    tarefas: [],
    historico: [],
  };
}

function linhaParaTarefa(l) {
  const tarefa = { id: l.id, etapa: l.etapa, tipo: l.tipo, descricao: l.descricao, data: l.data, status: l.status };
  if (l.concluida_em) Object.assign(tarefa, { concluidaEm: l.concluida_em, concluidaPor: l.concluida_por, observacao: l.observacao });
  if (l.resposta) tarefa.resposta = l.resposta;
  if (l.cancelada_em) tarefa.canceladaEm = l.cancelada_em;
  return tarefa;
}

class RepositorioPostgres {
  constructor(banco) {
    this.banco = banco;
  }

  // Lista processos com as tarefas (o histórico só vem no obter, para ficar leve).
  async listar() {
    const { rows: processos } = await this.banco.query(`select ${COLUNAS_PROCESSO} from processos order by id`);
    const { rows: tarefas } = await this.banco.query(`select ${COLUNAS_TAREFA} from tarefas order by processo_id, ordem`);
    const porId = new Map(processos.map((l) => [l.id, linhaParaProcesso(l)]));
    for (const t of tarefas) porId.get(t.processo_id)?.tarefas.push(linhaParaTarefa(t));
    return [...porId.values()];
  }

  async obter(id) {
    if (!/^\d+$/.test(String(id))) return null;
    const { rows } = await this.banco.query(`select ${COLUNAS_PROCESSO} from processos where id = $1`, [id]);
    if (!rows.length) return null;
    const processo = linhaParaProcesso(rows[0]);
    const tarefas = await this.banco.query(`select ${COLUNAS_TAREFA} from tarefas where processo_id = $1 order by ordem`, [id]);
    processo.tarefas = tarefas.rows.map(linhaParaTarefa);
    const historico = await this.banco.query(
      `select id::text as id, data::text as data, registrado_em, por, evento, detalhes
         from historico where processo_id = $1 order by id`,
      [id],
    );
    processo.historico = historico.rows.map((h) => ({ ...h, registradoEm: new Date(h.registrado_em).toISOString(), registrado_em: undefined }));
    return processo;
  }

  async obterPorTarefa(tarefaId) {
    return this.obter(String(tarefaId).split('.')[0]);
  }

  async processoAtivoDoCliente(clienteId) {
    const { rows } = await this.banco.query(`select id::text as id from processos where cliente_id = $1 and status = 'ativo'`, [String(clienteId)]);
    return rows[0] || null;
  }

  async proximoId() {
    const { rows } = await this.banco.query(`select nextval(pg_get_serial_sequence('processos', 'id'))::text as id`);
    return rows[0].id;
  }

  // Grava o processo inteiro numa transação (tudo ou nada).
  async salvarProcesso(processo) {
    await this.banco.transacao(async (query) => {
      if (processo.versao === undefined) {
        await query(
          `insert into processos (id, cliente_id, cliente_nome, cliente_contrato, bloqueado_em, iniciado_em, status, resultado, etapa_atual, finalizado_em)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [processo.id, processo.cliente.id, processo.cliente.nome, processo.cliente.contrato, processo.bloqueadoEm, processo.iniciadoEm,
            processo.status, processo.resultado, processo.etapaAtual, processo.finalizadoEm || null],
        );
        processo.versao = 1;
      } else {
        const r = await query(
          `update processos set status = $2, resultado = $3, etapa_atual = $4, finalizado_em = $5,
                  versao = versao + 1, atualizado_em = now()
            where id = $1 and versao = $6
           returning versao`,
          [processo.id, processo.status, processo.resultado, processo.etapaAtual, processo.finalizadoEm || null, processo.versao],
        );
        if (!r.rows.length) throw new ErroConflito('Outra pessoa atualizou este cliente agora há pouco. Recarregue a tela e tente de novo.');
        processo.versao = r.rows[0].versao;
      }

      for (const [i, t] of processo.tarefas.entries()) {
        await query(
          `insert into tarefas (id, processo_id, ordem, etapa, tipo, descricao, data, status, concluida_em, concluida_por, observacao, resposta, cancelada_em)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           on conflict (id) do update set
             status = excluded.status, concluida_em = excluded.concluida_em, concluida_por = excluded.concluida_por,
             observacao = excluded.observacao, resposta = excluded.resposta, cancelada_em = excluded.cancelada_em`,
          [t.id, processo.id, i + 1, t.etapa, t.tipo, t.descricao, t.data, t.status, t.concluidaEm || null, t.concluidaPor || null,
            t.observacao || null, t.resposta || null, t.canceladaEm || null],
        );
      }

      for (const h of processo.historico) {
        if (h.id) continue; // já está no banco
        const r = await query(
          `insert into historico (processo_id, data, registrado_em, por, evento, detalhes) values ($1, $2, $3, $4, $5, $6) returning id::text as id`,
          [processo.id, h.data, h.registradoEm, h.por, h.evento, h.detalhes || null],
        );
        h.id = r.rows[0].id;
      }
    });
  }
}

module.exports = { RepositorioPostgres };
