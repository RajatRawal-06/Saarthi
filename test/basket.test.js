import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePack, packsNeeded, classify, buildOffers, feesFor, optimise, APPS, APP_NAMES, isSearchBanner, productFormCompatible } from '../public/lib/basket.js';
import { parseList } from '../lib/basket/parse.js';
import { amazonQueryMatches, amazonTilesFromCards, searchUrl, tilesFromText } from '../lib/basket/scan.js';
import { chunkSearchTargets, confirmsDeliveryPin, SEARCH_AGENTS_PER_PROFILE, searchAgentSeconds, searchPartialNote, searchUnavailableNote } from '../lib/basket/jhola.js';
import { isMissingProfileError } from '../lib/accounts.js';

test('store search runs have item-aware hard deadlines', () => {
  assert.equal(searchAgentSeconds(1), 60);
  assert.equal(searchAgentSeconds(4), 84);
  assert.equal(searchAgentSeconds(30), 180);
});

test('authenticated store searches use one product per profile-safe agent task', () => {
  const targets = Array.from({ length: 7 }, (_, i) => ({ item: { name: String(i) } }));
  const chunks = chunkSearchTargets(targets);
  assert.deepEqual(chunks.map((batch) => batch.length), [1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(chunks.flat(), targets);
  assert.equal(SEARCH_AGENTS_PER_PROFILE, 1);
});

test('store failure notes distinguish timeout, login and blocking', () => {
  const timedOut = searchUnavailableNote({ agentErrorCode: 'TIMEOUT', scanIssue: 'timeout' });
  assert.match(timedOut, /timed out/i);
  assert.doesNotMatch(timedOut, /blocked/i);
  assert.match(searchUnavailableNote({ scanIssue: 'logged_out' }), /login/i);
  assert.match(searchUnavailableNote({ scanIssue: 'location_needed' }), /delivery location/i);
  assert.match(searchUnavailableNote({ scanIssue: 'location_unverified' }), /delivery PIN/i);
  assert.match(searchUnavailableNote({ blocked: true, scanIssue: 'blocked' }), /blocked/i);
});

test('stale remote retailer profiles are recognized without retrying unrelated 404 errors', () => {
  assert.equal(isMissingProfileError({ code: 'NOT_FOUND', status: 404, message: "Profile with id 'abc' not found" }), true);
  assert.equal(isMissingProfileError({ code: 'PROFILE_NOT_FOUND', message: 'profile expired' }), true);
  assert.equal(isMissingProfileError({ code: 'NOT_FOUND', status: 404, message: 'Product not found' }), false);
  assert.equal(isMissingProfileError({ code: 'TIMEOUT', message: 'Profile request timed out' }), false);
});

test('partial store results are not mislabeled as unavailable', () => {
  assert.match(searchPartialNote('navigation_failed'), /partial results/i);
  assert.match(searchPartialNote('timeout'), /remaining product searches timed out/i);
  assert.match(searchPartialNote('location_needed'), /delivery location/i);
  assert.match(searchPartialNote('location_unverified'), /delivery PIN/i);
  assert.equal(searchPartialNote(null), null);
});

test('local offers require the requested delivery PIN to be confirmed', () => {
  assert.equal(confirmsDeliveryPin('Prahladpur Bangar - 110042, Delhi', '110042'), true);
  assert.equal(confirmsDeliveryPin('Delhi', '110042'), false);
  assert.equal(confirmsDeliveryPin(null, ''), true);
});

test('basket compares Blinkit, Zepto and Amazon Fresh', () => {
  assert.deepEqual(APPS, ['blinkit', 'zepto', 'amazon']);
  assert.equal(APP_NAMES.amazon, 'Amazon Fresh');
  assert.equal(APPS.includes('instamart'), false);
  assert.equal(APP_NAMES.instamart, 'Swiggy Instamart (saved run)');
});

test('Amazon search result text parses Add to cart and MRP', () => {
  const results = tilesFromText([
    'Cadbury Dairy Milk Silk Chocolate Bar',
    '150 g',
    '₹210.00',
    'M.R.P.: ₹250.00',
    'Add to cart',
  ].join('\n'));
  assert.equal(results.length, 1);
  assert.equal(results[0].price, 210);
  assert.equal(results[0].mrp, 250);
  assert.match(results[0].name, /Cadbury Dairy Milk Silk/);
});

test('browser tile parsing ignores result banners instead of treating them as products', () => {
  const results = tilesFromText([
    'Showing results for banana',
    'Fresh Robusta Banana',
    '6 pcs',
    '₹48',
    'Add',
  ].join('\n'));
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Fresh Robusta Banana');
  assert.equal(isSearchBanner('Showing results for banana'), true);
  assert.equal(isSearchBanner('Fresh Robusta Banana'), false);
});

test('retailer scans reject obvious wrong product forms while keeping grocery matches', () => {
  const item = (name, unit = 'pc', quantity = 1) => ({ id: name, name, unit, quantity, allowSubstitute: true });
  assert.equal(productFormCompatible(item('banana'), 'Live Banana Fruit Plant'), false);
  assert.equal(productFormCompatible(item('banana'), 'Banana chips'), false);
  assert.equal(productFormCompatible(item('apple', 'g', 1000), 'Apple Plant'), false);
  assert.equal(productFormCompatible(item('brown bread'), 'Brown Rice Cakes'), false);
  assert.equal(productFormCompatible(item('milk', 'ml', 1000), 'Milk Powder'), false);
  assert.equal(productFormCompatible(item('amul butter', 'g', 100), 'Amul Butter Cookies'), false);
  assert.equal(productFormCompatible(item('amul butter', 'g', 100), 'Amul Butter 100 g'), true);
});

test('basket offers filter search banners and non-grocery lookalikes', () => {
  const item = { id: 'b', name: 'banana', quantity: 6, unit: 'pc', allowSubstitute: true };
  const offers = buildOffers(item, 'amazon', [
    { name: 'Showing results for banana', price: 99 },
    { name: 'Live Banana Fruit Plant', price: 99 },
    { name: 'Banana Chips', price: 99 },
    { name: 'Fresh Banana 6 pcs', price: 50 },
  ]);
  assert.deepEqual(offers.map((offer) => offer.productName), ['Fresh Banana 6 pcs']);
});

test('Amazon search cards use the product title and listing price, not payment promotions', () => {
  const results = amazonTilesFromCards([
    { name: 'Cadbury Dairy Milk Silk Chocolate Bar, 150 grams', price: '₹210', mrp: '₹290', in_stock: true },
    { name: 'Cadbury Dairy Milk Silk Chocolate Bars, 60 g', price: '₹159', mrp: '₹190', in_stock: true },
  ]);
  assert.deepEqual(results, [
    { name: 'Cadbury Dairy Milk Silk Chocolate Bar, 150 grams', pack: '150 grams', price: 210, mrp: 290, in_stock: true },
    { name: 'Cadbury Dairy Milk Silk Chocolate Bars, 60 g', pack: '60 g', price: 159, mrp: 190, in_stock: true },
  ]);
  assert.equal(amazonQueryMatches('Cadbury Dairy Milk Silk Chocolate Bar 150 g', results[0].name), true);
  assert.equal(amazonQueryMatches('Cadbury Dairy Milk Silk Chocolate Bar 150 g', 'Up to 5% back with Amazon Pay ICICI card'), false);
  assert.equal(amazonQueryMatches('Cadbury Dairy Milk Silk Chocolate Bar 150 g', 'Cadbury Dairy Milk Astros Special Edition Chocolate Bar, 80 g'), false);
});

test('store searches start at store-specific results pages', () => {
  assert.equal(searchUrl('zepto', 'milk 1 L'), 'https://www.zeptonow.com/search?query=milk%201%20L');
  assert.equal(searchUrl('blinkit', 'Amul milk'), 'https://blinkit.com/s/?q=Amul%20milk');
  assert.equal(searchUrl('amazon', 'oats'), 'https://www.amazon.in/s?k=oats');
  assert.equal(searchUrl('unknown', 'item'), null);
});

test('Hinglish list parsing', () => {
  const items = parseList('doodh 2 packet, atta 5kg, maggi 4, dhaniya');
  assert.deepEqual(items.map((i) => [i.name, i.quantity, i.unit]), [['milk', 1000, 'ml'], ['atta', 5000, 'g'], ['maggi', 4, 'pc'], ['coriander leaves', 1, 'pc']]);
  const [a] = parseList('sirf aashirvaad atta 10 kg');
  assert.equal(a.brand, 'aashirvaad');
  assert.equal(a.allowSubstitute, false);
  assert.equal(parseList('1 dozen ande')[0].quantity, 12);
});

test('pack sizes', () => {
  assert.deepEqual(parsePack('500 ml'), { size: 500, unit: 'ml', count: 1 });
  assert.deepEqual(parsePack('1 kg'), { size: 1000, unit: 'g', count: 1 });
  assert.deepEqual(parsePack('4 x 70 g'), { size: 280, unit: 'g', count: 4 });
  assert.deepEqual(parsePack('6 pieces'), { size: 6, unit: 'pc', count: 6 });
  assert.equal(parsePack('1 L').size, 1000);
});

test('packs needed and match kinds', () => {
  const milk = { name: 'milk', quantity: 1000, unit: 'ml', brand: null, allowSubstitute: true };
  assert.equal(packsNeeded(milk, parsePack('500 ml')), 2);
  assert.equal(packsNeeded(milk, parsePack('1 L')), 1);
  const eggs = { name: 'eggs', quantity: 12, unit: 'pc' };
  assert.equal(packsNeeded(eggs, parsePack('6 pcs')), 2);
  const atta = { name: 'aashirvaad atta', quantity: 5000, unit: 'g', brand: 'aashirvaad' };
  assert.equal(classify(atta, 'Aashirvaad Shudh Chakki Atta', parsePack('5 kg')), 'exact');
  assert.equal(classify(atta, 'Aashirvaad Shudh Chakki Atta', parsePack('2 kg')), 'size_variant');
  assert.equal(classify(atta, 'Fortune Chakki Fresh Atta', parsePack('5 kg')), 'substitute');
  const bananas = { name: 'banana', quantity: 6, unit: 'pc' };
  assert.equal(classify(bananas, 'Banana Robusta', parsePack('3 pcs')), 'exact');
  assert.equal(classify(bananas, 'Banana Raw', parsePack('500 g')), 'size_variant');
  assert.equal(packsNeeded(bananas, parsePack('500 g')), 1);
});

test('no-substitute items drop substitutes', () => {
  const item = { id: 'a', name: 'amul butter', quantity: 100, unit: 'g', brand: 'amul', allowSubstitute: false };
  const offers = buildOffers(item, 'blinkit', [{ name: 'Amul Butter', pack: '100 g', price: 58 }, { name: 'Mother Dairy Butter', pack: '100 g', price: 50 }]);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].productName, 'Amul Butter');
});

test('fees: delivery, small cart threshold', () => {
  const r = { deliveryFee: 30, freeDeliveryAbove: 199, handlingFee: 4, smallCartFee: 20, smallCartThreshold: 99 };
  assert.equal(feesFor(r, 50).total, 54);
  assert.equal(feesFor(r, 150).total, 34);
  assert.equal(feesFor(r, 250).total, 4);
  assert.equal(feesFor(r, 0).total, 0);
});

const offer = (app, itemId, price) => ({ app, itemId, productName: `${itemId}@${app}`, lineCost: price, packs: 1, price });
const FEES = {
  blinkit: { deliveryFee: 30, freeDeliveryAbove: 200, handlingFee: 4 },
  zepto: { deliveryFee: 30, freeDeliveryAbove: 200, handlingFee: 4 },
  amazon: {},
};

test('a split wins when it beats the best single app after fees', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const offers = {
    a: { blinkit: [offer('blinkit', 'a', 300)], zepto: [offer('zepto', 'a', 400)] },
    b: { blinkit: [offer('blinkit', 'b', 400)], zepto: [offer('zepto', 'b', 250)] },
  };
  const r = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'zepto'] });
  assert.deepEqual(r.best.apps, ['blinkit', 'zepto']);
  assert.equal(r.best.total, 300 + 250 + 8);
  assert.equal(r.bestSingle.total, 654); // zepto 650 + 4
  assert.equal(r.savings, 96);
});

test('fees pull small items onto one app', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const offers = {
    a: { blinkit: [offer('blinkit', 'a', 100)], zepto: [offer('zepto', 'a', 110)] },
    b: { blinkit: [offer('blinkit', 'b', 52)], zepto: [offer('zepto', 'b', 50)] },
  };
  const r = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'zepto'] });
  assert.deepEqual(r.best.apps, ['blinkit']); // splitting would pay two delivery fees
  assert.equal(r.best.total, 152 + 34);
});

test('local search moves an item to cross the free-delivery threshold', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const offers = {
    a: { blinkit: [offer('blinkit', 'a', 190)], zepto: [offer('zepto', 'a', 300)] },
    b: { blinkit: [offer('blinkit', 'b', 15)], zepto: [offer('zepto', 'b', 12)] },
    c: { blinkit: [offer('blinkit', 'c', 400)], zepto: [offer('zepto', 'c', 250)] },
  };
  const r = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'zepto'] });
  const bLine = r.best.lines.find((l) => l.itemId === 'b');
  assert.equal(bLine.app, 'blinkit'); // ₹3 dearer, but saves the ₹30 delivery fee on Blinkit
  assert.equal(r.best.total, 190 + 15 + 250 + 8);
});

test('missing items, forced app and dropped items', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const offers = { a: { blinkit: [offer('blinkit', 'a', 300)], zepto: [offer('zepto', 'a', 280)] }, b: { blinkit: [offer('blinkit', 'b', 100)] } };
  const all = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'zepto'] });
  assert.equal(all.best.covered, 2);
  const zeptoOnly = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'zepto'], onlyApps: ['zepto'] });
  assert.deepEqual(zeptoOnly.best.missing, ['b']);
  const dropped = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'zepto'], dropped: ['b'] });
  assert.deepEqual(dropped.best.apps, ['zepto']);
});

test('ties within ₹5 go to the better-rated app', () => {
  const items = [{ id: 'a' }];
  const offers = { a: { blinkit: [offer('blinkit', 'a', 302)], amazon: [offer('amazon', 'a', 302)] } };
  const r = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'amazon'] });
  assert.deepEqual(r.best.apps, ['blinkit']);
});
