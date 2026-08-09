# claude-learning

A learning lab. Each subfolder is a self-contained side project for learning one
topic by building it from scratch. Nothing here is production code — the goal is
that Mau can rebuild each feature unaided later.

## Projects

| Project | Topic | Status |
| --- | --- | --- |
| `cookies/` | Cookie-based session auth (Express + SPA) | Exercises 1–3 done, on 4 — server-side expiry |

Keep this table thin — one line each, pointing at the project's own `CLAUDE.md`
for detail. Update it **when an exercise completes**, not on every commit, so
progress has a single source of truth and project work doesn't keep touching a
shared file.

## Starting work

Mau names the project explicitly at the start of a session — don't infer it from
context. For a new project he describes what he wants to learn or build; suggest
a set of topics and an exercise path, and refine it together **before writing any
code**. Only start once the path is agreed.

## Every side project keeps its own CLAUDE.md

When starting a new side project, create `<project>/CLAUDE.md` with three sections:

**Exercises** — numbered steps, each with a status marker and a one-line
description of what it teaches. Mark them done as they pass.

**Failures** — bugs actually hit while building, written as *symptom → cause →
fix*. This is the most valuable section. Record them as they happen, not at the
end, and keep the ones that were embarrassing — those are the ones that recur.

**Learnings** — concepts that stuck, in plain words. Written so a cold reader
(including a future session with no memory of this one) can pick the project up.

## How to work in this repo

- **Scaffold, don't implement.** Build the surrounding app, tooling, and styling
  outright, but leave the concept under study for Mau to write.
- **One exercise at a time.** Explain the idea, let him attempt it, then review.
  Don't reveal the next step early, and don't pre-empt his attempt with code.
- **Review against what actually runs.** Verify with `curl -i` and DevTools, not
  by reading the code or looking at the UI. Several bugs here were invisible from
  the browser and obvious in the response headers.
- **Hint, don't solve.** When a review turns up a bug, first say *what* is wrong
  and roughly where — the symptom and the area to look at, not the fix. Hand over
  more specific hints only if Mau asks again. Corrected code is the last resort,
  not the opening move. Finding it himself is the point of the exercise.
- **Ask before answering.** When there's a design fork (status codes, data
  shapes), pose it as a question and ask for his reasoning first.
- **Plain language.** No filler vocabulary. Precise technical terms are good and
  worth teaching; decorative metaphors are not.
