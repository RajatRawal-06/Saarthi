// PRICE HUNT — "Where is this cheapest right now, and is it actually in stock?"
//
// 1. Search  → find retailer pages for the product in the shopper's country
// 2. Fetch   → cheap triage: drop reviews/blogs/listing pages, keep product pages
// 3. Agent   → open each store live (2 at a time), read the real price, stock, delivery
// 4. Browser → screenshot the winning listing as independent proof
// Errand never buys. The user gets a ranked list and finishes checkout themselves.

import { search, fetchPages } from '../tinyfish.js';
import { smartRun } from '../agent.js';
import { captureProof } from '../proof.js';
import { READ_ONLY_RULES } from '../safety.js';
import { parseStores, resolveStore, storeEntryUrl } from '../stores.js';

export { parseStores, resolveStore };

const NOT_STORES = [
  'youtube.com', 'reddit.com', 'quora.com', 'wikipedia.org', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com',
  'pinterest.com', 'linkedin.com', 'smartprix.com', '91mobiles.com', 'gadgets360.com', 'ndtv.com', 'pricebaba.com',
  'mysmartprice.com', 'gsmarena.com', 'rtings.com', 'techradar.com', 'theverge.com', 'cnet.com', 'tomsguide.com',
  'pcmag.com', 'whathifi.com', 'soundguys.com', 'bestbuy.ca/en-ca/blog', 'medium.com', 'news.google.com',
  'pricehistory.app', 'camelcamelcamel.com', 'pricespy.co.uk', 'idealo.de', 'google.com', 'bing.com', 'tiktok.com',
];
// Big, trusted retailers per country get a small ranking boost.
const KNOWN_STORES = {
  IN: ['amazon.in', 'flipkart.com', 'blinkit.com', 'zepto.com', 'zeptonow.com', 'indiamart.com', 'swiggy.com', 'bigbasket.com', 'croma.com', 'reliancedigital.in', 'vijaysales.com', 'tatacliq.com', 'jiomart.com', 'myntra.com', 'nykaa.com', 'ajio.com', 'apple.com', 'samsung.com'],
  US: ['amazon.com', 'bestbuy.com', 'walmart.com', 'target.com', 'costco.com', 'newegg.com', 'bhphotovideo.com', 'apple.com', 'ebay.com'],
  GB: ['amazon.co.uk', 'argos.co.uk', 'currys.co.uk', 'johnlewis.com', 'very.co.uk', 'ao.com', 'apple.com'],
  CA: ['amazon.ca', 'bestbuy.ca', 'walmart.ca', 'costco.ca', 'staples.ca'],
  DE: ['amazon.de', 'mediamarkt.de', 'saturn.de', 'otto.de', 'cyberport.de'],
  AU: ['amazon.com.au', 'jbhifi.com.au', 'harveynorman.com.au', 'officeworks.com.au', 'bigw.com.au'],
  JP: ['amazon.co.jp', 'rakuten.co.jp', 'yodobashi.com', 'biccamera.com'],
  FR: ['amazon.fr', 'fnac.com', 'darty.com', 'boulanger.com', 'cdiscount.com'],
};
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
    page_status: { type: 'string', enum: ['ok', 'blocked', 'captcha', 'not_found', 'not_product_page'] },
  },
  required: ['product_name', 'price', 'currency', 'in_stock', 'page_status'],
};

const domainOf = (u) => { try { return new URL(u).hostname.replace(/^(?:www|dir)\./i, ''); } catch { return ''; } };
const tokens = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length >= 2);

function tokenMatch(qToken, nameTokens, nameJoined) {
  if (nameTokens.has(qToken) || nameJoined.includes(qToken)) return true;
  const stemQ = qToken.replace(/(ie|es|s)$/, '');
  for (const nt of nameTokens) {
    const stemN = nt.replace(/(ie|es|s)$/, '');
    if (stemQ.length >= 3 && (stemQ === stemN || nt.startsWith(stemQ) || qToken.startsWith(stemN))) return true;
  }
  return false;
}

// How well a listing title matches what the user asked for. Model numbers
// (tokens with digits) must match; otherwise it's probably a different variant.
export function matchScore(query, name) {
  const q = tokens(query);
  const n = new Set(tokens(name));
  const nJoined = tokens(name).join('');
  if (!q.length) return 1;
  const hit = q.filter((t) => tokenMatch(t, n, nJoined)).length / q.length;
  const models = q.filter((t) => /\d/.test(t));
  const modelOk = models.every((t) => tokenMatch(t, n, nJoined));
  return modelOk ? hit : Math.min(hit, 0.35);
}

function snippetPrice(text = '') {
  const m = text.match(/(₹|Rs\.?|INR|\$|£|€|USD)\s?([\d,]+(?:\.\d{1,2})?)/i);
  return m ? `${m[1]}${m[2]}` : null;
}

async function findCandidates(ctx, { product, country, stores, maxStores }) {
  ctx.step('search', `Searching stores selling "${product}"`);
  const opts = { location: country, purpose: `Find online retailer product pages that sell "${product}" so I can compare the live price and stock.` };
  if (stores.length) opts.include_domains = stores.join(',');
  const queries = [`${product} buy online price`, `${product} price`, `${product} price in store amazon flipkart blinkit zepto indiamart`];
  const responses = await Promise.allSettled(queries.map((qq) => search(qq, opts)));
  ctx.usage('searches', queries.length);

  const seen = new Set();
  let results = [];
  const collect = (resps) => {
    for (const r of resps) {
      if (r.status !== 'fulfilled') { ctx.log(`Search failed: ${r.reason.message}`, { level: 'warn' }); continue; }
      for (const item of r.value.results || []) {
        const d = domainOf(item.url);
        if (!d || seen.has(d)) continue;
        if (stores.length && !stores.some((st) => d === st || d.endsWith(`.${st}`))) continue;
        if (NOT_STORES.some((bad) => d === bad || d.endsWith(`.${bad}`) || item.url.includes(bad))) continue;
        let u; try { u = new URL(item.url); } catch { continue; }
        if (NOT_PRODUCT_PATH.test(u.pathname + u.search)) continue;
        seen.add(d);
        results.push({ url: item.url, domain: d, title: item.title, snippet: item.snippet, hint: snippetPrice(item.snippet) });
      }
    }
  };
  collect(responses);

  // Nothing usable and no store filter: one broader retry before giving up.
  if (!results.length && !stores.length) {
    ctx.log('No store pages in the first search; trying a broader search', { level: 'warn' });
    collect(await Promise.allSettled([search(`buy ${product} online`, opts), search(product, opts)]));
    ctx.usage('searches', 2);
  }
  ctx.log(`Search found ${results.length} candidate store page(s): ${results.map((r) => r.domain).join(', ') || 'none'}`);

  let picked = [];
  if (results.length) {
    // Fetch triage: confirm these are real product pages before paying for agent steps.
    ctx.step('triage', `Checking ${Math.min(results.length, 10)} pages with Fetch`);
    const pool = results.slice(0, 10);
    try {
      const fetched = await fetchPages(pool.map((r) => r.url), {
        page_metadata: true,
        per_url_timeout_ms: 30000,
        purpose: `Decide which pages are product pages selling "${product}"`,
      });
      ctx.usage('fetchedUrls', pool.length);
      const byUrl = new Map((fetched.results || []).map((r) => [r.url, r]));
      for (const c of pool) {
        const page = byUrl.get(c.url);
        const known = stores.length > 0 || (KNOWN_STORES[country] || []).some((k) => c.domain === k || c.domain.endsWith(`.${k}`));
        if (!page) { c.score = known ? 2 : 0.5; c.triage = 'could not pre-check (will try live)'; continue; }
        const text = (page.text || '').slice(0, 60000);
        let score = 0;
        if (page.page_metadata?.og?.type === 'product') score += 2;
        if (/(add to (cart|bag|basket)|buy now|in stock|out of stock|notify me|add)/i.test(text)) score += 1.5;
        if (/(₹|Rs\.?|\$|£|€)\s?\d/.test(text)) score += 1;
        score += 2 * matchScore(product, `${page.title || ''} ${c.title}`);
        if (known) score += 1;
        c.score = score;
        c.pageTitle = page.title;
      }
    } catch (err) {
      ctx.log(`Fetch triage skipped (${err.message}); using search ranking`, { level: 'warn' });
      pool.forEach((c, i) => { c.score = 2 - i * 0.1; });
    }
    picked = pool.filter((c) => c.score >= 1.5).sort((a, b) => b.score - a.score);
  }

  // Every store the user named gets checked, via its own site search if web search missed it.
  for (const st of stores) {
    if (picked.some((p) => p.domain === st || p.domain.endsWith(`.${st}`))) continue;
    picked.push({ url: storeEntryUrl(st, product), domain: st, viaStoreSearch: true, score: 3 });
    ctx.log(`${st}: not in web search results — will search inside the store directly`);
  }
  // For India, always include the core competitive retailers: Blinkit, Zepto, Amazon, Flipkart, IndiaMART
  if (country === 'IN') {
    const popularStores = ['blinkit.com', 'zeptonow.com', 'amazon.in', 'flipkart.com', 'indiamart.com'];
    for (const st of popularStores) {
      if (stores.length && !stores.some((s) => s === st || s.endsWith(`.${st}`))) continue;
      if (!picked.some((p) => p.domain === st || p.domain.endsWith(`.${st}`) || (st === 'zeptonow.com' && p.domain === 'zepto.com'))) {
        picked.push({ url: storeEntryUrl(st, product), domain: st, viaStoreSearch: true, score: 2.8 });
      }
    }
  }

  // Ensure quick commerce (Blinkit, Zepto) and key marketplaces are prioritized in the checking queue
  const priorityDomains = ['blinkit.com', 'zeptonow.com', 'zepto.com', 'amazon.in', 'flipkart.com', 'indiamart.com'];
  picked.sort((a, b) => {
    const aPrio = priorityDomains.indexOf(a.domain);
    const bPrio = priorityDomains.indexOf(b.domain);
    if (aPrio !== -1 && bPrio !== -1) return aPrio - bPrio;
    if (aPrio !== -1) return -1;
    if (bPrio !== -1) return 1;
    return (b.score || 0) - (a.score || 0);
  });

  picked = stores.length ? picked.slice(0, Math.max(maxStores, stores.length)) : picked.slice(0, maxStores);
  ctx.log(`Selected ${picked.length} store(s) to check live: ${picked.map((p) => p.domain).join(', ') || 'none'}`);
  return picked;
}

async function checkStore(ctx, product, c, country, pin) {
  const goal = `You are checking an online store page for: "${product}".
1. If this page is a search/listing page, open the listing that best matches "${product}" (same model & variant). If it is already the product page, stay.${c.viaStoreSearch ? `
   If the page is the store's home page, use its search box to search for "${product}".` : ''}
   If the site asks for a delivery location / PIN code, ${pin ? `enter PIN code ${pin}` : 'pick any default location or dismiss it'} (this is not a login).
   For quick-commerce stores like Blinkit or Zepto: if a location modal or prompt appears, choose any suggested city/location (e.g., Delhi, Mumbai, Bengaluru or PIN 110001) or click current location / dismiss to view the listings and prices. If a price is visible on the listing tile, that is enough.
2. Read the CURRENT selling price of the main product (not EMI, not bank-card-only offers, not accessories or recommendations). Put the struck-through list price in mrp if shown.
3. Report currency as an ISO 4217 code (INR, USD, GBP…). Read stock status, delivery estimate, seller name, and up to 3 notable offers.
4. Read the image URL (src or srcset of the main product photo) into image_url.
5. Return JSON. Use page_status "not_product_page" if the store does not sell this product.
${READ_ONLY_RULES}`;
  const run = await smartRun(ctx, { url: c.url, goal, schema: SCHEMA, country, label: c.domain, maxSeconds: 180 });
  if (!run.ok) return { ...c, ok: false, reason: run.reason };
  const r = run.result || {};
  if (r.page_status && r.page_status !== 'ok') return { ...c, ok: false, reason: `Page status: ${r.page_status.replace(/_/g, ' ')}`, data: r };
  if (r.price == null) return { ...c, ok: false, reason: 'No price shown on the page', data: r };
  const match = matchScore(product, `${r.product_name} ${r.variant || ''}`);
  if (match < 0.45) return { ...c, ok: false, reason: `Different product (${r.product_name || 'unrelated item'})`, match, mismatch: true };
  return { ...c, ok: true, data: r, match, mismatch: match < 0.6, liveRunId: run.run_id };
}

async function pool2(items, fn, limit = 6) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export async function priceHunt(ctx, input) {
  const product = String(input.product || '').trim();
  if (!product) throw new Error('Tell me which product to look for.');
  const country = (input.country || 'IN').toUpperCase();
  const maxStores = Math.max(1, Math.min(Number(input.maxStores) || 6, 8));
  const stores = parseStores(input.stores, country);
  const pin = String(input.pin || '').replace(/\D/g, '').slice(0, 10);
  if (stores.length) ctx.log(`Stores to check: ${stores.join(', ')}`);
  const target = input.targetPrice ? (typeof input.targetPrice === 'number' ? input.targetPrice : Number(String(input.targetPrice).replace(/[^0-9.]/g, '')) || null) : null;

  const candidates = await findCandidates(ctx, { product, country, stores, maxStores });
  if (!candidates.length) {
    return { status: 'needs_input', message: `I couldn't find any store selling "${product}" in ${country}. Try the brand + model name (e.g. "Vaseline Lip Care Original 10g"), or name the stores to check (e.g. blinkit, amazon, flipkart).`, offers: [] };
  }

  const concurrency = Math.min(candidates.length, 6);
  ctx.step('agents', `Opening ${candidates.length} stores live in parallel (${concurrency} agents running simultaneously)`);
  const liveGood = [];
  const liveFailed = [];
  const checked = await pool2(candidates, async (c) => {
    const res = await checkStore(ctx, product, c, country, pin);
    if (res.ok && res.data?.price != null) {
      liveGood.push(res);
      ctx.log(`✅ ${res.domain}: ${res.data.product_name} · ${fmt(res.data.price, res.data.currency)}`);
    } else {
      liveFailed.push({ domain: c.domain, reason: res.reason || 'Product not sold or out of stock' });
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

  ctx.step('proof', `Taking proof screenshot(s) with a fresh browser`);
  const inStockOffers = ranked.filter((r) => r.data.in_stock && !r.mismatch);
  await Promise.allSettled(inStockOffers.slice(0, 3).map(async (r) => {
    try {
      r.proof = await captureProof(ctx, r.url, { country });
      if (r.proof?.ok) {
        ctx.log(`📸 Proof screenshot captured for ${r.domain}`);
      }
    } catch {
      r.proof = null;
    }
  }));

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
    failed: failed.map((f) => ({ domain: f.domain, url: f.url, reason: f.reason })),
    proof,
  };
}

function mostCommon(arr) {
  const m = new Map(); arr.forEach((x) => m.set(x, (m.get(x) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function fmt(n, cur) {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur || 'INR', maximumFractionDigits: 0 }).format(n); }
  catch { return `${cur || ''} ${n}`; }
}
