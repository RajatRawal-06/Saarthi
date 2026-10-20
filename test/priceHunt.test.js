import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
process.env.ERRAND_DATA_DIR = fileURLToPath(new URL('../data-test', import.meta.url));
const { parseStores, resolveStore, matchScore, findCandidates, checkStore, mapConcurrent, createPriceHunt } = await import('../lib/chores/priceHunt.js');
const { RETAILERS, retailerForDomain, storeEntryUrl, retailersForCountry } = await import('../lib/stores.js');
const { isSensitiveField, detectBlock } = await import('../lib/safety.js');

test('store names resolve to real domains', () => {
  assert.deepEqual(parseStores('Blinkit', 'IN'), ['blinkit.com']);
  assert.deepEqual(parseStores('blinkit, zepto and Amazon', 'IN'), ['blinkit.com', 'zeptonow.com', 'amazon.in']);
  assert.deepEqual(parseStores('Swiggy Instamart', 'IN'), ['swiggy.com']);
  assert.deepEqual(parseStores('amazon flipkart', 'IN'), ['amazon.in', 'flipkart.com']);
  assert.deepEqual(parseStores('https://www.croma.com/x', 'IN'), ['croma.com']);
  assert.equal(resolveStore('amazon', 'US'), 'amazon.com');
  assert.deepEqual(parseStores('', 'IN'), []);
  assert.equal(resolveStore('Tata 1mg', 'IN'), '1mg.com');
  assert.equal(resolveStore('not a configured shop', 'IN'), null);
  assert.deepEqual(parseStores('not a configured shop', 'IN'), []);
});

test('the India retailer directory gives every configured site a direct search URL', () => {
  const sites = retailersForCountry('IN');
  assert.equal(sites.length, 18);
  assert.ok(sites.some((site) => site.domain === '1mg.com'));
  for (const site of sites) {
    assert.ok(retailerForDomain(site.domain), site.domain);
    assert.match(storeEntryUrl(site.domain, 'Dolo 650', 'IN'), /^https:\/\//, site.domain);
  }
});

test('candidate discovery searches every configured India site when web search misses it', async () => {
  const events = [];
  const calls = [];
  const ctx = {
    step: (...args) => events.push(args),
    log: (...args) => events.push(args),
    usage: (...args) => events.push(args),
  };
  const candidates = await findCandidates(ctx, {
    product: 'Dolo 650', country: 'IN', stores: [], maxStores: 4,
  }, {
    searchFn: async (_query, opts) => { calls.push(opts); return { results: [] }; },
  });
  assert.equal(calls.length, 18);
  assert.deepEqual(new Set(calls.map((opts) => opts.include_domains)), new Set(retailersForCountry('IN').map((site) => site.domain)));
  assert.equal(candidates.length, 18);
  assert.ok(candidates.some((candidate) => candidate.domain === '1mg.com' && candidate.url.includes('/search/all')));
});

test('site-scoped search results route live checks to the discovered product page', async () => {
  const ctx = { step() {}, log() {}, usage() {} };
  const productUrl = 'https://www.1mg.com/drugs/dolo-650-tablet-74467';
  const candidates = await findCandidates(ctx, {
    product: 'Dolo 650', country: 'IN', stores: ['1mg.com'], storeSelectionProvided: true,
  }, {
    searchFn: async (_query, opts) => {
      assert.equal(opts.include_domains, '1mg.com');
      return { results: [{ url: productUrl, title: 'Buy Dolo 650 Tablet Online', snippet: 'Price ₹31' }] };
    },
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, productUrl);
  assert.equal(candidates[0].viaStoreSearch, false);
});

test('a price-only coincidence does not become a product candidate', async () => {
  const ctx = { step() {}, log() {}, usage() {} };
  const candidates = await findCandidates(ctx, {
    product: 'Dolo 650', country: 'IN', stores: ['myntra.com'], storeSelectionProvided: true,
  }, {
    searchFn: async () => ({ results: [{
      url: 'https://www.myntra.com/colorbar-lipstick',
      title: 'Colorbar Matte Lipstick',
      snippet: 'Price ₹650, in stock',
    }] }),
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].viaStoreSearch, true);
  assert.match(candidates[0].url, /myntra\.com/);
});

test('app-store pages are not treated as retailer listings', async () => {
  const ctx = { step() {}, log() {}, usage() {} };
  const candidates = await findCandidates(ctx, {
    product: 'Dolo 650', country: 'IN', stores: ['apple.com'], storeSelectionProvided: true,
  }, {
    searchFn: async () => ({ results: [{
      url: 'https://apps.apple.com/in/app/platinumrx-medicine-health/id6477701930',
      title: 'PlatinumRx Medicine & Health',
      snippet: 'Order Dolo 650 online with delivery.',
    }] }),
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].domain, 'apple.com');
  assert.equal(candidates[0].viaStoreSearch, true);
  assert.ok(candidates[0].url.startsWith('https://www.apple.com/in/search/'));
});

test('an unconfigured requested site is reported unsupported instead of guessed', async () => {
  const ctx = { step() {}, log() {}, usage() {} };
  const candidates = await findCandidates(ctx, {
    product: 'Dolo 650', country: 'IN', stores: [], unsupportedStores: ['unknown-retailer'],
    storeSelectionProvided: true, maxStores: 8,
  }, { searchFn: async () => assert.fail('must not search unconfigured sites') });
  assert.deepEqual(candidates.map(({ domain, unsupported }) => [domain, unsupported]), [['unknown-retailer', true]]);
});

test('store checks reject prices without a visible product name and reuse saved login profiles', async () => {
  let optsSeen;
  const candidate = {
    url: 'https://www.1mg.com/search/all?name=Dolo%20650', domain: '1mg.com',
    retailer: RETAILERS.find((site) => site.domain === '1mg.com'), viaStoreSearch: true,
  };
  const ctx = { log() {} };
  const incomplete = await checkStore(ctx, 'Dolo 650', candidate, 'IN', '', {
    smartRunFn: async () => ({ ok: true, result: { price: 42, currency: 'INR', in_stock: true, page_status: 'ok' } }),
    accountForFn: () => ({ connectedAt: 1, profileId: 'profile-1' }),
  });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.state, 'unverified');

  const verified = await checkStore(ctx, 'Dolo 650', candidate, 'IN', '', {
    smartRunFn: async (_ctx, opts) => { optsSeen = opts; return { ok: true, result: { product_name: 'Dolo 650 Tablet', price: 42, currency: 'INR', in_stock: true, page_status: 'ok' } }; },
    accountForFn: () => ({ connectedAt: 1, profileId: 'profile-1' }),
  });
  assert.equal(verified.ok, true);
  assert.equal(optsSeen.profileId, 'profile-1');
  assert.equal(optsSeen.noRetry, false);
  assert.equal(optsSeen.maxSeconds, 55);

  const blocked = await checkStore(ctx, 'Dolo 650', candidate, 'IN', '', {
    smartRunFn: async () => ({ ok: false, reason: 'CAPTCHA-protected.', status: 'COMPLETED', result: { page_status: 'captcha' } }),
    accountForFn: () => null,
  });
  assert.equal(blocked.state, 'blocked');
});

test('search-page checks get a slightly longer deadline than direct product pages', async () => {
  const candidate = {
    url: 'https://www.1mg.com/search/all?name=Dolo%20650', domain: '1mg.com',
    retailer: RETAILERS.find((site) => site.domain === '1mg.com'), viaStoreSearch: true,
  };
  let maxSeconds;
  await checkStore({ log() {} }, 'Dolo 650', candidate, 'IN', '', {
    smartRunFn: async (_ctx, opts) => { maxSeconds = opts.maxSeconds; return { ok: false, reason: 'Timeout', error: { code: 'TIMEOUT' } }; },
  });
  assert.equal(maxSeconds, 55);
});

test('expired retailer sessions are marked when a site requests login again', async () => {
  let expiredStore = null;
  const candidate = {
    url: 'https://www.1mg.com/drugs/dolo-650-tablet-74467', domain: '1mg.com',
    retailer: RETAILERS.find((site) => site.domain === '1mg.com'), viaStoreSearch: false,
  };
  const result = await checkStore({ log() {} }, 'Dolo 650', candidate, 'IN', '', {
    smartRunFn: async () => ({ ok: true, result: { product_name: '', page_status: 'login_required' } }),
    accountForFn: () => ({ connectedAt: 1, profileId: 'profile-1' }),
    markExpiredFn: (store) => { expiredStore = store; },
  });
  assert.equal(result.state, 'login_required');
  assert.equal(expiredStore, 'tata1mg');
});

test('concurrent store worker count is bounded', async () => {
  let active = 0;
  let peak = 0;
  const result = await mapConcurrent(Array.from({ length: 12 }, (_, i) => i), async (item) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 3));
    active--;
    return item * 2;
  }, 3);
  assert.equal(peak, 3);
  assert.deepEqual(result, Array.from({ length: 12 }, (_, i) => i * 2));
});

test('a full price hunt dispatches every configured retailer and returns partial results', async () => {
  let active = 0;
  let peak = 0;
  const searchCalls = [];
  const ctx = { step() {}, log() {}, usage() {}, update() {} };
  const run = createPriceHunt({
    concurrencyLimit: 4,
    searchFn: async (query, opts) => { searchCalls.push({ query, opts }); return { results: [] }; },
    accountForFn: () => null,
    captureProofFn: async () => ({ ok: false }),
    smartRunFn: async (_ctx, opts) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return { ok: true, run_id: opts.label, result: {
        product_name: 'Dolo 650 Tablet', price: opts.label === '1mg.com' ? 21 : 30,
        currency: 'INR', in_stock: true, page_status: 'ok',
      } };
    },
  });
  const result = await run(ctx, { product: 'Dolo 650', country: 'IN' });
  assert.equal(searchCalls.length, 18);
  assert.equal(result.offers.length, 18);
  assert.equal(result.failed.length, 0);
  assert.equal(result.best.domain, '1mg.com');
  assert.equal(peak, 4);
});

test('model numbers must match', () => {
  assert.ok(matchScore('Sony WH-1000XM5', 'Sony WH-1000XM5 Wireless Headphones') > 0.9);
  assert.ok(matchScore('Sony WH-1000XM5', 'Sony WH-1000XM4 Wireless Headphones') < 0.6);
});

test('grocery and unit matching handles commodities cleanly', () => {
  assert.ok(matchScore('onions 1 kg', 'Fresh Onion') >= 0.85);
  assert.ok(matchScore('onions 1 kg', 'Fresh Onion 900 g - 1 kg') >= 0.85);
  assert.ok(matchScore('onion 1kg', 'Fresh Onion') >= 0.85);
  assert.ok(matchScore('onion 1kg', 'Fresh Onion 1 kg') >= 0.85);
  assert.ok(matchScore('onions 1 kg', 'Watermelon 1 kg') < 0.4);
  assert.ok(matchScore('atta 5kg', 'Aashirvaad Shudh Chakki Atta 5 kg') >= 0.85);
  assert.ok(matchScore('atta 5kg', 'Fortune Basmati Rice 5 kg') < 0.4);
  assert.ok(matchScore('Dolo 650', 'Dolo 650 Tablet') >= 0.9);
  assert.ok(matchScore('Dolo 650', 'Dolo 500 Tablet') < 0.6);
});

test('sensitive fields are never auto-filled', () => {
  for (const f of ['Password', 'OTP', 'Card number', 'CVV', 'Aadhaar No', 'UPI ID']) assert.ok(isSensitiveField(f), f);
  for (const f of ['Full name', 'Email', 'Phone', 'PIN code']) assert.ok(!isSensitiveField(f), f);
});

test('COMPLETED-but-blocked runs are detected', () => {
  assert.equal(detectBlock({ status: 'COMPLETED', result: { page_status: 'captcha' } }), 'captcha');
  assert.equal(detectBlock({ status: 'COMPLETED', result: { message: 'Access denied' } }), 'blocked');
  assert.equal(detectBlock({ status: 'COMPLETED', result: { page_status: 'ok', price: 10 } }), null);
});
