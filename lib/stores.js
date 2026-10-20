// Retailer directory shared by search, order, and account flows.
// A retailer is only auto-searched when it has an explicit search route.

const q = encodeURIComponent;
const AMAZON = { IN: 'amazon.in', US: 'amazon.com', GB: 'amazon.co.uk', CA: 'amazon.ca', DE: 'amazon.de', AU: 'amazon.com.au', JP: 'amazon.co.jp', FR: 'amazon.fr' };

export const RETAILERS = [
  { id: 'blinkit', name: 'Blinkit', domain: 'blinkit.com', accountKey: 'blinkit', category: 'quick-commerce', countries: ['IN'], searchUrl: (t) => `https://blinkit.com/s/?q=${q(t)}` },
  { id: 'zepto', name: 'Zepto', domain: 'zeptonow.com', accountKey: 'zepto', category: 'quick-commerce', countries: ['IN'], searchUrl: (t) => `https://www.zeptonow.com/search?query=${q(t)}` },
  { id: 'instamart', name: 'Swiggy Instamart', domain: 'swiggy.com', accountKey: 'instamart', category: 'quick-commerce', countries: ['IN'], searchUrl: (t) => `https://www.swiggy.com/instamart/search?query=${q(t)}` },
  { id: 'bigbasket', name: 'BigBasket', domain: 'bigbasket.com', accountKey: 'bigbasket', category: 'grocery', countries: ['IN'], searchUrl: (t) => `https://www.bigbasket.com/ps/?q=${q(t)}` },
  { id: 'amazon', name: 'Amazon India', domain: 'amazon.in', accountKey: 'amazon', category: 'marketplace', countries: ['IN'], searchUrl: (t) => `https://www.amazon.in/s?k=${q(t)}` },
  { id: 'flipkart', name: 'Flipkart', domain: 'flipkart.com', accountKey: 'flipkart', category: 'marketplace', countries: ['IN'], searchUrl: (t) => `https://www.flipkart.com/search?q=${q(t)}` },
  { id: 'croma', name: 'Croma', domain: 'croma.com', accountKey: 'croma', category: 'electronics', countries: ['IN'], searchUrl: (t) => `https://www.croma.com/searchB?q=${q(t)}%3Arelevance` },
  { id: 'reliance', name: 'Reliance Digital', domain: 'reliancedigital.in', accountKey: 'reliance', category: 'electronics', countries: ['IN'], searchUrl: (t) => `https://www.reliancedigital.in/products?q=${q(t)}` },
  { id: 'indiamart', name: 'IndiaMART', domain: 'indiamart.com', accountKey: 'indiamart', category: 'b2b', countries: ['IN'], searchUrl: (t) => `https://dir.indiamart.com/search.mp?ss=${q(t)}` },
  { id: 'jiomart', name: 'JioMart', domain: 'jiomart.com', accountKey: 'jiomart', category: 'grocery', countries: ['IN'], searchUrl: (t) => `https://www.jiomart.com/search/${q(t)}` },
  { id: 'tata1mg', name: 'Tata 1mg', domain: '1mg.com', accountKey: 'tata1mg', category: 'pharmacy', countries: ['IN'], searchUrl: (t) => `https://www.1mg.com/search/all?name=${q(t)}` },
  { id: 'nykaa', name: 'Nykaa', domain: 'nykaa.com', accountKey: null, category: 'beauty', countries: ['IN'], searchUrl: (t) => `https://www.nykaa.com/search/result/?q=${q(t)}` },
  { id: 'myntra', name: 'Myntra', domain: 'myntra.com', accountKey: null, category: 'fashion', countries: ['IN'], searchUrl: (t) => `https://www.myntra.com/${q(t)}` },
  { id: 'ajio', name: 'AJIO', domain: 'ajio.com', accountKey: null, category: 'fashion', countries: ['IN'], searchUrl: (t) => `https://www.ajio.com/search/?text=${q(t)}` },
  { id: 'tatacliq', name: 'Tata CLiQ', domain: 'tatacliq.com', accountKey: null, category: 'marketplace', countries: ['IN'], searchUrl: (t) => `https://www.tatacliq.com/search/?searchCategory=all&text=${q(t)}` },
  { id: 'vijaysales', name: 'Vijay Sales', domain: 'vijaysales.com', accountKey: null, category: 'electronics', countries: ['IN'], searchUrl: (t) => `https://www.vijaysales.com/search?q=${q(t)}` },
  { id: 'apple', name: 'Apple', domain: 'apple.com', accountKey: null, category: 'electronics', countries: ['IN', 'US', 'GB', 'CA', 'DE', 'AU', 'JP', 'FR'], searchUrl: (t, c = 'IN') => { const locale = ({ IN: 'in', US: '', GB: 'uk', CA: 'ca', DE: 'de', AU: 'au', JP: 'jp', FR: 'fr' })[c] ?? 'in'; return `https://www.apple.com${locale ? `/${locale}` : ''}/search/${q(t)}`; } },
  { id: 'samsung', name: 'Samsung India', domain: 'samsung.com', accountKey: null, category: 'electronics', countries: ['IN'], searchUrl: (t) => `https://www.samsung.com/in/search/?searchvalue=${q(t)}` },
  { id: 'amazon-us', name: 'Amazon', domain: 'amazon.com', accountKey: null, category: 'marketplace', countries: ['US'], searchUrl: (t) => `https://www.amazon.com/s?k=${q(t)}` },
  { id: 'amazon-gb', name: 'Amazon', domain: 'amazon.co.uk', accountKey: null, category: 'marketplace', countries: ['GB'], searchUrl: (t) => `https://www.amazon.co.uk/s?k=${q(t)}` },
  { id: 'amazon-ca', name: 'Amazon', domain: 'amazon.ca', accountKey: null, category: 'marketplace', countries: ['CA'], searchUrl: (t) => `https://www.amazon.ca/s?k=${q(t)}` },
  { id: 'amazon-de', name: 'Amazon', domain: 'amazon.de', accountKey: null, category: 'marketplace', countries: ['DE'], searchUrl: (t) => `https://www.amazon.de/s?k=${q(t)}` },
  { id: 'amazon-au', name: 'Amazon', domain: 'amazon.com.au', accountKey: null, category: 'marketplace', countries: ['AU'], searchUrl: (t) => `https://www.amazon.com.au/s?k=${q(t)}` },
  { id: 'amazon-jp', name: 'Amazon', domain: 'amazon.co.jp', accountKey: null, category: 'marketplace', countries: ['JP'], searchUrl: (t) => `https://www.amazon.co.jp/s?k=${q(t)}` },
  { id: 'amazon-fr', name: 'Amazon', domain: 'amazon.fr', accountKey: null, category: 'marketplace', countries: ['FR'], searchUrl: (t) => `https://www.amazon.fr/s?k=${q(t)}` },
  { id: 'walmart-us', name: 'Walmart', domain: 'walmart.com', accountKey: null, category: 'marketplace', countries: ['US'], searchUrl: (t) => `https://www.walmart.com/search?q=${q(t)}` },
  { id: 'target-us', name: 'Target', domain: 'target.com', accountKey: null, category: 'marketplace', countries: ['US'], searchUrl: (t) => `https://www.target.com/s?searchTerm=${q(t)}` },
  { id: 'bestbuy-us', name: 'Best Buy', domain: 'bestbuy.com', accountKey: null, category: 'electronics', countries: ['US'], searchUrl: (t) => `https://www.bestbuy.com/site/searchpage.jsp?st=${q(t)}` },
  { id: 'bestbuy-ca', name: 'Best Buy Canada', domain: 'bestbuy.ca', accountKey: null, category: 'electronics', countries: ['CA'], searchUrl: (t) => `https://www.bestbuy.ca/en-ca/search?search=${q(t)}` },
  { id: 'ebay-us', name: 'eBay', domain: 'ebay.com', accountKey: null, category: 'marketplace', countries: ['US'], searchUrl: (t) => `https://www.ebay.com/sch/i.html?_nkw=${q(t)}` },
  { id: 'newegg-us', name: 'Newegg', domain: 'newegg.com', accountKey: null, category: 'electronics', countries: ['US'], searchUrl: (t) => `https://www.newegg.com/p/pl?d=${q(t)}` },
  { id: 'argos-gb', name: 'Argos', domain: 'argos.co.uk', accountKey: null, category: 'marketplace', countries: ['GB'], searchUrl: (t) => `https://www.argos.co.uk/search/${q(t)}/` },
  { id: 'currys-gb', name: 'Currys', domain: 'currys.co.uk', accountKey: null, category: 'electronics', countries: ['GB'], searchUrl: (t) => `https://www.currys.co.uk/search?q=${q(t)}` },
];

const ALIASES = {
  amazon: (c) => AMAZON[c] || 'amazon.com', flipkart: 'flipkart.com', blinkit: 'blinkit.com', zepto: 'zeptonow.com', zeptonow: 'zeptonow.com',
  instamart: 'swiggy.com', swiggy: 'swiggy.com', swiggyinstamart: 'swiggy.com', bigbasket: 'bigbasket.com', croma: 'croma.com', reliance: 'reliancedigital.in',
  reliancedigital: 'reliancedigital.in', indiamart: 'indiamart.com', nykaa: 'nykaa.com', myntra: 'myntra.com', ajio: 'ajio.com', jiomart: 'jiomart.com',
  tatacliq: 'tatacliq.com', vijaysales: 'vijaysales.com', meesho: 'meesho.com', snapdeal: 'snapdeal.com', '1mg': '1mg.com',
  tata1mg: '1mg.com', pharmeasy: 'pharmeasy.in', decathlon: (c) => (c === 'IN' ? 'decathlon.in' : 'decathlon.com'),
  walmart: 'walmart.com', target: 'target.com', bestbuy: (c) => (c === 'CA' ? 'bestbuy.ca' : 'bestbuy.com'), costco: 'costco.com',
  ebay: 'ebay.com', newegg: 'newegg.com', argos: 'argos.co.uk', currys: 'currys.co.uk', apple: 'apple.com', samsung: 'samsung.com',
};

const byDomain = new Map(RETAILERS.map((r) => [r.domain, r]));
export const retailerForDomain = (domain) => {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '').replace(/^dir\./, '');
  if (d === 'zepto.com') return byDomain.get('zeptonow.com');
  return byDomain.get(d) || RETAILERS.find((r) => d.endsWith(`.${r.domain}`)) || null;
};
export const retailersForCountry = (country = 'IN') => RETAILERS.filter((r) => r.countries.includes(String(country).toUpperCase()));

export function resolveStore(raw, country = 'IN') {
  const s = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*/, '');
  if (!s) return null;
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(s)) return s;
  const key = s.replace(/[^a-z0-9]/g, '');
  const alias = ALIASES[key];
  if (!alias) return null;
  return typeof alias === 'function' ? alias(String(country).toUpperCase()) : alias;
}

// "blinkit, zepto" / "Blinkit and Amazon" / "swiggy instamart" / "amazon.in flipkart.com"
export function parseStores(text, country = 'IN') {
  return parseStoreRequest(text, country).stores;
}

export function parseStoreRequest(text, country = 'IN') {
  const parts = String(text || '').split(/[,;\n]+|\s+(?:and|&|or)\s+/i).map((p) => p.trim()).filter(Boolean);
  const stores = [];
  const unsupported = [];
  for (const part of parts) {
    const whole = part.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const tokens = ALIASES[whole] || !/\s/.test(part) ? [part] : part.split(/\s+/);
    for (const token of tokens) {
      const domain = resolveStore(token, country);
      if (domain) stores.push(domain);
      else unsupported.push(token);
    }
  }
  return { stores: [...new Set(stores)], unsupported: [...new Set(unsupported)] };
}

export const storeEntryUrl = (domain, product, country = 'IN') => {
  const retailer = retailerForDomain(domain);
  return retailer ? retailer.searchUrl(product, String(country).toUpperCase()) : null;
};

export const STORE_NAMES = Object.fromEntries(RETAILERS.map((r) => [r.domain, r.name]));
STORE_NAMES['zepto.com'] = 'Zepto';
export const storeName = (d) => STORE_NAMES[d] || d;
// Stores offered as caretaker defaults / quick picks. This list remains limited
// to integrations with saved account profiles and basket workflows.
export const ORDER_STORES = ['blinkit.com', 'zeptonow.com', 'swiggy.com', 'bigbasket.com', 'amazon.in', 'flipkart.com', 'croma.com', 'reliancedigital.in', 'indiamart.com', 'jiomart.com', '1mg.com'];
