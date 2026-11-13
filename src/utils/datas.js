// Funções utilitárias de data usadas pelo cronograma.
const MS_POR_DIA = 24 * 60 * 60 * 1000;

function adicionarDias(data, dias) {
  return new Date(new Date(data).getTime() + dias * MS_POR_DIA);
}

function diasEntre(inicio, fim) {
  return Math.floor((new Date(fim) - new Date(inicio)) / MS_POR_DIA);
}

module.exports = { adicionarDias, diasEntre };
