import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicatePriceHunt, priceHuntKey } from '../lib/priceHuntDedupe.js';

test('price hunt key ignores whitespace and the India live-check cap', () => {
  assert.equal(
    priceHuntKey({ product: '  Cadbury   Silk ', country: 'IN', maxStores: 6 }),
    priceHuntKey({ product: 'cadbury silk', country: 'in', maxStores: 18 }),
  );
});

test('an identical active hunt is reused but completed and different hunts are not', () => {
  const active = { id: 'active', type: 'price_hunt', status: 'running', input: { product: 'Cadbury Silk', country: 'IN', targetPrice: '175' } };
  const completed = { id: 'done', type: 'price_hunt', status: 'done', input: active.input };
  assert.equal(findDuplicatePriceHunt({ product: ' cadbury  silk ', country: 'in', targetPrice: 175, maxStores: 8 }, [completed, active]), active);
  assert.equal(findDuplicatePriceHunt({ product: 'Dolo 650', country: 'IN' }, [active]), null);
});
