// Histórico (auditoria) de tudo que acontece com cada processo: quem, o quê e quando.
function registrar(processo, { data, por, evento, detalhes }) {
  processo.historico.push({
    data,
    registradoEm: new Date().toISOString(),
    por,
    evento,
    detalhes,
  });
}

module.exports = { registrar };
