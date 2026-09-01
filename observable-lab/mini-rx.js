/* ------------------------------------------------------------------
   mini-rx — your from-scratch rebuild of the Observable engine.

   This file is a PRACTICE rebuild. It is NOT imported by the lab, so
   nothing breaks while it's half-written. Fill in each body from your
   own understanding, then diff against the inline versions in
   observable-lab.jsx to check yourself.

   Rules of the game:
   - Type it, don't paste it.
   - Do the ones the current lesson needs first (1-3: Obs, interval,
     take, map, filter, tap). Leave the rest as TODO until we reach them.
   - Vocab check as you go: an *observable* holds a recipe and has
     .subscribe/.pipe; an *observer* is the {next,error,complete} object
     handed INTO a recipe.
------------------------------------------------------------------- */

/* === the engine ================================================== */

import ObservableLab from "./observable-lab.jsx";

export class Obs {
  constructor(subscribeFn) {
    // TODO(mau): store subscribeFn as the recipe. Do NOT run it here.
    this._subscribeFn = subscribeFn;
  }

  subscribe(handler) {
    // TODO(mau):
    //  1. normalize `handler` -> `o` (a bare function becomes { next: fn }).
    //  2. build a guarded `observer` around `o` using a `closed` flag so
    //     no value escapes after complete/error/teardown.
    //  3. run the recipe with that observer; capture its return as teardown.
    //  4. return an object with an unsubscribe() that closes + tears down once.
    const o = typeof handler === "function" ? { next: handler } : handler || {}
    let closed = false;
    let teardown = (() => {})

    const observer = {
      next: (v) => { if(!closed) o.next(v); },
      error: (e) => { if(!closed && o.error) { closed = true; o.error(e);  teardown(); }},
      complete: () => { if(!closed && o.complete) { closed = true; o.complete(); teardown(); }}
    }

    teardown = this._subscribeFn(observer) || (() => {});

    return {
      unsubscribe() {
        closed = true;
        teardown();
      }
    }
  }

  pipe(...ops) {
    // TODO(mau): thread `this` through each operator left-to-right,
    // returning the final observable. (one-liner with reduce)
  }
}

export class Subject extends Obs {
  constructor() {
    // TODO(mau): a Subject is hot. Its recipe should register each
    // observer in a list and return a teardown that removes it.
  }

  next(v) {
    // TODO(mau): push `v` to every currently-registered observer.
  }
}

/* === creation ==================================================== */

// emit each argument synchronously, then complete.
export const of = (...vals) => {
  // TODO(mau)
};

// emit 0,1,2,... every `ms`. teardown clears the interval.
export const interval = (ms) => {

  // TODO(mau)
  // recipe
  return new Obs((o) => {
    let n = 0
    const id = setInterval(() => {
      o.next(n++)
    }, ms)
    return () => {
      clearInterval(id)
    }
  })
};

// emit `value` once after `ms`, then complete. teardown clears the timeout.
export const timerOnce = (ms, value) => {
  // TODO(mau)
};

/* === operators (each: (args) => (src) => new Obs) ================ */
// Reminder: an operator is a middleman. Its recipe subscribes DOWN to
// `src` and forwards UP through the observer it was given (`o`).

export const map = (fn) => (src) => {
  // TODO(mau): forward fn(v) upward; pass error/complete straight through.
};

export const filter = (pred) => (src) => {
  // TODO(mau): forward v only when pred(v) is true.
};

export const tap = (fn) => (src) => {
  // TODO(mau): run fn(v) for its side effect, then forward v unchanged.
};

export const take = (n) => (src) => {
  return new Obs((o) => {
    let count = 0;
    const sub = src.subscribe({
      next: (e) => { if (count++ < n)  { o.next(e) } else { o.complete(); } },
    })
    return () => {
      sub.unsubscribe();
    }
  })
  // TODO(mau): forward values; after the nth, complete. (emit the nth first)
};

export const debounceTime = (ms) => (src) => {
  // TODO(mau): on each value, reset a timer; only emit when quiet for `ms`.
};

/* --- the three flatteners (lesson 8) ---------------------------- */

export const switchMap = (project) => (src) => {
  // TODO(mau): on each source value, unsubscribe the previous inner and
  // subscribe project(v). (cancels the old one)
};

export const mergeMap = (project) => (src) => {
  // TODO(mau): subscribe project(v) for every source value; keep them all.
};

export const concatMap = (project) => (src) => {
  // TODO(mau): queue source values; run one inner at a time, next starts
  // only when the current inner completes.
};
