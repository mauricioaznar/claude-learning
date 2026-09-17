// sandbox/06-request-loader.js
// Run:  node sandbox/06-request-loader.js
//
// REBUILD EXERCISE — you write `getRequestLoader` from scratch. `createBatchLoader`
// is your corrected 05 version, frozen here as infrastructure — don't change it.
// Everything below the line (the fake source, the four scenarios, the assertions)
// is scaffolding. Run the file; it prints PASS/FAIL per scenario. If you're stuck,
// ask for a hint (symptom + area first, code last) — don't read a solution.
//
// ── WHAT THIS PIECE IS FOR ───────────────────────────────────────────────────
// A loader CACHES, so it must die with the request. Nest resolvers are singletons;
// a loader stored on a resolver would serve stale rows to every later request
// forever. So loaders live on the per-request GraphQL context, one per type.field,
// under a `name`. getRequestLoader is the one place that builds them: lazily, on
// the context, memoized by name.
//
// ── THE CONTRACT ─────────────────────────────────────────────────────────────
// getRequestLoader(context, name, create) -> BatchLoader
//
//   context: a per-request object. In real Nest this is the GraphQL @Context();
//            here it's a plain {}. Loaders hang off it under `context.loaders`.
//   name:    unique key per type.field, e.g. 'Book.author'. Same name in the same
//            request => the SAME loader (shared cache). Different name => different
//            loader (isolated cache). Reusing a name on purpose is how audit users
//            collapse created_by + updated_by into one query (scenario D).
//   create:  () => createBatchLoader(batchFn). Runs AT MOST ONCE per (context,name).
//
//   Requirements:
//     1. LAZY CONTEXT — if context.loaders is missing, create it (a Map).
//     2. MEMOIZE BY NAME — first call for a name runs create() and stores the
//        loader; later calls for that name return the stored one WITHOUT calling
//        create() again.
//     3. ISOLATE BY NAME — different names get different loaders.
//     4. REQUEST LIFETIME — a fresh context starts empty; no loader or cached row
//        leaks in from a prior request.

// ── YOU WRITE THIS TOO (rebuild from memory) ─────────────────────────────────
// createBatchLoader(batchFn) -> { load(key) }. Same contract as 05:
//   1. BATCH  — every key loaded in one window goes to batchFn in ONE call.
//   2. DEDUP  — load(key) twice returns the SAME promise; key appears once.
//   3. TWO-HOP WINDOW — a load from a deferred/nested continuation still joins
//      the same batch (Promise.resolve().then(() => process.nextTick(flush))).
//   4. Missing key -> undefined; the gate must REOPEN after a flush (scenario C
//      loads across two windows).
function createBatchLoader(batchFn) {
  const cache = new Map();
  let queue = [];
  let scheduled = null;

  const schedule = () => {
    if (!scheduled) {
      scheduled = new Promise((resolve, reject) => {
        Promise.resolve().then(() => {
          process.nextTick(() => {
            scheduled = null;
            const keys = queue;
            queue = []
            batchFn(keys).then(resolve, reject)
          })
        })
      })
    }

    return scheduled;
  }

  return {
    load: (key) => {
      const cached = cache.get(key)
      if (cached) { return cached; }
      queue.push(key)
      const result = schedule().then(values => values.get(key))
      cache.set(key, result)
      return result
    }
  }
}

// ── YOU WRITE THIS ───────────────────────────────────────────────────────────
function getRequestLoader(context, name, create) {
  if (!context.loaders) {
    context.loaders = new Map();
  }
  const loaders = context.loaders;
  const existing = loaders.get(name)
  if (existing) { return existing; }
  const loader = create();
  loaders.set(name, loader);
  return loader;
}

// ── SCAFFOLD BELOW — do not change ───────────────────────────────────────────

// A fake data source. `batchFn` logs each batch and stamps every value with the
// current `version`, so a stale loader leaking across requests is VISIBLE (a
// request that reused an old loader would read the old version). `create` is what
// getRequestLoader is handed; it bumps `creates` each time it actually runs, so
// the assertions can prove memoization directly.
function makeSource() {
  const record = { batches: [], creates: 0 };
  let version = 1;
  const batchFn = async (keys) => {
    record.batches.push([...keys]);
    const map = new Map();
    for (const k of keys) map.set(k, `v${version}:${k}`);
    return map;
  };
  return {
    record,
    setVersion: (v) => { version = v; },
    create: () => { record.creates++; return createBatchLoader(batchFn); },
  };
}

// One "resolve-field call": look up (or build) the loader for this type.field on
// this request's context, then load one key through it.
const resolveVia = (ctx, name, source, key) =>
  getRequestLoader(ctx, name, source.create).load(key);

// tiny assert helpers (same as 05)
let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
};
const nextWindow = () => new Promise((r) => setTimeout(r, 20));

async function scenarioA() {
  console.log('\n== A. same name, same request -> ONE loader (memoize) ==');
  const ctx = {};
  const s = makeSource();
  const [a, b] = await Promise.all([
    resolveVia(ctx, 'Book.author', s, 'x'),
    resolveVia(ctx, 'Book.author', s, 'y'), // same field name, one request
  ]);
  ok('create ran once', s.record.creates === 1, `creates=${s.record.creates}`);
  ok('one shared batch', s.record.batches.length === 1, `batches=${s.record.batches.length}`);
  ok('keys batched together', String(s.record.batches[0]) === 'x,y', `[${s.record.batches[0]}]`);
  ok('values resolved', a === 'v1:x' && b === 'v1:y');
}

async function scenarioB() {
  console.log('\n== B. different names, same request -> TWO loaders (isolate) ==');
  const ctx = {};
  const s = makeSource();
  const [a, b] = await Promise.all([
    resolveVia(ctx, 'Book.author', s, 'x'),
    resolveVia(ctx, 'Review.book', s, 'x'), // different name, SAME key
  ]);
  ok('create ran twice', s.record.creates === 2, `creates=${s.record.creates}`);
  ok('two batches (not deduped across names)', s.record.batches.length === 2, `batches=${s.record.batches.length}`);
  ok('both resolved', a === 'v1:x' && b === 'v1:x');
}

async function scenarioC() {
  console.log('\n== C. new request -> FRESH loader, no stale leak (the lifetime test) ==');
  const s = makeSource();
  const ctx1 = {};
  const v1 = await resolveVia(ctx1, 'Book.author', s, 'x'); // request 1 sees version 1
  s.setVersion(2);                                          // data changes between requests
  await nextWindow();
  const ctx2 = {};                                          // request 2 = brand new context
  const v2 = await resolveVia(ctx2, 'Book.author', s, 'x'); // must re-fetch, see version 2
  ok('a loader per request', s.record.creates === 2, `creates=${s.record.creates}`);
  ok('a batch per request', s.record.batches.length === 2, `batches=${s.record.batches.length}`);
  ok('no stale value across requests', v1 === 'v1:x' && v2 === 'v2:x', `v1=${v1} v2=${v2}`);
}

async function scenarioD() {
  console.log('\n== D. one name shared on purpose -> collapse to ONE query (audit users) ==');
  const ctx = {};
  const s = makeSource();
  const [createdBy, updatedBy] = await Promise.all([
    resolveVia(ctx, 'audit.user', s, 'u1'), // created_by field
    resolveVia(ctx, 'audit.user', s, 'u2'), // updated_by field, SAME name deliberately
  ]);
  ok('one shared loader', s.record.creates === 1, `creates=${s.record.creates}`);
  ok('collapsed to one batch', s.record.batches.length === 1, `batches=${s.record.batches.length}`);
  ok('both users in it', String(s.record.batches[0]) === 'u1,u2', `[${s.record.batches[0]}]`);
  ok('values resolved', createdBy === 'v1:u1' && updatedBy === 'v1:u2');
}

(async () => {
  await scenarioA();
  await nextWindow();
  await scenarioB();
  await nextWindow();
  await scenarioC();
  await nextWindow();
  await scenarioD();
  console.log(`\n${failures === 0 ? 'ALL PASS ✅' : failures + ' FAILING ❌'}`);
  process.exit(failures === 0 ? 0 : 1);
})();
