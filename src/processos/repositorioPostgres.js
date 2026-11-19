// Processos guardados no Postgres (Neon). Mesmos métodos do RepositorioJson.
const { ErroConflito } = require('./repositorio');

const COLUNAS_PROCESSO = `
  id::text as id, cliente_id, cliente_nome, cliente_contrato,
  bloqueado_em::text as bloqueado_em, iniciado_em::text as iniciado_em,
  status, resultado, etapa_atual, finalizado_em::text as finalizado_em, versao,
  valor_aberto::float8 as valor_aberto, faturas_abertas, financeiro_em::text as financeiro_em,
  fluxo, ocorrencia_numero, autorizacao`;

const COLUNAS_TAREFA = `
  id, processo_id::text as processo_id, etapa, tipo, descricao, data::text as data, status,
  concluida_em::text as concluida_em, concluida_por, observacao, resposta, cancelada_em::text as cancelada_em, promessa, avisado_em::text as avisado_em, retorno`;

function linhaParaProcesso(l) {
  return {
    id: l.id,
    fluxo: l.fluxo || 'principal',
    ocorrencia: l.ocorrencia_numero ? { numero: l.ocorrencia_numero } : null,
    cliente: { id: l.cliente_id, nome: l.cliente_nome, contrato: l.cliente_contrato },
    bloqueadoEm: l.bloqueado_em,
    iniciadoEm: l.iniciado_em,
    status: l.status,
    resultado: l.resultado,
    etapaAtual: l.etapa_atual,
    finalizadoEm: l.finalizado_em,
    versao: l.versao,
    autorizacao: l.autorizacao || null,
    financeiro: l.financeiro_em ? { valorAberto: l.valor_aberto, faturasAbertas: l.faturas_abertas, em: l.financeiro_em } : null,
    tarefas: [],
    historico: [],
  };
}

function linhaParaTarefa(l) {
  const tarefa = { id: l.id, etapa: l.etapa, tipo: l.tipo, descricao: l.descricao, data: l.data, status: l.status };
  if (l.concluida_em) Object.assign(tarefa, { concluidaEm: l.concluida_em, concluidaPor: l.concluida_por, observacao: l.observacao });
  if (l.resposta) tarefa.resposta = l.resposta;
  if (l.cancelada_em) tarefa.canceladaEm = l.cancelada_em;
  if (l.promessa) tarefa.promessa = l.promessa;
  if (l.avisado_em) tarefa.avisadoEm = l.avisado_em;
  if (l.retorno) tarefa.retorno = l.retorno;
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
    const { rows } = await this.banco.query(`select id::text as id, bloqueado_em::text as "bloqueadoEm" from processos where cliente_id = $1 and status = 'ativo'`, [String(clienteId)]);
    return rows[0] || null;
  }

  async proximoId() {
    const { rows } = await this.banco.query(`select nextval(pg_get_serial_sequence('processos', 'id'))::text as id`);
    return rows[0].id;
  }

  // Anota o primeiro dia em que cada contrato apareceu suspenso no SGP e
  // esquece os que deixaram de estar suspensos (se voltarem, contam de novo).
  // Na primeíssima sincronização, quem já estava suspenso entra como suspenso
  // há "diasPrimeiraVez" dias, para não esperar mais um dia para começar.
  async registrarSuspensos(ids, hoje, diasPrimeiraVez) {
    return this.banco.transacao(async (query) => {
      const { rows } = await query('select ((select count(*) from sgp_suspensoes) + (select count(*) from processos))::int as n');
      const dias = rows[0].n === 0 ? diasPrimeiraVez : 0;
      await query('delete from sgp_suspensoes where not (contrato_id = any($1::text[]))', [ids]);
      await query(
        `insert into sgp_suspensoes (contrato_id, visto_desde)
         select unnest($1::text[]), ($2::date - $3::int)
         on conflict (contrato_id) do update set atualizado_em = now()`,
        [ids, hoje, dias],
      );
      const r = await query('select contrato_id, visto_desde::text as visto_desde from sgp_suspensoes');
      return new Map(r.rows.map((l) => [l.contrato_id, l.visto_desde]));
    });
  }

  // Liga o processo à ocorrência do contrato no SGP.
  async atualizarOcorrencia(processoId, numero) {
    await this.banco.query('update processos set ocorrencia_numero = $2 where id = $1', [processoId, numero]);
  }

  // Corrige a data do bloqueio com a data real vinda do SGP.
  async atualizarBloqueio(processoId, data) {
    await this.banco.query('update processos set bloqueado_em = $2 where id = $1', [processoId, data]);
  }

  // Fichas dos clientes (dados do SGP), por contrato.
  async salvarFichas(fichas, em) {
    if (!fichas.size) return;
    await this.banco.query(
      `insert into fichas_clientes (contrato_id, dados, atualizado_em)
       select f.contrato, f.dados, $2::date from jsonb_to_recordset($1::jsonb) as f(contrato text, dados jsonb)
       on conflict (contrato_id) do update set dados = excluded.dados, atualizado_em = excluded.atualizado_em`,
      [JSON.stringify([...fichas].map(([contrato, dados]) => ({ contrato: String(contrato), dados }))), em],
    );
  }

  async obterFicha(contrato) {
    const { rows } = await this.banco.query('select dados, atualizado_em::text as em from fichas_clientes where contrato_id = $1', [String(contrato)]);
    return rows.length ? { ...rows[0].dados, em: rows[0].em } : null;
  }

  // Prints dos avisos. dados: Buffer da imagem.
  async salvarAnexo({ processoId, tarefaId, nome, tipo, dados, em, por }) {
    const { rows } = await this.banco.query(
      'insert into anexos (processo_id, tarefa_id, nome, tipo, tamanho, dados, criado_em, criado_por) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
      [String(processoId), tarefaId || null, nome, tipo, dados.length, dados, em, por || null],
    );
    return String(rows[0].id);
  }

  async listarAnexos(processoId) {
    const { rows } = await this.banco.query(
      `select id::text as id, tarefa_id, nome, tipo, tamanho, criado_em::text as criado_em, criado_por, enviado_sgp_em::text as enviado_sgp_em
       from anexos where processo_id = $1 order by id`, [String(processoId)]);
    return rows.map((r) => ({ id: r.id, tarefaId: r.tarefa_id, nome: r.nome, tipo: r.tipo, tamanho: r.tamanho, em: r.criado_em, por: r.criado_por, enviadoSgpEm: r.enviado_sgp_em }));
  }

  async obterAnexo(id) {
    if (!/^\d+$/.test(String(id))) return null;
    const { rows } = await this.banco.query('select id::text as id, processo_id::text as processo_id, nome, tipo, dados from anexos where id = $1', [Number(id)]);
    return rows.length ? { id: rows[0].id, processoId: rows[0].processo_id, nome: rows[0].nome, tipo: rows[0].tipo, dados: Buffer.from(rows[0].dados) } : null;
  }

  async marcarAnexoEnviado(id, em) {
    await this.banco.query('update anexos set enviado_sgp_em = $2 where id = $1', [Number(id), em]);
  }

  // Atualiza só o valor em aberto (vem do SGP a cada sincronização).
  async atualizarFinanceiro(processoId, { valorAberto, faturasAbertas, em }) {
    await this.banco.query('update processos set valor_aberto = $2, faturas_abertas = $3, financeiro_em = $4 where id = $1', [processoId, valorAberto ?? null, faturasAbertas ?? null, em]);
  }

  // Grava o processo inteiro numa transação (tudo ou nada).
  async salvarProcesso(processo) {
    await this.banco.transacao(async (query) => {
      if (processo.versao === undefined) {
        await query(
          `insert into processos (id, cliente_id, cliente_nome, cliente_contrato, bloqueado_em, iniciado_em, status, resultado, etapa_atual, finalizado_em, valor_aberto, faturas_abertas, financeiro_em, fluxo, ocorrencia_numero, autorizacao)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [processo.id, processo.cliente.id, processo.cliente.nome, processo.cliente.contrato, processo.bloqueadoEm, processo.iniciadoEm,
            processo.status, processo.resultado, processo.etapaAtual, processo.finalizadoEm || null,
            processo.financeiro?.valorAberto ?? null, processo.financeiro?.faturasAbertas ?? null, processo.financeiro?.em ?? null,
            processo.fluxo || 'principal', processo.ocorrencia?.numero ?? null, processo.autorizacao ? JSON.stringify(processo.autorizacao) : null],
        );
        processo.versao = 1;
      } else {
        const r = await query(
          `update processos set status = $2, resultado = $3, etapa_atual = $4, finalizado_em = $5, autorizacao = $7,
                  versao = versao + 1, atualizado_em = now()
            where id = $1 and versao = $6
           returning versao`,
          [processo.id, processo.status, processo.resultado, processo.etapaAtual, processo.finalizadoEm || null, processo.versao, processo.autorizacao ? JSON.stringify(processo.autorizacao) : null],
        );
        if (!r.rows.length) throw new ErroConflito('Outra pessoa atualizou este cliente agora há pouco. Recarregue a tela e tente de novo.');
        processo.versao = r.rows[0].versao;
      }

      for (const [i, t] of processo.tarefas.entries()) {
        await query(
          `insert into tarefas (id, processo_id, ordem, etapa, tipo, descricao, data, status, concluida_em, concluida_por, observacao, resposta, cancelada_em, promessa, avisado_em, retorno)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           on conflict (id) do update set
             data = excluded.data, descricao = excluded.descricao, ordem = excluded.ordem,
             status = excluded.status, concluida_em = excluded.concluida_em, concluida_por = excluded.concluida_por,
             observacao = excluded.observacao, resposta = excluded.resposta, cancelada_em = excluded.cancelada_em, avisado_em = excluded.avisado_em, retorno = excluded.retorno`,
          [t.id, processo.id, i + 1, t.etapa, t.tipo, t.descricao, t.data, t.status, t.concluidaEm || null, t.concluidaPor || null,
            t.observacao || null, t.resposta || null, t.canceladaEm || null, t.promessa || null, t.avisadoEm || null, t.retorno ? JSON.stringify(t.retorno) : null],
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
