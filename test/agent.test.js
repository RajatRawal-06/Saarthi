import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartRun } from '../lib/agent.js';

test('a retailer access-denied result is reported without an automatic stealth retry', async () => {
  const originalFetch = globalThis.fetch;
  const priorKey = process.env.TINYFISH_API_KEY;
  const encoder = new TextEncoder();
  let agentRequests = 0;
  process.env.TINYFISH_API_KEY = 'test-key';
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/v1/automation/run-sse')) {
      agentRequests++;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"run_id":"blocked-test","type":"COMPLETE","status":"COMPLETED","result":{"product_name":"","page_status":"blocked"}}\n\n'));
          controller.close();
        },
      });
      return { ok: true, body };
    }
    if (String(url).endsWith('/v1/runs/blocked-test')) {
      return new Response(JSON.stringify({ num_of_steps: 3 }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const ctx = { log() {}, usage() {} };
    const result = await smartRun(ctx, {
      url: 'https://www.example.com',
      goal: 'Read a product page',
      label: 'example.com',
      country: 'IN',
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /blocks automated browsers/i);
    assert.equal(agentRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorKey === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = priorKey;
  }
});
