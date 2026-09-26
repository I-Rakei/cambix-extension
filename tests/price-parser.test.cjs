const test = require('node:test');
const assert = require('node:assert/strict');
require('../price-parser.js');

const { findPrices, barePrice, inferCurrency } = globalThis.CambixPrice;

test('recognizes common South African, US, and Portuguese price formats', () => {
  const cases = [
    ['R\u00a04\u00a0497,00', 'ZAR', 4497],
    ['R 3,999 00', 'ZAR', 3999],
    ['ZAR 1 299,99', 'ZAR', 1299.99],
    ['$1,299.99', 'USD', 1299.99],
    ['US $18.50', 'USD', 18.5],
    ['€1.234,56', 'EUR', 1234.56],
    ['29,99 €', 'EUR', 29.99],
    ['CAD 49.99', 'CAD', 49.99],
    ['£34.95', 'GBP', 34.95]
  ];
  for (const [text, code, amount] of cases) {
    const [found] = findPrices(text);
    assert.equal(found?.code, code, text);
    assert.equal(found?.amount, amount, text);
  }
});

test('finds multiple prices without treating unmarked numbers as prices', () => {
  assert.equal(findPrices('Now R 299,99, was R 349,99').length, 2);
  assert.equal(findPrices('Model 1299, quantity 2').length, 0);
});

test('infers currency only for scoped price elements', () => {
  assert.equal(inferCurrency('www.amazon.co.za'), 'ZAR');
  assert.equal(inferCurrency('www.vinted.pt'), 'EUR');
  assert.equal(inferCurrency('www.amazon.com'), 'USD');
  assert.equal(inferCurrency('www.takealot.com'), 'ZAR');
  assert.equal(inferCurrency('shop.example.com', 'pt-PT'), 'EUR');
  assert.equal(inferCurrency('shop.example.com'), null);
  assert.equal(barePrice('1.299,99', 'EUR').amount, 1299.99);
  assert.equal(barePrice('1.299,99', null), null);
});
