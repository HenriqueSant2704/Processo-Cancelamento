// Linha de comando do sistema.
//   npm run agenda                    -> agenda de hoje (quem contatar e o que fazer)
//   npm run sincronizar               -> busca os bloqueados no SGP e abre os processos
//   npm run cli -- processos          -> lista os processos ativos
//   npm run cli -- processo <id>      -> cronograma e histórico de um cliente
//   npm run cli -- concluir <tarefa> --por Jessica [--obs "texto"]
//   npm run cli -- decidir <tarefa> sim|nao --por Jessica --obs "o que foi feito / por quê"
// Usuários (só com o banco Neon configurado em DATABASE_URL):
//   npm run cli -- criar-usuario <login> --nome "Jessica Silva"   (mostra uma senha temporária)
//   npm run cli -- redefinir-senha <login>
//   npm run cli -- desativar-usuario <login>
//   npm run cli -- usuarios
// SGP:
//   npm run cli -- sgp-diagnostico   (mostra os campos que o SGP devolve, sem dados de clientes)
// Opção --data AAAA-MM-DD simula outro dia (padrão: hoje).
const { parseArgs } = require('node:util');
const config = require('./config');
const servico = require('./processos/servico');
const { criarFonteSgp } = require('./integracoes/sgp');
const { criarArmazenamento } = require('./armazenamento');
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
  console.log('\nPara concluir:  npm run cli -- concluir <tarefa> --por <seu nome>');
  console.log('Para decidir:   npm run cli -- decidir <tarefa> sim|nao --por <seu nome> --obs "o que foi feito"');
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

function exigirUsuarios(armazenamento) {
  if (!armazenamento.usuarios) throw new Error('Usuários só existem com o banco Neon. Configure DATABASE_URL no arquivo .env.');
  return armazenamento.usuarios;
}

async function executar(comando, args, values, armazenamento) {
  const hoje = values.data || hojeISO();
  const cronograma = config.carregarCronograma();
  const { repositorio } = armazenamento;

  switch (comando) {
    case 'agenda':
      return imprimirAgenda(await servico.agenda({ repositorio, hoje }), hoje);
    case 'sincronizar': {
      const sgp = criarFonteSgp(config, hoje, { bancoReal: armazenamento.tipo === 'postgres' });
      const { totalBloqueados, novos } = await servico.sincronizar({ sgp, repositorio, cronograma, hoje });
      console.log(`SGP: ${totalBloqueados} cliente(s) bloqueado(s). ${novos.length} novo(s) processo(s) aberto(s).`);
      for (const p of novos) console.log(`  processo ${p.id}: ${p.cliente.nome}`);
      return;
    }
    case 'processos':
      for (const p of (await repositorio.listar()).filter((p) => p.status === 'ativo')) {
        console.log(`  ${p.id}  ${p.cliente.nome.padEnd(30)} etapa: ${p.etapaAtual}`);
      }
      return;
    case 'processo': {
      const processo = await repositorio.obter(args[0]);
      if (!processo) throw new Error(`Processo ${args[0]} não encontrado.`);
      return imprimirProcesso(processo);
    }
    case 'concluir':
    case 'decidir': {
      const [tarefaId, resposta] = args;
      const { processo, tarefa } = await servico.concluir({
        repositorio,
        cronograma,
        tarefaId,
        por: values.por,
        data: hoje,
        observacao: values.obs,
        resposta: comando === 'decidir' ? resposta : undefined,
      });
      console.log(`Tarefa ${tarefa.id} concluída.`);
      return imprimirProcesso(processo);
    }
    case 'criar-usuario': {
      const { login, senha } = await exigirUsuarios(armazenamento).criar({ login: args[0], nome: values.nome });
      console.log(`Usuário "${login}" criado.\nSenha temporária: ${senha}\nPasse para a pessoa por um canal privado; ela pode trocar a senha na tela.`);
      return;
    }
    case 'redefinir-senha': {
      const { login, senha } = await exigirUsuarios(armazenamento).redefinirSenha(args[0]);
      console.log(`Nova senha temporária de "${login}": ${senha}`);
      return;
    }
    case 'desativar-usuario':
      await exigirUsuarios(armazenamento).desativar(args[0]);
      console.log(`Usuário "${args[0]}" desativado.`);
      return;
    case 'usuarios':
      for (const u of await exigirUsuarios(armazenamento).listar()) console.log(`  ${u.login.padEnd(20)} ${u.nome}${u.ativo ? '' : '  (desativado)'}`);
      return;
    case 'sgp-diagnostico': {
      // Mostra só a ESTRUTURA do que o SGP devolve (nomes de campos e contagens), sem dados de clientes.
      const { criarApiSgp } = require('./integracoes/sgp/api');
      const { diagnosticar } = require('./integracoes/sgp/contratos');
      const api = criarApiSgp({ url: config.sgp.uraClientesUrl, app: config.sgp.app, token: config.sgp.token });
      console.log('Lendo todos os clientes do SGP (pode levar alguns minutos)...');
      const { clientes, paginas } = await api.lerTodosClientes();
      const d = diagnosticar(clientes);
      const linhas = (pares) => pares.map(([k, n]) => `    ${k} (${n})`).join('\n') || '    (nenhum)';
      console.log(`\nPáginas: ${paginas} | Clientes: ${d.totalClientes}`);
      console.log(`\nCampos do cliente:\n${linhas(d.camposCliente)}`);
      console.log(`\nCampos do contrato:\n${linhas(d.camposContrato)}`);
      console.log(`\nCampos do contrato que têm datas:\n${linhas(d.camposDoContratoComData)}`);
      console.log(`\nCampos do serviço:\n${linhas(d.camposServico)}`);
      console.log('\nContratos por status (e motivos):');
      for (const s of d.status) console.log(`  ${s.status}: ${s.total}\n${linhas(s.motivos)}`);
      return;
    }
    case 'migrar':
      console.log(armazenamento.tipo === 'postgres' ? 'Banco Neon atualizado.' : 'Sem DATABASE_URL: nada a migrar (usando arquivo local).');
      return;
    default:
      throw new Error(`Comando desconhecido: ${comando}`);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { data: { type: 'string' }, por: { type: 'string' }, obs: { type: 'string' }, nome: { type: 'string' } },
  });
  const [comando = 'agenda', ...args] = positionals;
  const armazenamento = await criarArmazenamento();
  try {
    await executar(comando, args, values, armazenamento);
  } finally {
    await armazenamento.fechar();
  }
}

main().catch((erro) => {
  console.error(`Erro: ${erro.message}`);
  process.exitCode = 1;
});
