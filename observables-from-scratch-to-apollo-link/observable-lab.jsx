import React, { useState, useRef, useEffect, useCallback } from "react";

/* ------------------------------------------------------------------
   A miniature Observable library — read this part first.
   This is the whole idea. Everything below is built on these 40 lines.
------------------------------------------------------------------- */

class Obs {
  constructor(subscribeFn) {
    this._subscribeFn = subscribeFn; // the "recipe". Not run yet.
  }

  subscribe(handler) {
    const o = typeof handler === "function" ? { next: handler } : handler || {};
    let closed = false;
    let teardown = () => {};

    const observer = {
      next: (v) => { if (!closed && o.next) o.next(v); },
      error: (e) => { if (!closed) { closed = true; o.error && o.error(e); teardown(); } },
      complete: () => { if (!closed) { closed = true; o.complete && o.complete(); teardown(); } },
    };

    teardown = this._subscribeFn(observer) || (() => {});

    return {
      unsubscribe() { if (!closed) { closed = true; teardown(); } },
    };
  }

  pipe(...ops) {
    return ops.reduce((src, op) => op(src), this);
  }
}

class Subject extends Obs {
  constructor() {
    super((observer) => {
      this._observers.push(observer);
      return () => {
        this._observers = this._observers.filter((x) => x !== observer);
      };
    });
    this._observers = [];
  }
  next(v) { this._observers.slice().forEach((o) => o.next(v)); }
}

/* creation ------------------------------------------------------- */

const of = (...vals) =>
  new Obs((o) => { vals.forEach((v) => o.next(v)); o.complete(); });

const interval = (ms) =>
  new Obs((o) => {
    let n = 0;
    const id = setInterval(() => o.next(n++), ms);
    return () => clearInterval(id);
  });

const timerOnce = (ms, value) =>
  new Obs((o) => {
    const id = setTimeout(() => { o.next(value); o.complete(); }, ms);
    return () => clearTimeout(id);
  });

/* operators ------------------------------------------------------ */

const map = (fn) => (src) =>
  new Obs((o) => src.subscribe({
    next: (v) => o.next(fn(v)),
    error: (e) => o.error(e),
    complete: () => o.complete(),
  }).unsubscribe);

const filter = (pred) => (src) =>
  new Obs((o) => src.subscribe({
    next: (v) => { if (pred(v)) o.next(v); },
    error: (e) => o.error(e),
    complete: () => o.complete(),
  }).unsubscribe);

const tap = (fn) => (src) =>
  new Obs((o) => src.subscribe({
    next: (v) => { fn(v); o.next(v); },
    error: (e) => o.error(e),
    complete: () => o.complete(),
  }).unsubscribe);

const take = (n) => (src) =>
  new Obs((o) => {
    let count = 0;
    const sub = src.subscribe({
      next: (v) => { o.next(v); if (++count >= n) o.complete(); },
      error: (e) => o.error(e),
      complete: () => o.complete(),
    });
    return () => sub.unsubscribe();
  });

const debounceTime = (ms) => (src) =>
  new Obs((o) => {
    let id = null;
    const sub = src.subscribe({
      next: (v) => { clearTimeout(id); id = setTimeout(() => o.next(v), ms); },
      error: (e) => o.error(e),
      complete: () => o.complete(),
    });
    return () => { clearTimeout(id); sub.unsubscribe(); };
  });

// the three flatteners — the whole point of exercise 8
const switchMap = (project) => (src) =>
  new Obs((o) => {
    let inner = null;
    const sub = src.subscribe({
      next: (v) => {
        if (inner) inner.unsubscribe();          // cancel the previous one
        inner = project(v).subscribe({ next: (x) => o.next(x) });
      },
      error: (e) => o.error(e),
    });
    return () => { inner && inner.unsubscribe(); sub.unsubscribe(); };
  });

const mergeMap = (project) => (src) =>
  new Obs((o) => {
    const inners = [];
    const sub = src.subscribe({
      next: (v) => inners.push(project(v).subscribe({ next: (x) => o.next(x) })), // all at once
      error: (e) => o.error(e),
    });
    return () => { inners.forEach((i) => i.unsubscribe()); sub.unsubscribe(); };
  });

const concatMap = (project) => (src) =>
  new Obs((o) => {
    const queue = [];
    let active = null;
    const runNext = () => {
      if (active || !queue.length) return;
      const v = queue.shift();
      active = project(v).subscribe({
        next: (x) => o.next(x),
        complete: () => { active = null; runNext(); },   // wait your turn
      });
    };
    const sub = src.subscribe({
      next: (v) => { queue.push(v); runNext(); },
      error: (e) => o.error(e),
    });
    return () => { active && active.unsubscribe(); sub.unsubscribe(); };
  });

/* ------------------------------------------------------------------
   Exercises
------------------------------------------------------------------- */

const LESSONS = [
  {
    title: "Subscribing is what starts it",
    idea:
      "An Observable is a recipe, not a running process. The body doesn't execute when you create it — only when someone subscribes. Watch: nothing happens on the top track until the subscribe fires at 1.2s.",
    window: 3000,
    tracks: [
      { id: "inside", label: "inside the observable" },
      { id: "out", label: "what the subscriber sees" },
    ],
    code: `const src = new Obs(observer => {
  log('the body is running now');   // ← not called yet
  observer.next('A');
  observer.next('B');
  observer.complete();
});

// 1.2 seconds later...
src.subscribe({
  next: v => log(v),
  complete: () => log('done')
});`,
    run: ({ log }) => {
      const src = new Obs((o) => {
        log("inside", "body runs", "note");
        o.next("A"); o.next("B"); o.complete();
      });
      log("inside", "created (idle)", "note");
      const id = setTimeout(() => {
        src.subscribe({
          next: (v) => log("out", v),
          complete: () => log("out", "done", "complete"),
        });
      }, 1200);
      return { unsubscribe: () => clearTimeout(id) };
    },
  },

  {
    title: "Many values, spread over time",
    idea:
      "This is the part a Promise can't do. One subscription, five values, arriving whenever the producer decides. `take(5)` completes the stream after the fifth.",
    window: 4500,
    tracks: [{ id: "out", label: "output" }],
    code: `interval(700)
  .pipe(take(5))
  .subscribe({
    next: v => log(v),
    complete: () => log('done')
  });`,
    run: ({ log }) =>
      interval(700).pipe(take(5)).subscribe({
        next: (v) => log("out", v),
        complete: () => log("out", "done", "complete"),
      }),
  },

  {
    title: "map and filter",
    idea:
      "Each operator returns a *new* observable that subscribes to the one before it. Three tracks, three observables, chained. Nothing is mutated.",
    window: 5500,
    tracks: [
      { id: "src", label: "interval(600)" },
      { id: "mapped", label: "after map(n => n * 10)" },
      { id: "out", label: "after filter(even tens)" },
    ],
    code: `interval(600).pipe(
  take(8),
  map(n => n * 10),
  filter(n => n % 20 === 0)
).subscribe(v => log(v));`,
    run: ({ log }) =>
      interval(600).pipe(
        take(8),
        tap((v) => log("src", v)),
        map((n) => n * 10),
        tap((v) => log("mapped", v)),
        filter((n) => n % 20 === 0),
      ).subscribe({
        next: (v) => log("out", v),
        complete: () => log("out", "done", "complete"),
      }),
  },

  {
    title: "Teardown: the return value nobody explains",
    idea:
      "Whatever function you return from the observable body is the cleanup. It runs on unsubscribe, on complete, and on error. In an Apollo link this is what aborts the in-flight request when a component unmounts.",
    window: 5000,
    tracks: [
      { id: "out", label: "output" },
      { id: "clean", label: "teardown" },
    ],
    code: `const src = new Obs(observer => {
  const id = setInterval(() => observer.next(n++), 500);
  return () => {              // ← the teardown
    clearInterval(id);
    log('cleanup ran');
  };
});

const sub = src.subscribe(v => log(v));
setTimeout(() => sub.unsubscribe(), 2600);`,
    run: ({ log }) => {
      let n = 0;
      const src = new Obs((o) => {
        const id = setInterval(() => o.next(n++), 500);
        return () => { clearInterval(id); log("clean", "cleanup ran", "note"); };
      });
      const sub = src.subscribe((v) => log("out", v));
      const t = setTimeout(() => sub.unsubscribe(), 2600);
      return { unsubscribe: () => { clearTimeout(t); sub.unsubscribe(); } };
    },
  },

  {
    title: "Cold: every subscriber gets its own run",
    idea:
      "Two subscribers, one second apart. Notice B doesn't join A's sequence — it starts its own from zero. This is exactly why subscribing twice to an HTTP observable fires two requests.",
    window: 5500,
    tracks: [
      { id: "a", label: "subscriber A" },
      { id: "b", label: "subscriber B (joins at 1.5s)" },
    ],
    code: `const src = interval(600).pipe(take(5));

src.subscribe(v => logA(v));
setTimeout(() => src.subscribe(v => logB(v)), 1500);`,
    run: ({ log }) => {
      const src = interval(600).pipe(take(5));
      const subA = src.subscribe((v) => log("a", v));
      let subB = null;
      const t = setTimeout(() => { subB = src.subscribe((v) => log("b", v)); }, 1500);
      return {
        unsubscribe: () => { clearTimeout(t); subA.unsubscribe(); subB && subB.unsubscribe(); },
      };
    },
  },

  {
    title: "A Subject is hot — one source, shared",
    idea:
      "A Subject is both an observable and a thing you push into. Every subscriber sees the same emission at the same moment. Press the button.",
    window: 6000,
    interactive: "Push a value",
    tracks: [
      { id: "src", label: "subject.next(...)" },
      { id: "a", label: "subscriber A" },
      { id: "b", label: "subscriber B" },
    ],
    code: `const clicks$ = new Subject();

clicks$.subscribe(v => logA(v));
clicks$.subscribe(v => logB(v));

button.onclick = () => clicks$.next(n++);`,
    run: ({ log, trigger$ }) => {
      const s = new Subject();
      const feed = trigger$.subscribe((v) => { log("src", v); s.next(v); });
      const a = s.subscribe((v) => log("a", v));
      const b = s.subscribe((v) => log("b", v));
      return { unsubscribe: () => { feed.unsubscribe(); a.unsubscribe(); b.unsubscribe(); } };
    },
  },

  {
    title: "debounceTime — a search box",
    idea:
      "Mash the button quickly. Only the last press in a 600ms quiet window makes it through. Every intermediate value is discarded, which a chain of Promises cannot do.",
    window: 8000,
    interactive: "Type a keystroke",
    tracks: [
      { id: "src", label: "keystrokes" },
      { id: "out", label: "after debounceTime(600)" },
    ],
    code: `keystrokes$.pipe(
  debounceTime(600)
).subscribe(v => search(v));`,
    run: ({ log, trigger$ }) => {
      const t = trigger$.pipe(tap((v) => log("src", v)), debounceTime(600));
      return t.subscribe((v) => log("out", v, "hit"));
    },
  },

  {
    title: "switchMap vs mergeMap vs concatMap",
    idea:
      "The wall. Each press starts a 1.8s fake request. Press three times fast, then watch the three tracks: switchMap cancels the previous request, mergeMap runs them in parallel, concatMap queues them. Same input, three completely different results.",
    window: 12000,
    interactive: "Fire a request",
    tracks: [
      { id: "src", label: "presses" },
      { id: "switch", label: "switchMap — cancels the old one" },
      { id: "merge", label: "mergeMap — all in parallel" },
      { id: "concat", label: "concatMap — one after another" },
    ],
    code: `const request = id => timerOnce(1800, \`r\${id} done\`);

presses$.pipe(switchMap(request)).subscribe(...)
presses$.pipe(mergeMap(request)).subscribe(...)
presses$.pipe(concatMap(request)).subscribe(...)`,
    run: ({ log, trigger$ }) => {
      const request = (id) => timerOnce(1800, `r${id}`);
      const s0 = trigger$.subscribe((v) => log("src", v));
      const s1 = trigger$.pipe(switchMap(request)).subscribe((v) => log("switch", v, "hit"));
      const s2 = trigger$.pipe(mergeMap(request)).subscribe((v) => log("merge", v, "hit"));
      const s3 = trigger$.pipe(concatMap(request)).subscribe((v) => log("concat", v, "hit"));
      return { unsubscribe: () => [s0, s1, s2, s3].forEach((s) => s.unsubscribe()) };
    },
  },

  {
    title: "The Apollo link, finally",
    idea:
      "You are the middleman: subscribed to forward() above, producing into observer below. The first response is a 401 — it's swallowed, never reaching the caller. The retry's result is piped into the same observer, so the caller only ever sees one clean result.",
    window: 6000,
    tracks: [
      { id: "inner", label: "forward() — the chain above you" },
      { id: "outer", label: "observer — what the caller sees" },
    ],
    code: `new Observable(observer => {
  const sub = forward(op).subscribe({
    next: result => {
      if (isAuthError(result)) {
        refreshToken().then(() =>
          forward(op).subscribe(observer)  // pipe retry into the caller
        );
        return;                            // swallow the 401
      }
      observer.next(result);
    }
  });
  return () => sub.unsubscribe();
});`,
    run: ({ log }) => {
      let attempt = 0;
      const forward = () =>
        new Obs((o) => {
          const n = ++attempt;
          const id = setTimeout(() => {
            const result = n === 1 ? "401" : "data";
            log("inner", result, n === 1 ? "err" : "next");
            o.next(result); o.complete();
          }, 900);
          return () => clearTimeout(id);
        });

      const link = new Obs((observer) => {
        const sub = forward().subscribe({
          next: (result) => {
            if (result === "401") {
              log("inner", "refreshing token", "note");
              setTimeout(() => forward().subscribe(observer), 700);
              return; // swallowed — never reaches outer
            }
            observer.next(result);
          },
          complete: () => {},
        });
        return () => sub.unsubscribe();
      });

      return link.subscribe((v) => log("outer", v, "hit"));
    },
  },
];

/* ------------------------------------------------------------------
   UI
------------------------------------------------------------------- */

const C = {
  paper: "#EDF0F5",
  panel: "#FFFFFF",
  ink: "#182034",
  muted: "#6C7891",
  rule: "#CAD3E0",
  next: "#2F5DA8",
  hit: "#0E7A6E",
  note: "#8A6412",
  err: "#A8264F",
  complete: "#4A5568",
};

const KIND_COLOR = { next: C.next, hit: C.hit, note: C.note, err: C.err, complete: C.complete };

export default function ObservableLab() {
  const [lessonIdx, setLessonIdx] = useState(0);
  const [events, setEvents] = useState([]);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showCode, setShowCode] = useState(false);

  const startRef = useRef(0);
  const subRef = useRef(null);
  const triggerRef = useRef(null);
  const rafRef = useRef(null);
  const counterRef = useRef(0);

  const lesson = LESSONS[lessonIdx];

  const stop = useCallback(() => {
    if (subRef.current) { subRef.current.unsubscribe(); subRef.current = null; }
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
  }, []);

  useEffect(() => stop, [stop]);
  useEffect(() => { stop(); setEvents([]); setElapsed(0); }, [lessonIdx, stop]);

  const start = () => {
    stop();
    setEvents([]);
    counterRef.current = 0;
    startRef.current = performance.now();
    setElapsed(0);
    setRunning(true);

    const trigger$ = new Subject();
    triggerRef.current = trigger$;

    const log = (track, value, kind = "next") =>
      setEvents((prev) => [
        ...prev,
        { track, value: String(value), kind, t: performance.now() - startRef.current, key: prev.length },
      ]);

    subRef.current = lesson.run({ log, trigger$ });

    const tick = () => {
      setElapsed(performance.now() - startRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const fire = () => {
    if (triggerRef.current) triggerRef.current.next(++counterRef.current);
  };

  const span = Math.max(lesson.window, elapsed + 400);

  return (
    <div style={{ background: C.paper, color: C.ink, minHeight: "100%", padding: "18px 14px 28px",
                  fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <style>{`
        .marble { animation: pop 260ms cubic-bezier(.2,1.4,.4,1); }
        @keyframes pop { from { transform: translate(-50%,-50%) scale(0); } to { transform: translate(-50%,-50%) scale(1); } }
        @media (prefers-reduced-motion: reduce) { .marble { animation: none; } }
        .lab-btn:focus-visible { outline: 2px solid ${C.next}; outline-offset: 2px; }
      `}</style>

      <h1 style={{ fontFamily: "Iowan Old Style, Palatino, Georgia, serif", fontSize: 25,
                   lineHeight: 1.15, margin: "0 0 4px", letterSpacing: "-.01em" }}>
        Watching values move
      </h1>
      <p style={{ margin: "0 0 18px", fontSize: 13.5, color: C.muted, maxWidth: "62ch" }}>
        Nine steps, built on a 40-line Observable. Press play and watch the tracks.
      </p>

      {/* step picker */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {LESSONS.map((l, i) => (
          <button key={i} onClick={() => setLessonIdx(i)} className="lab-btn"
            style={{
              width: 30, height: 30, borderRadius: 15, cursor: "pointer", fontSize: 12.5,
              fontVariantNumeric: "tabular-nums",
              border: `1px solid ${i === lessonIdx ? C.ink : C.rule}`,
              background: i === lessonIdx ? C.ink : "transparent",
              color: i === lessonIdx ? C.paper : C.muted,
            }}>{i + 1}</button>
        ))}
      </div>

      <h2 style={{ fontFamily: "Iowan Old Style, Palatino, Georgia, serif", fontSize: 19,
                   margin: "0 0 8px", lineHeight: 1.25 }}>
        {lesson.title}
      </h2>
      <p style={{ fontSize: 14, lineHeight: 1.55, margin: "0 0 16px", maxWidth: "58ch" }}>
        {lesson.idea}
      </p>

      {/* controls */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={running ? stop : start} className="lab-btn"
          style={{ padding: "9px 18px", borderRadius: 6, border: "none", cursor: "pointer",
                   background: C.ink, color: C.paper, fontSize: 13.5, fontWeight: 500 }}>
          {running ? "Stop" : "Play"}
        </button>

        {lesson.interactive && (
          <button onClick={fire} disabled={!running} className="lab-btn"
            style={{ padding: "9px 16px", borderRadius: 6, cursor: running ? "pointer" : "not-allowed",
                     border: `1px solid ${running ? C.hit : C.rule}`,
                     background: running ? "#E4F1EE" : "transparent",
                     color: running ? C.hit : C.rule, fontSize: 13.5, fontWeight: 500 }}>
            {lesson.interactive}
          </button>
        )}

        <span style={{ marginLeft: "auto", fontSize: 12, color: C.muted,
                       fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                       fontVariantNumeric: "tabular-nums" }}>
          {(elapsed / 1000).toFixed(1)}s
        </span>
      </div>

      {/* tracks */}
      <div style={{ background: C.panel, borderRadius: 8, padding: "16px 12px 10px",
                    border: `1px solid ${C.rule}` }}>
        {lesson.tracks.map((track) => (
          <div key={track.id} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 7,
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              {track.label}
            </div>
            <div style={{ position: "relative", height: 30, borderBottom: `1px solid ${C.rule}` }}>
              {events.filter((e) => e.track === track.id).map((e) => {
                const x = Math.min(99, (e.t / span) * 100);
                const color = KIND_COLOR[e.kind] || C.next;
                const isNote = e.kind === "note" || e.kind === "complete";
                return (
                  <div key={e.key} className="marble" title={`${e.value} @ ${Math.round(e.t)}ms`}
                    style={{
                      position: "absolute", left: `${x}%`, top: "50%",
                      transform: "translate(-50%,-50%)",
                      padding: isNote ? "3px 7px" : "0 8px",
                      minWidth: isNote ? 0 : 24, height: 24,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      borderRadius: isNote ? 4 : 12, whiteSpace: "nowrap",
                      background: isNote ? "transparent" : color,
                      border: isNote ? `1px dashed ${color}` : "none",
                      color: isNote ? color : "#fff",
                      fontSize: isNote ? 10.5 : 12, fontWeight: 500,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}>
                    {e.value}
                  </div>
                );
              })}
              {running && (
                <div style={{ position: "absolute", left: `${Math.min(99, (elapsed / span) * 100)}%`,
                              top: 0, bottom: 0, width: 1, background: C.rule }} />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* code */}
      <button onClick={() => setShowCode((s) => !s)} className="lab-btn"
        style={{ marginTop: 14, background: "none", border: "none", cursor: "pointer",
                 color: C.next, fontSize: 13, padding: 0, textDecoration: "underline" }}>
        {showCode ? "Hide the code" : "Show the code"}
      </button>

      {showCode && (
        <pre style={{ marginTop: 10, background: C.panel, border: `1px solid ${C.rule}`,
                      borderRadius: 8, padding: 14, overflowX: "auto", fontSize: 12,
                      lineHeight: 1.6, color: C.ink,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
{lesson.code}
        </pre>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22 }}>
        <button onClick={() => setLessonIdx((i) => Math.max(0, i - 1))}
          disabled={lessonIdx === 0} className="lab-btn"
          style={{ background: "none", border: "none", fontSize: 13.5, padding: 0,
                   cursor: lessonIdx === 0 ? "default" : "pointer",
                   color: lessonIdx === 0 ? C.rule : C.ink }}>
          Previous
        </button>
        <button onClick={() => setLessonIdx((i) => Math.min(LESSONS.length - 1, i + 1))}
          disabled={lessonIdx === LESSONS.length - 1} className="lab-btn"
          style={{ background: "none", border: "none", fontSize: 13.5, padding: 0,
                   cursor: lessonIdx === LESSONS.length - 1 ? "default" : "pointer",
                   color: lessonIdx === LESSONS.length - 1 ? C.rule : C.ink }}>
          Next
        </button>
      </div>
    </div>
  );
}
