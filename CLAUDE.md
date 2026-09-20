# claude-learning

A learning lab. Each subfolder is a self-contained side project for learning one
topic by building it from scratch. Nothing here is production code — the goal is
that Mau can rebuild each feature unaided later.

## Projects

| Project | Topic | Status |
| --- | --- | --- |
| `express-cookie-session-sliding-absolute-expiry/` | Cookie-based session auth → access + refresh tokens (Express + SPA) | Exercises 1–8 done (404 handler / request-id still open) |
| `typescript-access-refresh-tokens-handrolled-jwt/` | Access + refresh tokens, in TypeScript (Express + SPA) | Ex 0–6 done; Ex 7 (optional: rotation + reuse detection) in progress |
| `s3-presigned-post-uploads-express-vs-nest/` | S3 presigned uploads — Express+React vs NestJS+Svelte | Complete — both modules E1–E6, plus delete + storage-facade extension (Ex 7 Express, Ex 8 Nest) |
| `nestjs-graphql-prisma-nplus1-transactions-di/` | NestJS + GraphQL (code-first) + Prisma: N+1, transactions, DI | Phases 1 & 4 done (wrong-way scaffold; DI conventions + circular-dep fixes); Phase 0 (event-loop sandbox) in progress; Phases 2–3 pending |
| `observables-from-scratch-to-apollo-link/` | Observables from scratch → the production Apollo Client link chain | Lessons 1–4, 7–8 done; next — Lessons 5–6 (cold / Subject hot), then 9 (Apollo link) |
| `nestjs-outcome-routing-mfa-throttle-cors/` | NestJS auth flow: outcome routing (`decideAfterPassword`), MFA, rate limiting, credentialed CORS | Planned — not scaffolded |
| `nestjs-report-query-indexing-apollo-cache-perf/` | Full-stack NestJS + React/Apollo: slow report queries + indexing (back), cache policies + re-renders (front) | Planned — not scaffolded |
| `debounce-batch-coalesce-dedup-microtask-lab/` | Promises/async internals from scratch — debouncing (trailing-edge timers), React render batching, request coalescing/dedup; built on the same microtask + timer substrate as the `nestjs-graphql-prisma-nplus1-transactions-di` batch loader. Not yet needed in inopack; learning for depth | Scaffolded — Ex 1–4 stubbed (debounce/batch/coalesce/dedup), pending Mau |
| `bash-command-dispatcher-from-scratch/` | Bash CLI: rebuild the `inopack` multi-repo git-workflow dispatcher from scratch (reference snapshot bundled). Teaches arg parsing, `case`/`exec`, sourcing helpers, idempotent rc-file edits, git plumbing | Scaffolded — reference bundled, curriculum agreed (E1–E8 + bonus); E1 (dispatcher) next, pending Mau |

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
description of what it teaches. Mark them done as they pass. Use one marker set
across every project: **✅ done**, **🚧 in progress**, **⬜ not started**.
(GitHub-style `- [x]` / `- [ ]` checkboxes are fine for sub-tasks *within* an
exercise — that's a separate device from the exercise's own status marker.)

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
- **Review statically; Mau runs the code.** Read the code and reason about it —
  don't start the server, run `curl`, or otherwise execute the project to answer
  a question. When a runtime check would genuinely settle something, *propose*
  it: say what to run and what each outcome would prove, then let Mau run it and
  report back. Running it for him costs tokens and takes away the half of the
  exercise where he learns to interrogate a live system.
- **Runtime checks still decide the truth.** `curl -i` and DevTools are what
  confirm a fix — several bugs here were invisible from the browser and obvious
  in the response headers. That verification just happens on Mau's side.
- **Offer alternatives and teach, don't just approve.** Mau is here to
  understand every line, not just pass the exercise. On every review, even when
  his answer already works: name the idiomatic pattern, surface other viable
  approaches with their trade-offs, correct loose terminology, and flag
  duplicated/unnecessary logic and code-organization improvements (he keeps files
  under ~200 lines). Say which option you'd pick and why — a menu, then a
  recommendation.
- **Hint, don't solve.** When a review turns up a bug, first say *what* is wrong
  and roughly where — the symptom and the area to look at, not the fix. Hand over
  more specific hints only if Mau asks again. Corrected code is the last resort,
  not the opening move. Finding it himself is the point of the exercise.
- **Ask before answering.** When there's a design fork (status codes, data
  shapes), pose it as a question and ask for his reasoning first.
- **Plain language.** No filler vocabulary. Precise technical terms are good and
  worth teaching; decorative metaphors are not.
