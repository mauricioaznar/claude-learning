// Instrumented fake backend. Every exercise runs against this so you can *see*
// how many real calls your implementation actually made. If coalesce/dedup work,
// the burst of requests collapses to a small number here.

let calls = 0;

export const realCallCount = () => calls;
export const resetCalls = () => { calls = 0; };

// Resolves after `delay` ms. Increments the real-call counter on every invocation
// — so a coalescer that shares one in-flight promise bumps this once, not N times.
export function fakeFetch(key, delay = 300) {
  calls += 1;
  const at = calls;
  return new Promise((resolve) => {
    setTimeout(() => resolve(`${key}#${at}`), delay);
  });
}
