// Datas no formato 'AAAA-MM-DD' (só o dia, sem hora), para não ter problema de fuso.
const MS_POR_DIA = 24 * 60 * 60 * 1000;
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function paraData(iso) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function paraISO(data) {
  return data.toISOString().slice(0, 10);
}

function adicionarDias(iso, dias) {
  return paraISO(new Date(paraData(iso).getTime() + dias * MS_POR_DIA));
}

function diasEntre(inicio, fim) {
  return Math.round((paraData(fim) - paraData(inicio)) / MS_POR_DIA);
}

function ehDiaUtil(iso, feriados = []) {
  const diaSemana = paraData(iso).getUTCDay();
  return diaSemana !== 0 && diaSemana !== 6 && !feriados.includes(iso);
}

// O próprio dia, se for útil; senão o próximo dia útil.
function proximoDiaUtil(iso, feriados = []) {
  let dia = iso;
  while (!ehDiaUtil(dia, feriados)) dia = adicionarDias(dia, 1);
  return dia;
}

function adicionarDiasUteis(iso, quantidade, feriados = []) {
  let dia = iso;
  let restantes = quantidade;
  while (restantes > 0) {
    dia = adicionarDias(dia, 1);
    if (ehDiaUtil(dia, feriados)) restantes--;
  }
  return dia;
}

// Volta N dias úteis (se o dia de partida não for útil, começa do dia útil anterior).
function subtrairDiasUteis(iso, quantidade, feriados = []) {
  let dia = iso;
  while (!ehDiaUtil(dia, feriados)) dia = adicionarDias(dia, -1);
  let restantes = quantidade;
  while (restantes > 0) {
    dia = adicionarDias(dia, -1);
    if (ehDiaUtil(dia, feriados)) restantes--;
  }
  return dia;
}

// Próximo aviso de uma etapa "dia sim, dia não" (regra do Miguel, 23/11): entre um aviso e o outro o cliente
// precisa ter pelo menos um dia de folga para regularizar, e esse dia pode ser QUALQUER dia (útil, sábado,
// domingo ou feriado). Então conta dias corridos e cai no próximo dia útil:
//   segunda -> quarta; quinta (sexta normal) -> segunda; sexta -> segunda;
//   quinta com sexta feriado -> segunda; terça com quarta feriado -> quinta.
function proximoAviso(iso, intervalo = 2, feriados = []) {
  return proximoDiaUtil(adicionarDias(iso, intervalo), feriados);
}

// O contrário: o dia útil mais recente cujo próximo aviso cai até a data informada.
function avisoAnterior(iso, intervalo = 2, feriados = []) {
  let dia = adicionarDias(iso, -1);
  while (!(ehDiaUtil(dia, feriados) && proximoAviso(dia, intervalo, feriados) <= iso)) dia = adicionarDias(dia, -1);
  return dia;
}

function hojeISO(timeZone = process.env.TZ || 'America/Sao_Paulo', agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

// '2026-11-16' -> '16/11/2026 (segunda)'
function formatarData(iso) {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano} (${DIAS_SEMANA[paraData(iso).getUTCDay()]})`;
}

module.exports = { adicionarDias, diasEntre, ehDiaUtil, proximoDiaUtil, adicionarDiasUteis, subtrairDiasUteis, proximoAviso, avisoAnterior, hojeISO, formatarData };
