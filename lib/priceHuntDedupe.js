function normalize(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// maxStores is intentionally excluded: configured-country searches fan out to
// all retailer domains, so two UI submissions with different caps still ask
// the provider to do the same work.
export function priceHuntKey(input = {}) {
  return JSON.stringify({
    product: normalize(input.product),
    country: normalize(input.country || 'IN'),
    targetPrice: normalize(input.targetPrice),
    pin: normalize(input.pin),
    stores: normalize(input.stores),
  });
}

export function findDuplicatePriceHunt(input, jobs = []) {
  const key = priceHuntKey(input);
  return jobs.find((job) => job.type === 'price_hunt'
    && job.status === 'running'
    && priceHuntKey(job.input) === key) || null;
}
