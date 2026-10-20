// PRICE HUNT — "Where is this cheapest right now, and is it actually in stock?"
//
// 1. Search the web and configured retailer catalogs in parallel.
// 2. Check each configured retailer with a bounded pool of live browser agents.
// 3. Verify the extracted product identity before ranking prices.
// 4. Capture a screenshot of the best verified listing when possible.
// Errand never buys. The user gets a ranked list and finishes checkout themselves.

import { search } from '../tinyfish.js';
import { smartRun } from '../agent.js';
import { captureProof } from '../proof.js';
import { READ_ONLY_RULES, detectBlock } from '../safety.js';
import { accountFor, markExpired } from '../accounts.js';
import { parseStores, parseStoreRequest, resolveStore, storeEntryUrl, retailerForDomain, retailersForCountry } from '../stores.js';

export { parseStores, resolveStore };

const NOT_STORES = [
  'youtube.com', 'reddit.com', 'quora.com', 'wikipedia.org', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com',
  'apps.apple.com', 'itunes.apple.com', 'play.google.com',
  'pinterest.com', 'linkedin.com', 'smartprix.com', '91mobiles.com', 'gadgets360.com', 'ndtv.com', 'pricebaba.com',
  'mysmartprice.com', 'gsmarena.com', 'rtings.com', 'techradar.com', 'theverge.com', 'cnet.com', 'tomsguide.com',
  'pcmag.com', 'whathifi.com', 'soundguys.com', 'bestbuy.ca/en-ca/blog', 'medium.com', 'news.google.com',
  'pricehistory.app', 'pricehistory.in', 'pricetracker.in', 'camelcamelcamel.com', 'pricespy.co.uk', 'idealo.de',
  'google.com', 'bing.com', 'tiktok.com', 'xerve.in', 'coupondunia.in', 'cashkaro.com', 'grabon.in', 'desidime.com',
  'buyhatke.com', 'couponraja.in', 'indiashopps.com', 'compareraja.in', 'junglee.com', 'scandid.in', 'mytokri.com',
  'topcashback.in', 'freekaamaal.com', 'dealstan.com', 'indiafreestuff.in', 'digit.in', 'flickstree.com',
];
const NOT_PRODUCT_PATH = /\/(blog|news|unboxed|review|reviews|compare|vs|forum|community|support|manual|article|guides?)\b|\/search[?/]|[?&](q|k|query)=/i;

const SCHEMA = {
  type: 'object',
  properties: {
    product_name: { type: 'string' },
    price: { type: 'number', nullable: true },
    currency: { type: 'string' },
    mrp: { type: 'number', nullable: true },
    in_stock: { type: 'boolean' },
    image_url: { type: 'string', nullable: true },
    delivery_info: { type: 'string', nullable: true },
    seller: { type: 'string', nullable: true },
    offers: { type: 'array', items: { type: 'string' } },
    variant: { type: 'string', nullable: true },
    page_status: { type: 'string', enum: ['ok', 'blocked', 'captcha', 'login_required', 'not_found', 'not_product_page'] },
  },
  required: ['product_name', 'price', 'currency', 'in_stock', 'page_status'],
};

const domainOf = (u) => { try { return new URL(u).hostname.replace(/^(?:www|dir)\./i, ''); } catch { return ''; } };
async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

const UNIT_WORDS = new Set([
  'kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms',
  'g', 'gm', 'gms', 'gram', 'grams',
  'l', 'lt', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters',
  'ml', 'mls', 'milli',
  'pc', 'pcs', 'piece', 'pieces',
  'pack', 'packs', 'packet', 'packets', 'pkg', 'pkgs',
  'box', 'boxes', 'bottle', 'bottles', 'pouch', 'pouches', 'can', 'cans',
  'combo', 'set', 'bag', 'bags', 'bar', 'bars'
]);

function normalizeUnits(s) {
  return (s || '').toLowerCase()
    .replace(/(\d+)\s*(kg|kgs|kilo|kilos|kilogram|kilograms|g|gm|gms|gram|grams|l|lt|ltr|ltrs|litre|litres|liter|liters|ml|mls|pc|pcs|piece|pieces|pack|packs|packet|packets|box|boxes)\b/gi, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const tokens = (s) => normalizeUnits(s).split(' ').filter((t) => t.length >= 2 || (t.length === 1 && /\d/.test(t)));

function tokenMatch(qToken, nameTokens, nameJoined) {
  if (nameTokens.has(qToken) || nameJoined.includes(qToken)) return true;
  const stemQ = qToken.replace(/(ie|es|s)$/, '');
  for (const nt of nameTokens) {
    const stemN = nt.replace(/(ie|es|s)$/, '');
    if (stemQ.length >= 3 && (stemQ === stemN || nt.startsWith(stemQ) || qToken.startsWith(stemN))) return true;
  }
  return false;
}

// How well a listing title matches what the user asked for.
// - Model numbers (e.g. WH-1000XM5 vs WH-1000XM4, Dolo 650 vs Dolo 500) must match.
// - Grocery/commodity unit & quantity qualifiers (e.g. 1 kg, 500g) are handled intelligently:
//   matching core items like "Fresh Onion" to "onions 1 kg" with high score.
export function matchScore(query, name) {
  const qAll = tokens(query);
  const nList = tokens(name);
  const n = new Set(nList);
  const nJoined = nList.join('');
  if (!qAll.length) return 1;

  // Separate query into core tokens vs unit/quantity tokens
  const qCore = [];
  const qUnits = [];
  for (let i = 0; i < qAll.length; i++) {
    const t = qAll[i];
    if (UNIT_WORDS.has(t)) {
      qUnits.push(t);
    } else if (/^\d+$/.test(t) && (i + 1 < qAll.length && UNIT_WORDS.has(qAll[i + 1]))) {
      // number followed immediately by a unit word like '1' in '1 kg'
      qUnits.push(t);
    } else {
      qCore.push(t);
    }
  }

  // Model numbers: alphanumeric codes or standalone numbers not part of quantity
  const models = qCore.filter((t) => /\d/.test(t));
  const modelOk = models.every((t) => tokenMatch(t, n, nJoined));
  if (!modelOk) return 0.3;

  // Check core product hit
  const coreTarget = qCore.length ? qCore : qAll;
  const coreHits = coreTarget.filter((t) => tokenMatch(t, n, nJoined)).length;
  const coreHitRate = coreHits / coreTarget.length;

  if (coreHitRate === 0) return 0.1;

  // If core hits well (>= 0.75), give bonus if units also match
  const unitHits = qUnits.filter((t) => tokenMatch(t, n, nJoined)).length;
  const unitHitRate = qUnits.length ? (unitHits / qUnits.length) : 1;

  if (coreHitRate >= 0.75) {
    return qUnits.length ? Math.min(1, 0.85 + 0.15 * unitHitRate) : coreHitRate;
  }
  return coreHitRate * 0.7;
}

function snippetPrice(text = '') {
  const m = text.match(/(₹|Rs\.?|INR|\$|£|€|USD)\s?([\d,]+(?:\.\d{1,2})?)/i);
  return m ? `${m[1]}${m[2]}` : null;
}

export async function findCandidates(ctx, { product, country, stores, unsupportedStores = [], storeSelectionProvided = false, maxStores }, { searchFn = search } = {}) {
  const targets = storeSelectionProvided
    ? stores.map((domain) => ({ domain, retailer: retailerForDomain(domain) }))
    : retailersForCountry(country).map((retailer) => ({ domain: retailer.domain, retailer }));
  ctx.step('search', `Searching the web and ${targets.length || 'available'} retailer sites for "${product}"`);
  const responses = targets.length ? await Promise.allSettled(targets.map((target) => searchFn(
    `${product} buy online price`,
    {
      location: country,
      purpose: `Find a current product listing on ${target.domain} for "${product}".`,
      include_domains: target.domain,
    },
  ))) : [];
  if (targets.length) ctx.usage('searches', targets.length);

  const byDomain = new Map();
  for (const response of responses) {
    if (response.status !== 'fulfilled') {
      ctx.log(`Web search failed: ${response.reason?.message || 'unknown error'}`, { level: 'warn' });
      continue;
    }
    for (const item of response.value?.results || []) {
      const domain = domainOf(item.url);
      let parsed;
      try { parsed = new URL(item.url); } catch { continue; }
      if (!domain || NOT_STORES.some((bad) => domain === bad || domain.endsWith(`.${bad}`))) continue;
      if (NOT_PRODUCT_PATH.test(parsed.pathname + parsed.search)) continue;
      const target = targets.find((t) => domain === t.domain || domain.endsWith(`.${t.domain}`));
      if (!target) continue;
      const candidate = { url: item.url, domain: target.domain, retailer: target.retailer, title: item.title, snippet: item.snippet, hint: snippetPrice(item.snippet), viaStoreSearch: false };
      candidate.match = matchScore(product, `${item.title || ''} ${item.snippet || ''}`);
      candidate.score = 2 * candidate.match + (candidate.hint ? 0.5 : 0);
      if (!byDomain.has(target.domain) || candidate.score > byDomain.get(target.domain).score) byDomain.set(target.domain, candidate);
    }
  }

  let picked = targets.map((target) => {
    const webResult = byDomain.get(target.domain);
    if (webResult && webResult.match >= 0.6 && webResult.score >= 0.8) return webResult;
    const url = storeEntryUrl(target.domain, product, country);
    if (!url) return { ...target, unsupported: true, score: 0 };
    return { ...target, url, viaStoreSearch: true, score: 1 };
  });

  // Keep generic web discovery for countries without a configured retailer catalog.
  if (!targets.length && !storeSelectionProvided) {
    const response = await searchFn(`${product} buy online price`, { location: country, purpose: `Find retailer product listings for "${product}".` });
    ctx.usage('searches');
    picked = (response?.results || []).flatMap((item) => {
      const retailer = retailerForDomain(domainOf(item.url));
      if (!retailer) return [];
      const match = matchScore(product, `${item.title || ''} ${item.snippet || ''}`);
      const score = 2 * match + (snippetPrice(item.snippet) ? 0.5 : 0);
      return match >= 0.6 && score >= 0.8 ? [{ url: item.url, domain: retailer.domain, retailer, title: item.title, snippet: item.snippet, match, score }] : [];
    }).slice(0, maxStores);
  }
  picked.push(...unsupportedStores.map((name) => ({ domain: name, unsupported: true, score: 0 })));
  ctx.log(`Selected ${picked.length} site(s) to check live: ${picked.map((p) => p.domain).join(', ') || 'none'}`);
  return picked;
}

export async function checkStore(ctx, product, c, country, pin, {
  smartRunFn = smartRun,
  accountForFn = accountFor,
  markExpiredFn = markExpired,
  directPageTimeoutSeconds = 40,
  searchPageTimeoutSeconds = 55,
} = {}) {
  const goal = `You are checking an online store page for: "${product}".
1. If this page is a search/listing page, find and open the listing that best matches "${product}" (same model & variant). If it is already the product page, stay.${c.viaStoreSearch ? `
   If the page is the store's home page, use its search box to search for "${product}".` : ''}
   If the site asks for a delivery location / PIN code, ${pin ? `enter PIN code ${pin}` : 'pick any default location or dismiss it'} (this is not a login). If a login wall appears, stop and report page_status "login_required".
   For quick-commerce stores like Blinkit or Zepto: if a location modal or prompt appears, choose any suggested city/location (e.g., Delhi, Mumbai, Bengaluru or PIN 110001) or click current location / dismiss to view the listings and prices. If a price is visible on the listing tile, that is enough.
2. Read the full, real product name into product_name (e.g. "Fresh Onion" or "Platone Organic Onion 1 kg", never breadcrumbs or navigation symbols like ">").
3. Read the CURRENT selling price of the main product (not EMI, not bank-card-only offers, not accessories or recommendations). Put the struck-through list price in mrp if shown.
4. Report currency as an ISO 4217 code (INR, USD, GBP…). Read stock status, delivery estimate, seller name, and up to 3 notable offers.
5. Read the image URL (src or srcset of the main product photo) into image_url.
6. Return JSON. Use page_status "not_found" only if the store search completed and the product is absent. Use "not_product_page" if the page cannot be verified as a product listing. Never infer a product name or price that is not visible.
${READ_ONLY_RULES}`;
  if (c.unsupported) return { ...c, ok: false, state: 'unsupported', reason: 'No retailer search adapter is configured for this site.' };
  const account = c.retailer?.accountKey ? accountForFn(c.retailer.accountKey) : null;
  const profileId = account?.profileId || null;
  const run = await smartRunFn(ctx, {
    url: c.url,
    goal,
    schema: SCHEMA,
    country,
    label: c.domain,
    // A direct product page should need very little navigation. Search pages
    // get a little more time, but avoid letting one slow retailer hold an
    // entire 18-store comparison open for several minutes.
    maxSeconds: c.viaStoreSearch ? searchPageTimeoutSeconds : directPageTimeoutSeconds,
    profileId,
    stealthFirst: true,
    noRetry: false
  });
  if (!run.ok) {
    const block = detectBlock(run);
    const loginRequired = run.error?.code === 'LOGIN_REQUIRED' || /login required|sign in to continue|session expired/i.test(run.reason || '');
    if (loginRequired && account?.profileId) markExpiredFn(c.retailer.accountKey);
    const state = run.error?.code === 'TIMEOUT' ? 'timeout' : loginRequired ? 'login_required' : block ? 'blocked' : 'error';
    return { ...c, ok: false, state, reason: run.reason };
  }
  const r = run.result || {};
  if (r.page_status && r.page_status !== 'ok') {
    if (r.page_status === 'login_required' && account?.profileId) markExpiredFn(c.retailer.accountKey);
    const state = ['captcha', 'blocked'].includes(r.page_status) ? 'blocked'
      : r.page_status === 'login_required' ? 'login_required'
        : r.page_status === 'not_product_page' ? 'unverified' : 'not_found';
    return { ...c, ok: false, state, reason: `Page status: ${r.page_status.replace(/_/g, ' ')}`, data: r };
  }
  if (typeof r.product_name !== 'string' || r.product_name.trim().length < 2) return { ...c, ok: false, state: 'unverified', reason: 'The page did not provide a verifiable product name.', data: r };
  if (!Number.isFinite(r.price) || r.price <= 0 || typeof r.currency !== 'string' || typeof r.in_stock !== 'boolean') return { ...c, ok: false, state: 'unverified', reason: 'The page did not provide a valid price, currency, and stock status.', data: r };
  const match = matchScore(product, `${r.product_name} ${r.variant || ''}`);
  if (match < 0.6) return { ...c, ok: false, state: 'mismatch', reason: `Different product (${r.product_name})`, match, mismatch: true };
  return { ...c, ok: true, data: r, match, mismatch: match < 0.6, liveRunId: run.run_id };
}

export async function mapConcurrent(items, fn, limit = 6) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export function createPriceHunt({
  searchFn = search,
  smartRunFn = smartRun,
  captureProofFn = captureProof,
  accountForFn = accountFor,
  concurrencyLimit,
  directPageTimeoutSeconds = 40,
  searchPageTimeoutSeconds = 55,
} = {}) {
  return async function priceHunt(ctx, input) {
  const product = String(input.product || '').trim();
  if (!product) throw new Error('Tell me which product to look for.');
  const country = (input.country || 'IN').toUpperCase();
  const maxStores = Math.max(1, Math.min(Number(input.maxStores) || 8, 20));
  const storeRequest = parseStoreRequest(input.stores, country);
  const stores = storeRequest.stores;
  const pin = String(input.pin || '').replace(/\D/g, '').slice(0, 10);
  if (String(input.stores || '').trim()) ctx.log(`Stores to check: ${[...stores, ...storeRequest.unsupported].join(', ')}`);
  const target = input.targetPrice ? (typeof input.targetPrice === 'number' ? input.targetPrice : Number(String(input.targetPrice).replace(/[^0-9.]/g, '')) || null) : null;

  const candidates = await findCandidates(ctx, {
    product, country, stores, unsupportedStores: storeRequest.unsupported,
    storeSelectionProvided: Boolean(String(input.stores || '').trim()), maxStores,
  }, { searchFn });
  if (!candidates.length) {
    return { status: 'needs_input', message: `I couldn't find any store selling "${product}" in ${country}. Try the brand + model name (e.g. "Vaseline Lip Care Original 10g"), or name the stores to check (e.g. blinkit, amazon, flipkart).`, offers: [] };
  }

  const configured = concurrencyLimit ?? (Number(process.env.PRICE_HUNT_CONCURRENCY) || 6);
  const concurrency = Math.min(candidates.length, Math.max(1, Math.min(configured, 10)));
  ctx.step('agents', `Opening ${candidates.length} stores live (${concurrency} agents running simultaneously)`);
  const liveGood = [];
  const liveFailed = [];
  const checked = await mapConcurrent(candidates, async (c) => {
    let res;
    try {
      res = await checkStore(ctx, product, c, country, pin, {
        smartRunFn,
        accountForFn,
        directPageTimeoutSeconds,
        searchPageTimeoutSeconds,
      });
    }
    catch (error) { res = { ...c, ok: false, state: 'error', reason: error.message || 'Store check failed.' }; }
    if (res.ok && res.data?.price != null) {
      liveGood.push(res);
      ctx.log(`✅ ${res.domain}: ${res.data.product_name} · ${fmt(res.data.price, res.data.currency)}`);
    } else {
      liveFailed.push({ domain: c.domain, state: res.state || 'not_found', reason: res.reason || 'Product not sold or out of stock' });
      ctx.log(`❌ ${c.domain}: ${res.reason || 'Product not sold or out of stock'}`);
    }
    ctx.update({
      liveOffers: liveGood.map((r) => ({
        domain: r.domain,
        url: r.url,
        match: +r.match.toFixed(2),
        mismatch: r.mismatch,
        proof: r.proof || null,
        ...r.data
      })),
      liveFailed: liveFailed.slice()
    });
    return res;
  }, concurrency);

  const good = checked.filter((c) => c.ok);
  const failed = checked.filter((c) => !c.ok);
  // Rank: exact match & in stock first, then cheapest. Compare only within the main currency.
  const currency = mostCommon(good.map((g) => g.data.currency)) || null;
  const ranked = good.sort((a, b) =>
    (a.mismatch - b.mismatch) || (b.data.in_stock - a.data.in_stock) ||
    ((a.data.currency === currency ? 0 : 1) - (b.data.currency === currency ? 0 : 1)) || (a.data.price - b.data.price));
  const best = ranked.find((r) => r.data.in_stock && !r.mismatch && r.data.currency === currency) || null;

  ctx.step('proof', `Capturing visual proof`);
  if (best?.url) {
    try {
      best.proof = await withTimeout(captureProofFn(ctx, best.url, { country }), 15000, 'Proof timeout');
      if (best.proof?.ok) {
        ctx.log(`📸 Proof screenshot captured for ${best.domain}`);
      }
    } catch {
      best.proof = null;
    }
  }

  const proof = best?.proof || null;

  const summary = best
    ? `Best in-stock price: ${fmt(best.data.price, best.data.currency)} at ${best.domain}` +
      (ranked.length > 1 ? ` (checked ${checked.length} stores).` : '.') +
      (target ? (best.data.price <= target ? ` That's at or below your target of ${fmt(target, currency)}.` : ` Still above your target of ${fmt(target, currency)}.`) : '')
    : good.length ? 'Found prices, but no exact-match listing is in stock right now.' : 'No store returned a usable price.';
  ctx.step('done', summary);
  return {
    status: best ? 'done' : 'partial',
    product, country, target, currency, summary,
    best: best ? { domain: best.domain, url: best.url, proof: best.proof || null, ...best.data } : null,
    offers: ranked.map((r) => ({
      domain: r.domain,
      url: r.url,
      match: +r.match.toFixed(2),
      mismatch: r.mismatch,
      proof: r.proof || null,
      ...r.data
    })),
    failed: failed.map((f) => ({ domain: f.domain, url: f.url, state: f.state || 'not_found', reason: f.reason })),
    proof,
  };
  };
}

export const priceHunt = createPriceHunt();

function mostCommon(arr) {
  const m = new Map(); arr.forEach((x) => m.set(x, (m.get(x) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function fmt(n, cur) {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur || 'INR', maximumFractionDigits: 0 }).format(n); }
  catch { return `${cur || ''} ${n}`; }
}
