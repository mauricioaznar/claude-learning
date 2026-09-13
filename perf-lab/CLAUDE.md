# Perf Lab (full-stack)

**Status: planned — not scaffolded.** This file exists to hold the lab's
review-to-understand TODO and its intended scope. When starting the lab, ask Mau
for the INOPACK snippets (one heavy summary/report resolver + its Prisma query,
and the Apollo Client `typePolicies` / cache config) and agree the exercise path
**before writing any code**.

Full-stack on purpose: a NestJS + Prisma backend and a React + Apollo frontend in
one lab, so one slow report is traceable end-to-end — from the DB query, through
the resolver, to the rendered component and its re-renders. Note the overlap with
`observable-lab/` (the Apollo Client link chain); re-audit against it before
building the frontend half so the Apollo material isn't duplicated.

## Intended scope

- **Backend** — the heavy summary/report queries: where the time goes (EXPLAIN),
  indexing, query shape.
- **Frontend** — Apollo cache policies, memoization, and re-render behavior; where
  frontend caching actually helps and where it doesn't.

## Prod reference — review-to-understand

(INOPACK; tech debt; hands-on lab, not a code task): production performance — the
heavy summary/report queries on the GraphQL backend, and cache optimization on the
React frontend (Apollo cache policies, memoization, re-render behavior). Goal:
understand where time goes server-side and where frontend caching actually helps.

## Exercises

_(TBD — agreed once the INOPACK snippets are in hand.)_

## Failures

_(symptom → cause → fix; recorded as they happen)_

## Learnings

_(plain-words concepts that stuck; written for a cold reader)_
