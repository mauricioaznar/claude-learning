import React, { useState } from 'react';
import * as reference from './reference.js';
import * as yours from './to-implement.js';
import { fakeFetch, realCallCount, resetCalls } from './fake-api.js';

const IMPLS = { reference, yours };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Drivers ────────────────────────────────────────────────────────────────
// Each fires a realistic burst against the chosen implementation (`impl`), then
// logs the numbers that tell you whether the redundant work actually collapsed.

async function runDebounce(log, impl) {
  let runs = 0;
  const d = impl.debounce((tag) => { runs += 1; log(`  fn fired with "${tag}"`); }, 200);
  log('calling debounced fn 5x, 50ms apart (quiet window = 200ms)…');
  for (let i = 1; i <= 5; i += 1) { d(`call ${i}`); await sleep(50); }
  await sleep(300);
  log(`→ fn ran ${runs}x  (want 1, carrying the LAST call's args)`);
}

async function runBatch(log, impl) {
  const batches = [];
  const b = impl.createBatcher((items) => batches.push(items));
  log('scheduling items 1..5 synchronously (same tick)…');
  for (let i = 1; i <= 5; i += 1) b.schedule(i);
  await sleep(0);
  log(`→ flushes: ${batches.length} (want 1)`);
  log(`→ items in the flush: [${(batches[0] || []).join(', ')}] (want 1..5)`);
}

async function runCoalesce(log, impl) {
  resetCalls();
  const load = impl.coalesce((k) => fakeFetch(k));
  log('firing load("A") x3 at once (all in flight together)…');
  const vals = await Promise.all([load('A'), load('A'), load('A')]);
  log(`→ values: [${vals.join(', ')}]  (want all identical)`);
  log(`→ real fetches: ${realCallCount()} (want 1)`);
  log('now load("A") again, after it settled…');
  await load('A');
  log(`→ real fetches: ${realCallCount()} (want 2 — entry clears on settle)`);
}

async function runDedup(log, impl) {
  resetCalls();
  const load = impl.dedup((k) => fakeFetch(k));
  log('load("A"), await, then load("A") again…');
  await load('A');
  await load('A');
  log(`→ real fetches for A: ${realCallCount()} (want 1 — served from cache)`);
  log('subtle case: fire load("B") x3 concurrently, mid-flight…');
  const before = realCallCount();
  await Promise.all([load('B'), load('B'), load('B')]);
  log(`→ real fetches for B: ${realCallCount() - before}`);
  log('  (1 = you cached the PROMISE; 3 = you cached only the settled value)');
}

const EXERCISES = [
  { id: 1, title: 'debounce', blurb: 'Wait until the calls stop, then run once. (time-based)', run: runDebounce },
  { id: 2, title: 'batch', blurb: 'Collect a tick of calls, flush once with all of them. (microtask)', run: runBatch },
  { id: 3, title: 'coalesce', blurb: 'Share the one call already in flight. (dedupe in-flight)', run: runCoalesce },
  { id: 4, title: 'dedup', blurb: 'Reuse the answer you already got. (cache settled)', run: runDedup },
];

// ── UI ───────────────────────────────────────────────────────────────────────

function Panel({ ex }) {
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [src, setSrc] = useState('reference');
  const onRun = async () => {
    const out = [];
    const log = (line) => { out.push(line); setLines([...out]); };
    setLines([]);
    setBusy(true);
    try {
      await ex.run(log, IMPLS[src]);
    } catch (e) {
      log(`✖ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section style={S.panel}>
      <div style={S.head}>
        <h2 style={S.h2}>{ex.id}. {ex.title}</h2>
        <button style={S.btn} onClick={onRun} disabled={busy}>
          {busy ? 'running…' : 'Run'}
        </button>
      </div>
      <p style={S.blurb}>{ex.blurb}</p>
      <div style={S.toggle}>
        {['reference', 'yours'].map((s) => (
          <button
            key={s}
            onClick={() => setSrc(s)}
            style={{ ...S.tab, ...(src === s ? S.tabOn : null) }}
          >
            {s === 'reference' ? 'Reference' : 'Yours'}
          </button>
        ))}
      </div>
      <pre style={S.log}>{lines.length ? lines.join('\n') : '—'}</pre>
    </section>
  );
}

export default function AsyncLab() {
  return (
    <div style={S.page}>
      <h1 style={S.h1}>Async Lab</h1>
      <p style={S.intro}>
        Four ways to stop doing redundant work. Edit <code>to-implement.js</code>,
        then Run each panel and read the counts.
      </p>
      <div style={S.grid}>
        {EXERCISES.map((ex) => <Panel key={ex.id} ex={ex} />)}
      </div>
    </div>
  );
}

const S = {
  page: { font: '15px/1.5 system-ui, sans-serif', color: '#1a1a1a', maxWidth: 900, margin: '0 auto', padding: 24 },
  h1: { fontSize: 24, margin: '0 0 4px' },
  intro: { color: '#555', margin: '0 0 20px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  panel: { border: '1px solid #ddd', borderRadius: 10, padding: 16, background: '#fafafa' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  h2: { fontSize: 17, margin: 0 },
  blurb: { color: '#666', fontSize: 13, margin: '6px 0 10px' },
  btn: { font: 'inherit', padding: '4px 14px', borderRadius: 6, border: '1px solid #888', background: '#fff', cursor: 'pointer' },
  toggle: { display: 'flex', gap: 4, margin: '0 0 10px' },
  tab: { font: 'inherit', fontSize: 12, padding: '2px 10px', borderRadius: 5, border: '1px solid #ccc', background: '#fff', color: '#666', cursor: 'pointer' },
  tabOn: { borderColor: '#1a1a1a', background: '#1a1a1a', color: '#fff' },
  log: { background: '#111', color: '#c9ffd4', padding: 12, borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap', minHeight: 90, margin: 0 },
};
