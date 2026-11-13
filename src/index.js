// Ponto de entrada do sistema de cancelamento por inadimplência.
const config = require('./config');

function main() {
  const { etapas } = config.carregarCronograma();
  console.log(`Processo-Cancelamento iniciado (${config.ambiente}).`);
  console.log(`${etapas.length} etapa(s) configurada(s) no cronograma.`);
}

main();
