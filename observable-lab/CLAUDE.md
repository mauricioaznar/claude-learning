# observable-lab

Understanding Observables from the ground up, so the production `apollo-client.ts`
(saved here as a reference) reads as obvious instead of magic. Unlike the other
labs this is a **comprehension** project, not a build-it one: the teaching code is
already written in [observable-lab.jsx](observable-lab.jsx) — a ~40-line hand-rolled
Observable engine (`Obs`, `Subject`, operators) wrapped in 9 runnable lessons. We
walk through it lesson by lesson; Mau reasons about each part, then we annotate.

Run it: `npm --prefix observable-lab run dev` → http://localhost:5180

## Files

- `observable-lab.jsx` — the lab (engine + 9 lessons + marble-diagram UI).
- `apollo-client.ts` — the real-world target. Never imported; pure reference to
  annotate as concepts click. Lesson 9 is a stripped-down version of its retry.

## Exercises

Each maps to one lesson (button 1–9 in the UI).

1. **[done] Subscribing is what starts it** — an Observable is a stored recipe;
   `subscribe` invokes it, teardown is what invoking it returns.
2. **[done] Many values over time** — the thing a Promise can't do; `take(n)` completes.
3. **[done] map / filter** — each operator returns a *new* Observable subscribing to
   the previous one. Nothing is mutated.
4. **[done] Teardown** — the returned cleanup runs on unsubscribe / complete / error.
5. **[ ] Cold** — every subscriber re-runs the recipe from scratch.
6. **[ ] Subject is hot** — one source, shared to all subscribers at once.
7. **[done] debounceTime** — discard intermediate values in a quiet window.
   Chose reading B: on source complete, let the pending timer run its full
   window and deliver its value, then complete (RxJS flushes immediately —
   reading A). Requires a "completion owed" flag; error still tears through.
8. **[done] switchMap vs mergeMap vs concatMap** — cancel / parallel / queue.
   All three rebuilt cold, async-correct. Completion is an AND: source done
   *and* no work remaining (switch: current inner done; merge: list empty;
   concat: queue empty *and* active null). Sync-inner hardening done for switch
   and merge (per-value flag, skip/undo the clobber); left out of concat on
   purpose — `doNext` recurses, so the switch/merge post-check stomps live
   state a nested call set. Concat inners are async in this lab, so it's moot.
9. **[ ] The Apollo link** — swallow a 401, pipe the retry into the same observer.

## Failures

*(symptom → cause → fix; record as they happen)*

- **Double teardown / double-complete on reentrancy** (mini-rx rebuild of
  `subscribe`). *Symptom:* a caller that unsubscribes inside its own `complete`
  handler makes the recipe's teardown run twice (e.g. `clearInterval` twice —
  harmless there, but a socket close / refcount / list-removal would corrupt).
  *Cause:* `closed = true` was set *after* calling `o.complete()`/`o.error()`.
  While the caller's handler runs, `closed` is still `false`, so a reentrant
  `unsubscribe()` (or synchronous re-emit) sees the stream as open and fires
  teardown again. *Fix:* flip the flag first — inside `if (!closed)`, do
  `closed = true` → notify caller → `teardown()`, in that order. The guard only
  works if it's set before you hand control to caller code. A defensive
  `unsubscribe()` on complete is legal and common (the caller can't see the
  source self-completes), so the lib must make it a free no-op.

- **`take(n)` boundary — one comparison can't do it.** *Symptom:* `count++ < n`
  emits n values but completes one tick late (waits for the (n+1)th value);
  reordering to "emit first, then `++count >= n`" completes on time but leaks one
  value on `take(0)`. *Cause:* each source value needs *two independent*
  decisions, not one. *Fix:* `if (count < n) o.next(v); count++; if (count >= n)
  o.complete();` — guard the emit and guard the completion separately. Handles
  both `take(0)` (emit nothing, complete) and `take(n)` (complete on the nth).
  Also emit the *value* `v`, not `count`/`n`.

- **debounceTime reading B — stale timer id defeats the "pending?" check.**
  (Took three passes to land.) *Symptom:* emit a value, let the window elapse,
  then complete the source → never completes (hangs). *Cause:* `complete` decides
  "is a timer pending?" from `if (id)`, but `id` was only nulled on reschedule and
  in teardown — never when the timer *fires on its own*. A fired-but-not-cleared
  `id` reads as "pending" forever, so `complete` sets the "completion owed" flag
  and waits on a timer that already ran. Nulling it only *inside* the
  `if (isComplete)` branch has the same hole (the plain fire path skips it).
  *Fix:* null `id` inside the timer callback, **unconditionally**, right after the
  emit and before the `isComplete` check — the timer stops being pending the
  instant it fires, regardless of whether completion is owed.

## Learnings

- **Define vs. invoke.** `new Obs(fn)` only *stores* `fn` as `_subscribeFn`; the
  body runs only when `subscribe()` calls it (line 24). Like a function definition
  vs. a function call.
- **Two objects in `subscribe`.** `o` = the caller's callbacks; `observer` = a
  guarded wrapper around `o` that the recipe is handed. The guard is a single
  `closed` boolean: after complete/error/teardown, no value escapes to the caller.
- **Teardown flows the other way.** Invoking the recipe *returns* the teardown
  (`teardown = _subscribeFn(observer)`); teardown is cleanup called later, on
  unsubscribe / complete / error. It does not drive emissions — `observer.next` does.
- **Sync-completion wrinkle (toy-lib footnote).** If a recipe completes
  synchronously *during* the line-24 call, `teardown()` fired by `complete()` still
  sees the initial `()=>{}` from line 16, because the `=` on line 24 hasn't run yet.
  Invisible when both are no-ops; real recipes emit asynchronously so it never bites.
