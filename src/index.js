// Linha de comando do sistema (interface provisória até termos a tela web).
//   npm start                         -> agenda de hoje (quem contatar e o que fazer)
//   npm run sincronizar               -> busca os bloqueados no SGP e abre os processos
//   node src/index.js processos       -> lista os processos ativos
//   node src/index.js processo <id>   -> cronograma e histórico de um cliente
//   node src/index.js concluir <tarefa> --por Jessica [--obs "texto"]
//   node src/index.js decidir <tarefa> sim|nao --por Jessica --obs "o que foi feito / por quê"
// Opção --data AAAA-MM-DD simula outro dia (padrão: hoje).
const { parseArgs } = require('node:util');
const config = require('./config');
const { RepositorioJson } = require('./processos/repositorio');
const servico = require('./processos/servico');
const { criarFonteSgp } = require('./integracoes/sgp');
const { hojeISO, formatarData } = require('./utils/datas');

const ROTULOS = { contato: 'CONTATO', acao: 'AÇÃO', decisao: 'DECISÃO' };
const STATUS = { pendente: 'pendente', concluida: 'concluída', cancelada: 'cancelada' };

function imprimirAgenda(itens, hoje) {
  console.log(`\nAgenda de ${formatarData(hoje)}\n`);
  if (!itens.length) {
    console.log('Nenhuma tarefa para hoje.');
    return;
  }
  let clienteAtual = null;
  for (const { processo, tarefa, atrasada } of itens) {
    if (processo.id !== clienteAtual) {
      clienteAtual = processo.id;
      console.log(`${processo.cliente.nome} (contrato ${processo.cliente.contrato}) - processo ${processo.id}, bloqueado desde ${formatarData(processo.bloqueadoEm)}`);
    }
    const atraso = atrasada ? `  [ATRASADA, era ${formatarData(tarefa.data)}]` : '';
    console.log(`  [${tarefa.id}] ${ROTULOS[tarefa.tipo]}: ${tarefa.descricao}${atraso}`);
  }
  console.log('\nPara concluir:  node src/index.js concluir <tarefa> --por <seu nome>');
  console.log('Para decidir:   node src/index.js decidir <tarefa> sim|nao --por <seu nome> --obs "o que foi feito"');
}

function imprimirProcesso(processo) {
  console.log(`\nProcesso ${processo.id} - ${processo.cliente.nome} (contrato ${processo.cliente.contrato})`);
  console.log(`Bloqueado desde ${formatarData(processo.bloqueadoEm)} | Status: ${processo.status}${processo.resultado ? ` (${processo.resultado})` : ''}`);
  if (processo.etapaAtual) console.log(`Etapa atual: ${processo.etapaAtual}`);
  console.log('\nCronograma:');
  for (const t of processo.tarefas) {
    const extra = t.status === 'concluida' ? ` por ${t.concluidaPor}${t.resposta ? ` -> ${t.resposta}` : ''}${t.observacao ? ` | ${t.observacao}` : ''}` : '';
    console.log(`  [${t.id}] ${formatarData(t.data).padEnd(22)} ${STATUS[t.status].padEnd(9)} ${ROTULOS[t.tipo]}: ${t.descricao}${extra}`);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { data: { type: 'string' }, por: { type: 'string' }, obs: { type: 'string' } },
  });
  const [comando = 'agenda', ...args] = positionals;
  const hoje = values.data || hojeISO();
  const cronograma = config.carregarCronograma();
  const repositorio = new RepositorioJson(config.arquivoDados);

  switch (comando) {
    case 'agenda':
      imprimirAgenda(servico.agenda({ repositorio, hoje }), hoje);
      break;
    case 'sincronizar': {
      const sgp = criarFonteSgp(config, hoje);
      const { totalBloqueados, novos } = await servico.sincronizar({ sgp, repositorio, cronograma, hoje });
      console.log(`SGP: ${totalBloqueados} cliente(s) bloqueado(s). ${novos.length} novo(s) processo(s) aberto(s).`);
      for (const p of novos) console.log(`  processo ${p.id}: ${p.cliente.nome}`);
      break;
    }
    case 'processos':
      for (const p of repositorio.listar().filter((p) => p.status === 'ativo')) {
        console.log(`  ${p.id}  ${p.cliente.nome.padEnd(30)} etapa: ${p.etapaAtual}`);
      }
      break;
    case 'processo': {
      const processo = repositorio.obter(args[0]);
      if (!processo) throw new Error(`Processo ${args[0]} não encontrado.`);
      imprimirProcesso(processo);
      break;
    }
    case 'concluir':
    case 'decidir': {
      const [tarefaId, resposta] = args;
      const { processo, tarefa } = servico.concluir({
        repositorio,
        cronograma,
        tarefaId,
        por: values.por,
        data: hoje,
        observacao: values.obs,
        resposta: comando === 'decidir' ? resposta : undefined,
      });
      console.log(`Tarefa ${tarefa.id} concluída.`);
      imprimirProcesso(processo);
      break;
    }
    default:
      throw new Error(`Comando desconhecido: ${comando}`);
  }
}

main().catch((erro) => {
  console.error(`Erro: ${erro.message}`);
  process.exitCode = 1;
});
