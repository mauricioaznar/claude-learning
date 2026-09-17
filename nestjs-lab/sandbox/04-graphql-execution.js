// sandbox/04-graphql-execution.js
// Run:  node sandbox/04-graphql-execution.js two     # real prod scheduler
//       node sandbox/04-graphql-execution.js one     # the broken one-hop
//
// 03 FAKED the staggering with a hand-built promise chain (p = p.then(...)).
// This file removes the fake: a tiny graphql-js-shaped executor drives the REAL
// two-hop createBatchLoader, so you WATCH how loads actually get registered.
//
// Query modelled:   { authors { books { reviews } } }
//
// The two patterns to spot in the log:
//   LEVEL 1 (books, one per author)  -> fired in a SYNCHRONOUS loop = a burst.
//     Every author's book-load is in `queue` before any microtask runs.
//   LEVEL 2 (reviews, one per book)  -> fired INSIDE each author's books
//     continuation (a .then), so the keys arrive across several microtasks,
//     STAGGERED, exactly the case the second hop exists for.
//
// A monotonic step number prefixes every line so you can read the interleaving.

const HOP = process.argv[2] === 'one' ? 'one' : 'two';

let step = 0;
const log = (m) => console.log(String(++step).padStart(2, '0'), m);

// ── the two schedulers (identical to 02/03; `schedule()` below picks one) ─────
const oneHop = (flush) => {
  Promise.resolve().then(flush); // flush IS a microtask -> fires mid-drain
};
const twoHop = (flush) => {
  Promise.resolve().then(() => {
    log('      · hop1 ran -> process.nextTick(flush)');
    process.nextTick(flush); // parked until the microtask queue is EMPTY
  });
};
const scheduler = HOP === 'one' ? oneHop : twoHop;

// ── faithful createBatchLoader: cache (stores the DERIVED promise) + queue +
//    a promise-valued `scheduled` gate, exactly like prod. Only logs are added.
function createBatchLoader(batchFn, label) {
  const cache = new Map();
  let queue = [];
  let scheduled = null;
  let batches = 0;

  function schedule() {
    if (!scheduled) {
      scheduled = new Promise((resolve, reject) => {
        scheduler(() => {
          const keys = queue;
          queue = [];
          scheduled = null; // gate reopens; later keys start a NEW batch
          batches++;
          log(`>>> FLUSH ${label} BATCH #${batches} -> [${keys.join(', ')}]`);
          batchFn(keys).then(resolve, reject);
        });
      });
    }
    return scheduled;
  }

  return {
    load(key) {
      const cached = cache.get(key);
      if (cached) {
        log(`    load(${label}, ${key}) CACHE HIT`);
        return cached;
      }
      queue.push(key);
      const gate = scheduled ? 'gate=open' : 'gate=null->schedule';
      log(`    load(${label}, ${key}) queue=[${queue.join(', ')}] ${gate}`);
      const result = schedule().then((values) => values.get(key));
      cache.set(key, result); // CACHE FILL: the derived per-key promise
      return result;
    },
    batchCount: () => batches,
  };
}

// ── data ──────────────────────────────────────────────────────────────────
const AUTHORS = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];
const BOOKS = [
  { id: 'b1', authorId: 'a1' }, { id: 'b2', authorId: 'a1' },
  { id: 'b3', authorId: 'a2' }, { id: 'b4', authorId: 'a2' },
  { id: 'b5', authorId: 'a3' }, { id: 'b6', authorId: 'a3' },
];
const REVIEWS = BOOKS.map((b, i) => ({ id: `rev-${b.id}`, bookId: b.id }));

// batch fns model a DB round-trip (async -> resolves on a microtask). Real DB
// latency is a macrotask, but the batch is already CLOSED at flush time, so it
// doesn't change which keys share a batch — only when the rows come back.
const booksLoader = createBatchLoader(async (authorIds) => {
  const map = new Map();
  authorIds.forEach((id) => map.set(id, BOOKS.filter((b) => b.authorId === id)));
  return map;
}, 'books');

const reviewsLoader = createBatchLoader(async (bookIds) => {
  const map = new Map();
  bookIds.forEach((id) => map.set(id, REVIEWS.filter((r) => r.bookId === id)));
  return map;
}, 'reviews');

// ── a graphql-js-shaped executor for { authors { books { reviews } } } ───────
// The shape that matters: completeList loops parents SYNCHRONOUSLY and fires the
// child resolver for each; a child that returns a promise is completed in a
// .then continuation, and the grandchild resolvers fire from INSIDE that
// continuation. That is the whole sibling-burst-vs-depth-stagger mechanism.
function execute() {
  log('== resolve authors (root, sync) ==');
  const authors = AUTHORS;

  log('== completeList(authors): SYNC loop -> fire `books` resolver per author ==');
  const authorNodes = authors.map((author) => {
    log(`  resolveField books for ${author.id}`);
    const booksPromise = booksLoader.load(author.id); // LEVEL-1 load (burst)

    return booksPromise.then((books) => {
      log(`  [cont] ${author.id}.books resolved [${books.map((b) => b.id).join(',')}] -> fire \`reviews\` per book`);
      const bookNodes = books.map((book) => {
        log(`    resolveField reviews for ${book.id}`);
        const reviewsPromise = reviewsLoader.load(book.id); // LEVEL-2 load (stagger)
        return reviewsPromise.then((reviews) => ({
          id: book.id,
          reviews: reviews.map((r) => r.id),
        }));
      });
      return Promise.all(bookNodes).then((bs) => ({ id: author.id, books: bs }));
    });
  });

  return Promise.all(authorNodes);
}

console.log(`\n=== HOP = ${HOP} ===`);
const done = execute();
log('== execute() RETURNED (sync phase over); microtask drain begins ==');
done.then((result) => {
  log(`== DONE. books batches=${booksLoader.batchCount()}  reviews batches=${reviewsLoader.batchCount()} ==`);
  console.log(JSON.stringify(result, null, 2));
});

// Predict BEFORE running, for EACH of `two` and `one`:
//   1. How many times does `resolveField books` print in a row, with no other
//      line between them? What does that tell you about level-1 load timing?
//   2. How many `books` batches? How many `reviews` batches?
//   3. For which LEVEL does one-hop differ from two-hop — and why does the other
//      level survive one-hop unharmed?
//   4. Where does the `>>> FLUSH reviews` line land relative to the three
//      `[cont] aN.books resolved` lines? (This is the empty-vs-ahead question.)
