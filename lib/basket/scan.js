// Fallback price scan with the TinyFish Browser API (India proxy, Playwright
// over CDP). Used when an Agent search run is blocked: it opens each app's
// search results page and reads product tiles from the page text. Scripted and
// cheap (billed per browser-minute), but less reliable than the agent, so its
// results are marked as "scan".
import { chromium } from 'playwright-core';
import { createBrowser, closeBrowser } from '../tinyfish.js';
import { isSearchBanner, productFormCompatible } from '../../public/lib/basket.js';

const SEARCH = {
  blinkit: (q) => `https://blinkit.com/s/?q=${encodeURIComponent(q)}`,
  zepto: (q) => `https://www.zeptonow.com/search?query=${encodeURIComponent(q)}`,
  instamart: (q) => `https://www.swiggy.com/instamart/search?query=${encodeURIComponent(q)}`,
  amazon: (q) => `https://www.amazon.in/s?k=${encodeURIComponent(q)}`,
};
export const searchUrl = (app, query) => SEARCH[app]?.(query) || null;
const PACK = /(\d+(?:\.\d+)?\s*(?:kg|g|gms?|grams?|ml|litres?|liters?|ltr|l|pcs?|pieces?|units?)\b|\d+\s*[x×]\s*\d+\s*(?:g|gm|grams?|ml))/i;
const PRICE = /^(?:m\.?r\.?p\.?\s*:\s*)?₹\s?(\d[\d,]*(?:\.\d+)?)$/i;
const ADD_ACTION = /^(?:add|add to cart|add to basket)$/i;
const AMAZON_QUERY_STOP = new Set(['the', 'and', 'for', 'pack', 'packet', 'packets', 'of', 'x', 'g', 'gm', 'gms', 'gram', 'grams', 'kg', 'ml', 'l', 'ltr', 'litre', 'litres']);

const amount = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const match = String(value || '').match(/₹\s*([\d,]+(?:\.\d+)?)/);
  const parsed = match ? Number(match[1].replace(/,/g, '')) : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// Amazon search cards expose the complete product title in the image alt text;
// the visible heading is often only the brand. Keep this parser pure for tests.
export function amazonTilesFromCards(cards = [], limit = 3) {
  return cards.map((card) => {
    const name = String(card?.name || '').trim();
    const price = amount(card?.price);
    if (!name || !price) return null;
    const pack = String(card.pack || name.match(PACK)?.[0] || '').trim();
    return { name, pack, price, mrp: amount(card.mrp), in_stock: card.in_stock !== false };
  }).filter(Boolean).slice(0, limit);
}

export function amazonQueryMatches(query, productName) {
  if (!productFormCompatible(query, productName)) return false;
  const terms = String(query || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const wanted = [...new Set(terms.filter((t) => t.length > 1 && !AMAZON_QUERY_STOP.has(t) && !/^\d+(?:\.\d+)?$/.test(t)))];
  if (!wanted.length) return true;
  const nameTerms = String(productName || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const hits = wanted.filter((t) => nameTerms.some((n) => n === t || n.startsWith(t) || t.startsWith(n))).length;
  // Sponsored alternatives often repeat the brand and generic category words.
  // Require nearly every meaningful query term so they cannot become false offers.
  return hits >= Math.ceil(wanted.length * 0.9);
}

async function amazonCardsFromPage(page) {
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-component-type="s-search-result"]')].map((card) => {
    const name = card.querySelector('img.s-image[alt]')?.alt?.trim()
      || card.querySelector('h2 a[aria-label]')?.getAttribute('aria-label')?.trim()
      || '';
    const prices = [...card.querySelectorAll('.a-price .a-offscreen')].map((node) => node.innerText.trim());
    const mrpText = card.innerText.match(/M\.?R\.?P\.?\s*:\s*(₹\s*[\d,]+(?:\.\d+)?)/i)?.[1];
    return {
      name,
      price: prices[0] || '',
      mrp: mrpText || '',
      in_stock: !/currently unavailable|out of stock/i.test(card.innerText),
    };
  }));
  return amazonTilesFromCards(rows, 20);
}

// Product tiles render as short lines: [discount] name, pack, ₹price, [₹mrp], ADD
export function tilesFromText(text, limit = 3) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    if (!ADD_ACTION.test(lines[i])) continue;
    const window = lines.slice(Math.max(0, i - 6), i);
    const prices = window.map((l) => l.match(PRICE)).filter(Boolean).map((m) => Number(m[1].replace(/,/g, '')));
    const pack = window.find((l) => PACK.test(l) && l.length < 25);
    const name = window.filter((l) => !PRICE.test(l) && l !== pack && !isSearchBanner(l) && !/% ?off|mins?$|^\d+$/i.test(l) && l.length > 3).sort((a, b) => b.length - a.length)[0];
    if (!name || !prices.length) continue;
    out.push({ name, pack: pack || '', price: Math.min(...prices), mrp: prices.length > 1 ? Math.max(...prices) : null, in_stock: true });
  }
  return out;
}

export async function scanApp(ctx, app, items, { label, pincode }) {
  const started = Date.now();
  const budgetMs = Math.min(180_000, 75_000 + Math.max(0, items.length - 1) * 12_000);
  let session; let browser;
  let issue = null;
  let locationConfirmed = false;
  const found = [];
  try {
    session = await createBrowser({ timeout_seconds: 120, proxy_config: { country_code: 'IN' } }, { timeoutMs: 25_000, retries: 0 });
    browser = await chromium.connectOverCDP(session.cdp_url, { timeout: 20_000 });
    const page = browser.contexts()[0].pages()[0] || (await browser.contexts()[0].newPage());
    for (const it of items) {
      if (Date.now() - started >= budgetMs) { issue = 'timeout'; break; }
      ctx.log(`${label}: browser scan for "${it.query}"`, { tag: label });
      try {
        const response = await page.goto(SEARCH[app](it.query), { waitUntil: 'domcontentloaded', timeout: 20_000 });
        if ([401, 403, 429].includes(response?.status())) {
          issue = 'blocked';
          found.push({ query: it.query, itemId: it.itemId, found: false, results: [] });
          break;
        }
        await page.waitForTimeout(1200);
        const pageIssue = await page.evaluate(() => {
          const text = (document.body?.innerText || '').slice(0, 8000);
          if (/access denied|verify you are human|unusual traffic|robot check|captcha|automated requests/i.test(text)) return 'blocked';
          if (/log in to (?:continue|view prices)|sign in to (?:continue|view prices)|login required|enter (?:your )?(?:mobile|phone) number to continue/i.test(text)) return 'logged_out';
          return null;
        });
        if (pageIssue) {
          issue = pageIssue;
          found.push({ query: it.query, itemId: it.itemId, found: false, results: [] });
          break;
        }
        let results;
        const pageText = await page.evaluate(() => document.body?.innerText || '');
        if (pincode && String(pincode).length === 6 && pageText.includes(String(pincode))) locationConfirmed = true;
        if (app === 'amazon') {
          results = (await amazonCardsFromPage(page))
            .filter((result) => amazonQueryMatches(it.query, result.name) && productFormCompatible(it.query, result.name))
            .slice(0, 3);
        } else {
          results = tilesFromText(pageText).filter((result) => productFormCompatible(it.query, result.name));
        }
        found.push({ query: it.query, itemId: it.itemId, found: results.length > 0, results });
      } catch (e) {
        found.push({ query: it.query, itemId: it.itemId, found: false, results: [] });
        issue = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : 'navigation_failed';
        ctx.log(`${label}: product navigation failed (${e.name || 'Error'}${e.code ? `, ${e.code}` : ''})`, { tag: label, level: 'warn' });
        // The same host-level navigation error will not improve by repeating
        // it for every item. Stop early and report a clear store-level failure.
        break;
      }
    }
  } catch (err) {
    issue = err.name === 'TimeoutError' || err.name === 'AbortError' || err.code === 'TIMEOUT' ? 'timeout' : 'provider_unavailable';
    ctx.log(`${label}: remote browser session unavailable`, { tag: label, level: 'warn' });
  } finally {
    await browser?.close().catch(() => {});
    if (session) await closeBrowser(session.session_id, { timeoutMs: 5000, retries: 0 });
    ctx.usage('browserSeconds', Math.round((Date.now() - started) / 1000));
  }
  return { items: found, issue, locationConfirmed: !pincode || locationConfirmed };
}
