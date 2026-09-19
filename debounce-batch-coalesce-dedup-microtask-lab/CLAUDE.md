# debounce-batch-coalesce-dedup-microtask-lab

Promises/async internals from scratch. Four small primitives, each a different
answer to the same question — *"how do I stop doing redundant work?"* — built on
one shared substrate: the microtask queue (`queueMicrotask`) and timers
(`setTimeout`). It's the same substrate the
`nestjs-graphql-prisma-nplus1-transactions-di` batch loader stands on;
this lab isolates the pieces so they read as obvious there.

**Walkthrough-then-replicate.** Each primitive ships as a worked example in
`reference.js`. We read it together; then Mau rebuilds it from memory in
`to-implement.js`. Every panel has a **Reference / Yours** toggle — run Reference
to see the target counts, switch to Yours, make them match.

Run it: `npm --prefix debounce-batch-coalesce-dedup-microtask-lab install` once, then
`npm --prefix debounce-batch-coalesce-dedup-microtask-lab run dev` → http://localhost:5181

## Files

- `reference.js` — the four **worked examples** (don't edit). What we walk through;
  comments explain the *why* at each decision point.
- `to-implement.js` — **the only file you edit.** Four stubs to rebuild after the
  walkthrough. They throw until implemented.
- `async-lab.jsx` — the harness: four panels, each a Run button, a Reference/Yours
  toggle, and a live log. Drivers fire realistic bursts and print observed counts.
- `fake-api.js` — instrumented fake backend (`fakeFetch`, `realCallCount`). Lets
  you *see* how many real calls survived your coalesce/dedup.
- `main.jsx` / `index.html` / `vite.config.js` — Vite plumbing. No StrictMode (it
  would double every driver run).

## Exercises

Each maps to one Run panel in the UI.

1. **[ ] debounce(fn, wait)** — trailing-edge timer. Repeated calls reset the
   window; `fn` runs once, `wait` ms after the calls go quiet, with the last
   call's args. *Time-based:* wait until the calls stop.
2. **[ ] createBatcher(flush)** — collect every `schedule(item)` in one tick and
   call `flush(items)` exactly once on the next microtask. *Why a microtask, not
   a timer?* It flushes before the browser paints / the next task runs.
3. **[ ] coalesce(fetcher)** — while a call for a key is in flight, every
   `load(key)` returns the same promise (one real fetch for the burst). Clears on
   settle — including on reject. *Dedupe work in flight.*
4. **[ ] dedup(fetcher)** — remember the resolved value per key; later calls skip
   `fetcher`. The counterpart to coalesce (in-flight vs. already-done). The
   subtle fork the driver exposes: cache the **promise** (concurrent callers also
   dedupe) vs. cache only the **settled value** (a mid-flight burst still
   double-fetches).

## Failures

*(symptom → cause → fix; record as they happen)*

## Learnings

*(concepts that stuck, in plain words; fill in as each exercise lands)*
