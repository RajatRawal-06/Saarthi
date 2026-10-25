// Connected grocery-app accounts (TinyFish Browser Context Profiles, India proxy).
//
// The shopper logs in ONCE through Saarthi's window: a remote TinyFish browser
// whose screen is streamed here as screenshots, with clicks and keys forwarded.
// The phone number and OTP are typed by the person straight into the app's own
// page — Saarthi never stores them. TinyFish saves the cookies to a profile that
// later Agent runs reuse (use_profile + profile_id). The same window is reused
// for the payment hand-off: the person pays inside their own logged-in session.
import { chromium } from 'playwright-core';
import * as tf from './tinyfish.js';
import { readJSON, writeJSON } from './store.js';

const FILE = 'accounts.json';
const FALLBACK_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const profileRepairs = new Map();

export const ALL_APPS = [
  'blinkit',
  'zepto',
  'instamart',
  'bigbasket',
  'amazon',
  'flipkart',
  'croma',
  'reliance',
  'indiamart',
  'tata1mg',
  'jiomart',
];

export const APP_NAMES = {
  blinkit: 'Blinkit',
  zepto: 'Zepto',
  instamart: 'Swiggy Instamart',
  bigbasket: 'BigBasket',
  amazon: 'Amazon India',
  flipkart: 'Flipkart',
  croma: 'Croma',
  reliance: 'Reliance Digital',
  indiamart: 'IndiaMART',
  tata1mg: 'Tata 1mg',
  jiomart: 'JioMart',
};

export const APP_CATEGORIES = {
  blinkit: 'Quick Commerce · 10-15 Mins',
  zepto: 'Quick Commerce · 10 Mins',
  instamart: 'Quick Commerce · 15 Mins',
  bigbasket: 'Instant Grocery · BB Now',
  amazon: 'Pan-India Marketplace',
  flipkart: 'Mega Marketplace & Minutes',
  croma: 'Consumer Electronics & Tata Neu',
  reliance: 'Electronics & Digital Retail',
  indiamart: 'B2B Wholesale & Direct Deals',
  tata1mg: 'Digital Pharmacy & Health',
  jiomart: 'Omnichannel Supermarket',
};

export const APP_DOMAINS = {
  blinkit: 'blinkit.com',
  zepto: 'zeptonow.com',
  instamart: 'swiggy.com',
  bigbasket: 'bigbasket.com',
  amazon: 'amazon.in',
  flipkart: 'flipkart.com',
  croma: 'croma.com',
  reliance: 'reliancedigital.in',
  indiamart: 'indiamart.com',
  tata1mg: '1mg.com',
  jiomart: 'jiomart.com',
};

export const APP_HOME = {
  blinkit: 'https://blinkit.com/',
  zepto: 'https://www.zeptonow.com/',
  instamart: 'https://www.swiggy.com/instamart',
  bigbasket: 'https://www.bigbasket.com/',
  amazon: 'https://www.amazon.in/',
  flipkart: 'https://www.flipkart.com/',
  croma: 'https://www.croma.com/',
  reliance: 'https://www.reliancedigital.in/',
  indiamart: 'https://www.indiamart.com/',
  tata1mg: 'https://www.1mg.com/',
  jiomart: 'https://www.jiomart.com/',
};
const sessions = new Map(); // sessionId -> { app, profileId, browser, page, expiresAt, purpose }

export const listAccounts = () => readJSON(FILE, {});
export const accountFor = (app) => listAccounts()[app] || null;

export function isMissingProfileError(err) {
  const code = String(err?.code || '').toUpperCase();
  const message = String(err?.message || err || '');
  return ['PROFILE_NOT_FOUND', 'BROWSER_PROFILE_NOT_FOUND'].includes(code)
    || ((code === 'NOT_FOUND' || err?.status === 404) && /profile/i.test(message) && /not found|does not exist/i.test(message));
}

// Repair local references when TinyFish has already removed the remote profile.
export async function replaceProfile(app, staleProfileId) {
  if (!APP_HOME[app]) throw Object.assign(new Error('Unknown app'), { status: 400 });
  const currentId = listAccounts()[app]?.profileId;
  if (staleProfileId && currentId && currentId !== staleProfileId) return currentId;
  if (profileRepairs.has(app)) return profileRepairs.get(app);
  const repair = (async () => {
    const latest = listAccounts();
    if (staleProfileId && latest[app]?.profileId && latest[app].profileId !== staleProfileId) return latest[app].profileId;
    const previous = latest[app] || {};
    const profile = await tf.createProfile({ name: `Saarthi · ${app}`, proxy_country_code: 'IN' });
    const fresh = listAccounts();
    if (staleProfileId && fresh[app]?.profileId && fresh[app].profileId !== staleProfileId) {
      await tf.deleteProfile(profile.id).catch(() => {});
      return fresh[app].profileId;
    }
    fresh[app] = {
      ...previous,
      profileId: profile.id,
      connectedAt: null,
      expired: !!previous.connectedAt || !!previous.expired,
      cookies: null,
    };
    writeJSON(FILE, fresh);
    return profile.id;
  })();
  profileRepairs.set(app, repair);
  try { return await repair; }
  finally { if (profileRepairs.get(app) === repair) profileRepairs.delete(app); }
}

export function markExpired(app) {
  const all = listAccounts();
  if (all[app]) { all[app].expired = true; writeJSON(FILE, all); }
}

export async function ensureProfile(app) {
  const all = listAccounts();
  if (all[app]?.profileId) return all[app].profileId;
  const p = await tf.createProfile({ name: `Saarthi · ${app}`, proxy_country_code: 'IN' });
  all[app] = { profileId: p.id, connectedAt: null };
  writeJSON(FILE, all);
  return p.id;
}

export async function openWindow(app, { url, purpose = 'login' } = {}) {
  if (!APP_HOME[app]) throw Object.assign(new Error('Unknown app'), { status: 400 });
  const start = url || APP_HOME[app];
  let profileId = await ensureProfile(app);
  let s;
  try {
    s = await tf.startProfileSetup(profileId, { url: start, timeout_seconds: 900 });
  } catch (error) {
    if (!isMissingProfileError(error)) throw error;
    profileId = await replaceProfile(app, profileId);
    s = await tf.startProfileSetup(profileId, { url: start, timeout_seconds: 900 });
  }
  const browser = await chromium.connectOverCDP(s.cdp_url, { timeout: 60000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url() !== 'about:blank') || ctx.pages()[0] || (await ctx.newPage());
  await page.setViewportSize({ width: 1000, height: 700 }).catch(() => {});
  if (page.url() === 'about:blank') await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  ctx.on('page', (np) => { const e = sessions.get(s.session_id); if (e) e.page = np; });
  const sessionData = {
    app,
    profileId,
    browser,
    page,
    expiresAt: s.expires_at,
    purpose,
    inFlightFrame: null,
    lastFrame: null,
  };
  sessions.set(s.session_id, sessionData);

  // Pre-warm the first frame in the background so client receives it without delay
  sessionData.inFlightFrame = page.screenshot({ type: 'jpeg', quality: 55, timeout: 12000, animations: 'disabled' })
    .then((buf) => {
      sessionData.lastFrame = { buf, url: page.url() || start, t: Date.now() };
      return sessionData.lastFrame;
    })
    .catch(() => null)
    .finally(() => {
      sessionData.inFlightFrame = null;
    });

  return { sessionId: s.session_id, expiresAt: s.expires_at, width: 1000, height: 700 };
}

function get(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) throw Object.assign(new Error('This window has closed or expired. Open it again.'), { status: 410 });
  return s;
}

export async function frame(sessionId) {
  const s = get(sessionId);
  const now = Date.now();

  // Return fresh frame if captured less than 250ms ago to avoid overloading remote CDP
  if (s.lastFrame && (now - s.lastFrame.t < 250)) {
    return { buf: s.lastFrame.buf, url: s.lastFrame.url };
  }

  // Join in-flight screenshot if already active (prevents parallel CDP lockup)
  if (s.inFlightFrame) {
    return s.inFlightFrame;
  }

  s.inFlightFrame = (async () => {
    try {
      const buf = await s.page.screenshot({
        type: 'jpeg',
        quality: 55,
        timeout: 9000,
        animations: 'disabled',
      });
      const url = s.page.url() || '';
      s.lastFrame = { buf, url, t: Date.now() };
      return { buf, url };
    } catch (err) {
      if (s.lastFrame?.buf) {
        return { buf: s.lastFrame.buf, url: s.lastFrame.url };
      }
      const currentUrl = s.page.url() || APP_HOME[s.app] || '';
      return { buf: FALLBACK_JPEG, url: currentUrl };
    } finally {
      s.inFlightFrame = null;
    }
  })();

  return s.inFlightFrame;
}

const KEYS = ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Delete'];
export async function input(sessionId, ev) {
  const { page } = get(sessionId);
  if (ev.type === 'click') await page.mouse.click(Number(ev.x), Number(ev.y));
  else if (ev.type === 'type') await page.keyboard.type(String(ev.text || '').slice(0, 200), { delay: 25 });
  else if (ev.type === 'key' && KEYS.includes(ev.key)) await page.keyboard.press(ev.key);
  else if (ev.type === 'scroll') await page.mouse.wheel(0, Math.max(-2000, Math.min(2000, Number(ev.dy) || 0)));
  else if (ev.type === 'back') await page.goBack({ timeout: 15000 }).catch(() => {});
  return { ok: true };
}

export async function closeWindow(sessionId, save) {
  const s = get(sessionId);
  sessions.delete(sessionId);
  let result = null;
  try {
    if (save) result = await tf.saveProfileSetup(s.profileId, sessionId);
    else await tf.cancelProfileSetup(s.profileId, sessionId);
  } finally {
    await s.browser.close().catch(() => {});
  }
  if (save) {
    const all = listAccounts();
    all[s.app] = { ...all[s.app], profileId: s.profileId, connectedAt: Date.now(), expired: false, cookies: result?.cookie_count ?? null };
    writeJSON(FILE, all);
  }
  return { ok: true, app: s.app, saved: !!save, cookies: result?.cookie_count ?? null };
}

export async function disconnect(app) {
  const all = listAccounts();
  if (all[app]?.profileId) await tf.deleteProfile(all[app].profileId).catch(() => null);
  delete all[app];
  writeJSON(FILE, all);
  return { ok: true };
}
