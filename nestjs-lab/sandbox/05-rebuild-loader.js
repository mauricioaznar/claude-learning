// sandbox/05-rebuild-loader.js
// Run:  node sandbox/05-rebuild-loader.js
//
// REBUILD EXERCISE — you write `createBatchLoader` from scratch. Everything else
// (the batchFn, the three scenarios, the assertions) is scaffolding. Run the
// file; it prints PASS/FAIL per scenario so you can check yourself. Don't read a
// solution — if you're stuck, ask for a hint (symptom + area first, code last).
//
// ── THE CONTRACT ────────────────────────────────────────────────────────────
// createBatchLoader(batchFn) -> { load(key) }
//
//   load(key): returns Promise<value> — the value batchFn produced for that key.
//   batchFn(keys): (keys: K[]) => Promise<Map<K, V>>   (given below, don't change)
//
//   Requirements your load() must satisfy:
//     1. BATCHING: every key loaded within one window goes to batchFn in ONE
//        call. (Scenario A)
//     2. CACHE / DEDUP: calling load(key) twice returns the SAME promise, and the
//        key appears once in the batch. (Scenario B)
//     3. THE WINDOW STAYS OPEN ACROSS THE WHOLE MICROTASK DRAIN: a load that
//        arrives from a deferred continuation
//        (Promise.resolve().then(() => load(...)), even nested) must still join
//        the same batch. This is the two-hop. (Scenario C — the discriminating one)
//     4. A missing key (batchFn's Map has no entry) resolves to undefined.

// ── YOU WRITE THIS ───────────────────────────────────────────────────────────
function createBatchLoader(batchFn) {
  let cache = {}
  let queue = []
  let scheduled = null; // promise which all row items will wait for settling.

  const schedule = () => {
    if (!scheduled) {
      scheduled = new Promise((resolve, reject) => {
        Promise.resolve().then(() => {
          process.nextTick(() => {
            const keys = queue;
            queue = []
            scheduled = null
            batchFn(keys).then(values => { resolve(values) }, error => reject(error))
          })
        })
      })
    }


    return scheduled
  }

  return {
    load: (key) => {
      if (cache[key]) {
        return cache[key]
      }
      queue.push(key)
      const result = schedule().then(values => values.get(key))
      cache[key] = result
      return cache[key]
    }
  }

}

// ── SCAFFOLD BELOW — do not change ───────────────────────────────────────────

// A fake data source. Returns a Map keyed by the requested keys; logs each batch
// so the harness can count them. `key.toUpperCase()` stands in for "the row".
function makeBatchFn(record) {
  return async (keys) => {
    record.batches.push([...keys]);
    const map = new Map();
    for (const k of keys) {
      if (k !== 'MISSING') map.set(k, `val:${k}`);
    }
    return map;
  };
}

function newLoader() {
  const record = { batches: [] };
  const loader = createBatchLoader(makeBatchFn(record));
  return { loader, record };
}

// tiny assert helpers
let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
};
const nextWindow = () => new Promise((r) => setTimeout(r, 20));

async function scenarioA() {
  console.log('\n== A. sync siblings -> ONE batch ==');
  const { loader, record } = newLoader();
  const [x, y, z] = await Promise.all([
    loader.load('x'),
    loader.load('y'),
    loader.load('z'),
  ]);
  ok('one batch', record.batches.length === 1, `batches=${record.batches.length}`);
  ok('all keys present', String(record.batches[0]) === 'x,y,z', `[${record.batches[0]}]`);
  ok('values resolved', x === 'val:x' && y === 'val:y' && z === 'val:z');
}

async function scenarioB() {
  console.log('\n== B. cache / dedup ==');
  const { loader, record } = newLoader();
  const p1 = loader.load('x');
  const p2 = loader.load('x'); // same key again
  const p3 = loader.load('y');
  ok('same key -> same promise', p1 === p2);
  await Promise.all([p1, p2, p3]);
  ok('one batch', record.batches.length === 1, `batches=${record.batches.length}`);
  ok('key x appears once', String(record.batches[0]) === 'x,y', `[${record.batches[0]}]`);
}

async function scenarioC() {
  console.log('\n== C. deferred loads (the two-hop test) -> still ONE batch ==');
  const { loader, record } = newLoader();
  const results = [];
  results.push(loader.load('a')); // sync
  // depth-1 deferred:
  results.push(Promise.resolve().then(() => loader.load('b')));
  // depth-2 deferred (nested continuation):
  results.push(
    Promise.resolve().then(() => Promise.resolve().then(() => loader.load('c'))),
  );
  await Promise.all(results);
  ok('one batch', record.batches.length === 1, `batches=${record.batches.length} (one-hop would split this)`);
  ok('all deferred keys joined', String(record.batches[0]) === 'a,b,c', `[${record.batches[0]}]`);
}

async function scenarioD() {
  console.log('\n== D. missing key -> undefined ==');
  const { loader } = newLoader();
  const v = await loader.load('MISSING');
  ok('missing resolves undefined', v === undefined, `got ${v}`);
}

async function scenarioE() {
  console.log('\n== E. same loader, two windows -> TWO batches (tests Hole 1) ==');
  const { loader, record } = newLoader();
  const a = await loader.load('x'); // window 1 flushes, gate must REOPEN
  await nextWindow();
  const b = await loader.load('y'); // window 2 — hangs/crashes if scheduled never nulled
  ok('two batches', record.batches.length === 2, `batches=${record.batches.length}`);
  ok('values across windows', a === 'val:x' && b === 'val:y');
}

(async () => {
  await scenarioA();
  await nextWindow();
  await scenarioB();
  await nextWindow();
  await scenarioC();
  await nextWindow();
  await scenarioD();
  await nextWindow();
  await scenarioE();
  console.log(`\n${failures === 0 ? 'ALL PASS ✅' : failures + ' FAILING ❌'}`);
  process.exit(failures === 0 ? 0 : 1);
})();
