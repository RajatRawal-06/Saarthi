// End-to-end test runner for Saarthi live server
const BASE_URL = 'http://localhost:4321';

async function test(name, fn) {
  process.stdout.write(`TEST: ${name} ... `);
  try {
    const result = await fn();
    console.log(`PASS ✅`, result ? `(${JSON.stringify(result).slice(0, 90)}...)` : '');
    return { name, passed: true, result };
  } catch (err) {
    console.log(`FAIL ❌ - Error: ${err.message}`);
    return { name, passed: false, error: err };
  }
}

async function run() {
  const results = [];

  // --- Test 1: Grocery list parsing - standard items ---
  results.push(await test('1. Parse standard grocery list (milk, bread, eggs, butter)', async () => {
    const res = await fetch(`${BASE_URL}/api/saarthi/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '1 litre amul milk, 1 brown bread, 6 eggs, 1 pack amul butter 100g' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!Array.isArray(data.items) || data.items.length !== 4) {
      throw new Error(`Expected 4 items, got ${data.items?.length}`);
    }
    return { itemsCount: data.items.length, items: data.items.map(i => `${i.quantity} ${i.unit} ${i.name}`) };
  }));

  // --- Test 2: Grocery list parsing - Hinglish & staples ---
  results.push(await test('2. Parse Hinglish staples (aashirvaad atta, fortune tel, tata namak)', async () => {
    const res = await fetch(`${BASE_URL}/api/basket/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '5 kg aashirvaad atta, 2 litre fortune sunflower oil, 1 kg tata salt, 500g toor dal' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!Array.isArray(data.items) || data.items.length !== 4) {
      throw new Error(`Expected 4 items, got ${data.items?.length}`);
    }
    const atta = data.items.find(i => /atta/i.test(i.name));
    if (!atta || atta.quantity !== 5000 || atta.unit !== 'g') {
      throw new Error(`Atta parsing mismatch: ${JSON.stringify(atta)}`);
    }
    return { itemsCount: data.items.length, atta: `${atta.quantity}${atta.unit} ${atta.name}` };
  }));

  // --- Test 3: Grocery list parsing - Medicines & Personal Care ---
  results.push(await test('3. Parse OTC medicines & personal care (Dolo 650, Head & Shoulders)', async () => {
    const res = await fetch(`${BASE_URL}/api/basket/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '2 strips dolo 650, 1 bottle head and shoulders shampoo 180ml, 1 tube colgate 150g' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!Array.isArray(data.items) || data.items.length !== 3) {
      throw new Error(`Expected 3 items, got ${data.items?.length}`);
    }
    return { itemsCount: data.items.length, items: data.items.map(i => `${i.quantity} ${i.unit} ${i.name}`) };
  }));

  // --- Test 4: Breakfast & Dairy combo parsing ---
  results.push(await test('4. Parse breakfast restock preset (Parle-G, Amul Taaza, bananas)', async () => {
    const res = await fetch(`${BASE_URL}/api/saarthi/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '2 packets parle-g, 1 litre amul milk, 6 bananas, 1 packet bread' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.items.length < 3) throw new Error(`Expected at least 3 items, got ${data.items.length}`);
    return { count: data.items.length, items: data.items.map(i => i.name) };
  }));

  // --- Test 5: Order NL Parsing - Blinkit ---
  results.push(await test('5. Order sentence: "I want to order 2 amul butter and 1 dozen eggs from blinkit"', async () => {
    const res = await fetch(`${BASE_URL}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'I want to order 2 amul butter and 1 dozen eggs from blinkit' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.id) throw new Error(`Missing job id in response: ${JSON.stringify(data)}`);
    const job = await (await fetch(`${BASE_URL}/api/jobs/${data.id}`)).json();
    return { jobId: data.id, title: job.title, type: job.type };
  }));

  // --- Test 6: Order NL Parsing - Zepto ---
  results.push(await test('6. Order sentence: "order 1kg surf excel and 2 vim bars from zepto"', async () => {
    const res = await fetch(`${BASE_URL}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'order 1kg surf excel and 2 vim bars from zepto' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.id) throw new Error(`Missing job id: ${JSON.stringify(data)}`);
    const job = await (await fetch(`${BASE_URL}/api/jobs/${data.id}`)).json();
    return { jobId: data.id, title: job.title };
  }));

  // --- Test 7: Order NL Parsing - Amazon ---
  results.push(await test('7. Order sentence: "get me boat headphones from amazon"', async () => {
    const res = await fetch(`${BASE_URL}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'get me boat headphones from amazon' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.id) throw new Error(`Missing job id: ${JSON.stringify(data)}`);
    const job = await (await fetch(`${BASE_URL}/api/jobs/${data.id}`)).json();
    return { jobId: data.id, title: job.title };
  }));

  // --- Test 8: Order NL Parsing - Tata 1mg ---
  results.push(await test('8. Order sentence: "buy 2 dolo 650 and vicks vaporub from 1mg"', async () => {
    const res = await fetch(`${BASE_URL}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'buy 2 dolo 650 and vicks vaporub from 1mg' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.id) throw new Error(`Missing job id: ${JSON.stringify(data)}`);
    const job = await (await fetch(`${BASE_URL}/api/jobs/${data.id}`)).json();
    return { jobId: data.id, title: job.title };
  }));

  // --- Test 9: Price Hunt - Electronics ---
  results.push(await test('9. Price Hunt: "Sony WH-1000XM5" target ₹20000', async () => {
    const res = await fetch(`${BASE_URL}/api/price-hunt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: 'Sony WH-1000XM5 ANC Headphones', targetPrice: 20000, maxStores: 4 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.id) throw new Error(`Missing job id: ${JSON.stringify(data)}`);
    return { jobId: data.id };
  }));

  // --- Test 10: Price Hunt deduplication ---
  results.push(await test('10. Price Hunt deduplication on duplicate query', async () => {
    const res = await fetch(`${BASE_URL}/api/price-hunt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: 'Sony WH-1000XM5 ANC Headphones', targetPrice: 20000, maxStores: 4 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.reused) throw new Error(`Expected duplicated price hunt to be reused: ${JSON.stringify(data)}`);
    return { reused: data.reused, id: data.id };
  }));

  // --- Test 11: Price Hunt empty product validation ---
  results.push(await test('11. Price Hunt rejection of empty product string', async () => {
    const res = await fetch(`${BASE_URL}/api/price-hunt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: '   ' }),
    });
    if (res.status !== 400) throw new Error(`Expected status 400, got ${res.status}`);
    const data = await res.json();
    if (!data.error) throw new Error(`Expected error property: ${JSON.stringify(data)}`);
    return { status: res.status, error: data.error };
  }));

  // --- Test 12: PIN code sync ---
  results.push(await test('12. PIN code sync API (valid & invalid PIN codes)', async () => {
    const res1 = await fetch(`${BASE_URL}/api/pincode/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pincode: '110001' }),
    });
    if (!res1.ok) throw new Error(`HTTP ${res1.status}`);
    const data1 = await res1.json();
    if (!data1.ok || data1.pincode !== '110001') throw new Error(`Valid PIN sync failed: ${JSON.stringify(data1)}`);

    const res2 = await fetch(`${BASE_URL}/api/pincode/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pincode: 'abc' }),
    });
    if (res2.status !== 400) throw new Error(`Expected 400 for invalid PIN, got ${res2.status}`);

    return { validOk: data1.ok, pincode: data1.pincode, invalidStatus: res2.status };
  }));

  // --- Test 13: Profile safety filter ---
  results.push(await test('13. Profile sensitive data filtering (credit card, cvv, password stripped)', async () => {
    const res = await fetch(`${BASE_URL}/api/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Isha Test',
        phone: '9876543210',
        pincode: '110042',
        credit_card: '4111111111111111',
        cvv: '123',
        password: 'supersecretpassword',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const saved = await res.json();
    if (saved.credit_card || saved.cvv || saved.password) {
      throw new Error(`Sensitive field was NOT stripped! ${JSON.stringify(saved)}`);
    }
    if (saved.full_name !== 'Isha Test' || saved.pincode !== '110042') {
      throw new Error(`Non-sensitive field missing or wrong: ${JSON.stringify(saved)}`);
    }
    return { strippedSensitive: true, savedFields: Object.keys(saved) };
  }));

  // --- Test 14: Form fill URL validation ---
  results.push(await test('14. Form fill chore URL validation (rejecting non-http URLs)', async () => {
    const res = await fetch(`${BASE_URL}/api/form-fill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'javascript:alert(1)' }),
    });
    if (res.status !== 400) throw new Error(`Expected status 400, got ${res.status}`);
    const data = await res.json();
    return { status: res.status, error: data.error };
  }));

  // --- Test 15: Account listings directory ---
  results.push(await test('15. Account listings & 11 configured retailers directory', async () => {
    const res = await fetch(`${BASE_URL}/api/accounts`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const accounts = await res.json();
    if (!Array.isArray(accounts) || accounts.length < 5) {
      throw new Error(`Expected at least 5 configured retailer accounts, got ${accounts?.length}`);
    }
    const apps = accounts.map(a => a.app);
    const expected = ['blinkit', 'zepto', 'amazon', 'flipkart', 'croma', 'reliance', 'indiamart', 'tata1mg', 'jiomart'];
    for (const exp of expected) {
      if (!apps.includes(exp)) throw new Error(`Missing expected retailer: ${exp}`);
    }
    return { totalAccounts: accounts.length, retailers: apps };
  }));

  // --- Summary ---
  console.log('\n========================================');
  const passed = results.filter(r => r.passed).length;
  console.log(`TOTAL TESTS: ${results.length} | PASSED: ${passed} | FAILED: ${results.length - passed}`);
  console.log('========================================\n');
  return results;
}

run().catch(console.error);
