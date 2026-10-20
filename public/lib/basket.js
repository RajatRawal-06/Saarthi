// Saarthi basket maths — shared by the server and the browser (so swaps, drops
// and "force one app" re-plan instantly on the page). Pure functions only.

export const APPS = ['blinkit', 'zepto', 'amazon'];
// The Instamart label is retained only so saved pre-removal runs stay readable.
export const APP_NAMES = { blinkit: 'Blinkit', zepto: 'Zepto', amazon: 'Amazon Fresh', instamart: 'Swiggy Instamart (saved run)' };
// Tie-breaker only (two plans within ₹5): approximate Play Store ratings.
export const APP_RATING = { blinkit: 4.6, zepto: 4.5 };

// "500 ml", "1 kg", "4 x 70 g", "70 g x 4", "6 pcs", "Pack of 2", "1 pack (12 pieces)", "1 L"
export function parsePack(text = '') {
  const s = String(text).toLowerCase().replace(/,/g, '');
  const unitOf = (u) => (/^(kg|g|gm|gms|gram|grams)$/.test(u) ? 'g' : /^(l|ltr|litre|liter|ml)$/.test(u) ? 'ml' : 'pc');
  const mult = (u) => (/^(kg|l|ltr|litre|liter)$/.test(u) ? 1000 : 1);
  const UNIT = '(kg|gm|gms|grams|gram|g|ltr|litre|liter|ml|l)\\b';
  let m;
  if ((m = s.match(new RegExp(`(\\d+)\\s*[x×*]\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}`)))) {
    const count = +m[1]; const each = +m[2] * mult(m[3]); return { size: count * each, unit: unitOf(m[3]), count };
  }
  if ((m = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT}\\s*[x×*]\\s*(\\d+)`)))) {
    const count = +m[3]; const each = +m[1] * mult(m[2]); return { size: count * each, unit: unitOf(m[2]), count };
  }
  if ((m = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT}`)))) return { size: +m[1] * mult(m[2]), unit: unitOf(m[2]), count: 1 };
  if ((m = s.match(/(\d+)\s*(pcs|pc|pieces|piece|units|unit|nos|eggs|sachets|bars|rolls|n)\b/)) || (m = s.match(/pack of\s*(\d+)/))) return { size: +m[1], unit: 'pc', count: +m[1] };
  return { size: 1, unit: 'pc', count: 1, unknown: true };
}

const STOP = new Set(['fresh', 'pack', 'packet', 'pouch', 'the', 'and', 'with', 'of', 'for', 'new', 'premium', 'pure', 'original', 'classic', 'regular']);
const toks = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));
const SEARCH_BANNER = /^(?:showing results for|search results for|results for|did you mean|no (?:products?|results?) found|your search for)\b/i;
const FORM_MISMATCHES = [
  { query: /\bmilk\b/i, product: /\b(?:powder|almond|oat|soy|coconut|plant[- ]based|beverage|formula|shake|chocolate|candy|toffee|boiler|frother|bottle|mug)\b/i },
  { query: /\bbanana\b/i, product: /\b(?:chips?|plant|seed(?:ling)?s?|tree|powder|flour|bread|cake)\b/i },
  { query: /\bapple\b/i, product: /\b(?:plant|seed(?:ling)?s?|tree|juice|cider|vinegar|chips?|pie)\b/i },
  { query: /\bbutter\b/i, product: /\b(?:cookies?|biscuits?|peanut|almond|chocolate|cake|popcorn|spread|butterscotch|ice\s+cream|kulfi|box|dish|knife|container|spatula|tray|holder|lip\s*balm|body\s*butter|lotion)\b/i },
  { query: /\bbread\b/i, product: /\b(?:rice\s+cakes?|cakes?|crackers?|rusks?|breadcrumbs?|bread\s+maker|toaster|knife|box|bin|basket)\b/i },
  { query: /\beggs?\b/i, product: /\b(?:boiler|tray|holder|separator|beater|whisk|shampoo)\b/i },
  { query: /\b(?:cooking|sunflower|mustard|refined)?\s*oil\b/i, product: /\b(?:hair|massage|essential|diffuser|lamp|dispenser|spray\s+bottle)\b/i },
];

export function isSearchBanner(name) {
  return SEARCH_BANNER.test(String(name || '').trim());
}

// Reject obvious forms that share search terms but are not the requested grocery.
// This applies equally to each retailer; it is not tied to a particular site.
export function productFormCompatible(itemOrQuery, productName) {
  const query = typeof itemOrQuery === 'string' ? itemOrQuery : itemOrQuery?.name || '';
  const product = String(productName || '');
  return !isSearchBanner(product) && !FORM_MISMATCHES.some((rule) => (
    rule.query.test(query) && rule.product.test(product) && !rule.product.test(query)
  ));
}

// How many packs of this offer cover what the shopper asked for.
export function packsNeeded(item, pack) {
  if (item.unit === 'pc') {
    if (!pack.unknown && pack.unit !== 'pc') return 1;
    return pack.unit === 'pc' && pack.count > 1 && item.quantity > 1 ? Math.ceil(item.quantity / pack.count) : item.quantity;
  }
  if (pack.unit === item.unit && pack.size > 0) {
    const r = item.quantity / pack.size;
    return Math.max(1, Math.abs(r - Math.round(r)) < 0.08 ? Math.round(r) : Math.ceil(r));
  }
  return 1;
}

export function classify(item, productName, pack) {
  const name = String(productName || '').toLowerCase();
  if (item.brand && !name.includes(item.brand.split(' ')[0])) return 'substitute';
  const want = toks(item.name).filter((t) => !(item.brand || '').includes(t));
  const have = new Set(toks(productName));
  const hit = want.length ? want.filter((t) => have.has(t) || [...have].some((h) => h.startsWith(t) || t.startsWith(h))).length / want.length : 1;
  if (hit === 0) return null;
  if (hit < 0.5) return 'substitute';
  if (item.unit === 'pc') return pack.unknown || pack.unit !== 'pc' ? 'size_variant' : 'exact';
  if (pack.unknown) return 'size_variant';
  if (pack.unit !== item.unit) return 'substitute';
  const r = item.quantity / pack.size;
  return Math.abs(r - Math.round(r)) < 0.08 && Math.round(r) >= 1 ? 'exact' : 'size_variant';
}

export function unitPriceLabel(price, pack) {
  if (!pack || !pack.size) return '';
  if (pack.unit === 'g') return `₹${Math.round((price / pack.size) * 1000)}/kg`;
  if (pack.unit === 'ml') return `₹${Math.round((price / pack.size) * 1000)}/L`;
  return `₹${+(price / pack.size).toFixed(1)}/pc`;
}

const KIND_RANK = { exact: 0, size_variant: 1, substitute: 2 };
// Turn raw agent results for one item on one app into ranked offers.
export function buildOffers(item, app, results = []) {
  return results
    .filter((r) => r && r.name && r.price > 0 && productFormCompatible(item, r.name))
    .map((r) => {
      const pack = parsePack(r.pack || r.name);
      const packs = packsNeeded(item, pack);
      return {
        app, itemId: item.id, productName: r.name, packLabel: r.pack || '', packSize: pack.size, packUnit: pack.unit,
        price: r.price, mrp: r.mrp ?? null, inStock: r.in_stock !== false, matchKind: classify(item, r.name, pack),
        packs, lineCost: +(r.price * packs).toFixed(2), unitPrice: unitPriceLabel(r.price, pack),
      };
    })
    .filter((o) => o.inStock && o.matchKind && (item.allowSubstitute || o.matchKind !== 'substitute'))
    .sort((a, b) => KIND_RANK[a.matchKind] - KIND_RANK[b.matchKind] || a.lineCost - b.lineCost);
}

// Fees an app charges on a given item subtotal.
export function feesFor(rules = {}, subtotal = 0) {
  if (subtotal <= 0) return { delivery: 0, handling: 0, smallCart: 0, other: 0, total: 0 };
  const delivery = rules.freeDeliveryAbove && subtotal >= rules.freeDeliveryAbove ? 0 : (rules.deliveryFee || 0);
  const smallCart = rules.smallCartThreshold && subtotal < rules.smallCartThreshold ? (rules.smallCartFee || 0) : 0;
  const handling = rules.handlingFee || 0;
  const other = rules.otherFees || 0;
  return { delivery, handling, smallCart, other, total: delivery + handling + smallCart + other };
}

function* subsets(arr) {
  for (let mask = 1; mask < 1 << arr.length; mask++) yield arr.filter((_, i) => mask & (1 << i));
}

function evaluate(assign, pickFor, fees) {
  const byApp = {};
  for (const [itemId, app] of Object.entries(assign)) {
    const o = pickFor(itemId, app);
    byApp[app] = (byApp[app] || 0) + o.lineCost;
  }
  let total = 0;
  const feesByApp = {};
  for (const [app, sub] of Object.entries(byApp)) {
    const f = feesFor(fees[app], sub);
    feesByApp[app] = { subtotal: +sub.toFixed(2), ...f };
    total += sub + f.total;
  }
  return { total: +total.toFixed(2), feesByApp };
}

/**
 * Cheapest way to buy the whole list.
 * offers:  { [itemId]: { [app]: Offer[] } }   (ranked, best first)
 * choice:  { [itemId]: { [app]: index } }      user's swap per item/app
 * pinned:  { [itemId]: app }                  user forced an item to an app
 * dropped: itemId[]                            user removed these items
 * onlyApps: app[]                              "force a single app" / restrict
 */
export function optimise({ items, offers, fees = {}, apps = APPS, choice = {}, pinned = {}, dropped = [], onlyApps = null }) {
  const live = items.filter((i) => !dropped.includes(i.id));
  const pickFor = (itemId, app) => offers[itemId]?.[app]?.[choice[itemId]?.[app] ?? 0];
  const has = (itemId, app) => !!pickFor(itemId, app);
  const pool = (onlyApps?.length ? onlyApps : apps).filter((a) => apps.includes(a));

  const plans = [];
  for (const combo of subsets(pool)) {
    const assign = {};
    for (const it of live) {
      const pin = pinned[it.id];
      const cands = pin && combo.includes(pin) && has(it.id, pin) ? [pin] : combo.filter((a) => has(it.id, a));
      if (!cands.length) continue;
      assign[it.id] = cands.reduce((b, a) => (pickFor(it.id, a).lineCost < pickFor(it.id, b).lineCost ? a : b));
    }
    if (!combo.every((a) => Object.values(assign).includes(a))) continue; // an unused app = a smaller combo
    let cur = evaluate(assign, pickFor, fees);
    // Local search: move single items (to cross small-cart / free-delivery thresholds), or empty an app entirely.
    for (let round = 0, improved = true; improved && round < 20; round++) {
      improved = false;
      for (const it of live) {
        if (!assign[it.id] || pinned[it.id]) continue;
        for (const a of combo) {
          if (a === assign[it.id] || !has(it.id, a)) continue;
          const trial = { ...assign, [it.id]: a };
          const ev = evaluate(trial, pickFor, fees);
          if (ev.total < cur.total - 0.01) { Object.assign(assign, trial); cur = ev; improved = true; }
        }
      }
    }
    const used = [...new Set(Object.values(assign))];
    const covered = Object.keys(assign).length;
    const rating = used.reduce((s, a) => s + (APP_RATING[a] || 4), 0) / used.length;
    plans.push({
      apps: used.sort((a, b) => APPS.indexOf(a) - APPS.indexOf(b)),
      lines: live.filter((i) => assign[i.id]).map((i) => ({ itemId: i.id, app: assign[i.id], offer: pickFor(i.id, assign[i.id]), packs: pickFor(i.id, assign[i.id]).packs })),
      missing: live.filter((i) => !assign[i.id]).map((i) => i.id),
      feesByApp: cur.feesByApp, total: cur.total, covered, rating,
    });
  }
  // Dedupe (a pair can collapse to a single app after local search).
  const seen = new Set();
  const uniq = plans.filter((p) => { const k = p.lines.map((l) => `${l.itemId}:${l.app}`).join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
  uniq.sort((a, b) => b.covered - a.covered || (Math.abs(a.total - b.total) <= 5 ? b.rating - a.rating : a.total - b.total));
  const best = uniq[0] || null;
  const singles = uniq.filter((p) => p.apps.length === 1 && best && p.covered === best.covered).sort((a, b) => a.total - b.total);
  const bestSingle = singles[0] || null;
  return { best, bestSingle, savings: best && bestSingle ? +(bestSingle.total - best.total).toFixed(2) : null, plans: uniq };
}
