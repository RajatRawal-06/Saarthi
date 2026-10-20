export function createSemaphore(limit = 1) {
  const capacity = Math.max(1, Math.floor(Number(limit) || 1));
  let active = 0;
  const waiting = [];

  const releaseSlot = () => {
    while (waiting.length) {
      const next = waiting.shift();
      next.signal?.removeEventListener('abort', next.onAbort);
      if (next.signal?.aborted) continue;
      next.resolve(makeRelease());
      return;
    }
    active--;
  };

  const makeRelease = () => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseSlot();
    };
  };

  async function acquire(signal) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    if (active < capacity) {
      active++;
      return makeRelease();
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, onAbort: null };
      entry.onAbort = () => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason || new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      waiting.push(entry);
    });
  }

  return {
    acquire,
    async run(task, signal) {
      const release = await acquire(signal);
      try { return await task(); } finally { release(); }
    },
    get active() { return active; },
    get queued() { return waiting.length; },
  };
}

// Start a provider-operation timeout only after a worker has actually acquired
// capacity. Time waiting in Saarthi's queue is not time spent on the remote site.
export function runWithTimeoutAfterAcquire(semaphore, task, { timeoutMs, signal } = {}) {
  return semaphore.run(() => {
    const timeout = Number(timeoutMs) > 0 ? AbortSignal.timeout(Number(timeoutMs)) : null;
    const taskSignal = timeout && signal
      ? AbortSignal.any([signal, timeout])
      : (timeout || signal);
    return task(taskSignal);
  }, signal);
}
