// Modo demonstração: cria clientes FICTÍCIOS em várias etapas do processo
// (numa pasta separada, data/demo/) e abre a tela. Não toca nos dados reais.
//   npm run demo
const path = require('node:path');
const fs = require('node:fs');
const config = require('../config');
const { criarProcesso, concluirTarefa } = require('../cronograma/motor');
const { RepositorioJson } = require('../processos/repositorio');
const { adicionarDias, hojeISO, ehDiaUtil } = require('../utils/datas');
const { iniciarServidor } = require('../web/servidor');

const OBS_NAO = ['Cliente não atendeu as ligações.', 'Mensagem visualizada, sem resposta.', 'Prometeu pagar, mas não pagou.'];

// Executa automaticamente tudo que venceu ANTES de hoje (como se a equipe
// tivesse feito), respondendo "não" nas decisões.
function simularAteOntem(processo, hoje, cronograma) {
  for (let guarda = 0; guarda < 200; guarda++) {
    const tarefa = processo.tarefas.filter((t) => t.status === 'pendente' && t.data < hoje).sort((a, b) => a.data.localeCompare(b.data))[0];
    if (!tarefa || processo.status !== 'ativo') return;
    const decisao = tarefa.tipo === 'decisao';
    concluirTarefa(
      processo,
      tarefa.id,
      {
        por: ['Jessica', 'Rafael'][guarda % 2],
        data: tarefa.data,
        resposta: decisao ? 'nao' : undefined,
        observacao: decisao ? OBS_NAO[guarda % OBS_NAO.length] : undefined,
      },
      cronograma,
    );
  }
}

// Procura uma data de início (até 90 dias atrás) que deixe o cliente na situação desejada hoje.
function montarCenario({ id, cliente, criterio, simular = true }, hoje, cronograma) {
  for (let atras = 0; atras <= 90; atras++) {
    const inicio = adicionarDias(hoje, -atras);
    if (!ehDiaUtil(inicio, cronograma.feriados)) continue;
    const processo = criarProcesso({ id, cliente, bloqueadoEm: adicionarDias(inicio, -1), inicio, cronograma });
    if (simular) simularAteOntem(processo, hoje, cronograma);
    if (criterio(processo, hoje)) return processo;
  }
  return null;
}

const temHoje = (etapa, tipo, trecho = '') => (p, hoje) =>
  p.etapaAtual === etapa && p.tarefas.some((t) => t.status === 'pendente' && t.data === hoje && t.tipo === tipo && t.descricao.includes(trecho));

const CENARIOS = [
  { nome: 'Mariana Lopes', criterio: temHoje('notificacao-negativacao', 'contato', '1ª') },
  { nome: 'Carlos Henrique Dias', criterio: temHoje('notificacao-negativacao', 'contato', '2ª') },
  { nome: 'Fernanda Rocha', criterio: temHoje('notificacao-negativacao', 'contato', '3ª') },
  { nome: 'João Pedro Alves', criterio: temHoje('notificacao-negativacao', 'decisao') },
  { nome: 'Luciana Martins', criterio: temHoje('aguardo-negativado', 'decisao') },
  { nome: 'Roberto Nunes', criterio: temHoje('aviso-cancelamento', 'contato', '2ª') },
  { nome: 'Patrícia Gomes', criterio: temHoje('aviso-cancelamento', 'decisao') },
  // Atrasado: começou há alguns dias e ninguém fez nada.
  { nome: 'Eduardo Souza', simular: false, criterio: (p, hoje) => p.tarefas.some((t) => t.data < hoje) && p.tarefas.some((t) => t.data <= hoje && t.tipo === 'contato' && t.descricao.includes('2ª')) },
  // Sem tarefa hoje (aparecem em "Todos os clientes").
  { nome: 'Camila Ferreira', criterio: (p, hoje) => p.etapaAtual === 'aguardo-negativado' && p.tarefas.every((t) => t.status !== 'pendente' || t.data > adicionarDias(hoje, 5)) },
  { nome: 'Thiago Barbosa', criterio: (p, hoje) => p.etapaAtual === 'retirada-equipamentos' && p.tarefas.every((t) => t.status !== 'pendente' || t.data > hoje) },
];

function semear(arquivo, hoje) {
  const cronograma = config.carregarCronograma();
  fs.rmSync(arquivo, { force: true });
  const repositorio = new RepositorioJson(arquivo);

  CENARIOS.forEach((cenario, i) => {
    const numero = 7001 + i;
    const cliente = { id: String(numero), nome: cenario.nome, contrato: `C-${numero}` };
    const id = String(i + 1);
    const processo = montarCenario({ ...cenario, id, cliente }, hoje, cronograma);
    if (processo) {
      repositorio.dados.ultimoId = Number(id);
      repositorio.adicionar(processo);
    }
  });

  // Um cliente que regularizou logo no começo (processo finalizado).
  const id = String(repositorio.dados.ultimoId + 1);
  const regularizado = criarProcesso({
    id,
    cliente: { id: '7100', nome: 'Beatriz Cardoso', contrato: 'C-7100' },
    bloqueadoEm: adicionarDias(hoje, -8),
    inicio: adicionarDias(hoje, -7),
    cronograma,
  });
  const decisao = regularizado.tarefas.find((t) => t.tipo === 'decisao');
  concluirTarefa(regularizado, decisao.id, { por: 'Jessica', data: adicionarDias(hoje, -6), resposta: 'sim', observacao: 'Pagou via PIX após o 1º aviso.' }, cronograma);
  for (const t of regularizado.tarefas.filter((t) => t.status === 'pendente')) {
    concluirTarefa(regularizado, t.id, { por: 'Jessica', data: adicionarDias(hoje, -6) }, cronograma);
  }
  repositorio.dados.ultimoId = Number(id);
  repositorio.adicionar(regularizado);

  repositorio.salvar();
  return repositorio.listar().length;
}

if (require.main === module) {
  const arquivo = path.join(path.dirname(config.arquivoDados), 'demo', 'processos.json');
  const total = semear(arquivo, hojeISO());
  console.log(`Demonstração: ${total} clientes fictícios criados em ${arquivo}`);
  iniciarServidor({ arquivoDados: arquivo, modoDemo: true });
}

module.exports = { semear };
