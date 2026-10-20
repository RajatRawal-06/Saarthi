// Multi-batch search runner to test diverse item lists end-to-end
const BASE = 'http://localhost:4321';

async function runSearch(name, items, apps = ['zepto', 'amazon']) {
  console.log(`\n======================================================`);
  console.log(`RUNNING SEARCH TEST: ${name}`);
  console.log(`Items:`, items.map(i => `${i.quantity}${i.unit} ${i.name}`).join(', '));
  console.log(`Apps:`, apps.join(', '));
  console.log(`======================================================`);

  const res = await fetch(`${BASE}/api/saarthi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, apps, pincode: '110042' }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`❌ HTTP Error:`, err);
    return { name, ok: false, error: err };
  }

  const { id } = await res.json();
  console.log(`✅ Started Job ID: ${id}`);

  // Poll job until approval or completion
  const start = Date.now();
  let completed = false;
  let jobData = null;

  while (Date.now() - start < 120000) {
    await new Promise(r => setTimeout(r, 4000));
    const jRes = await fetch(`${BASE}/api/jobs/${id}`);
    if (!jRes.ok) continue;
    const job = await jRes.json();
    const elapsed = Math.round((Date.now() - start) / 1000);
    const lastEv = job.events[job.events.length - 1];
    process.stdout.write(`\r   [${elapsed}s] Status: ${job.status} | Last event: ${(lastEv?.msg || lastEv?.stage || '').slice(0, 45)}...      `);

    if (['awaiting_approval', 'finished', 'failed', 'cancelled', 'interrupted'].includes(job.status)) {
      console.log(`\n🎯 Reached terminal status: ${job.status}`);
      completed = true;
      jobData = job;
      break;
    }
  }

  if (!completed) {
    console.log(`\n⚠️ Job did not reach terminal status within deadline`);
    return { name, ok: false, timeout: true };
  }

  if (jobData.status === 'awaiting_approval') {
    const offersCount = Object.keys(jobData.approval?.offers || {}).length;
    console.log(`📦 Basket plan generated with ${offersCount} item offers!`);
    // Reject to cleanly close out the job without placing order
    await fetch(`${BASE}/api/jobs/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: false }),
    });
    console.log(`✅ Closed plan approval cleanly.`);
    return { name, ok: true, status: jobData.status, offers: jobData.approval?.offers };
  }

  return { name, ok: jobData.status !== 'failed', status: jobData.status, result: jobData.result };
}

async function main() {
  const testBatches = [
    {
      name: 'Batch 1: Morning Chai & Biscuits',
      items: [
        { id: 'chai_1', name: 'Parle-G Biscuits', quantity: 1, unit: 'pc', brand: 'parle', allowSubstitute: true },
        { id: 'chai_2', name: 'Red Label Tea', quantity: 250, unit: 'g', brand: 'brooke bond', allowSubstitute: true }
      ]
    },
    {
      name: 'Batch 2: Kitchen Essentials (Atta & Salt)',
      items: [
        { id: 'kit_1', name: 'Aashirvaad Atta', quantity: 1000, unit: 'g', brand: 'aashirvaad', allowSubstitute: true },
        { id: 'kit_2', name: 'Tata Salt', quantity: 1000, unit: 'g', brand: 'tata', allowSubstitute: true }
      ]
    },
    {
      name: 'Batch 3: Personal Care & Shampoo',
      items: [
        { id: 'pc_1', name: 'Head and Shoulders Shampoo', quantity: 180, unit: 'ml', brand: 'head and shoulders', allowSubstitute: true },
        { id: 'pc_2', name: 'Dettol Soap', quantity: 1, unit: 'pc', brand: 'dettol', allowSubstitute: true }
      ]
    },
    {
      name: 'Batch 4: OTC Wellness & First Aid',
      items: [
        { id: 'med_1', name: 'Dolo 650', quantity: 1, unit: 'pc', brand: null, allowSubstitute: true },
        { id: 'med_2', name: 'Vicks Vaporub', quantity: 25, unit: 'g', brand: 'vicks', allowSubstitute: true }
      ]
    },
    {
      name: 'Batch 5: Breakfast Quick Dairy',
      items: [
        { id: 'brk_1', name: 'Amul Taaza Milk', quantity: 500, unit: 'ml', brand: 'amul', allowSubstitute: true },
        { id: 'brk_2', name: 'White Bread', quantity: 1, unit: 'pc', brand: null, allowSubstitute: true }
      ]
    }
  ];

  const results = [];
  for (const b of testBatches) {
    const res = await runSearch(b.name, b.items, ['zepto']);
    results.push(res);
  }

  console.log('\n======================================================');
  console.log('SEARCH TEST SUITE RESULTS:');
  results.forEach(r => {
    console.log(`- ${r.name}: ${r.ok ? 'SUCCESS ✅' : 'FAILED ❌'} (${r.status || r.error})`);
  });
  console.log('======================================================\n');
}

main().catch(console.error);
