// Dados FICTÍCIOS para testar o sistema sem acessar o SGP real.
const { adicionarDias } = require('../../utils/datas');

function criarFonteExemplo(hoje) {
  const clientes = [
    { id: '9001', nome: 'Cliente Exemplo A', contrato: 'C-9001', diasBloqueado: 0 },
    { id: '9002', nome: 'Cliente Exemplo B', contrato: 'C-9002', diasBloqueado: 1 },
    { id: '9003', nome: 'Cliente Exemplo C', contrato: 'C-9003', diasBloqueado: 3 },
  ];
  return {
    async listarClientesBloqueados() {
      return clientes.map(({ diasBloqueado, ...c }) => ({ ...c, bloqueadoEm: adicionarDias(hoje, -diasBloqueado) }));
    },
  };
}

module.exports = { criarFonteExemplo };
