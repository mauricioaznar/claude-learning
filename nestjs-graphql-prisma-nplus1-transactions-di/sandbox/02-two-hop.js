// sandbox/02-two-hop.js
// Run:  node sandbox/02-two-hop.js
//
// THE payoff. This is why createBatchLoader schedules its flush with TWO hops
// (Promise.resolve().then(() => process.nextTick(flush))) instead of one.
//
// We build a STRIPPED loader — no cache, no grouping, just the batching WINDOW:
// collect keys, defer a flush, and when the flush runs it CLOSES the batch
// (scheduled = null). Then we run the exact same workload under a one-hop
// scheduler and a two-hop scheduler and count how many batches each fires.
//
// (The cache / keyOf / groupByKey / toOne / toMany parts are deliberately left
// out — those are yours to build in Phase 2. This isolates just the timing.)

function makeLoader(schedule, label) {
  let queue = [];
  let scheduled = null;
  let batchNo = 0;

  function flush() {
    const keys = queue;
    queue = [];
    scheduled = null; // <-- the batch is now CLOSED. Keys arriving after this
                      //     line start a NEW batch.
    batchNo++;
    console.log(`   [${label}] BATCH #${batchNo} fired -> [${keys.join(', ')}]`);
  }

  return function load(key) {
    queue.push(key);
    if (!scheduled) {
      scheduled = true;
      schedule(flush); // defer the flush. HOW FAR we defer is the whole lesson.
    }
  };
}

// One hop: flush runs during the microtask drain.
const oneHop = (flush) => Promise.resolve().then(flush);

// Two hops: a microtask that, in turn, schedules the flush on nextTick — so the
// flush waits until the microtask queue has FULLY drained before it runs.
const twoHop = (flush) => Promise.resolve().then(() => process.nextTick(flush));

function workload(load, header) {
  console.log(`\n== ${header} ==`);

  // LEVEL 1 — sibling resolvers. graphql-js fires these in one synchronous
  // burst, the way books() runs once per author with no await between them.
  load('L1-a');
  load('L1-b');
  load('L1-c');

  // LEVEL 2 — a field one level deeper. It does NOT run synchronously; it runs
  // inside a promise continuation (a microtask), after its parent settled.
  // The question: does its key join the SAME batch as level 1, or a new one?
  Promise.resolve().then(() => {
    load('L2-nested');
  });
}

// Run the two schedulers well apart on the event loop so their output can't mix.
workload(makeLoader(oneHop, 'one-hop'), 'ONE HOP  — Promise.resolve().then(flush)');

setTimeout(() => {
  workload(makeLoader(twoHop, 'two-hop'), 'TWO HOP  — .then(() => process.nextTick(flush))');
}, 50);

// Predict BEFORE running:
//   - How many batches does ONE HOP fire, and which keys are in each?
//   - How many does TWO HOP fire?
//   - The ONLY difference is when `scheduled` gets cleared. Trace it: when the
//     nested load('L2-nested') runs, is `scheduled` still set (join the batch)
//     or already null (start a new one)? That single fact explains both counts.
