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
