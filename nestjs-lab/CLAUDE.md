# NestJS Lab — N+1, transactions, DI

A tiny NestJS + `@nestjs/graphql` (code-first) + Prisma + **SQLite** app built to
reproduce, in miniature, three problems Mau keeps hitting in his real project
(NestJS + GraphQL + Prisma + MySQL, "inopack") so he can master the fixes here
first. Nothing here touches inopack.

Domain: **Author 1—N Book 1—N Review**. Seeded with 20 authors, ~59 books, ~176
reviews.

The lab is built **wrong on purpose** first (Phase 1), then fixed one problem at
a time. **Mau writes the fixes**; the wrong-way scaffold and all NestJS/Prisma
wiring are scaffolded.

## Running it

```
npm install        # also runs `prisma generate`
npm run db:push    # create prisma/lab.db from the schema
npm run seed       # 20 authors / ~59 books / ~176 reviews
npm run start:dev  # http://localhost:3000/graphql
npm run reset      # wipe + re-push + re-seed (predictable counts)
```

`PrismaService` runs with `log: ['query']`, so every SQL statement prints to the
console prefixed `prisma:query`. That console is the instrument for this whole
lab — you COUNT those lines.

The canonical N+1 probe query (Phase 2):

```graphql
{ authors { displayName books { title reviews { rating } } } }
```

## Structure

```
prisma/
  schema.prisma      Author / Book / Review, SQLite datasource (literal url)
  seed.ts            deterministic-ish seed
src/
  main.ts            bootstrap, listen on 3000
  app.module.ts      GraphQLModule.forRoot (code-first, autoSchemaFile)
  prisma/
    prisma.service.ts  PrismaClient subclass, query logging on
  shared/
    author-name.service.ts  the "shared" service (logs an instanceId to prove copies)
  author/  book/  review/    one module + model + resolver per entity
```

## Exercises

### Phase 0 — event-loop sandbox (prereq for Phase 2) 🔧
Two standalone `node` scripts in `sandbox/`, no Nest/Prisma, built to make the
batch loader's scheduler readable instead of magic. **Predict the output, then
run** — the answers below are for confirming, not reading first.

```
node nestjs-lab/sandbox/01-queues.js
node nestjs-lab/sandbox/02-two-hop.js
node nestjs-lab/sandbox/03-multi-continuation.js
```

- `01-queues.js` — ordering of sync / `process.nextTick` / promise microtask /
  `setTimeout`. Prints **A, F, E, C, D, B**: both sync lines first (A, F); then
  the microtask checkpoint, where Node drains `nextTick` (E) *before* the promise
  microtasks (C then D, FIFO by registration); the `setTimeout(0)` macrotask (B)
  last. The point: a microtask or nextTick scheduled *now* runs before the event
  loop's next macrotask, i.e. before the process does anything else — which is
  why the batcher defers with a microtask, never a timer.
- `02-two-hop.js` — why `createBatchLoader` uses **two** hops
  (`Promise.resolve().then(() => process.nextTick(flush))`), not one. Same
  workload under each scheduler: **one-hop fires 2 batches** (`[L1-a, L1-b,
  L1-c]` then `[L2-nested]`) — it closes the batch mid microtask-drain, so the
  nested level-2 key arrives after `scheduled` is already `null` and starts a new
  batch. **Two-hop fires 1 batch** (`[L1-a, L1-b, L1-c, L2-nested]`) — the flush
  is deferred to `nextTick`, which runs only after the microtask queue fully
  drains, so the nested key arrives while `scheduled` is still set and joins. The
  whole difference is *when `scheduled` gets cleared* relative to the nested
  `load()`.
- `03-multi-continuation.js` — the faithful case: 5 level-2 loads arriving
  **staggered** (one microtask-tick apart, via a promise chain, the way graphql
  resolves `product` inside each row's continuation). **One-hop fires 5 batches**
  (splits on every continuation — the flush microtask runs before cb2..cb5 even
  exist); **two-hop fires 1 batch** (the nextTick flush waits until the microtask
  queue is *empty*, capturing continuations not yet born when it was scheduled).
  The takeaway 02 can't show: two-hop waits for the queue to reach empty, not
  merely for the tasks ahead of it.

**The draining is the runtime's, not the loader's.** `createBatchLoader` has no
drain loop — the two-hop (`Promise.resolve().then(() => process.nextTick(flush))`)
only *positions* the flush. The load-bearing runtime rule: a `nextTick` scheduled
from inside a microtask runs only after the whole microtask queue has drained. So
the flush reads a `queue` that already holds every sibling key, then clears
`scheduled`. Level-2 "resolving in a microtask" is graphql-js calling the deeper
resolver off the `.then` in `load` (`schedule().then(v => v.get(key))`), not a
line in the loader.

**Absorbed:** graphql-js fires sibling resolvers in one synchronous burst, and a
field one level deeper resolves in a promise continuation (a microtask). The
two-hop flush waits past the entire microtask drain, so both levels land in one
batch — the batching window is "one microtask-drain window", not literally one
tick.

### Phase 1 — build it the WRONG way ✅ (scaffolded)

Reproduces all three problems at once so later phases have something to fix:

- one module per entity, each `exports: [XxxResolver]` (exporting the entry point,
  consumed by nobody);
- `AuthorNameService` re-declared in the `providers` of **two** modules
  (`PrismaService` in all three) — several instances of a "shared" service;
- every relation (`Author.books`, `Book.author`, `Book.reviews`, `Book.authorName`,
  `Review.book`) resolved with a direct per-parent Prisma query → **N+1**;
- `createBookWithReviews` writes the book then loops writing reviews with **no
  transaction**.

_What it teaches:_ what each anti-pattern looks like in real code, and that the
symptoms are only visible in the query log / DB — not in the GraphQL response.

### Phase 2 — N+1 → DataLoader ⬜ (Mau writes the fix)

Run the probe query, count the `prisma:query` lines, explain N+1 from what you
see. Predict the fixed count BEFORE writing the fix. Then a request-scoped
DataLoader-style batcher; then abstract it into generic `toOne` / `toMany`
helpers so each resolve field is one line. Re-run, watch the count drop.

**Prod reference — review-to-understand** (INOPACK; shipped to prod; spare-time
deep-read, not a code task): the real N+1 → batch-loader logic — `toOne`/`toMany`
over `common/helpers/graphql/batch-loader.ts`, the per-request loader on the
GraphQL context, the `audit.user` name-collapse (`created_by` + `updated_by` → 1
query), and how/whether the same idea applies to the summary queries. See
`docs/features/archived/feature-nestjs-resolvefield-loaders.md`.

_Sandbox rebuild progress (ahead of wiring into Nest resolvers):_
- `sandbox/05-rebuild-loader.js` ✅ — `createBatchLoader` from scratch (two-hop
  scheduler, promise-cache dedup, gate reopen). Prod-faithful.
- `sandbox/06-request-loader.js` ✅ — `getRequestLoader` + a from-memory rebuild
  of `createBatchLoader`. Scenarios prove memoize-by-name, isolate-by-name,
  per-request lifetime (the stale-leak test), and the deliberate audit-user
  name-share. Prod parity for both.
- Still open in Phase 2: the `toOne`/`toMany`/`groupByKey` wrappers, then wiring
  the loader onto a real Nest GraphQL context + resolvers and counting the drop.

### Phase 3 — transactions ⬜ (Mau writes the fix)

Make `createBookWithReviews` throw on the 3rd review; see the orphaned book. Wrap
in `prisma.$transaction`; prove the rollback. Add a second service whose writes
join the SAME transaction by threading `Prisma.TransactionClient`; see the bug if
you forget to pass `tx`.

**Prod reference — review-to-understand** (INOPACK; shipped to prod; spare-time
deep-read): the real transaction logic — Phase 2a single-service `$transaction`
header+lines wraps (`upsertOrderSale`/`Quotation`/`Production`/`Transfer`, reads
kept outside the tx), and Phase 4 cross-service `tx`-threading
(`client: Prisma.TransactionClient = this.prisma`). See
`docs/plans/archived/nestjs-maintainability-refactor.md` (Phases 2a & 4).

### Phase 4 — DI conventions ✅ (Mau wrote the fix)

Export the SERVICE not the resolver; delete dead exports; move the shared service
into one `SharedModule` that exports it. Explain what `exports` means and why
re-declaring a provider makes a new instance. Then introduce a circular
dependency and fix it three ways (extract a third service / `forwardRef` /
which is better).

Done: `PrismaModule` (`@Global`, provided+exported once, imported once in
`AppModule`) and `SharedModule` (owns `AuthorNameService`) replace the
re-declared providers; feature modules `imports` those instead of listing the
services in their own `providers`; dead resolver exports removed. Proof: the
`AuthorNameService constructed (instanceId=...)` line prints ONCE at boot (was
twice). Circular dep: `AuthorService` ⇄ `BookService` built as a real module +
provider cycle, then fixed with `forwardRef` (both the module `imports` and
`@Inject(forwardRef(...))` on the ctor params), then re-fixed by extracting the
shared piece into `BookCountService` (a leaf in `SharedModule`) so both arrows
point one way and no `forwardRef` remains. Verdict recorded in Learnings.
(`AuthorService`/`BookService`/`BookCountService` are left as exercise stubs,
wired to no resolver.)

**Prod reference — review-to-understand** (INOPACK; tech debt; shipped to prod;
spare-time deep-read, not a code task): DI conventions in the Nest backend — how
providers/modules are wired, giving shared services a single home, and the DI
cleanup done in Phase 1. See `docs/features/archived/feature-nestjs-di-conventions.md`
+ `docs/plans/archived/nestjs-maintainability-refactor.md` (Phase 1).

## Failures

_(symptom → cause → fix; recorded as they happen)_

- **forwardRef didn't defer; boot still threw the circular-dependency error.**
  Symptom: with `forwardRef` on the module imports AND on the constructor, Nest
  still couldn't resolve the cycle. Cause: `@Inject(forwardRef(() => X))` was
  stacked on the **class** (`@Injectable()` \n `@Inject(...)` \n `class`), not on
  the constructor **parameter**. `@Inject` is a parameter decorator — on the
  class it attaches to no injection point, so the injector never deferred. Fix:
  move it onto the param: `constructor(@Inject(forwardRef(() => X)) private readonly x: X) {}`.
- **Extracted a third service, boot still failed to resolve it.** Symptom:
  `Nest can't resolve dependencies of AuthorService (?)` after moving the shared
  logic into `BookCountService`. Cause: added it to `SharedModule` `providers`
  but not `exports` — importers can't see a provider that isn't exported. Fix:
  add it to `exports`. (Same rule that Phase 4's core wiring turns on.)
- **Rebuilt loader (`05`): nulled `schedule` instead of `scheduled`.** Symptom:
  a loader that already flushed once threw `TypeError: schedule is not a function`
  (and never re-batched) on a second window. Cause: the flush reset `schedule`
  (the function `load()` calls) instead of `scheduled` (the promise the gate
  `if (!scheduled)` checks) — two bindings one letter apart. Fix: null `scheduled`
  (the thing the gate reads); `schedule` goes back to `const`. Classic: survives
  every passing test, bites in prod.
- **Green test suite that never tested the fix.** Symptom: all four rebuild
  scenarios printed PASS with the reset bug still in the code. Cause: each scenario
  used a fresh loader and a single flush window, so none exercised the gate
  *reopening* — the exact thing the reset governs. Fix: added scenario E (one
  loader, two windows). Lesson: a passing suite only proves what it exercises;
  "all pass" is not "correct".

## Learnings

_(plain-words concepts that stuck; written for a cold reader)_

- **`imports` = modules, `providers` = things this module constructs, `exports` =
  what it shares.** A class listed in a module's `providers` is *constructed by
  that module's injector* — listing it means building it there. Re-declaring the
  same class in two modules' `providers` mints two instances. To share one
  instance, provide+export it in one home module and `import` that module
  elsewhere; Nest dedupes, so it's built once. (Proven by the `instanceId` log
  going from 2 → 1.) A service is never put in `imports`; you import the *module*
  that exports it.
- **`@Global()` registers into a global scope, but the module still has to be
  imported once** (in `AppModule`) for its providers to exist. Global only
  changes *who can inject without importing*, not *whether it's registered*. Use
  it for genuinely cross-cutting infra (Prisma); the cost is a consumer injects
  it with no visible `imports` line saying where it came from.
- **Nest builds a dependency graph, not a top-to-bottom sequence.** Declaration
  order in `imports`/`providers` is irrelevant — every provider is constructed
  before whatever injects it. The one thing that can't be ordered is a *cycle*.
- **`forwardRef` has two layers.** (1) File-load race: circular file imports mean
  the other class can be `undefined` when a decorator runs; `forwardRef(() => X)`
  passes a thunk Nest calls later, after all files load. (2) Instance cycle: Nest
  builds one side with the reference temporarily empty, then back-patches it. The
  landmine: a `forwardRef`'d dependency is safe in **methods** (runtime) but NOT
  in the **constructor body** — it may not be built yet.
- **Two species of cycle → which fix applies.** If both sides reach in for the
  *same shared piece*, extract that piece into a neutral leaf service — the cycle
  *disappears*, the graph stays honest, no constructor landmine. If they need
  each other's *distinct behavior* (true mutual recursion, no shared piece to
  pull out), extraction has nothing to grab; then `forwardRef` (or dependency
  inversion via an interface/token, or events) is legitimate, not a smell. Test:
  does one extracted service absorb what both were calling each other for?
- **Dependency direction is the real cycle-preventer.** Leaf/shared modules
  should be *consumed, never consume upward*. A module with no outgoing edge to a
  feature module can't close a loop. Watch `SharedModule` for grab-bag rot — the
  moment it holds two unrelated concerns, split it (that's why Prisma got its own
  module).

### Event-loop ordering (Phase 0, for the DataLoader two-hop)

- **The ordering is spec, not logic — memorize it.** You cannot derive that
  `nextTick` beats promises from first principles. The rule: after each chunk of
  sync code, the runtime drains the **nextTick queue** fully, then the
  **microtask queue** fully, looping until *both* are empty, then takes **one**
  macrotask (`setTimeout`), and repeats. Shape: sync → all ticks → all micros →
  one timer → loop.
- **`.then` / `await` / `queueMicrotask` are the SAME queue** (the microtask
  queue), draining FIFO by registration. `process.nextTick` is a *separate*,
  higher-priority queue. So it's three levels, not four.
- **Rule (b) — the engine of the two-hop:** a `nextTick` scheduled from *inside*
  a microtask does **not** preempt; it waits until the microtask queue drains to
  **empty**, then fires on the checkpoint's next lap. Verified with a 6-liner:
  `.then(() => { log('m1'); nextTick(() => log('tick')) }); .then(() => log('m2'))`
  prints `m1, m2, tick` — not `m1, tick, m2`.
- **Chain vs fan-out.** `p = p.then(cb)` (reassigning `p`) builds a *chain*:
  `cbN` is registered on `cb(N-1)`'s result-promise, so only ONE continuation is
  queued at a time and they arrive **staggered**, one tick apart. `keys.forEach(k
  => p.then(...))` (not reassigning) *fans out* — all queued at once. `03`
  staggers precisely because of the reassignment; that models how graphql resolves
  level-2 (`product`) inside each level-1 row's continuation.
- **Why two hops.** `Promise.resolve().then(() => process.nextTick(flush))`.
  Hop 1 (`.then`) puts you inside a microtask; hop 2 (`nextTick`, by rule (b))
  defers `flush` until the microtask queue is empty — so staggered/nested
  `load()` keys that don't even exist yet when flush is scheduled still land in
  the batch. One-hop (`.then(flush)`) makes flush a plain microtask that fires
  mid-cascade → splits into N batches. **Same ordering, opposite outcome:** the
  second hop turns "flush scheduled early" from a bug into a no-op, because a
  nextTick only *parks* the flush; it can't run until the micros are gone.
- **Ordering inside a settling continuation (RESOLVED — was the `[H, then2]`
  thread).** When a `.then` callback runs, two different agents enqueue, in this
  order: (a) the **callback body** enqueues `H` (e.g. `schedule()` doing
  `Promise.resolve().then(hop)`) *while it executes*; (b) **the runtime, at the
  moment the callback returns**, settles the callback's result-promise, and that
  settlement enqueues the next chain link `then2`. Body first, settlement second
  → queue is `[H, then2]`. Confirmed by step-through: in `04`, `loadA`'s body
  enqueues `hop1`, then `loadA` returning settles `p1` which enqueues `loadB` →
  `[hop1, loadB]`.

### The loader "song" + when two-hop actually matters (Phase 0, sandbox 04)

- **Every loader level is the SAME 5-beat song; memorize it, don't re-trace.**
  (1) `load(key)` pushes to `queue`, first call only enqueues `hop`. (2) `hop` →
  `process.nextTick(flush)`. (3) `flush` (after MQ empties) → `batchFn` → enqueues
  `j`. (4) `j` → `resolve(map)` settles the batch promise → enqueues the **picks**
  (`schedule().then(v => v.get(key))`, one per key). (5) picks resolve each per-key
  promise `R` → enqueue the **conts** (the resolver's `booksPromise.then(...)`).
- **The only link between levels: beat 5 contains the next level's beat 1.** A
  level-1 `cont` (e.g. `cont_a1`) is where the level-2 `load()`s fire. The `cont`s
  are enqueued by the level-1 picks; inside each cont the next loader's `load`
  runs. Nothing else connects the loops — each is self-similar.
- **A promise is NEVER "enqueued"; only callbacks are.** Creating or settling a
  promise doesn't put *it* in a queue — settling puts its registered `.then`
  callbacks in the queue. The only things ever in the microtask queue are
  callbacks (`hop`, `j`, `pick`, `cont`), never the promises (`scheduled`, the
  `batchFn` result, `R`). "Registered on a pending promise" ≠ "enqueued"; it
  enqueues only when that promise settles.
- **Correction to the earlier "one-hop splits into N batches" claim — needs a
  run of `04` to confirm.** Reasoning through `04` (real two-hop loader driven by
  a graphql-shaped executor, `{ authors { books { reviews } } }`): graphql's
  per-level resolution is **sibling-parallel** — all same-level continuations
  (`cont_a1/a2/a3`) are enqueued *together* (they share one parent batch), so they
  sit in the queue *ahead of* the flush that the first one schedules. Result: every
  same-level `load` joins one batch **under one-hop AND two-hop alike**. Predicted:
  `books=1, reviews=1` for both `node sandbox/04-graphql-execution.js one` and
  `... two`. If so, plain resolveField-per-level does NOT need the second hop.
- **So when DOES one-hop split?** Only when a `load` runs in a continuation
  **enqueued *after* the flush** — i.e. genuinely *chained* loads (a deeper load
  born from an earlier load's continuation), which is what `02` (nested) and `03`
  (`p = p.then`) model. That's a user-code-chaining shape, not the sibling-parallel
  per-level shape. The two-hop is DataLoader's **defensive default** that also
  covers the chained case; `03`'s "this is how graphql resolves level-2" framing
  is the part to re-examine against `04`'s output.

### Request-scoped loaders — lifetime & keying (Phase 2, sandbox 06)

- **A loader must die with the request; that's the ONLY reason it lives on the
  context.** It caches, and Nest resolvers are singletons — a loader stored on a
  resolver would hand every later request the first request's cached rows. The
  per-request GraphQL context is a fresh object each request, so parking loaders
  under `context.loaders` gives them exactly the request's lifetime, no more.
  `06`'s scenario C is the proof: bump the data version between two requests
  (`ctx1`, `ctx2`); a loader that leaked would return the stale version. Losing
  this is invisible in a single-request test — same trap species as `05`'s
  scenario E (a green suite only proves what it exercises).
- **`getRequestLoader(context, name, create)` is the whole story: lazy-init
  `context.loaders`, memoize by `name`, `create()` at most once per name.** The
  early-return shape (`const existing = m.get(name); if (existing) return existing;
  … set … return loader`) does presence-check + return in one lookup — cleaner
  than a truthiness guard that re-`get`s. `.has(name)` is the intent-exact check
  ("is it present?"); truthiness is safe here only because loaders are always
  objects, and prod uses truthiness too.
- **`name` is the isolation key AND the deliberate-sharing key.** Unique per
  `type.field` (`'Book.author'`) → isolated cache; the same key under two names
  does NOT dedup (they're different loaders). Reuse one name across fields on
  purpose (`'audit.user'` for `created_by` + `updated_by`) → shared loader → both
  collapse into one query. Same mechanism, opposite intent — a bug by accident, a
  feature when chosen.
- **Cache the PROMISE, not the resolved value.** `createBatchLoader` stores what
  `schedule().then(pick)` returns, so a key that resolves to `undefined` (a
  MISSING row) still dedups — the cached promise is truthy even though its value
  isn't. Cache the value instead and every missing key re-batches forever. (Also
  why rejections stay cached: one poison key fails its whole batch for the request.)
