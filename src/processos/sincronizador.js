// Sincronização com o SGP em segundo plano.
// A leitura completa do SGP pode levar vários minutos, então:
//  - o botão da tela só "dispara" e a tela acompanha o andamento;
//  - uma agenda roda sozinha uma vez por dia, a partir de um horário (padrão 7h).
// Só uma sincronização roda por vez.
function horaLocal(timeZone, agora = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(agora));
}

function criarSincronizador({ executar, hoje, timeZone = process.env.TZ || 'America/Sao_Paulo', horaInicio = 7, intervaloMs = 30 * 60 * 1000 }) {
  let emAndamento = null;
  let ultima = null;
  let iniciadaEm = null;

  function rodar(origem = 'manual', diaEscolhido = null) {
    if (emAndamento) return emAndamento;
    iniciadaEm = new Date().toISOString();
    emAndamento = (async () => {
      const dia = diaEscolhido || hoje();
      try {
        const r = await executar(dia);
        ultima = { dia, origem, inicio: iniciadaEm, fim: new Date().toISOString(), ok: true, total: r.totalBloqueados, totalPosCancelamento: r.totalPosCancelamento || 0, novos: r.novos.map((p) => p.cliente.nome) };
      } catch (erro) {
        console.error(`Sincronização com o SGP falhou: ${erro.message}`);
        ultima = { dia, origem, inicio: iniciadaEm, fim: new Date().toISOString(), ok: false, erro: erro.message };
      } finally {
        emAndamento = null;
      }
      return ultima;
    })();
    return emAndamento;
  }

  function status() {
    return { emAndamento: Boolean(emAndamento), iniciadaEm: emAndamento ? iniciadaEm : null, ultima };
  }

  // Confere de tempos em tempos: se hoje ainda não sincronizou e já passou do horário, sincroniza.
  function iniciarAgenda() {
    const conferir = () => {
      const jaHoje = ultima && ultima.ok && ultima.dia === hoje();
      if (!emAndamento && !jaHoje && horaLocal(timeZone) >= horaInicio) rodar('automática');
    };
    conferir();
    const relogio = setInterval(conferir, intervaloMs);
    relogio.unref();
    return () => clearInterval(relogio);
  }

  return { rodar, status, iniciarAgenda };
}

module.exports = { criarSincronizador, horaLocal };
