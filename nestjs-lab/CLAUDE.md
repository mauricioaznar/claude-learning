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

### Phase 3 — transactions ⬜ (Mau writes the fix)

Make `createBookWithReviews` throw on the 3rd review; see the orphaned book. Wrap
in `prisma.$transaction`; prove the rollback. Add a second service whose writes
join the SAME transaction by threading `Prisma.TransactionClient`; see the bug if
you forget to pass `tx`.

### Phase 4 — DI conventions ⬜ (Mau writes the fix)

Export the SERVICE not the resolver; delete dead exports; move the shared service
into one `SharedModule` that exports it. Explain what `exports` means and why
re-declaring a provider makes a new instance. Then introduce a circular
dependency and fix it three ways (extract a third service / `forwardRef` /
which is better).

## Failures

_(symptom → cause → fix; recorded as they happen)_

- none yet.

## Learnings

_(plain-words concepts that stuck; written for a cold reader)_

- none yet.
