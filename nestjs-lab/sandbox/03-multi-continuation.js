// sandbox/03-multi-continuation.js
// Run:  node sandbox/03-multi-continuation.js
//
// 02 used ONE nested continuation. Reality has many, and they arrive STAGGERED
// — one microtask-tick apart — because graphql resolves level-2 (`product`)
// inside each level-1 row's own promise continuation, and those continuations
// resolve at slightly different microtask depths. This is the case that shows
// what "wait for the WHOLE microtask queue, not just the ones ahead of me"
// actually buys you.
//
// Same stripped loader as 02 (queue + scheduled + flush; no cache/grouping).

function makeLoader(schedule, label) {
  let queue = [];
  let scheduled = null;
  let batchNo = 0;

  function flush() {
    const keys = queue;
    queue = [];
    scheduled = null; // batch closes; later keys start a NEW batch
    batchNo++;
    console.log(`   [${label}] BATCH #${batchNo} -> [${keys.join(', ')}]`);
  }

  return {
    load(key) {
      queue.push(key);
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    },
    batchCount: () => batchNo,
  };
}

const oneHop = (flush) => Promise.resolve().then(flush);
const twoHop = (flush) => Promise.resolve().then(() => process.nextTick(flush));

// Model the staggering. graphql chains roughly:
//     l1.load(row).then(row => l2.load(row.fk))
// so each level-2 load runs one `.then` deeper than the previous row's. A
// promise chain reproduces that: cb1 fires now, cb2 fires when cb1 completes,
// cb3 when cb2 completes... one microtask-tick apart, NOT all at once.
function spawnStaggered(loader, keys) {
  let p = Promise.resolve();
  for (const k of keys) {
    p = p.then(() => loader.load(k));
  }
}

const KEYS = [
  'product-of-r1',
  'product-of-r2',
  'product-of-r3',
  'product-of-r4',
  'product-of-r5',
];

const one = makeLoader(oneHop, 'one-hop');
console.log('\n== ONE HOP — flush IS a microtask; fires mid-cascade ==');
spawnStaggered(one, KEYS);

setTimeout(() => {
  console.log(`   -> ${one.batchCount()} batches for ${KEYS.length} continuations\n`);

  const two = makeLoader(twoHop, 'two-hop');
  console.log('== TWO HOP — flush on nextTick; waits for the whole cascade ==');
  spawnStaggered(two, KEYS);

  setTimeout(() => {
    console.log(`   -> ${two.batchCount()} batch for ${KEYS.length} continuations\n`);
  }, 50);
}, 50);

// Predict before running:
//   - ONE HOP: at the moment the first load registers the flush microtask, do
//     cb2..cb5 exist yet? (No — they're born one tick at a time.) So when the
//     flush runs, how many keys has it seen? How many batches result?
//   - TWO HOP: the flush is parked on nextTick, which the runtime reaches only
//     after the microtask queue is EMPTY. The cascade cb1..cb5 is all microtask
//     work. So how many keys are in `queue` by the time the flush finally runs?
//
// The lesson: two-hop doesn't wait "for the continuations queued ahead of it" —
// it waits for the microtask queue to reach EMPTY, which includes continuations
// that don't even exist yet when the flush is scheduled.
