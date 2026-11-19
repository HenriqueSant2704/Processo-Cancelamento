// Dados FICTÍCIOS para testar o sistema sem acessar o SGP real.
const { adicionarDias } = require('../../utils/datas');

// Fichas fictícias (CPF, contatos, plano, faturas) para a demonstração.
function fichasExemplo(contratos, hoje) {
  return new Map(contratos.map((c, i) => [String(c), {
    documento: '000.000.000-00', tipoPessoa: 'F', telefones: ['(00) 90000-0000'], emails: ['cliente@exemplo.com'],
    plano: 'Plano Exemplo 300 MB', diaVencimento: 10, formaCobranca: 'Boleto', clienteDesde: adicionarDias(hoje, -400),
    faturas: [
      { vencimento: adicionarDias(hoje, -20), valor: 99.9, status: 'aberto', pagoEm: null, diasAtraso: 20 },
      { vencimento: adicionarDias(hoje, -50), valor: 99.9, status: 'pago', pagoEm: adicionarDias(hoje, -40), diasAtraso: 10 },
      { vencimento: adicionarDias(hoje, -80), valor: 99.9, status: 'pago', pagoEm: adicionarDias(hoje, -80), diasAtraso: 0 },
    ],
    frequencia: { nivel: i % 2 ? 'frequente' : 'as-vezes', faturas: 3, emDia: 1, pagasComAtraso: 1, emAberto: 1, atrasoMedio: 10 },
  }]));
}

function criarFonteExemplo(hoje) {
  const clientes = [
    { id: '9001', nome: 'Cliente Exemplo A', contrato: 'C-9001', diasBloqueado: 0 },
    { id: '9002', nome: 'Cliente Exemplo B', contrato: 'C-9002', diasBloqueado: 1 },
    { id: '9003', nome: 'Cliente Exemplo C', contrato: 'C-9003', diasBloqueado: 3 },
  ];
  return {
    async listarClientesBloqueados() {
      return clientes.map(({ diasBloqueado, ...c }) => ({ ...c, bloqueadoEm: adicionarDias(hoje, -diasBloqueado), financeiro: { valorAberto: 99.9, faturasAbertas: 1 } }));
    },
    async comentariosDaOcorrencia() {
      return [];
    },
    async listarFichas(contratos) {
      return fichasExemplo(contratos, hoje);
    },
    async listarPosCancelamento() {
      return [{ contrato: 'C-9101', nome: 'Cliente Exemplo D (cancelado)', ocorrencia: { numero: '900001', abertaEm: adicionarDias(hoje, -5) } }];
    },
  };
}

module.exports = { criarFonteExemplo, fichasExemplo };
