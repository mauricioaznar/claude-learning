// ─────────────────────────────────────────────────────────────────────────────
// WORKED EXAMPLES — study these, don't edit them.
//
// We walk through each one together; then you reimplement it from scratch in
// to-implement.js and flip the panel toggle to "Yours" to check the counts match.
// The comments explain the *why* at each decision point — the parts that bite.
// ─────────────────────────────────────────────────────────────────────────────

// 1 — debounce: run once, `wait` ms after the calls go quiet (trailing edge).
export function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    // A new call cancels the pending one — that's what "resets the window" means.
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;      // window is over; next call starts fresh
      fn(...args);       // the LAST call's args win, because only its timer survived
    }, wait);
  };
}

// 2 — batch: gather a tick's worth of schedule() calls, flush once on a microtask.
export function createBatcher(flush) {
  let queue = [];
  let scheduled = false;
  return {
    schedule(item) {
      queue.push(item);
      if (scheduled) return;         // a flush is already pending — don't book a 2nd
      scheduled = true;
      // Microtask, not setTimeout: this runs after the current sync code but
      // BEFORE the next task / paint — so the batch closes at the end of *this* tick.
      queueMicrotask(() => {
        const items = queue;
        queue = [];                  // reset BEFORE flush, so items scheduled from
        scheduled = false;           // inside flush() start a clean next batch
        flush(items);
      });
    },
  };
}

// 3 — coalesce: share the one in-flight promise per key; clear it on settle.
export function coalesce(fetcher) {
  const inflight = new Map();        // key -> pending promise
  return (key) => {
    if (inflight.has(key)) return inflight.get(key);
    // .finally clears on BOTH resolve and reject — otherwise a failed fetch would
    // wedge the key forever and every retry would return the rejected promise.
    const p = fetcher(key).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}

// 4 — dedup: cache the result per key so later calls skip the fetch entirely.
export function dedup(fetcher) {
  const cache = new Map();           // key -> promise (NOT the resolved value)
  return (key) => {
    if (cache.has(key)) return cache.get(key);
    const p = fetcher(key);
    cache.set(key, p);               // caching the PROMISE means a mid-flight burst
    p.catch(() => cache.delete(key)); // also dedupes. Drop rejections so retries work.
    return p;
  };
}
