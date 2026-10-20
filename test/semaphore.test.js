import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSemaphore, runWithTimeoutAfterAcquire } from '../lib/semaphore.js';
import { runAgent } from '../lib/tinyfish.js';

test('shared agent semaphore limits simultaneous runs', async () => {
  const slots = createSemaphore(2);
  let active = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: 8 }, () => slots.run(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 4));
    active--;
  })));
  assert.equal(peak, 2);
  assert.equal(slots.active, 0);
  assert.equal(slots.queued, 0);
});

test('a queued task can be cancelled without taking a slot', async () => {
  const slots = createSemaphore(1);
  let releaseFirst;
  const first = slots.run(() => new Promise((resolve) => { releaseFirst = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  const controller = new AbortController();
  const cancelled = slots.run(async () => assert.fail('cancelled task must not run'), controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  releaseFirst();
  await first;
  assert.equal(slots.active, 0);
  assert.equal(slots.queued, 0);
});

test('a queued agent timeout starts only after the provider slot is acquired', async () => {
  const slots = createSemaphore(1);
  let releaseFirst;
  const first = slots.run(() => new Promise((resolve) => { releaseFirst = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  const queued = runWithTimeoutAfterAcquire(slots, async (signal) => {
    assert.equal(signal.aborted, false);
    return 'started';
  }, { timeoutMs: 30 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  releaseFirst();
  await first;
  assert.equal(await queued, 'started');
});

test('an aborted agent run cancels its remote TinyFish run', async () => {
  const originalFetch = globalThis.fetch;
  const priorKey = process.env.TINYFISH_API_KEY;
  const encoder = new TextEncoder();
  let remoteCancelled = false;
  process.env.TINYFISH_API_KEY = 'test-key';
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/v1/automation/run-sse')) {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"run_id":"run-test","type":"PROGRESS"}\n\n'));
          options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
        },
      });
      return { ok: true, body };
    }
    if (String(url).endsWith('/v1/runs/run-test/cancel')) {
      remoteCancelled = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), 30);
    await assert.rejects(runAgent({}, { signal: controller.signal }), { name: 'TimeoutError' });
    assert.equal(remoteCancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorKey === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = priorKey;
  }
});
