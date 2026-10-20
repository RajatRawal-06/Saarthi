// SAARTHI — one grocery list, three apps, the cheapest real basket.
//
// 1. Collect: one bounded Agent run per app (Blinkit, Zepto, Amazon Fresh).
//    Each run sets the delivery location once, then visits direct search URLs
//    for its list. Stores run in parallel without competing over the same profile.
//    Failed authenticated Agent runs never silently fall back to a fresh,
//    anonymous Browser session that cannot see the saved retailer login.
// 2. Plan: the shopper sees the optimised basket (public/lib/basket.js), can
//    swap, drop or force one app, and taps Approve. Nothing touches a cart before.
// 3. Fill: one Agent run per chosen app fills the cart and reads the bill.
//    It stops on the cart page. Saarthi never presses a payment button.
// 4. Check: planned vs actual totals; >₹10 apart → the shopper is asked again.

import { runAgent } from '../tinyfish.js';
import { createSemaphore } from '../semaphore.js';
import { readJSON, writeJSON } from '../store.js';
import { accountFor, markExpired, ensureProfile, replaceProfile, isMissingProfileError, APP_HOME } from '../accounts.js';
import { scanApp, searchUrl } from './scan.js';
import { fmtQty } from './parse.js';
import { APPS, APP_NAMES, buildOffers, feesFor } from '../../public/lib/basket.js';

// Starting estimates until Saarthi reads real fees from a cart (then it learns them).
export const DEFAULT_FEES = {
  blinkit: { deliveryFee: 30, freeDeliveryAbove: 199, handlingFee: 2, smallCartFee: 20, smallCartThreshold: 99, otherFees: 0, source: 'estimate' },
  zepto: { deliveryFee: 30, freeDeliveryAbove: 199, handlingFee: 2, smallCartFee: 35, smallCartThreshold: 99, otherFees: 0, source: 'estimate' },
  // Amazon grocery fees vary by service, PIN code, Prime status and order. Do
  // not invent a fee estimate; the shopper can verify the final amount at cart.
  amazon: { source: 'delivery fees not included; verify at checkout' },
};
export const knownFees = () => ({ ...DEFAULT_FEES, ...readJSON('fees.json', {}) });

const NO_PAY = 'Do not click Proceed to Pay, Place Order, Pay, Checkout confirm or any payment button.';
const nn = (type) => ({ type, nullable: true });
const SEARCH_AGENT_BASE_SECONDS = 60;
const SEARCH_AGENT_PER_EXTRA_ITEM_SECONDS = 8;
const SEARCH_AGENT_MAX_SECONDS = 180;
// Keep each authenticated run short enough to finish reliably. Large multi-item
// prompts tend to stall at retailer navigation; smaller batches let the
// provider run several independent tasks against the same saved profile.
const SEARCH_BATCH_SIZE = 1;
export const SEARCH_AGENTS_PER_PROFILE = 1;
const searchProfileSlots = new Map(APPS.map((app) => [app, createSemaphore(SEARCH_AGENTS_PER_PROFILE)]));
const CART_AGENT_MAX_SECONDS = 150;

export function searchAgentSeconds(itemCount) {
  const count = Number.isFinite(Number(itemCount)) ? Math.max(1, Number(itemCount)) : 1;
  return Math.min(
    SEARCH_AGENT_MAX_SECONDS,
    SEARCH_AGENT_BASE_SECONDS + Math.max(0, count - 1) * SEARCH_AGENT_PER_EXTRA_ITEM_SECONDS,
  );
}

export function searchUnavailableNote({ blocked = false, agentErrorCode, scanIssue } = {}) {
  if (scanIssue === 'logged_out') return 'This store requires a login. Connect it in Setup, then try again.';
  if (scanIssue === 'location_needed') return 'This store needs a delivery location. Set it in the store session in Setup, then retry.';
  if (scanIssue === 'location_unverified') return 'The store did not confirm the saved delivery PIN. Connect it in Setup and set the delivery location, then retry.';
  if (blocked || scanIssue === 'blocked') return 'The store blocked automated search. Try again later or connect the store in Setup.';
  if (scanIssue === 'timeout' || agentErrorCode === 'TIMEOUT') return 'The store search timed out before returning prices. Retry; no price was assumed.';
  if (scanIssue === 'provider_unavailable') return 'The remote browser could not open this store. Check the browser connection and retry.';
  if (scanIssue === 'navigation_failed') return 'The store page failed to load in the remote browser. Retry the search.';
  return 'No matching product listings were returned for this store.';
}

export function searchPartialNote(scanIssue) {
  if (scanIssue === 'logged_out') return 'Partial results: the remaining products require a store login.';
  if (scanIssue === 'location_needed') return 'Partial results: the store needs its delivery location set in Setup.';
  if (scanIssue === 'location_unverified') return 'Partial results omitted because the store did not confirm the saved delivery PIN.';
  if (scanIssue === 'blocked') return 'Partial results: the store blocked some product searches.';
  if (scanIssue === 'timeout') return 'Partial results: the remaining product searches timed out.';
  if (scanIssue === 'provider_unavailable') return 'Partial results: the remote browser became unavailable.';
  if (scanIssue === 'navigation_failed') return 'Partial results: some product pages failed to load.';
  return null;
}

export function confirmsDeliveryPin(address, pincode) {
  const pin = String(pincode || '').trim();
  return !/^\d{6}$/.test(pin) || String(address || '').includes(pin);
}

const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    error: { type: 'string', enum: ['none', 'logged_out', 'blocked', 'location_needed'] },
    delivery_address: nn('string'),
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          found: { type: 'boolean' },
          results: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, pack: nn('string'), price: { type: 'number' }, mrp: nn('number'), in_stock: { type: 'boolean' } }, required: ['name', 'price', 'in_stock'] } },
        },
        required: ['query', 'found', 'results'],
      },
    },
  },
  required: ['error', 'items'],
};

const CART_SCHEMA = {
  type: 'object',
  properties: {
    error: { type: 'string', enum: ['none', 'logged_out', 'blocked'] },
    removed_existing: { type: 'boolean' },
    lines: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, pack: nn('string'), qty: { type: 'number' }, price: { type: 'number' } }, required: ['name', 'qty', 'price'] } },
    item_total: nn('number'),
    delivery_fee: nn('number'),
    handling_fee: nn('number'),
    small_cart_fee: nn('number'),
    other_fees: nn('number'),
    grand_total: nn('number'),
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: ['error', 'lines'],
};

const queryFor = (it) => [it.brand && !it.name.includes(it.brand) ? it.brand : '', it.name, it.unit !== 'pc' ? fmtQty(it.quantity, it.unit) : ''].filter(Boolean).join(' ');
export function chunkSearchTargets(targets, size = SEARCH_BATCH_SIZE) {
  const chunks = [];
  for (let i = 0; i < targets.length; i += size) chunks.push(targets.slice(i, i + size));
  return chunks;
}

async function agentRun(ctx, label, body) {
  ctx.log(`${label}: agent started`, { tag: label });
  let run;
  try {
    run = await runAgent(body, {
      timeoutMs: (Math.max(90, Number(body.agent_config?.max_duration_seconds)) + 25) * 1000,
      onEvent: (ev) => {
        if (ev.type === 'STREAMING_URL') ctx.log(`${label}: live view ready`, { tag: label, live: ev.streaming_url });
        if (ev.type === 'PROGRESS') ctx.log(`${label}: ${ev.purpose}`, { tag: label, progress: true });
      },
    });
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError' || err.code === 'TIMEOUT';
    run = {
      status: 'FAILED',
      error: {
        code: timedOut ? 'TIMEOUT' : (err.code || 'AGENT_ERROR'),
        message: String(err.message || 'Agent request failed').slice(0, 180),
        ...(isMissingProfileError(err) ? { message: 'Saved retailer profile not found' } : {}),
      },
    };
  }
  const outcome = run.status === 'COMPLETED' ? 'finished' : (run.error?.code === 'TIMEOUT' ? 'timed out' : 'failed');
  const reason = run.error?.code ? `, ${run.error.code}` : '';
  ctx.log(`${label}: agent ${outcome} (${run.steps ?? '?'} steps${reason})`, { tag: label, liveEnd: true });
  ctx.usage('agentRuns');
  if (run.steps) ctx.usage('agentSteps', run.steps);
  return run;
}

const isLoggedIn = (app) => { const acc = accountFor(app); return !!(acc?.connectedAt && !acc.expired); };
// Every run goes through the app's own profile (created with proxy_country_code "IN"),
// logged in or not — that is how Agent runs get an Indian IP. Stealth on every run.
async function runBody(app, url, goal, schema, { maxDurationSeconds = SEARCH_AGENT_BASE_SECONDS, profileId: knownProfileId } = {}) {
  const profileId = knownProfileId || await ensureProfile(app);
  const effectiveMaxSeconds = Math.max(90, maxDurationSeconds);
  const body = { url, goal, output_schema: schema, browser_profile: 'stealth', agent_config: { max_duration_seconds: effectiveMaxSeconds }, use_profile: true, profile_id: profileId };
  return { body, loggedIn: isLoggedIn(app) };
}

// ---------- 1. collect prices on one app ----------
async function collectApp(ctx, app, items, pincode, setStatus) {
  const label = APP_NAMES[app];
  setStatus(app, { state: 'searching' });
  const profileId = await ensureProfile(app);
  const loggedIn = isLoggedIn(app);
  const targets = items.map((item) => {
    const query = queryFor(item);
    return { item, query, url: searchUrl(app, query) || APP_HOME[app] };
  });
  const runBatch = async (batch) => {
    const target = batch[0];
    const goal = `The open URL is already the product search page for "${target.query}". `
      + `DO NOT open or click address or location selector modals. Prioritize immediately extracting up to 3 matching grocery product listings from the search results: `
      + `exact visible product name, pack size, price (in INR/Rs), MRP if shown, and stock status. `
      + `If the page header shows a delivery address or PIN, return it in delivery_address; otherwise leave delivery_address as whatever location is visible or null. `
      + `If the page requires sign-in set error to "logged_out". If blocked by CAPTCHA/access denied set error to "blocked"; otherwise use "none". `
      + `Do not add anything to a cart or checkout. Set found=false and results=[] only if no matching product is listed.`;
    const { body } = await runBody(app, batch[0].url, goal, SEARCH_SCHEMA, {
      maxDurationSeconds: searchAgentSeconds(batch.length),
      profileId,
    });
    return searchProfileSlots.get(app).run(async () => {
      let run = await agentRun(ctx, `${label} (${batch.map((t) => t.item.name).join(', ')})`, body);
      if (isMissingProfileError(run.error)) {
        body.profile_id = await replaceProfile(app, body.profile_id);
        ctx.log(`${label}: saved browser profile was missing; created a fresh profile and retrying once`, { tag: label, level: 'warn' });
        run = await agentRun(ctx, label, body);
      }
      if (Array.isArray(run.result?.items)) {
        run.result.items.forEach((it) => {
          if (!it.itemId) it.itemId = target.item.id;
          if (!it.query) it.query = target.query;
        });
      }
      return run;
    });
  };

  // Browser API sessions do not inherit Browser Context Profile cookies. Keep
  // logged-in searches on Agent runs and split their work into small parallel
  // batches instead of falling back to an anonymous browser on timeout.
  const batches = chunkSearchTargets(targets);
  const runs = await Promise.all(batches.map((batch) => runBatch(batch)));
  const blocked = runs.some((run) => run.error?.code === 'SITE_BLOCKED' || run.result?.error === 'blocked');
  const loggedOut = runs.some((run) => run.result?.error === 'logged_out');
  const locationNeeded = runs.some((run) => run.result?.error === 'location_needed');
  if (loggedOut) {
    if (loggedIn) markExpired(app);
    setStatus(app, { state: 'logged_out', note: loggedIn ? 'Login expired — reconnect in Setup' : 'Needs login — connect in Setup' });
    return null;
  }
  if (locationNeeded && !runs.some((run) => Array.isArray(run.result?.items) && run.result.items.length)) {
    setStatus(app, { state: 'unavailable', note: searchUnavailableNote({ scanIssue: 'location_needed' }) });
    return null;
  }
  const results = runs.flatMap((run) => Array.isArray(run.result?.items) ? run.result.items : []);
  const r = runs.find((run) => run.result?.delivery_address)?.result || runs.find((run) => run.result)?.result || {};
  let deliveryAddress = r.delivery_address || null;
  let locationConfirmed = confirmsDeliveryPin(deliveryAddress, pincode);
  let source = 'agent';
  const runFailure = runs.find((run) => run.status !== 'COMPLETED' || !Array.isArray(run.result?.items));
  if (!results.some((result) => result.found && result.results?.length)) {
    // Anonymous scans are only appropriate when no saved session exists.
    // They cannot diagnose or repair a failed authenticated Agent run.
    if (loggedIn) {
      const note = blocked ? searchUnavailableNote({ blocked: true }) : searchUnavailableNote({ agentErrorCode: runFailure?.error?.code });
      setStatus(app, { state: blocked ? 'blocked' : 'unavailable', note });
      return null;
    }
    ctx.log(`${label}: agent failed — trying an anonymous Browser scan`, { level: 'warn', tag: label });
    setStatus(app, { state: 'scanning' });
    const scan = await scanApp(ctx, app, targets.map(({ item, query }) => ({ itemId: item.id, query })), { label, pincode });
    if (!scan.items.some((x) => x.found)) {
      const note = searchUnavailableNote({ blocked, agentErrorCode: runFailure?.error?.code, scanIssue: scan.issue });
      const state = scan.issue === 'logged_out' ? 'logged_out' : 'unavailable';
      setStatus(app, { state, note });
      return null;
    }
    if (!scan.locationConfirmed && !scan.items.some((x) => x.found && x.results?.length)) {
      setStatus(app, { state: 'unavailable', note: searchUnavailableNote({ scanIssue: 'location_unverified' }) });
      return null;
    }
    locationConfirmed = true;
    deliveryAddress = null;
    source = 'scan';
    results.push(...scan.items);
  }
  const addressPin = deliveryAddress?.match(/\b\d{6}\b/)?.[0];
  const conflictingPin = addressPin && /^\d{6}$/.test(String(pincode || '').trim()) && addressPin !== String(pincode).trim();
  if (conflictingPin || (!locationConfirmed && !results.some((result) => result.found && result.results?.length))) {
    setStatus(app, { state: 'unavailable', note: searchUnavailableNote({ scanIssue: 'location_unverified' }) });
    return null;
  }
  const offers = {};
  items.forEach((item) => {
    const query = queryFor(item);
    const result = results.find((entry) => entry.itemId === item.id)
      || results.find((entry) => String(entry.query || '').toLowerCase() === query.toLowerCase());
    offers[item.id] = result ? buildOffers(item, app, result.results || []).map((offer) => ({ ...offer, source })) : [];
  });
  const feesSeen = r.fees_seen || {};
  const fees = {
    ...knownFees()[app],
    ...(feesSeen.delivery_fee > 0 ? { deliveryFee: feesSeen.delivery_fee, source: 'seen on app' } : {}),
    ...(feesSeen.free_delivery_above > 0 ? { freeDeliveryAbove: feesSeen.free_delivery_above } : {}),
    ...(feesSeen.handling_fee > 0 ? { handlingFee: feesSeen.handling_fee } : {}),
    ...(feesSeen.small_cart_fee > 0 ? { smallCartFee: feesSeen.small_cart_fee } : {}),
    ...(feesSeen.small_cart_threshold > 0 ? { smallCartThreshold: feesSeen.small_cart_threshold } : {}),
  };
  const foundCount = Object.values(offers).filter((offerList) => offerList.length).length;
  const note = runFailure && foundCount < items.length ? 'Partial results: one or more store searches timed out or failed.' : undefined;
  setStatus(app, { state: 'done', found: foundCount, address: deliveryAddress, source, loggedIn, ...(note ? { note } : {}) });
  return { offers, fees, address: deliveryAddress };
}

// ---------- 3. fill one cart ----------
async function fillCart(ctx, app, lines, plannedFees) {
  const label = `${APP_NAMES[app]} cart`;
  if (!isLoggedIn(app)) return { app, state: 'not_connected', message: `Connect ${APP_NAMES[app]} in Setup so I can fill the cart on your account.` };
  const products = lines.map((l, i) => `   ${i + 1}. "${l.productName}"${l.packLabel ? ` (${l.packLabel})` : ''} — quantity ${l.packs}`).join('\n');
  const { body } = await runBody(app, APP_HOME[app], `1. Wait for the page to fully load. Close any popup or banner.
2. Open the cart. If it has any items, remove all of them and remember that you did (removed_existing).
3. For each product below, search for it, find the result whose name and pack size match exactly, and click ADD. Use the + button until the quantity matches.
${products}
4. Open the cart. Wait for the bill summary to load.
5. Note every line item (name, pack, qty, price), the item total, delivery fee, handling fee, small cart fee, any other fee, and the grand total ("To pay").
6. Stop on the cart page. ${NO_PAY}
If a product is out of stock or no exact match exists, skip it and list it under "missing".
If a login page appears, stop and return error "logged_out". If an access denied page or CAPTCHA appears, stop and return error "blocked". Otherwise error is "none".`, CART_SCHEMA, { maxDurationSeconds: CART_AGENT_MAX_SECONDS });
  const run = await agentRun(ctx, label, body);
  const r = run.result || {};
  if (r.error === 'logged_out') { markExpired(app); return { app, state: 'logged_out', message: `${APP_NAMES[app]} logged you out. Reconnect it in Setup.` }; }
  if (run.status !== 'COMPLETED' || r.error === 'blocked' || !Array.isArray(r.lines)) {
    return { app, state: 'error', message: `${APP_NAMES[app]}: couldn't fill the cart (${r.error === 'blocked' ? 'blocked' : run.error?.message || 'agent failed'}). Check the app before paying.` };
  }
  const plannedSub = lines.reduce((s, l) => s + l.price * l.packs, 0);
  const planned = +(plannedSub + feesFor(plannedFees, plannedSub).total).toFixed(2);
  const actual = r.grand_total ?? null;
  // Learn the real fees for next time.
  const learned = readJSON('fees.json', {});
  learned[app] = {
    ...knownFees()[app],
    ...(r.delivery_fee != null ? { deliveryFee: r.delivery_fee } : {}),
    ...(r.handling_fee != null ? { handlingFee: r.handling_fee } : {}),
    ...(r.small_cart_fee ? { smallCartFee: r.small_cart_fee, smallCartThreshold: Math.max(knownFees()[app].smallCartThreshold || 0, (r.item_total || 0) + 1) } : {}),
    ...(r.other_fees != null ? { otherFees: r.other_fees } : {}),
    source: 'read from your cart', learnedAt: Date.now(),
  };
  writeJSON('fees.json', learned);
  return { app, state: 'filled', planned, actual, diff: actual != null ? +(actual - planned).toFixed(2) : null, cart: r };
}

// ---------- the chore ----------
export async function jhola(ctx, input) {
  const items = (input.items || []).filter((i) => i && i.name).slice(0, 25);
  if (!items.length) return { status: 'needs_input', message: 'Type your list first, e.g. "doodh 2 packet, atta 5kg, maggi 4".' };
  const apps = (input.apps || APPS).filter((a) => APPS.includes(a));
  const pincode = String(input.pincode || '').replace(/\D/g, '').slice(0, 6);
  const status = Object.fromEntries(apps.map((a) => [a, { state: 'queued' }]));
  const setStatus = (app, s) => { status[app] = { ...status[app], ...s }; ctx.update({ basket: { items, apps, status } }); };
  ctx.update({ basket: { items, apps, status } });

  ctx.step('collect', `Checking ${apps.map((a) => APP_NAMES[a]).join(', ')} for ${items.length} item(s)`);
  // Start all selected stores together; the shared TinyFish semaphore limits
  // provider concurrency, and each run now has a bounded deadline.
  const collected = await Promise.all(apps.map(async (app) => [app, await collectApp(ctx, app, items, pincode, setStatus)]));
  const offers = Object.fromEntries(items.map((it) => [it.id, {}]));
  const fees = {};
  const usable = [];
  for (const [app, res] of collected) {
    if (!res) continue;
    usable.push(app);
    fees[app] = res.fees;
    for (const it of items) offers[it.id][app] = res.offers[it.id] || [];
  }
  if (!usable.length) {
    ctx.step('done', 'No app returned prices.');
    return { status: 'failed', message: 'None of the apps returned prices (blocked or logged out). Check Setup and try again.', status_by_app: status };
  }

  ctx.step('plan', 'Your plan is ready — review and approve');
  const answer = await ctx.askApproval({ kind: 'basket_plan', items, offers, fees, apps: usable, status });
  if (!answer.approved) { ctx.step('done', 'Cancelled. Nothing was added to any cart.'); return { status: 'cancelled', message: 'You cancelled. No cart was touched.' }; }

  // Validate the approved plan against what we actually found.
  const plan = answer.data?.plan;
  const byApp = {};
  for (const l of plan?.lines || []) {
    const known = offers[l.itemId]?.[l.app]?.find((o) => o.productName === l.productName);
    if (!known) continue;
    (byApp[l.app] ||= []).push({ ...known, packs: Math.max(1, Math.min(Number(l.packs) || known.packs, 30)) });
  }
  const planFees = { ...fees, ...(answer.data?.fees || {}) };
  if (!Object.keys(byApp).length) return { status: 'needs_input', message: 'The approved plan was empty.' };

  ctx.step('fill', `Filling ${Object.keys(byApp).map((a) => APP_NAMES[a]).join(' + ')} cart(s) — stopping before payment`);
  const carts = await Promise.all(Object.entries(byApp).map(async ([app, lines], i) => { await sleep(i * 4000); return { ...(await fillCart(ctx, app, lines, planFees[app])), lines }; }));

  const off = carts.filter((c) => c.state === 'filled' && c.diff != null && Math.abs(c.diff) > 10);
  if (off.length) {
    ctx.step('check', 'Cart totals differ from the plan — please check');
    const again = await ctx.askApproval({ kind: 'cart_diff', carts: off.map((c) => ({ app: c.app, planned: c.planned, actual: c.actual, diff: c.diff })) });
    if (!again.approved) {
      ctx.step('done', 'Okay — don\'t pay yet. Your carts are filled for you to review.');
      return { status: 'partial', message: 'You chose not to go ahead with the new totals. The carts are filled but nothing is paid.', carts, plan };
    }
  }
  const filled = carts.filter((c) => c.state === 'filled');
  const msg = filled.length
    ? `Carts ready on ${filled.map((c) => APP_NAMES[c.app]).join(' + ')}. Pay in each app — Saarthi never pays.`
    : 'No cart could be filled. See the notes below.';
  ctx.step('done', msg);
  return { status: filled.length === carts.length ? 'done' : filled.length ? 'partial' : 'needs_input', message: msg, carts, plan };
}

export { jhola as saarthi };

