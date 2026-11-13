const test = require('node:test');
const assert = require('node:assert');
const { adicionarDias, diasEntre } = require('../src/utils/datas');

test('adicionarDias soma dias corretamente', () => {
  const r = adicionarDias('2026-01-01T00:00:00Z', 16);
  assert.strictEqual(r.toISOString(), '2026-01-17T00:00:00.000Z');
});

test('diasEntre conta dias inteiros', () => {
  assert.strictEqual(diasEntre('2026-01-01T00:00:00Z', '2026-01-17T00:00:00Z'), 16);
});
