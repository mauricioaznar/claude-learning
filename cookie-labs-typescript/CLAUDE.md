# Cookie Labs (TypeScript)

A from-scratch rebuild of the `cookies/` lab, in TypeScript, going straight to
**access + refresh tokens**. Repetition on purpose: the concepts are the same as
`cookies/` Exercise 8, rebuilt from a cleaner base so Mau can produce them unaided.

- **Server** and **client** are both TypeScript.
- **Mau writes** the Express server (`src/server/server.ts`) and the token
  functions (`signToken` / `verifyToken`, hand-rolled with `node:crypto` — no
  `jsonwebtoken`).
- **Scaffolded** (not the learning target): TS tooling, the DB pool (`db.ts`),
  the page shell (`public/`), and the client views (`src/client/app.ts`).

## Running it

```
npm install
npm run dev
```

`npm run dev` runs two watchers side by side (via `concurrently`):
- **server** — `node --watch --env-file=.env --import tsx src/server/server.ts`
  (tsx compiles the `.ts` at run time; `--watch` restarts on save; `--env-file`
  loads `.env`).
- **client** — `tsc --watch` compiles `src/client/app.ts` → `public/app.js`.

Then open the port the server logs (pick one in Ex 0; the old lab used 3000).
Log in with `mau` / `hunter2`. Needs a running MySQL and a `cookie_labs_ts`
database (see `.env`); `schema.sql` creates the tables and seeds the users on boot.

## Structure & conventions

**`server.ts` is configuration only.** It wires the app together and starts it —
middleware, static serving, schema-on-boot, `listen`, the error handler. It holds
**no route logic**. If `server.ts` is deciding *what a request does*, that belongs
in `routes/` or `middlewares/` and gets mounted/`use`d from `server.ts`.

Everything lives in a folder by role:

```
src/server/
  server.ts       app setup: middleware wiring, static, schema boot, listen, error handler
  db.ts           the MySQL pool
  routes/         route modules (one per feature area), mounted in server.ts
  middlewares/    reusable middleware — auth, ...
  helpers/        pure helpers with NO req/res — signToken, verifyToken, cookie/token utils
```

**Helpers never touch `req`/`res`.** They take plain values and return plain
values, so they're reusable from any route and testable without a fake request.
`signToken(userId, …)` returning a string is a helper; a thing that reads
`req.headers` and calls `res.status()` is middleware. Keep the boundary sharp —
that separation is *why* a helper can be reused, and mixing `req` into one is how
it stops being reusable.

## Exercises

### Phase 0 — Express under TypeScript

#### 0 — minimal server, compiling and running ✅
Write `src/server/server.ts`: read + run `schema.sql` on boot, serve the SPA from
`public/`, add one health route, listen and log the URL. No token routes yet.

**TypeScript setup notes** (the part that's new vs the JS lab — concepts, so you
write the code):

- **`@types/*` packages are the types, shipped separately.** `express`,
  `cookie-parser`, and Node itself are plain JS; the hand-written type
  definitions live in `@types/express`, `@types/cookie-parser`, `@types/node`
  (all in `devDependencies`). Install them and imports like `import express from
  "express"` become fully typed. Miss one and you get "could not find a
  declaration file" — that's the signal a `@types/x` is absent.
- **`req` and `res` are typed by inference.** Write `app.get("/x", (req, res) =>
  …)` and `@types/express` already types both — you rarely annotate them by hand.
  When you *do* need the names (a helper that takes `res`), import them:
  `import type { Request, Response, NextFunction } from "express"`.
- **`import type`** pulls in something used only as a type; it's erased at compile
  time and never emits a runtime import. Use it for `Request`/`Response` and for
  the row shapes you'll define.
- **The dev loop** is `.ts` → tsx (run time) with no build artifact for the
  server; the client is the one thing that *emits* (`tsc` → `public/app.js`),
  because browsers can't run `.ts`.
- **Two tsconfigs on purpose.** `tsconfig.server.json` has Node types and no DOM;
  `tsconfig.client.json` has the DOM and no Node. A `document` in server code or a
  `process` in client code is then a *type error*, not a run-time surprise.
- **Module resolution is `Bundler`** (see base `tsconfig.json`), so relative
  imports need no `.js` extension — `import { pool } from "./db"` just works.
  (Under `NodeNext` you'd have to write `"./db.js"`; we sidestep that.)
- **Reading `schema.sql`** — resolve its path relative to this file. In an ES
  module there's no `__dirname`; use `import.meta.dirname` (Node 20.11+) or derive
  it from `import.meta.url`. Read the file, pass it to a pool query
  (`multipleStatements` is already on in `db.ts`).
- **`process.env.X` is typed `string | undefined`.** TypeScript will make you deal
  with the "missing" case — good, since a missing secret should fail loudly.

### Phase 1 — access token, no refresh yet

#### 1 — `signToken` / `verifyToken` by hand ⬜
A JWT is just `base64url(header).base64url(payload).base64url(HMAC-SHA256)`.
`signToken(...)` builds it; `verifyToken(token)` splits on `.`, recomputes the
HMAC over the first two segments, **constant-time**-compares it
(`crypto.timingSafeEqual`, length-guarded so it can't throw), checks expiry, and
returns the payload or a single falsy value on any expected failure.

#### 2 — login mints an access token ⬜
`POST /api/login` validates credentials against `users`, mints a short-TTL access
token (~10s so expiry is observable), returns it in the JSON body. Client holds it
in memory and sends `Authorization: Bearer <token>` via an `authedFetch` wrapper.

#### 3 — `auth` middleware + protected `/api/me` ⬜
Middleware reads the Bearer header, `verifyToken`s it, sets `req.user`; `/api/me`
is guarded by it and the dashboard renders from it. Logout here is just the client
dropping the token — there's nothing server-side to revoke yet. **Sit with that
seam:** the token expires in ~10s and you have no way back to a valid one. That
missing piece is exactly what Phase 2 adds.

### Phase 2 — refresh token

#### 4 — the `sessions` table (the refresh token) ⬜
Add `sessions` to `schema.sql`. Login also creates a session and sets an httpOnly
**signed** refresh cookie scoped to `/api/refresh`, with an absolute expiry.

#### 5 — `POST /api/refresh` ⬜
Read the refresh cookie, check the session (delete + 401 on expiry), mint a fresh
access token, return it in the body. The revocable reference token backs the fast
self-contained one.

#### 6 — client refresh-and-retry + single-flight ⬜
`authedFetch`: on a 401, refresh once then retry the original request. Collapse
concurrent 401s onto one `/api/refresh` with a single-flight promise. Logout now
`DELETE`s the session.

#### 7 (optional) — rotation + reuse detection ⬜
Each refresh issues a new refresh token and deletes the old; a replayed old token
means theft → revoke the family.

## Failures

*symptom → cause → fix. Record them as they happen — this is the section that pays
off. TypeScript will catch some of the JS lab's bugs at compile time (the
`session.expiresAt` vs `expireAt` typo, the wrong-arity finder calls); note which
ones it caught, because that contrast is the point of redoing this in TS.*

## Learnings

*Concepts that stuck, in plain words, written for a cold reader.*
