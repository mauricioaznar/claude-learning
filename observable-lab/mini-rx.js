/* ------------------------------------------------------------------
   mini-rx — your from-scratch rebuild of the Observable engine.

   This file is a PRACTICE rebuild. It is NOT imported by the lab, so
   nothing breaks while it's half-written. Fill in each body from your
   own understanding, then diff against the inline versions in
   observable-lab.jsx to check yourself.

   Rules of the game:
   - Type it, don't paste it.
   - Order this pass: (1) the engine — Obs, then Subject; (2) creation —
     interval; (3) take. Get those cold, then move on to debounceTime,
     then the three flatteners. The Apollo link (Lesson 9) is built
     inline in the lab, not here — we rebuild it there when we arrive.
   - Vocab check as you go: an *observable* holds a recipe and has
     .subscribe/.pipe; an *observer* is the {next,error,complete} object
     handed INTO a recipe.

   Two failures already recorded in CLAUDE.md — don't relearn them the
   hard way:
   - subscribe: flip `closed` to true BEFORE notifying the caller, else a
     reentrant unsubscribe double-fires teardown.
   - take(n): two separate guards (emit vs complete), not one comparison.
------------------------------------------------------------------- */

/* === the engine ================================================== */

export class Obs {
  constructor(subscribeFn) {
    this._subscribeFn = subscribeFn;
  }

  subscribe(handler) {
    const o = typeof handler === 'function' ? { next: handler} : handler || {};
    let closed = false;
    let teardown = (() => {});

    const observer = {
      next: (v) => {
        if (!closed) {
          o.next(v);
        }
      },
      complete: () => {
        if (!closed) {
          closed = true;
          if (o.complete) {
            o.complete()
          }
          teardown();
        }
      },
      error: (e) => {
        if (!closed) {
          closed = true;
          if (o.error) {
            o.error(e)
          }
          teardown();
        }
      }
    }
    teardown = this._subscribeFn(observer) || (() => {});
    return {
      unsubscribe: () => {
        if (!closed) {
          closed = true
          teardown();
        }
      }
    }
  }

  pipe(...ops) {
    return ops.reduce((src, trg) => { return trg(src) }, this)
  }
}

export class Subject extends Obs {
  constructor() {
    super((observer) => {
      this._observers.push(observer)
      return () => {
        this._observers = this._observers.filter(x => x !== observer)
      }
    })
    this._observers = []
  }

  next(v) {
    this._observers.slice().forEach(observer => {
      observer.next(v)
    })
  }
}

/* === creation ==================================================== */

// emit each argument synchronously, then complete.
export const of = (...vals) => {
  // TODO(mau)
};

// emit 0,1,2,... every `ms`. teardown clears the interval.
export const interval = (ms) => {
  return new Obs((observer) => {
    let n = 0;
    const id = setInterval(() => {
      observer.next(n++)
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
  return new Obs((observer) => {
    let count = 0;
    const sub = src.subscribe({
      next: (v) => {
        if (count < n) {
          observer.next(v);
          count++
        }
        if (count >= n) {
          observer.complete();
        }
      },
      error: (e) => {
        observer.error(e)
      },
      complete: () => {
        observer.complete()
      }
    })
    return () => {
      sub.unsubscribe()
    }
  })
};

export const debounceTime = (ms) => (src) => {
  return new Obs((observer) => {
    let timerId = null;
    let lastValue = null;
    const sub = src.subscribe({
      next: (v) => {
        lastValue = v;
        if (!timerId) {
          timerId = setTimeout(() => {
            observer.next(lastValue)
            timerId = null
          }, ms)
        }
      },
      complete: () => {
        timerId = null;
        observer.complete()
      },
      error: (e) => {
        timerId = null;
        observer.error(e)
      }
    })
    return () => {
      sub.unsubscribe()
      timerId = null;
    }
  })
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
