/* ------------------------------------------------------------------
   mini-rx — your from-scratch rebuild of the Observable engine.

   This file is a PRACTICE rebuild. It is NOT imported by the lab, so
   nothing breaks while it's half-written. Fill in each body from your
   own understanding, then diff against the inline versions in
   observable-lab.jsx to check yourself.

   Rules of the game:
   - Type it, don't paste it.
   - Order this pass: (1) the engine — Obs, then Subject; (2) creation —
     of, interval, timerOnce; (3) operators — map, filter, tap, take,
     debounceTime; (4) the flatteners — switchMap, mergeMap, concatMap.
     The Apollo link (Lesson 9) is built inline in the lab, not here.
   - Vocab check as you go: an *observable* holds a recipe and has
     .subscribe/.pipe; an *observer* is the {next,error,complete} object
     handed INTO a recipe.
   - Stuck? The recurring bugs are logged in CLAUDE.md (Failures) — but
     try to land it cold first; that's the whole point of this pass.
------------------------------------------------------------------- */

/* === the engine ================================================== */

export class Obs {
  constructor(subscribeFn) {
    this._subscribeFn = subscribeFn
  }

  subscribe(handler) {
    const o = typeof handler === 'function' ? { next: handler } : handler || {};
    let closed = false;
    let teardown = (() => {})

    const observer = {
      next: (v) => {
        if (!closed && o.next) {
          o.next(v)
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
      },
      complete: () => {
        if (!closed) {
          closed = true;
          if (o.complete) {
            o.complete();
          }
          teardown();
        }
      },
    }

    teardown = this._subscribeFn(observer) || (() => {})
    return {
      unsubscribe: () => {
        if (!closed) {
          closed = true;
          teardown();
        }
      }
    }
  }

  pipe(...ops) {
    return ops.reduce((src, op) => { return op(src) }, this)
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
    this._observers.slice().forEach(obs => obs.next(v))
  }
}

/* === creation ==================================================== */

export const of = (...vals) => {
  return new Obs((observer) => {
    vals.forEach((v) => {
      observer.next(v) // what would happen if it asynchronous, could observe.complete() run before next
    })
    observer.complete()
  })
};

export const interval = (ms) => {
  return new Obs((observer) => {
    let count = 0;
    const id = setInterval(() => {
      observer.next(count++)
    }, ms)
    return () => {
      clearInterval(id)
    }
  })
};

export const timerOnce = (ms, value) => {
  return new Obs((observer) => {
    const id = setTimeout(() => {
      observer.next(value)
      observer.complete()
    }, ms)
    return () => {
      clearTimeout(id)
    }
  })
};

/* === operators (each: (args) => (src) => new Obs) ================ */

export const map = (fn) => (src) => {
  return new Obs((observer) => {
    const sub = src.subscribe({
      next: (v) => {
        observer.next(fn(v))
      },
      complete: () => {
        observer.complete()
      },
      error: (e) => {
        observer.error(e)
      }
    })
    return () => {
      sub.unsubscribe()
    }
  })
};

export const filter = (pred) => (src) => {
  return new Obs((observer) => {
    const sub = src.subscribe({
      next: (v) => {
        if (pred(v)) {
          observer.next(v)
        }
      },
      complete: () => {
        observer.complete()
      },
      error: (e) => {
        observer.error(e)
      }
    })
    return () => {
      sub.unsubscribe()
    }
  })
};

export const tap = (fn) => (src) => {
  return new Obs((observer) => {
    const sub = src.subscribe({
      next: (v) => {
        fn(v)
        observer.next(v)
      },
      complete: () => {
        observer.complete()
      },
      error: (e) => {
        observer.error(e)
      }
    })
    return () => {
      sub.unsubscribe()
    }
  })
};

export const take = (n) => (src) => {
  return new Obs((observer) => {
    let count = 0;
    const sub = src.subscribe({
      next: (v) => {
          if (count < n) {
            observer.next(v)
            count++
          }
          if (count >= n) {
            observer.complete()
          }
      },
      complete: () => {
        observer.complete()
      },
      error: (e) => {
        observer.error(e)
      }
    })
    return () => {
      sub.unsubscribe()
    }
  })
};

export const debounceTime = (ms) => (src) => {
  return new Obs((observer) => {
    let id = null;
    let isComplete = false;
    const sub = src.subscribe({
      next: (v) => {
        if (id) {
          clearTimeout(id)
        }
        id = setTimeout(() => {
          observer.next(v)
          id = null;
          if (isComplete) {
            observer.complete()
            isComplete = false
          }
        }, ms)
      },
      complete: () => {
        if (id) {
          isComplete = true
        } else {
          observer.complete()
        }

      },
      error: (e) => {
        observer.error(e)
      }
    })
    return () => {
      clearTimeout(id)
      sub.unsubscribe();
    }
  })
};

/* --- the three flatteners (lesson 8) ---------------------------- */

export const switchMap = (project) => (src) => {
  return new Obs((observer) => {
    let projectSub = null;
    let isSrcClosed = false;
    const sub = src.subscribe({
      next: (v) => {
        let projectComplete = false;
        if (projectSub) {
          projectSub.unsubscribe()
        }
        projectSub = project(v).subscribe({
          next: (w) => {
            observer.next(w)
          },
          complete: () => {
            projectSub = null;
            if (isSrcClosed) {
              observer.complete()
            }
            projectComplete = true
          },
          error: (e) => {
            observer.error(e)
          }
        })

        if (projectComplete) {
          projectSub = null;
        }
      },
      complete: () => {
        if (!projectSub) {
          observer.complete()
        }
        isSrcClosed = true
      },
      error: (e) => {
        observer.error(e)
      }
    })
    return () => {
      if (projectSub) {
        projectSub.unsubscribe()
      }
      sub.unsubscribe()
    }
  })
};

export const mergeMap = (project) => (src) => {
  return new Obs((observer) => {
    let current = []; // I named it current for current observers
    let isSrcClosed = false;
    const clearCurrent = () => {
      current.forEach((curr) => curr.unsubscribe())
    }
    const sub = src.subscribe({
      next: (v) => {
        let syncComplete = false;
        let projectSub;
        projectSub = project(v).subscribe({
          next: (w) => {
            observer.next(w)
          },
          complete: () => {
            syncComplete = true;
            current = current.filter(curr => curr !== projectSub) //on sync is no ops, since its undefined and current just represnets the same array after the filtering
            if (isSrcClosed && current.length === 0) {
              observer.complete()
            }
          },
          error: (e) => {
            observer.error(e);
          }
        })
        if (!syncComplete) {
          current.push(projectSub)
        }

      },
      complete: () => {
        isSrcClosed = true;
        if (current.length === 0) {
          observer.complete()
        }
      },
      error: (e) => {
        clearCurrent()
        observer.error(e)
      }
    })

    return () => {
      clearCurrent()
      sub.unsubscribe()
    }
  })
};

export const concatMap = (project) => (src) => {
  return new Obs((observer) => {
    let queue = []
    let active = null;
    let isSrcClosed = false;
    const doNext = () => {
      if (isSrcClosed && queue.length === 0 && active === null) { observer.complete() }
      if (queue.length === 0 || active !== null) { return }
      active = project(queue.shift()).subscribe({
        next: (w) => {
          observer.next(w);
        },
        complete: () => {
          active = null;
          doNext();
        },
        error: (e) => {
          observer.error(e)
        }
      })
    }

    const sub = src.subscribe({
      next: (v) => {
        queue.push(v);
        doNext();
      },
      complete: () => {
        isSrcClosed = true;
        if (queue.length === 0 && active === null) {
          observer.complete()
        }
      },
      error: (e) => {
        observer.error(e)
      }
    })

    return () => {
      if (active) {
        active.unsubscribe();
      }
      sub.unsubscribe()
    }

  })
};
