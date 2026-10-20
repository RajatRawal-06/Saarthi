import assert from 'node:assert/strict';

const BASE = 'http://localhost:4321';

async function test(name, fn) {
  process.stdout.write(`TEST: ${name} ... `);
  try {
    const res = await fn();
    console.log(`PASS ✅ (${JSON.stringify(res).slice(0, 80)}...)`);
    return { name, pass: true };
  } catch (err) {
    console.log(`FAIL ❌ (${err.message})`);
    return { name, pass: false, error: err.message };
  }
}

async function run() {
  const results = [];

  // 1. Root HTML serving /
  results.push(await test('1. Root HTML serving (http://localhost:4321/)', async () => {
    const res = await fetch(`${BASE}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Saarthi — Your personal web agent'));
    assert.ok(html.includes('#saarthi'));
    return { status: 200, length: html.length };
  }));

  // 2. Static banner and card assets all return 200 OK
  results.push(await test('2. Static assets & hero banners integrity', async () => {
    const assets = [
      '/assets/grocery-hero.png',
      '/assets/order-hero.jpg',
      '/assets/compare-hero.jpg',
      '/assets/history-hero.jpg',
      '/assets/setup-hero.jpg',
      '/assets/me-hero.jpg',
      '/assets/vertical-groceries.jpg',
      '/assets/vertical-medicines.jpg',
      '/assets/vertical-electronics.jpg',
      '/assets/vertical-beauty.jpg',
      '/assets/quick-vaseline.jpg',
      '/assets/quick-chai-biscuit.jpg',
      '/assets/quick-dolo.jpg',
      '/assets/quick-shampoo.jpg',
      '/assets/pillar-zero-markup.jpg',
      '/assets/pillar-stealth-agent.jpg',
      '/assets/pillar-local-vault.jpg',
      '/assets/pillar-human-control.jpg',
    ];
    for (const path of assets) {
      const res = await fetch(`${BASE}${path}`);
      assert.equal(res.status, 200, `Asset ${path} returned status ${res.status}`);
    }
    return { verifiedCount: assets.length };
  }));

  // 3. Status API & wallet connectivity
  results.push(await test('3. Provider status & balance (/api/status)', async () => {
    const res = await fetch(`${BASE}/api/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ready, true);
    return { ready: data.ready, wallet: data.wallet };
  }));

  // 4. Item List 1: Groceries & Pantry
  results.push(await test('4. Basket parse: Aashirvaad Atta, Fortune Oil, Maggi', async () => {
    const res = await fetch(`${BASE}/api/basket/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '5 kg aashirvaad atta, 1L fortune tel, 4 maggi noodles' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.items.length, 3);
    assert.equal(data.items[0].brand, 'aashirvaad');
    assert.equal(data.items[0].quantity, 5000);
    assert.equal(data.items[0].unit, 'g');
    return { itemsCount: data.items.length, items: data.items.map(i => i.name) };
  }));

  // 5. Item List 2: Breakfast & Dairy
  results.push(await test('5. Basket parse: Fresh Milk, Brown Bread, 12 Eggs, Amul Butter', async () => {
    const res = await fetch(`${BASE}/api/basket/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '1L amul taaza doodh, 1 packet brown bread, 12 ande, 100g amul makhan' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.items.length, 4);
    assert.ok(data.items.some(i => i.name.includes('milk') || i.raw.includes('doodh')));
    return { itemsCount: data.items.length, items: data.items.map(i => i.name) };
  }));

  // 6. Item List 3: OTC Pharmacy & Health
  results.push(await test('6. Basket parse: Dolo 650, Band-Aid, Vicks Vaporub', async () => {
    const res = await fetch(`${BASE}/api/basket/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '2 strips dolo 650, 1 box band-aid, 50g vicks vaporub' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.items.length, 3);
    return { itemsCount: data.items.length, items: data.items.map(i => i.name) };
  }));

  // 7. Item List 4: Cleaning & Personal Care
  results.push(await test('7. Basket parse: Surf Excel, Vim Bar, Head & Shoulders shampoo', async () => {
    const res = await fetch(`${BASE}/api/basket/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '1kg surf excel detergent, 2 vim bar soap, 180ml head and shoulders' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.items.length, 3);
    return { itemsCount: data.items.length, items: data.items.map(i => i.name) };
  }));

  // 8. Order parse: Natural language order command parsing via /api/order/parse
  results.push(await test('8. Order parse: "Order 2 packs of Parle-G from Blinkit"', async () => {
    const res = await fetch(`${BASE}/api/order/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Order 2 packs of Parle-G from Blinkit' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.store, 'blinkit.com');
    assert.ok(data.items.some(it => it.name.toLowerCase().includes('parle-g')));
    return { store: data.store, items: data.items };
  }));

  // 9. Natural language order chore dispatch via /api/order
  results.push(await test('9. Chore dispatch: "Order 2 packs of Parle-G from Blinkit"', async () => {
    const res = await fetch(`${BASE}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Order 2 packs of Parle-G from Blinkit' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.id);
    return { jobId: data.id };
  }));

  // 10. Natural language order chore dispatch: Zepto vegetables
  results.push(await test('10. Chore dispatch: "Get me 1kg onion and 2kg potatoes from Zepto"', async () => {
    const res = await fetch(`${BASE}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Get me 1kg onion and 2kg potatoes from Zepto' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.id);
    return { jobId: data.id };
  }));

  // 11. Natural language order chore dispatch: Amazon electronics
  results.push(await test('11. Chore dispatch: "Order boAt wireless earphones from Amazon"', async () => {
    const res = await fetch(`${BASE}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Order boAt wireless earphones from Amazon' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.id);
    return { jobId: data.id };
  }));

  // 12. Fees API returns valid configuration
  results.push(await test('12. Delivery & Platform Fees API (/api/basket/fees)', async () => {
    const res = await fetch(`${BASE}/api/basket/fees`);
    assert.equal(res.status, 200);
    const fees = await res.json();
    assert.ok(fees.blinkit);
    assert.ok(fees.zepto);
    assert.ok(fees.amazon);
    return { appsWithFees: Object.keys(fees) };
  }));

  // 13. Profile PIN code update & round-trip verification
  results.push(await test('13. Profile PIN code update to Delhi (110042)', async () => {
    const res = await fetch(`${BASE}/api/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Saarthi Tester', phone: '9811122233', pincode: '110042' }),
    });
    assert.equal(res.status, 200);
    const profile = await res.json();
    assert.equal(profile.pincode, '110042');
    return { pincode: profile.pincode, name: profile.full_name };
  }));

  // 14. Retailer Directory (/api/accounts) supports 11 retailers
  results.push(await test('14. Retailer Directory (/api/accounts) supports 11 retailers', async () => {
    const res = await fetch(`${BASE}/api/accounts`);
    assert.equal(res.status, 200);
    const accounts = await res.json();
    assert.ok(Array.isArray(accounts));
    assert.ok(accounts.length >= 10);
    const apps = accounts.map(a => a.app);
    assert.ok(apps.includes('blinkit'));
    assert.ok(apps.includes('zepto'));
    assert.ok(apps.includes('amazon'));
    return { accountCount: accounts.length, apps: apps.slice(0, 5) };
  }));

  // 15. Compare Price Hunt: Sony WH-1000XM5
  results.push(await test('15. Price Hunt: "Sony WH-1000XM5" target ₹22000', async () => {
    const res = await fetch(`${BASE}/api/price-hunt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: 'Sony WH-1000XM5 Noise Cancelling Headphones', target_price: 22000 }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.id);
    return { huntId: data.id };
  }));

  // 16. Compare Price Hunt: Apple MacBook Air M3
  results.push(await test('16. Price Hunt: "Apple MacBook Air M3" target ₹95000', async () => {
    const res = await fetch(`${BASE}/api/price-hunt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: 'Apple MacBook Air M3 16GB 512GB', target_price: 95000 }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.id);
    return { huntId: data.id };
  }));

  // 17. Caretaker settings retrieval
  results.push(await test('17. Caretaker settings (/api/settings)', async () => {
    const res = await fetch(`${BASE}/api/settings`);
    assert.equal(res.status, 200);
    const settings = await res.json();
    assert.ok(Array.isArray(settings.defaultStores));
    return { defaultStores: settings.defaultStores, simpleMode: settings.simpleMode };
  }));

  // 18. Job list retrieval (/api/jobs)
  results.push(await test('18. Job ledger audit retrieval (/api/jobs)', async () => {
    const res = await fetch(`${BASE}/api/jobs`);
    assert.equal(res.status, 200);
    const jobs = await res.json();
    assert.ok(Array.isArray(jobs));
    return { totalJobs: jobs.length, latest: jobs[0]?.title };
  }));

  console.log('\n========================================');
  const passed = results.filter(r => r.pass).length;
  console.log(`TOTAL HTTP TESTS: ${results.length} | PASSED: ${passed} | FAILED: ${results.length - passed}`);
  console.log('========================================');

  if (passed !== results.length) {
    process.exit(1);
  }
}

run();
