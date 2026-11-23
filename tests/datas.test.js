const test = require('node:test');
const assert = require('node:assert');
const { adicionarDias, diasEntre, ehDiaUtil, proximoDiaUtil, adicionarDiasUteis, formatarData } = require('../src/utils/datas');

test('adicionarDias e diasEntre', () => {
  assert.strictEqual(adicionarDias('2026-11-30', 1), '2026-12-01');
  assert.strictEqual(diasEntre('2026-11-01', '2026-11-17'), 16);
});

test('dias úteis pulam fim de semana e feriados', () => {
  assert.strictEqual(ehDiaUtil('2026-11-16'), true); // segunda
  assert.strictEqual(ehDiaUtil('2026-11-21'), false); // sábado
  assert.strictEqual(proximoDiaUtil('2026-11-21'), '2026-11-23');
  assert.strictEqual(adicionarDiasUteis('2026-11-20', 2), '2026-11-24'); // sexta + 2 úteis = terça
  assert.strictEqual(adicionarDiasUteis('2026-11-19', 1, ['2026-11-20']), '2026-11-23');
});

test('formatarData', () => {
  assert.strictEqual(formatarData('2026-11-16'), '16/11/2026 (segunda)');
});

test('próximo aviso: o dia de folga pode ser fim de semana ou feriado (regra de 23/11)', () => {
  const { proximoAviso, avisoAnterior } = require('../src/utils/datas');
  assert.strictEqual(proximoAviso('2026-11-16'), '2026-11-18'); // segunda -> quarta
  assert.strictEqual(proximoAviso('2026-11-12'), '2026-11-16'); // quinta (sexta normal) -> segunda
  assert.strictEqual(proximoAviso('2026-11-13'), '2026-11-16'); // sexta -> segunda
  assert.strictEqual(proximoAviso('2026-11-19', 2, ['2026-11-20']), '2026-11-23'); // quinta, sexta feriado -> segunda
  assert.strictEqual(proximoAviso('2026-11-24', 2, ['2026-11-25']), '2026-11-26'); // terça, quarta feriado -> quinta
  assert.strictEqual(avisoAnterior('2026-11-23', 2, ['2026-11-20']), '2026-11-19');
  assert.strictEqual(avisoAnterior('2026-11-18'), '2026-11-16');
});
