# Auth improvements — refresh tokens, throttling, TOTP MFA

Category: Platform
Summary: COMPLETE — shipped to prod 2026-09-11 (0–1.7 + Phase 2 throttling/lockout + Phase 3 email MFA all live; MFA enforcing + email delivery verified).

**✅ COMPLETE — SHIPPED TO PRODUCTION 2026-09-11.** Phase 2 (per-IP login/refresh
throttling + per-account lockout, unified failure message, trust-proxy) and Phase 3
(email one-time-code MFA, per-user enforce flag, forced-password-change gate, root /
login-disable flags) reached prod via `dev → master` on 2026-09-11 (graphql `7.42.0`,
react `4.42.0`; the three `1789…` migrations applied non-destructively). **Verified on
prod:** root login on the migrated `administracion@grupoinopack.com` id=1 account, and a
real `mfa_enabled=1` account received its verification code by email end-to-end. Sender
identity is `no-reply@grupoinopack.app` on a Mauricio-controlled domain (Netlify DNS) with
`dkim=pass (d=grupoinopack.app)` + aligned SPF (option 1, independent of Neubox). Stage was
rehearsed first (nginx `.bak` cleanup, §3/§4/§8 passes, mail-identity switch). Feature
branch dropped 2026-09-11. **Residual, non-blocking:** §2 throttle + §7 cross-origin/WS
durability were verified locally only (never re-run on stage); the Phase-1 time-based soak
(A.4 silent access-token expiry, B past-TTL reconnect, E long-idle) remains accepted risk
to watch in prod. Everything below is retained as historical planning detail.

Status: **PHASES 1.5 AND 1.6 CODE COMPLETE, NEITHER ACCEPTED; PHASE 1.7 PLANNED
(2026-07-30)** on `feature/authentication-mfa`. All nine Phase 1.5 findings are
implemented, and a static review of that diff produced four more, scoped as
**Phase 1.6 below**; all four are now implemented too. **Phase 1.7** — structured
application logging, no schema change — was scoped on 2026-07-30 and ships with
the same unit. The test that called the deleted GraphQL `login`
mutation is gone, so the backend suite should be runnable again for the first time
since 1.5.6 — **that has not been confirmed by a run.** Nothing in either phase is
verified: every acceptance criterion needs a test run or a browser, and none have
happened. The `CORS_ORIGINS` server prerequisite is also still pending.
**Phase 2 does not begin until Phases 0–1.6 are running in production** — see
[Rollout and sequencing](#rollout-and-sequencing) below, which replaces the
earlier "build all four phases locally first" policy.
Phase 1 deviated from this document in six places — the grace window for refresh
reuse, the cookie path, a public logout route, no `cookie-parser`, the retained
terminal reload, and the still-present GraphQL `login` mutation — each recorded with
its reason in the feature document. Phases 2–3 still planned. See
[features/ongoing/feature-authentication-mfa.md](../../features/ongoing/feature-authentication-mfa.md)
for what shipped and the deployment prerequisites. Adapted from an external plan to
the actual codebase. Grounded in `nestjs-inopack-graphql/src/modules/auth/` (resolver,
service, guards, strategies) and
`react-inopack/src/services/apollo/init-apollo-client.ts` +
`src/app/app/authorization-wrapper/`.

Receipt taxation and classification constants were moved to database-backed
metadata on 2026-07-23. The hardcoded JWT secret remains an auth-specific
configuration problem covered by Phase 0 below.

## Rollout and sequencing

Set by Mauricio on 2026-07-28, extended to include Phase 1.7 on 2026-07-30. This
**replaces** the earlier policy that all four phases would be built and tested
locally before anything shipped. Phases 0–1.7 now go all the way to production
as one unit, and Phase 2 is not started until they are there.

**Why 1.7 joins the unit rather than waiting.** The reason for freezing the unit
was that a rewritten auth path had never run in production and should not carry
additional unverified change. 1.7 adds no migration, no schema change and no
behaviour change — it observes the auth path and writes stdout, so it does not
add a failure mode to what is being shipped. The single exception is the
rotation refactor in §1.7.6, which is why that section carries the constraint
that the three Phase 1.6 race tests must pass unmodified.

The order is strict — each step begins only when the previous one is finished:

1. **Local verification.** Work through the outstanding acceptance criteria for
   Phases 0, 1, 1.5, 1.6 and 1.7 together: the backend suite (twice
   consecutively, no rebuild between), the red-first and mutation checks on the
   Phase 1.6 race tests, typecheck/lint on both repos, and the browser checks.
   Deliberately not done on 2026-07-28 — the code is being read first.
2. **Approval.** Mauricio accepts the feature. Until then nothing moves.
3. **Ship to `stage`.** ⚠️ The **deployment prerequisites must be set on the
   staging server before the first push**, not after — staging redeploys on
   every push to `stage`, and a missing `JWT_ACCESS_SECRET` stops the API
   booting while a missing `CORS_ORIGINS` breaks the frontend outright. The full
   list is in the feature document.
4. **Extended manual testing on `stage`.** Many manual runs, until it is
   demonstrably stable. This is where the auth change earns its confidence:
   the failure modes that matter here — a refresh cookie the browser silently
   drops, a session that does not survive a reload, subscriptions that stop
   after an idle period — are cross-origin and time-dependent, and are the
   reason a local suite is not sufficient evidence on its own.
5. **Ship to production.**
6. **Only then, begin Phase 2.** Throttling and lockout are not started before
   the refresh-token work is live.

Why this order, given Phase 2 does not depend on 1.6's code: the coupling is in
the *evidence*, not the source. Phase 2's acceptance criteria are all test-run
criteria, and Phase 2 changes the login path — throttling it per IP and adding
per-account lockout — which is the same surface Phases 0–1 rewrote. Stacking
that on top of an auth change that has never run in production means any
incident afterwards has two candidate causes instead of one.

## Current state (what exists today — differs from the original plan's assumptions)

- **Login is a GraphQL mutation**, not REST: `login(loginInput)` in `auth.resolver.ts`
  (marked `@Public()`). A REST `POST /auth/login` also exists in `auth.controller.ts`
  (plus an odd `GET /auth/users`) — effectively duplicate/legacy surface.
- **Token:** single JWT, TTL **43200s = 12h**, signed with the **hardcoded** secret
  `'secretKey'` in `src/common/constants/jwt.ts` (same file also holds `fileSecret`
  used by the files module and `memory-token` service). Payload = the **entire user
  row** (password stripped) including `user_roles`.
- **Passwords: bcrypt** (`bcrypt.compare`), with a Laravel-era `$2y$` → `$2a$` prefix
  rewrite for legacy hashes. Not argon2 — and that's fine (see adaptations).
- **Guards:** `GqlAuthGuard` (passport-jwt) + `GqlRolesGuard` applied globally via
  `app.module.ts`; `@Public()` opt-out exists. `jwt.strategy.ts` returns the raw
  payload as `req.user`.
- **Frontend:** token in **localStorage** (`login-form.tsx` sets it, then
  `window.location.reload()`). Apollo `authLink` reads localStorage per request; the
  **WebSocket** client (`graphql-ws`) sends the same token in `connectionParams` at
  connect time. `errorLink` on UNAUTHENTICATED: toast "Sesión expirada", drop the
  token, reload the page after 2s — no refresh/retry.
- **No** refresh tokens, no rate limiting, no lockout, no MFA.
- 🐞 **Bug found while surveying:** `AuthService.validateUser` does **not** filter
  `active = 1` — a soft-deleted/deactivated user can still log in. Fix in Phase 0.

## Phase 0 — Quick wins (independent of everything else) — ✅ DONE 2026-07-28

1. Move `authSecret`/`fileSecret` to env vars (`JWT_ACCESS_SECRET`, `JWT_FILE_SECRET`)
   read in `src/common/constants/jwt.ts`; keep the constants file as the single access
   point so call sites don't change. Fail fast at boot if unset in production.
2. `validateUser`: add `active: 1` to the `where`.
3. Slim the JWT payload to `sub` (user id), `email`, and role ids — not the whole user
   row. `jwt.strategy.ts#validate` and `@CurrentUser` consumers read `id`/`email`
   today via the spread payload; adjust `currentUser` resolver (it re-fetches by email
   anyway) and `GqlRolesGuard` (verify what it reads from `req.user`).
4. Decide the fate of the legacy REST controller (`POST /auth/login`, `GET
   /auth/users`): keep `/auth/*` REST only for the new cookie endpoints (Phase 1) and
   delete the legacy routes if nothing consumes them.

## Phase 1 — Refresh tokens

### 1.1 Database

New table `refresh_tokens` — **TypeORM-style migration** in
`nestjs-inopack-graphql/src/db/migrations/` (raw SQL via `queryRunner.query`, like
`1783708800000-AddExcludeFromFinancialSummaries.ts`), then mirror in
`prisma/schema.prisma` + `npm run db:generate`.

| column | type | notes |
|---|---|---|
| `id` | INT UNSIGNED AUTO_INCREMENT PK | house convention — not UUID |
| `user_id` | INT UNSIGNED, FK → users.id | index |
| `token_hash` | CHAR(64) | SHA-256 hex of the raw token; never store the raw token |
| `family_id` | CHAR(36) | UUID shared across rotations of one session; index |
| `expires_at` | DATETIME | now + 14 days |
| `revoked_at` | DATETIME NULL | set on rotation, logout, theft detection |
| `created_at` / `updated_at` | DATETIME NULL | house convention |
| `user_agent` | VARCHAR(255) NULL | future "active sessions" UI |
| `ip` | VARCHAR(45) NULL | |

No `active` soft-delete column needed — `revoked_at`/`expires_at` carry the state.

**Passwords stay bcrypt.** The original plan's argon2id migration is dropped: bcrypt
is not weak, the `$2y$` legacy-compat rewrite must keep working for old Laravel
hashes, and churning the hash algorithm buys little here. (Optional later: lazy
re-hash to a higher cost factor on successful login.)

### 1.2 Token strategy

- **Access token:** JWT, ~15 min TTL (`JWT_ACCESS_TTL=15m` env), slim payload
  (Phase 0.3). Sent as `Authorization: Bearer` exactly as today — `GqlAuthGuard` and
  the WS context factory keep working unchanged.
- **Refresh token:** opaque crypto-random 64 bytes base64url — not a JWT. Stored
  hashed. Delivered only as a cookie: `httpOnly; Secure; SameSite=Strict;
  Path=/auth/refresh; Max-Age=14d`.
- ⚠️ **Cross-origin check before coding:** frontend (`:3000` dev / Netlify prod) and
  API (`:3008`) are different origins. `localhost` different-ports is same-site, so
  dev works with `SameSite=Strict`; **verify the production domains** — if app and
  API don't share a registrable domain, the cookie needs `SameSite=None; Secure` and
  CORS `credentials: true` with the explicit origin (no wildcard). Check
  `main.ts` `enableCors` config at implementation time.

### 1.3 Backend

Extend the existing `src/modules/auth/` module — no new module:

- `auth.service.ts` additions:
  - `issueTokenPair(userId, familyId?)` — access JWT + refresh row. New login ⇒ new
    `family_id`; rotation ⇒ same family.
  - `rotateRefreshToken(rawToken)` — hash, look up; missing/expired ⇒ 401; **already
    revoked ⇒ theft: revoke whole family, 401**; valid ⇒ revoke old row, issue new
    pair.
  - `revokeFamily(familyId)`, `revokeAllForUser(userId)`.
- `auth.controller.ts` — the cookie endpoints live here (REST is right for cookies;
  the fixed `Path` scoping needs a stable URL):
  - `POST /auth/login` (`@Public()`) — validate → set refresh cookie → `{ accessToken }`.
  - `POST /auth/refresh` (`@Public()`) — read cookie → rotate → set cookie → `{ accessToken }`.
  - `POST /auth/logout` — revoke family, clear cookie.
- The GraphQL `login` mutation **cannot set an httpOnly cookie portably** through the
  upload link — the frontend switches to the REST login endpoint. Keep the mutation
  temporarily for the grace period, then delete it.
- Enable `cookie-parser` in `main.ts`.
- Env: `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL=15m`, `REFRESH_TTL_DAYS=14`.

### 1.4 Frontend (react-inopack)

- Access token: **in-memory module variable** (e.g. `src/services/auth/token.ts`) —
  remove localStorage usage. `authLink` reads the variable.
- **WebSocket:** `connectionParams` is already a function evaluated per (re)connect —
  point it at the in-memory getter. An open socket keeps working after the access
  token expires (the server validates only at `connection_init`); on **reconnect**
  the retry must first await a fresh access token — make `connectionParams` async and
  call the single-flight refresh there.
- `errorLink`: replace the current "toast + reload" with silent refresh + retry
  (forwarded observable). **Single-flight:** one shared module-level promise;
  concurrent 401s await it. Refresh fails ⇒ clear state, show "Sesión expirada"
  (existing toast), send to login.
- `refreshAccessToken()` — `fetch('<api>/auth/refresh', { method: 'POST',
  credentials: 'include' })`.
- Bootstrap: `AuthorizationWrapper` calls `refreshAccessToken()` once before
  rendering the app (loading gate) to restore the session on reload. 401 = "not
  logged in", no error UI. ⚠️ Preserve the `isInitialLoading = loading && !data`
  guard — see docs/subscription-reconnect-fix.md; do not reintroduce the
  SubscriptionsProvider unmount bug.
- `login-form.tsx`: POST to REST login, store token in memory, drop the
  `window.location.reload()` (set auth state instead).
- Logout: `POST /auth/logout` with credentials, clear memory, `client.resetStore()`.

### 1.5 Migration path

Small user count: ship, and legacy 12h localStorage tokens simply die at expiry (or
immediately if the secret is rotated when moving to env) — users log in again once.

### Phase 1 acceptance criteria

- [x] Access token expires in 15 min; app keeps working past expiry (silent refresh + retry, no reload).
- [x] Page reload restores the session without the login screen.
- [ ] ⚠️ **Fixed in Phase 1.5 item 2, not yet verified.** Subscriptions survive token expiry and reconnect with a fresh token.
- [x] Refresh cookie is never readable from JS and never sent on `/graphql`.
- [x] Reusing a rotated refresh token kills the whole family.
- [ ] ⚠️ **Fixed in Phase 1.5 items 4 and 5, not yet verified.** Logout invalidates server-side.
- [x] Deactivated (`active != 1`) users cannot log in.

Items marked `[x]` are implemented; the browser-level confirmations are still
outstanding and are tracked in the feature document, not here.

## Phase 1.5 — Correctness fixes before Phase 2

Status: **CODE COMPLETE, VERIFICATION PENDING (2026-07-28).** Scope agreed with
Mauricio after an external review of the Phase 1 diff. All nine items are
implemented; see the feature document for what each one changed and where it
deviated. Item 1 blocked the test suite outright; items 2–6 were the "must" tier;
items 7–9 "should, same phase".

The item text below is kept as written — it is the record of *why* each change was
made, and it is more detailed than the implementation notes that replaced it.

Every finding below was verified against the code, not taken on faith. Two review
claims were **rejected or reduced** — read *What not to do* at the end before
starting, so effort does not go where it is not needed.

Branch: `feature/authentication-mfa` (same branch; this is not a new feature).

### 1.5.1 — `refresh_tokens` breaks the next test run  ⛔ blocking

**File:** `nestjs-inopack-graphql/src/common/__tests__/helpers/setup-database.ts`

Jest's `globalSetup` deletes every table in dependency order and ends with
`users.deleteMany()` (line 54). `refresh_tokens` is not in that list, and its FK
(`refresh_tokens_user_id_foreign`) has no `ON DELETE` clause, so MySQL defaults to
`RESTRICT`. The first run after a `db:test:rebuild` passes because the table is
empty; the auth tests then leave rows behind, and the **next** run fails in global
setup with a foreign-key error before a single test executes.

**Fix:** add `await prismaService.refresh_tokens.deleteMany();` to the `// level 4`
block, next to `user_roles.deleteMany()` — i.e. anywhere above line 54. One line.
This is exactly the pattern every other user-referencing table already follows.

**Verify:** run `npm run test` **twice in a row** without rebuilding the database in
between. Both runs must be green.

### 1.5.2 — WebSocket reconnect presents an expired token  ⛔ blocking

**Files:** `react-inopack/src/services/auth/access-token.ts`,
`react-inopack/src/services/apollo/init-apollo-client.ts`

`connectionParams` is `async` and awaits `ensureAccessToken()`, which looks
compliant but is not: `ensureAccessToken` returns whatever token is in memory
without ever inspecting its `exp`. HTTP traffic is self-healing (401 → `errorLink`
→ refresh → replay), but **subscriptions bypass `errorLink` entirely**. An idle tab
whose socket drops after the 15-minute expiry reconnects with the dead token, the
per-operation `GqlAuthGuard` rejects each subscription, and the socket stays open
presenting the same dead token — subscriptions silently stop until some HTTP query
happens to refresh. This is the plan's own §1.4 requirement ("on **reconnect** the
retry must first await a fresh access token") only half-delivered.

**Fix:** track expiry in `access-token.ts`.

- In `adoptToken`, decode the JWT's middle segment (`atob` + `JSON.parse`) and
  store `exp * 1000` in a module variable. This is a **scheduling hint, not a trust
  decision** — the server is still the only thing that validates the token, so
  client-side decoding is safe here.
- If the token cannot be decoded, store `null` and treat expiry as *unknown*, which
  must mean "assume valid". Treating it as expired would refresh on every single
  request.
- `ensureAccessToken()` refreshes when the token is missing **or** expires within a
  small skew (30s is fine). Keep the `sessionKnownDead` short-circuit ahead of it.

This also improves HTTP: `authLink` starts refreshing pre-emptively instead of
waiting for a 401 round trip.

**React build trap:** this repo targets es5 without `downlevelIteration` — no
spreading of `Map`/`Set` iterators (see `docs/memory/project_react_build_traps.md`).
Plain string/JSON work only.

**Verify:** set `JWT_ACCESS_TTL=1m` locally, open a page with a live subscription,
leave it idle past expiry, force a reconnect (DevTools offline/online toggle), and
confirm the subscription resumes without a reload.

### 1.5.3 — Only 401 may invalidate a session  ⛔ blocking

**Files:** `nestjs-inopack-graphql/src/modules/auth/auth.controller.ts` (refresh),
`react-inopack/src/services/auth/access-token.ts`

Highest blast radius of the whole review. Both sides currently treat *any* failure
as "your session is over":

- The controller's `catch` clears the refresh cookie for **every** exception, so a
  transient database error deletes the user's cookie. That is not "retry in a
  moment" — it is permanently logged out.
- `refreshAccessToken()` marks `sessionKnownDead = true` on **any** non-2xx, so a
  500 triggers the terminal "Sesión expirada" + reload path.

A five-second database blip therefore logs out everyone whose token happened to be
refreshing.

**Fix:**

- Controller: clear the cookie only when the caught error is an
  `UnauthorizedException` (or, equivalently, `HttpException` with status 401). Let
  everything else propagate untouched as a 500, cookie intact.
- Frontend: `sessionKnownDead = true` only for 401 and 403. Any other non-2xx is
  handled like the existing network-error branch — clear the in-memory token,
  leave the session alive and retryable, do **not** call `endExpiredSession`.

**Verify:** stop MySQL, trigger a refresh, confirm the user is not logged out and
recovers once the database returns.

### 1.5.4 — Logout can be undone by an in-flight rotation  ⛔ blocking

**File:** `nestjs-inopack-graphql/src/modules/auth/auth.service.ts`
(`rotateRefreshToken`)

Rotation reads the row, validates it, then revokes it and inserts a successor as
separate statements. If `logout` revokes the family *between* the read and the
insert, rotation inserts a **live row into a dead family** and the logged-out
session comes back. This is the same class of bug the grace window's
"family must still have a live token" condition was written to prevent — that door
was closed and this one left open. It breaks the acceptance criterion *"Logout
invalidates server-side."*

**Approved fix: the cheap one — a conditional update, no transaction.** Replace the
unconditional `revokeToken(stored.id)` (`prisma.update`) with:

```ts
const { count } = await this.prisma.refresh_tokens.updateMany({
    where: { id: stored.id, revoked_at: null },
    data: { revoked_at: now, updated_at: now },
});
```

`count === 1` means this request won the race and may proceed.

**⚠️ Do not simply 401 when `count === 0`.** That would break the legitimate
two-tab case the grace window exists for: the losing tab would be told its session
is dead. On `count === 0`, re-read the row and run **the same decision the grace
path already makes** — reuse is benign only if it is within
`refreshReuseGraceSeconds` **and** the family still has a live, unexpired token.
After a concurrent rotation the family has a live successor, so the loser falls
through and gets its own pair. After a logout the family has no live row, so it
correctly 401s.

Extract that decision into one private helper used by **both** the existing
`stored.revoked_at` branch and this new lost-the-race branch, so the two can never
drift apart.

**Known residual, deliberately accepted:** a small window remains between the
liveness check and the `create`. Closing it fully needs a transaction with a row
lock (`SELECT … FOR UPDATE`). Mauricio chose the cheap fix; revisit only if this
ever actually bites.

> ⚠️ **This note was wrong and is withdrawn — see Phase 1.6 item 1.** The residual
> is not confined to the liveness check on the losing path; it sits between the
> **revoke** and the **create** on the *winning* path, which every successful
> rotation takes. The decision to accept it was made on this description, so it is
> reopened rather than overridden.

**Tests to add** (`auth.service.test.ts`): a rotation whose token is revoked by a
concurrent `logout` before the insert must not produce a live token — assert the
family has zero live rows afterwards.

### 1.5.5 — Logout failure is reported as success  ⛔ blocking

**Files:** `react-inopack/src/services/auth/access-token.ts` (`logoutSession`),
`react-inopack/src/app/app/inopack-drawer/inopack-drawer.tsx`

`logoutSession()` ignores the HTTP status and swallows network errors, then always
clears local state; the drawer then reloads unconditionally. JavaScript cannot
clear an httpOnly cookie, so if the server call did not actually happen the cookie
survives and the bootstrap refresh restores the session moments later — the user
was told they logged out and did not.

**Fix:** have `logoutSession()` report success (return a boolean or throw). The
drawer reloads only on success; on failure show a Spanish error toast (existing
`pushMessage` pattern, e.g. *"No se pudo cerrar la sesión, intenta de nuevo"*) and
do **not** reload. Keep the in-memory token on failure so the user is left in a
working session rather than a half-broken one.

### 1.5.6 — Delete the GraphQL `login` mutation  ⛔ blocking (before Phase 2)

Nothing calls it since the Phase 1 cutover, and Phase 2 applies login throttling to
the **REST** route — leaving this mutation in place is an unthrottled way around
the rate limit, defeating a Phase 2 acceptance criterion before it is written.

Remove, in this order:

1. `react-inopack/src/auth.gql` — the `mutation Login` block.
2. `react-inopack`: `npm run codegen` (regenerates
   `src/services/apollo/inopack-graphql-schema.ts`; the generated `useLoginMutation`
   disappears with it).
3. `nestjs-inopack-graphql/src/modules/auth/auth.resolver.ts` — the `login`
   mutation and its now-unused imports (`AccessToken`, `LoginInput`, `Public` if
   nothing else in the file uses them — check).
4. `auth.service.ts` — `AuthService#login`. Keep `loginWithCredentials`.
5. `auth.dto.ts` — the `AccessToken` `@ObjectType` if nothing else references it.
   `LoginInput` **stays**: the REST controller still uses it as a type.

`schema.gql` is generated at boot (`autoSchemaFile`), so it needs no manual edit.

### 1.5.7 — Pin `NODE_ENV=production` in the Docker image

**File:** `nestjs-inopack-graphql/Dockerfile`

The image sets no `NODE_ENV`, and both GitHub Actions workflows start the container
with `--env-file` only. Two protections silently depend on that file being right:
the boot failure on a missing JWT secret (without it the API quietly falls back to
the development secret that is public in this repository) and the
`SameSite=none; Secure` cookie default (without it the cookie is dropped cross-site
and logins never persist, with nothing in the logs).

**Fix:** add `ENV NODE_ENV=production` to the **runtime stage only** — after the
`npx prisma generate` on line 28, before `EXPOSE`. **Not in the builder stage**,
where it would change `npm ci` behaviour during the build. A server env file can
still override it deliberately.

### 1.5.8 — Origin check on the cookie endpoints (CSRF)

**File:** `nestjs-inopack-graphql/src/modules/auth/auth.controller.ts`

Production uses `SameSite=None`, so a cross-site POST carries the refresh cookie. A
cross-site form POST is a *simple request*: no preflight, and CORS only stops the
attacker **reading** the response — it does not stop the request executing. So any
site can force-log-out a logged-in user (`/auth/logout` takes no body at all), and
`/auth/login` is open to the same trick (Nest parses urlencoded bodies by default),
giving session fixation. Tokens cannot be stolen this way, so this is
nuisance-to-moderate — but the fix is small.

**Fix:** validate the `Origin` header against the CORS allowlist on all three
routes. Reject with 403 when `Origin` is **present and not allowlisted**; allow when
it is **absent** (non-browser callers — curl, tests, server-to-server — send none,
and browsers always send it on cross-origin POSTs).

`corsOrigins()` currently lives as a private function in `src/main.ts`. Extract it
to a shared module (e.g. `src/common/constants/cors.ts`) so `main.ts` and the guard
read one list.

### 1.5.9 — Sweep every stored password key

**File:** `react-inopack/src/app/app/authorization-wrapper/login-form.tsx`

The Phase 1 cleanup removes `LoginForm.name + '_Password'`, but CRA's production
build mangles function names (terser `keep_fnames` is off outside profiling
builds), and the mangled name is not guaranteed stable across builds. A password
persisted by an earlier deploy may sit under a different key and never be removed.

**Fix:** on mount, iterate `window.localStorage` by index and remove every key
ending in `_Password`. Collect the keys first, then remove — removing while
iterating shifts the indices. Plain `for` loop over `localStorage.length` /
`localStorage.key(i)`; no iterator spreading (es5).

### Phase 1.5 acceptance criteria

Every one of these needs a test run or a browser, so all nine are **implemented and
unverified**. The verification steps live in the feature document.

- [ ] `npm run test` passes **twice consecutively** without a database rebuild.
- [ ] A subscription survives access-token expiry across a reconnect.
- [ ] A backend 500 during refresh does not log the user out.
- [ ] ⚠️ **Not met — see Phase 1.6 item 1.** A logout concurrent with a rotation
      leaves zero live tokens in the family.
- [ ] A failed logout tells the user so and does not falsely reload.
- [ ] The GraphQL `login` mutation no longer exists in either repo.
- [ ] The runtime image reports `NODE_ENV=production` with no server env file.
- [ ] A cross-origin POST to `/auth/logout` is rejected.
- [ ] No `*_Password` key survives in localStorage after loading the login screen.

### What not to do

Two review claims were checked and **should not** drive work:

- **"Watch-mode reruns need an idempotency strategy."** True, but **pre-existing and
  unrelated to Phase 1**: every test in the suite already creates fixed unique
  emails, and `globalSetup` runs once per Jest process, so pressing `a` twice
  already failed before refresh tokens existed. Do not fold a suite-wide redesign
  into 1.5.
- **"Two concurrent refreshes create separate successors."** Real but **harmless** —
  both successors are live and belong to the same family and the same session.
  Only the *logout* half of that finding (1.5.4) is a defect. Do not add machinery
  to prevent duplicate successors.

### Explicitly out of scope for Phase 1.5

Tracked separately, not part of this branch's auth work:

- `scripts/db-schema-dump.js`: truncates the tracked `db/schema.sql` with mode `'w'`
  before `mysqldump` has proven it can succeed, and only drops its fixed-name
  scratch database on the happy path. Wants a unique scratch name, `try/finally`
  cleanup, and atomic temp-file replacement.
- `nestjs-inopack-graphql/db/README.md` says `prisma/schema.prisma` is gitignored.
  It is tracked (only `prisma/migrations/` is ignored) and this feature modified it.
  One-line doc correction.
- ✅ **Done 2026-07-28:** `scripts/summary.sh` read `docs/plans/priority-order.txt`
  with `read -r`, which does not strip the `\r` of a CRLF checkout, so every plan
  reported `MISSING PLAN FILE`. Fixed in the script and pinned to LF in
  `.gitattributes`.

## Phase 1.6 — Close the rotation race properly, and finish the login removal

Status: **CODE COMPLETE, VERIFICATION PENDING (2026-07-28).** From a static review
of the Phase 1.5 diff. No runtime commands were run for it, so nothing here is
contradicted by a test result — it is all read from the code.

Mauricio approved the two open decisions on 2026-07-28: 1.6.1 takes the
**transaction + `SELECT … FOR UPDATE`** route (not the `$executeRaw` fallback),
and `auth.resolver.test.ts` was **renamed to `auth.controller.test.ts`**. The
implementation notes are in the feature document; the item text below is kept as
written, as the record of why each change was made.

**Do this before Phase 2**, for the same reason 1.5 came first: item 1.6.2 means
the backend suite cannot pass at all, and Phase 2's acceptance criteria are all
test-run criteria.

Every finding was re-verified against the code before being written down. None
were rejected this time.

### 1.6.1 — Rotation and logout are still not atomic  ⛔ blocking

**File:** `nestjs-inopack-graphql/src/modules/auth/auth.service.ts`
(`rotateRefreshToken`, `logout`, `revokeFamily`, `revokeAllForUser`)

Phase 1.5.4's conditional `updateMany` **narrowed** the window it was written to
close; it did not close it, and the plan's own note said so — but it described the
residual as living "between the liveness check and the `create`", i.e. only on the
lost-the-race path. That understated it. The real window is between the **revoke**
and the **create**, which is the *main* path, taken by every successful rotation:

1. Rotation revokes the presented row (`count === 1`, it won).
2. `logout` runs. It finds the row by hash, calls `revokeFamily`, sees **no live
   rows** — the successor does not exist yet — updates nothing, and returns
   success. The user is told they logged out.
3. Rotation inserts the successor. The family is live again. The session the user
   just ended is back.

The same window produces a second, opposite defect. A rotation that loses the race
re-reads the row and asks whether the family still has a live token. If the winner
has revoked but not yet inserted, the answer is *no*, so the loser 401s — and
because 1.5.3 clears the cookie on exactly a 401, the loser's response carries a
`Set-Cookie` that **deletes the refresh cookie** the winner's response just set.
Whichever response the browser applies last wins. This path did not exist before
1.5.4 (the old unconditional revoke never 401'd there); it is a small regression
traded for a larger fix, and it is the same root cause.

**The Phase 1.5 tests do not cover either window and cannot.** Both spy on
`readActiveUser`, which runs *before* the conditional revoke, so they exercise the
branch logic — "does the code make the right decision given this state" — and never
an interleaving. They are worth keeping; they are just not evidence of atomicity.

**Fix — the expensive one this time.** Serialize the whole family operation:

- Wrap revoke → liveness re-check → `create` in a single `this.prisma.$transaction`,
  taking `SELECT … FOR UPDATE` on the family's rows at the top.
- **`logout` must take the same lock**, and so must `revokeFamily` and
  `revokeAllForUser`. A transaction on the rotation side alone changes nothing —
  the writer it needs to exclude is logout. This is the step most likely to be
  missed, because 1.6.1 reads as "a rotation problem".
- Alternative if the transaction proves awkward under Prisma: make the successor
  insert a single atomic statement via `$executeRaw` — `INSERT … SELECT … WHERE
  EXISTS (live row in family)` — which needs no explicit transaction but puts raw
  SQL in the service. Prefer the transaction; note the fallback exists.

**Tests to add.** Write them **red first** — each must fail against today's code:

- Seam **after** the conditional revoke and **before** `issueTokenPair` (spy on the
  private `issueTokenPair`, same technique as the existing race tests). Run
  `logout` inside it. The family must end with **zero** live rows.
- Same seam, running a competing rotation inside it, asserting the loser does not
  401.

If a test cannot be made to fail before the fix, it is not testing the window —
say so rather than keeping it.

### 1.6.2 — Deleting the GraphQL `login` mutation left a test calling it  ⛔ blocking

**Files:** `nestjs-inopack-graphql/src/modules/auth/auth.resolver.test.ts`,
`nestjs-inopack-graphql/src/common/__tests__/helpers/get-token.ts`

`auth.resolver.test.ts` posts a raw `mutation { login(loginInput: …) }` to
`/graphql` and reads `response.body.data.login.accessToken`. Phase 1.5.6 deleted
that mutation, so the field no longer exists, `data` is null, and the test throws.
Jest picks up every `*.test.ts`, so **the backend suite cannot pass** — which also
means Phase 1.5's first acceptance criterion ("passes twice consecutively") is
currently unreachable for a reason that has nothing to do with the teardown fix it
was written to check.

`get-token.ts` (`getAdminToken`) builds the same dead mutation. It is exported from
`common/__tests__/helpers/index.ts` but **has no callers**.

**Fix:**

- `auth.resolver.test.ts` — replace the GraphQL login with `POST /auth/login` via
  supertest, asserting a 200 and an `accessToken` in the body. The file is named
  for the resolver but the behaviour it covers moved to the controller; renaming it
  to `auth.controller.test.ts` is the honest option.
- `get-token.ts` — **delete it** (and its line in the helpers barrel). It has no
  callers; migrating dead code to a new endpoint is work for nothing. If a future
  test needs an authenticated request, write the helper then, against REST.

**Why 1.5's verification did not catch this:** the check was a `grep` for
`\.login(` and a case-sensitive `AccessToken`. Both call sites embed the mutation
in a template-literal GraphQL string — `login(` with no leading dot, and
`accessToken` lowercase — so neither pattern could match. Grepping for identifiers
does not find GraphQL operations. Search the operation name and the `.gql`/query
text as well.

### 1.6.3 — A transient refresh failure strands subscriptions anonymously

**File:** `react-inopack/src/services/apollo/init-apollo-client.ts`
(`connectionParams`)

Phase 1.5.2 fixed the *expiry* half of the reconnect problem. The other half is
still open: when `ensureAccessToken()` returns `null` because the refresh hit a 500
or a network error, `connectionParams` returns `authorization: null` and the socket
connects **anonymously** — `onConnect` in `app.module.ts` deliberately accepts a
tokenless socket so the login screen's always-on subscriptions can open it, and
authentication is enforced per operation by `GqlAuthGuard`.

So the socket is open and healthy, every protected subscription on it fails, and
nothing retries: `shouldRetry` / `retryAttempts` only fire on a `close`, and
subscriptions never reach `errorLink`. The tab keeps a live, useless connection
until something else forces a reconnect.

This is **pre-existing**, not introduced by 1.5 — but it defeats 1.5.2's own
acceptance criterion whenever the reconnect happens to coincide with a refresh
failure, which is exactly when reconnects happen.

**Fix:** distinguish the two nulls in `connectionParams`.

- No token **and** `isSessionKnownDead()` ⇒ return the anonymous params as today.
  The login screen needs this, and retrying would spin.
- No token and the session is **not** known dead ⇒ **throw**. A `connectionParams`
  that rejects fails the connection attempt, and `shouldRetry: () => true` +
  `retryAttempts: Infinity` are already configured, so graphql-ws backs off and
  tries again — which is the correct behaviour for "the token is temporarily
  unavailable".

**Verify:** stop the API, force a reconnect, restart the API, and confirm
subscriptions come back without a page reload.

### 1.6.4 — `AuthResolver` still injects `AuthService`

**File:** `nestjs-inopack-graphql/src/modules/auth/auth.resolver.ts`

`login` was the only member that used it. Constructor parameter is now dead. One
line, and it is the repository's own drop-unused rule.

### Phase 1.6 acceptance criteria

- [ ] A logout concurrent with a rotation leaves zero live tokens in the family,
      proven by a test that fails without the fix.
- [ ] A rotation that loses the race never returns 401, proven the same way.
- [ ] `npm run test` passes twice consecutively — including the migrated
      REST-login test.
- [ ] No test or helper references the GraphQL `login` mutation.
- [ ] Subscriptions recover after the API is stopped and restarted, with no reload.
- [ ] `AuthResolver` has no unused dependencies.

### Phase 1.5 items this supersedes

The plan's "Known residual, deliberately accepted" note under 1.5.4 is **withdrawn**
by 1.6.1 — not because the decision was wrong when it was made, but because the
window turned out to be wider than the note described, and the note is what that
decision was based on. The corresponding Phase 1.5 acceptance criterion ("a logout
concurrent with a rotation leaves zero live tokens") should be read as **not met**
until 1.6.1 lands.

## Phase 1.7 — Structured application logging

Status: **CODE COMPLETE, NOT ACCEPTED (2026-07-30).** Implemented as written,
with five recorded deviations — see
[Phase 1.7 — decisions and deviations](../../features/ongoing/feature-authentication-mfa.md#phase-17--decisions-and-deviations).
The acceptance criteria below are all still open: typecheck and lint are clean
on the touched files, but the Jest suite could not run on the implementing
machine (its generated Prisma client predates the `refresh_tokens` model, so
`globalSetup` dies before any test does). Scope agreed with Mauricio on
2026-07-30. This is the first logging facility in the repository — there is no
prior art to follow, so the decisions below are the convention other modules
will copy later.

**It ships with the 0–1.6 unit.** That is a deliberate exception to the "one
verified unit" reasoning in [Rollout and sequencing](#rollout-and-sequencing),
and it holds for one specific reason: 1.7 adds **no migration and no schema
change**. It only observes the auth path. The argument for freezing 0–1.6 was
that a rewritten auth path had never run in production and should not carry
extra unverified change; a logger that reads state and writes stdout does not
add a failure mode to that path — with **one exception**, §1.7.6, which is the
most important section here.

### What Mauricio decided (2026-07-30)

| Question | Decision |
|---|---|
| Console or database? | **Console/stdout only.** No `auth_events` table, no migration. `activities` cannot host auth events anyway — `user_id`, `entity_name` and `entity_id` are all NOT NULL, and a failed login for an unknown email has no user id. |
| Which events? | **All of them**, including successful rotation, with level-based filtering to switch the noisy one off. |
| Log the attempted email on a failed login? | **Yes.** |
| Correlation ids? | **Cheap version only** — a per-request id on the auth REST routes. No `AsyncLocalStorage`, no GraphQL correlation. Revisit if the logger spreads. |
| Replace the existing `console.*` calls? | **No.** 1.7 covers new code and the auth module. The 16 existing calls live in `src/db/` migrations, `src/db/runner.ts`, `src/tools/` and the seeders — code that runs outside the Nest application context, where an injectable logger is awkward or impossible. Leave them. |
| Global exception filter? | **No.** Errors keep throwing exactly as they do today; the logger records them *in addition*. Normalising error responses is a behaviour change to a unit about to ship, and it is not what was asked for. |
| Adoption elsewhere? | **On demand.** Other modules take the logger when they have a reason to, not as a sweep. |

`react-inopack` is **not touched by 1.7 at all.**

### 1.7.1 — The module

New directory `src/common/modules/logging/`, alongside the existing
`common/modules/prisma/` and `common/modules/pub-sub/`.

- `logging.module.ts` — exports `AppLoggerService` and `RequestIdMiddleware`.
- `app-logger.service.ts` — the injectable.
- `request-id.middleware.ts` — see §1.7.4.

**Not `@Global()`.** Being imported explicitly is the point: `AuthModule` imports
it, and the next module to want logging imports it too, deliberately. A global
provider invites logging from everywhere without anyone deciding to.

**Why an injectable wrapper rather than `new Logger(AuthService.name)` directly**
— Nest's built-in `Logger` needs no module at all, so the wrapper has to earn
its existence, and it does, three times over:

1. **Redaction is enforced in one place** (§1.7.2) instead of remembered at
   ~15 call sites.
2. **It can be mocked.** A `new Logger()` constructed inside a class cannot be
   replaced without module mocking; an injected provider is overridden in the
   testing module in one line. §1.7.8 depends on this.
3. **It is where the non-throwing guarantee lives** (§1.7.6).

The API is deliberately small and mirrors Nest's level names so it reads
familiarly:

```ts
log(event: string, context: LogContext): void;
warn(event: string, context: LogContext): void;
error(event: string, context: LogContext, error?: unknown): void;
debug(event: string, context: LogContext): void;
```

⚠️ **§1.7.10 adds two more:** `verbose()`, which is where the routine events
actually ended up, and `trace()` for the step trace. Read that section before
treating this list as complete.

`event` is a **stable dotted identifier** (`auth.refresh.theft`), not a prose
sentence. Prose gets reworded and then greps stop matching; an event name is the
thing you actually search `docker logs` for. The rendered line is the event name
followed by the context as `key=value` pairs, emitted through a Nest `Logger`
whose context is the calling class.

### 1.7.2 — Redaction: an allowlist enforced by the type system

The single most important design constraint in 1.7, and the reason a denylist is
the wrong shape — a denylist fails silently on the day someone adds a field it
does not know about.

`LogContext` is a **closed interface**, so an unlisted field is a compile error:

```ts
export interface LogContext {
    requestId?: string;
    userId?: number;
    email?: string;
    familyId?: string;
    tokenId?: number;
    ip?: string;
    userAgent?: string;
    reason?: string;
    durationMs?: number;
}
```

There is no field for a password, an access token, a raw refresh token, or a
`token_hash`, so none of them can be passed. **`token_hash` is on that list
deliberately**: it is the primary lookup key for a session row
(`refresh_tokens.token_hash` is unique and is what `rotateRefreshToken` queries
by), so logging it is logging a credential-equivalent. Use `tokenId` — the
integer PK — when a specific row needs naming.

⚠️ **The compile-time guarantee has one hole the implementer must know about.**
TypeScript's excess-property check only fires on **object literals**. Passing a
pre-built variable of a wider type slips extra keys through. So always call with
a literal — `logger.warn('auth.login.failed', { email, ip })` — and never build
the context into a `const` of an inferred type first.

Runtime belt-and-braces, since the type check is not a guarantee at runtime
(anything reaching this from `unknown` bypasses it): truncate every string value
to 200 characters before emitting. A pathological user agent or a pasted blob in
the email field should not produce an unreadable log line.

**On `email`:** logged on both login success and login failure. On failure it is
the entire value of the line. On success it is what makes the log readable by a
human — `userId=47` names nobody. Note the deliberate asymmetry with Phase 2:
its acceptance criterion says the *response* must not distinguish unknown user
from wrong password. The log may, because logs are not attacker-visible. Those
are different surfaces and the distinction is intentional.

### 1.7.3 — Level configuration

New `src/common/constants/logging.ts`, following the established shape of
`constants/jwt.ts` and `constants/cors.ts` — env read once, validated, exported
through a single access point.

```ts
export function logLevels(): LogLevel[];
```

Reads `LOG_LEVEL`, one of `debug | verbose | log | warn | error`. An
**unrecognised value throws at boot.** Falling back silently would mean a typo'd
`LOG_LEVEL` quietly disables logging, and that is discovered at exactly the
moment the logs are needed.

Defaults when `LOG_LEVEL` is unset:

| `NODE_ENV` | Default | Why |
|---|---|---|
| `production` | `log` | Rotation success (`verbose`) stays off. That is the whole point of putting it there. |
| `test` | `warn` | The auth suite logs in and out constantly; at `log` it would bury test failures. |
| anything else | `verbose` | Local development sees every auth *decision*, but not the §1.7.10 step trace, which sits one rung lower at `debug`. |

⚠️ **The `anything else` default was `debug` until §1.7.10 re-tiered the ladder.**
Read that section before changing any level in this plan.

**Return the expanded list, not a single-element array.** This is not cosmetic —
it works around a genuine quirk in Nest 8 that the implementer will otherwise
trip over. From
`node_modules/@nestjs/common/services/utils/is-log-level-enabled.util.js`:

```js
LOG_LEVEL_VALUES = { debug: 0, verbose: 1, log: 2, warn: 3, error: 4 }
// enabled if explicitly listed, OR value >= the highest value in the list
```

So `logger: ['debug']` enables **every** level, because the threshold is derived
from the *highest* value present and `debug` is the lowest. Passing
`['debug','verbose','log','warn','error']` explicitly makes the behaviour
obvious to a reader and immune to the quirk. Put the source reference in a
comment; this is not guessable from the docs.

Wire it in `main.ts`:

```ts
const app = await NestFactory.create(AppModule, { logger: logLevels() });
```

That calls `Logger.overrideLogger` internally, so it applies to every `Logger`
instance in the process, not just the bootstrap one.

Emit one `log`-level line at bootstrap naming the active level — it is how you
confirm in production that `LOG_LEVEL` actually took effect. It is invisible at
`warn`/`error`, which is correct: someone running at `error` does not want a
boot banner.

### 1.7.4 — Correlation ids

A short id generated per request and stamped on every line that request
produces, so concurrent requests can be told apart. Without it a rotation racing
a logout — the exact scenario Phase 1.6 exists for — reads as three
indistinguishable lines from two requests.

**Implement it as middleware, not as a helper in the controller.** The reason is
concrete: `AllowedOriginGuard` also needs to log (§1.7.5), and Nest's request
lifecycle is middleware → guards → interceptors → handler. A helper called
inside the controller runs too late for the guard to see.

- `RequestIdMiddleware` sets `req.requestId = randomUUID().slice(0, 8)`.
- Applied by `AuthModule` via `NestModule#configure()` to the `auth/*` routes
  only. Nothing else is in 1.7's scope.
- Type it by declaration merging on Express's `Request` (`declare global {
  namespace Express { interface Request { requestId?: string } } }`) rather than
  casting at each read.

Eight hex characters, not a full UUID: a full one makes every line unreadable,
and the only requirement is disambiguating requests alive at the same instant.

**Threading it into the service — use the parameter that already exists.**
`loginWithCredentials(userInput, meta)` and `rotateRefreshToken(rawToken, meta)`
already take `SessionMeta`. Add `requestId?: string` to it and populate it in
the controller's existing `sessionMeta(req)` helper. `logout(rawToken)` has no
`meta` parameter today and needs one added — that is the only signature change.

The type then mixes persisted metadata (`userAgent`, `ip` are written to the
`refresh_tokens` row) with log-only metadata (`requestId`). Accepted, because a
second parallel parameter on three methods is worse, and the persistence path is
already an explicit allowlist: `issueTokenPair` names `meta.userAgent` and
`meta.ip` field by field, so `requestId` **cannot** leak into the table by
accident. Say so in a comment on the field.

### 1.7.5 — The event catalogue

Log where the decision is made — in the service — not in the controller.
Transport-level events the service never sees are the exception.

**`AuthService.loginWithCredentials`**

| Event | Level | When | Context |
|---|---|---|---|
| `auth.login.success` | `log` | pair issued | `userId`, `email`, `familyId`, `ip`, `requestId` |
| `auth.login.failed` | `warn` | `validateUser` returned `null` | `email`, `ip`, `requestId` |

⚠️ **`auth.login.failed` cannot say *why* it failed.** `validateUser` returns
`null` for both an unknown user and a wrong password, and separating them means
changing its return type — that is auth logic, not logging, and it is out of
scope here. Phase 2 needs the distinction for the lockout counter and should add
it then. Do not smuggle it into 1.7.

**`AuthService.rotateRefreshToken`**

| Event | Level | When | Context |
|---|---|---|---|
| `auth.refresh.rotated` | `verbose` | success | `userId`, `familyId`, `tokenId`, `requestId` |
| `auth.refresh.race` | `verbose` | benign-race path taken (`isBenignRotationRace` true) | `userId`, `familyId`, `requestId` |
| `auth.refresh.no_token` | `verbose` | no cookie presented | `requestId` |
| `auth.refresh.expired` | `verbose` | row past `expires_at` | `userId`, `familyId`, `requestId` |
| `auth.refresh.unknown_token` | `warn` | hash not found in the table | `ip`, `requestId` |
| `auth.refresh.user_inactive` | `warn` | user deactivated between login and rotation; family revoked | `userId`, `familyId`, `requestId` |
| `auth.refresh.row_missing` | `warn` | the presented row vanished between the unlocked read and the lock | `userId`, `familyId`, `requestId` |
| `auth.refresh.theft` | **`error`** | reuse outside the grace window; whole family revoked | `userId`, `familyId`, `tokenId`, `ip`, `requestId` |

⚠️ **`auth.refresh.no_token` must be `verbose`, not `warn`.** The frontend's
`bootstrapSession` posts to `/auth/refresh` on **every page load**, including
for a logged-out visitor, and a 401 there is the designed "not logged in"
answer. At `warn` every anonymous page load writes a warning and the level
becomes meaningless.

`auth.refresh.theft` is the highest-value line in the system. It is the only
`error` on a non-exceptional path, and it is what someone greps for first.

**`AuthService.logout`**

| Event | Level | When | Context |
|---|---|---|---|
| `auth.logout.success` | `log` | family revoked | `userId`, `familyId`, `requestId` |
| `auth.logout.unknown_token` | `verbose` | no matching row | `requestId` |
| `auth.logout.no_token` | `verbose` | no cookie | `requestId` |

Neither `unknown_token` nor `no_token` is a failure — the desired end state
(this browser holds no live session) already holds, which is why `logout`
returns silently today.

**`AuthController`**

| Event | Level | When | Context |
|---|---|---|---|
| `auth.login.malformed` | `warn` | `readCredentials` rejects the body | `ip`, `requestId` |

**`AllowedOriginGuard`**

| Event | Level | When | Context |
|---|---|---|---|
| `auth.origin.rejected` | `warn` | present-but-unlisted `Origin` → 403 | `reason` (the origin), `requestId` |

The guard is instantiated by Nest, so injecting `AppLoggerService` into it works
normally — but `AuthModule` must import `LoggingModule` for that to resolve.

### 1.7.6 — ⚠️ The one way a logger can break auth, and the two rules that prevent it

This section is why 1.7 is safe to ship with 0–1.6, and it is the part most
likely to be skimmed.

**Rule 1 — every log call must be incapable of throwing.** Wrap the format-and-
emit body of each `AppLoggerService` method in a `try { … } catch { /* ignore */ }`.
A logger that can throw stops being an observer and becomes a new way for login
to fail.

**Rule 2 — never log inside the rotation transaction.** This is the sharp one.
[Phase 1.6 decision 1](../../features/ongoing/feature-authentication-mfa.md#phase-16--decisions-and-deviations)
records that an exception thrown inside a Prisma interactive transaction
**rolls it back**, and that this is why the theft path returns `null` instead of
throwing — throwing would have revoked the family and instantly undone the
revocation, silently disabling theft detection while every test still passed.

A log call placed inside `rotateRefreshToken`'s `$transaction` callback inherits
that hazard exactly. A `TypeError` in a log line would roll back a revocation.
Rule 1 makes that survivable; Rule 2 makes it impossible. There is a second,
independent reason: the callback runs while holding `SELECT … FOR UPDATE` on the
family, and log I/O there lengthens the critical section every concurrent
rotation queues behind — the same argument
[decision 3](../../features/ongoing/feature-authentication-mfa.md#phase-16--decisions-and-deviations)
already applied when it moved `readActiveUser` out of the lock.

**Consequence — this is the largest single piece of work in 1.7.** The callback
currently returns `TokenPair | null`, which is enough to decide the HTTP status
but not enough to say *which* of six things happened. Widen it to a small
discriminated result:

```ts
type RotationOutcome =
    | { kind: 'rotated'; pair: TokenPair; tokenId: number }
    | { kind: 'race'; pair: TokenPair }
    | { kind: 'theft'; tokenId: number }
    | { kind: 'expired' }
    | { kind: 'inactive' }
    | { kind: 'row_missing' };
```

`rotateRefreshToken` then logs **after the transaction commits**, switching on
`kind`, and throws `UnauthorizedException` for every non-pair outcome exactly as
it does now.

⚠️ **This edits the method Phase 1.6.1 was written to get right.** Two
non-negotiable constraints:

- **The three Phase 1.6 tests must pass unmodified** —
  `a logout inside the rotation window still ends the session`, `a rotation that
  loses the window is not told its session is dead`, and `the family lock blocks
  a second transaction on the same family`. If any of them needs editing to go
  green, the refactor changed behaviour rather than observation. Stop and say so
  rather than adjusting the test.
- **`issueTokenPair`, `readActiveUser` and `lockFamily` keep their current
  signatures and call positions.** The 1.6 tests spy on all three to open their
  seams; moving them breaks the tests for reasons unrelated to what they assert.

### 1.7.7 — Container log rotation

Both deploy workflows start the API with `--env-file` and no `--log-opt`, so
Docker uses the default `json-file` driver with **no size limit and no
rotation** — the container log grows until it fills the droplet. Nothing
collects these logs; `docker logs` is the only reader.

In `.github/workflows/deploy-staging.yml` and
`.github/workflows/deploy-production.yml`, add to the `docker run -d` block (the
long-lived container, **not** the `docker run --rm` migration container above
it, which needs nothing):

```
--log-opt max-size=50m \
--log-opt max-file=5 \
```

A 250 MB ceiling, which is nothing next to the ten full SQL dumps
`/root/backups` is already allowed to hold — and that pruning step is the
precedent: the deploy script already guards disk against unbounded growth for
backups, and container logs had no equivalent.

**This belongs in 1.7 rather than in a follow-up** because it is the same
decision as logging rotation success. Production at `log` never writes those
lines, but `LOG_LEVEL=debug` during an incident does — and that is precisely
when nobody is watching disk.

At production defaults the expected retention is well over a year; at `debug`
with a few dozen sessions, a month or two. Neither number is the real risk. The
real risk is an error loop writing 250 MB in minutes and evicting the evidence
of its own cause, and no rotation setting fixes that — the ceiling only bounds
the damage.

### 1.7.8 — Tests

Everything below is runnable in the existing Jest suite; none of it needs a
browser.

New `src/common/constants/logging.test.ts`:

- Each `NODE_ENV` default resolves to the documented level.
- A threshold expands to the right list (`log` ⇒ `log, warn, error`).
- An unrecognised `LOG_LEVEL` throws, with the bad value in the message.

New `src/common/modules/logging/app-logger.service.test.ts`:

- A string value longer than 200 characters is truncated.
- **The logger never throws** — pass a context containing a value whose getter
  throws and assert the call returns normally. This is Rule 1's test and it is
  the one that matters.

Extend `src/modules/auth/auth.service.test.ts`:

- Override `AppLoggerService` in the testing module with a spy.
- Assert `auth.refresh.theft` is emitted at `error` on the existing theft path.
- Assert `auth.login.failed` carries the attempted email and that **no logged
  context anywhere in the run contains the raw refresh token or a `token_hash`**
  — walk the spy's recorded calls. This is the automated half of the redaction
  criterion.

`.env.test` gains `LOG_LEVEL=warn` so the suite output stays readable.

### 1.7.9 — Documentation

- `.env.example` — a `LOG_LEVEL` block explaining the threshold semantics and
  the per-`NODE_ENV` defaults.
- The feature document's **deployment prerequisites** table — add `LOG_LEVEL` as
  optional, defaulting to `log` in production.
- The feature document gains a **Phase 1.7 — what changed** section when the
  code lands, matching the 1.5 / 1.6 sections.
- `docs/changelog.md` — a dated entry, per the workflow rules.

### 1.7.10 — The `verbose` trace tier

Status: **CODE COMPLETE, NOT ACCEPTED (2026-07-30).** Implemented as written; the
acceptance criteria below are open for the same reason the rest of 1.7's are —
the suite cannot run on the implementing machine.

Added 2026-07-30 after Mauricio asked for a line-by-line narration of the auth
flow to learn from. The request was for temporary log lines after every
statement, to be removed later. This is the permanent version of the same idea,
and it exists because the temporary version has three problems: it would put log
calls **inside the rotation transaction**, which §1.7.6 forbids for a documented
reason; "remove it later" means the code that ships is not the code that was
tested, on a branch whose entire rollout argument is that they are the same; and
a per-statement log teaches *what executed*, which is the easy half — the hard
half is why each decision goes the way it does, and that is what the
[learning guide](../../guides/authentication-mfa-learning-guide.md) already
covers.

A trace tier gives the same visibility, permanently, at no cost when it is off.

#### The level ladder was incoherent — fix it first

Nest orders levels least-to-most-severe as `debug (0) < verbose (1) < log (2) <
warn (3) < error (4)`, so **`debug` is the most inclusive setting, not the
least.** §1.7.5 put the routine auth events at `debug` and left `verbose`
unassigned, which means a step trace placed at `verbose` would be *hidden* by
`LOG_LEVEL=verbose` while `auth.refresh.rotated` showed — backwards, and a
guaranteed source of confusion.

Re-tier so that granularity increases monotonically as the level drops:

| Level | Contents |
|---|---|
| `error` | `auth.refresh.theft` |
| `warn` | every failure event |
| `log` | `auth.login.success`, `auth.logout.success` |
| **`verbose`** | the four routine events **moved down from `debug`**: `auth.refresh.rotated`, `auth.refresh.race`, `auth.refresh.no_token`, `auth.refresh.expired`, plus `auth.logout.unknown_token` and `auth.logout.no_token` |
| **`debug`** | the step trace, and nothing else |

Change the `logLevels()` default for non-production, non-test environments from
`debug` to **`verbose`**. Local development should see every auth decision by
default but not a step trace on every request; `debug` becomes a deliberate
"narrate everything" opt-in. Production stays `log`, test stays `warn`.

Mechanically this is a one-word change at six call sites plus the §1.7.5 tables,
`.env.example`, and the `logging.test.ts` default assertions.

#### The API

One method on `AppLoggerService`, emitting through Nest's `debug`:

```ts
trace(event: string, context: LogContext): void;
```

Trace events are namespaced `auth.trace.*` so they filter cleanly and can never
be confused with the §1.7.5 catalogue, which is the stable, greppable contract.
Trace points are **not** a contract: they exist to be added to and removed
freely, and Mauricio will add his own as he reads.

`LogContext` gains two fields for trace use — still a closed allowlist, still no
credential field of any kind:

```ts
detail?: string;   // a short free-text note about the step
count?: number;    // "3 rows in family", "1 live", "2 expired rows swept"
```

#### Tracing inside the transaction — the buffer

§1.7.6's rule stands unchanged: **no I/O inside the rotation transaction.** The
trace still needs to narrate what happens in there, so it collects and emits
afterwards.

New `TraceBuffer` in the logging module:

```ts
export class TraceBuffer {
    add(event: string, context: LogContext): void;
    flushTo(logger: AppLoggerService): void;
}
```

`add` appends to a private array — an in-memory push, not I/O, so it cannot roll
a transaction back and does not lengthen the `FOR UPDATE` critical section.
`add` is itself wrapped in `try/catch` for the same reason every emit body is:
a bug in trace collection must not be able to break a rotation.

`rotateRefreshToken` constructs one before the transaction, passes it into the
callback, and calls `flushTo` **in a `finally` around the `await`** — beside the
existing outcome logging, which already runs post-commit. The `finally` matters:
a rotation that throws (lock wait timeout, dropped connection, deadlock) is the
case whose narration is most worth having, and a flush placed after the `await`
is the one case that never runs for it.

⚠️ `.finally()` on the promise does not compile — this repo targets `es2017` and
`Promise.prototype.finally` is ES2018. Assign `$transaction(...)` to a promise
and `await` it inside a `try` instead; that also keeps the ~128-line callback at
its current indentation, so Phase 1.6's critical section stays reviewable in the
diff.

When `LOG_LEVEL` is above `debug` the buffer still fills and then discards; that
is a few array pushes per rotation and is not worth optimising. Note it, do not
gate it.

#### The initial trace points

A scaffold, not a finished set — roughly twenty points covering the three public
methods. Add them in the order the code executes:

**`loginWithCredentials`** — `auth.trace.login.begin`,
`auth.trace.login.validated` (`detail`: found / rejected),
`auth.trace.login.swept` (`count`: expired rows deleted),
`auth.trace.login.family_created` (`familyId`).

**`rotateRefreshToken`** — `auth.trace.rotate.begin`,
`auth.trace.rotate.presented_found` (`tokenId`, `familyId`),
`auth.trace.rotate.user_read` (`detail`: active / inactive), then **buffered**
from here: `auth.trace.rotate.family_locked` (`count`: rows, `detail`: live
count), `auth.trace.rotate.row_found` or `.row_missing`,
`auth.trace.rotate.revoked_row_seen`, `auth.trace.rotate.race_verdict`
(`detail`: benign / theft, `count`: ms since revocation),
`auth.trace.rotate.expiry_checked`, `auth.trace.rotate.row_revoked`,
`auth.trace.rotate.successor_created`, then unbuffered
`auth.trace.rotate.flushed`.

**`logout`** — `auth.trace.logout.begin`, `auth.trace.logout.row_found`
(`familyId`), `auth.trace.logout.family_revoked`.

The buffered span is exactly the `$transaction` callback. Everything outside it
emits directly.

#### Constraints — unchanged from 1.7.6

The three Phase 1.6 race tests must still pass **byte-for-byte unmodified**, and
`issueTokenPair`, `readActiveUser` and `lockFamily` keep their signatures and
call positions. A trace point may be added *around* those calls, never inside
them.

#### 1.7.10 acceptance criteria

- [ ] `LOG_LEVEL=debug` narrates a full login → refresh → logout with
      `auth.trace.*` lines; `LOG_LEVEL=verbose` shows the §1.7.5 events and
      **no** trace lines; `LOG_LEVEL=log` shows neither.
- [ ] The trace lines emitted from inside the transaction appear **after** the
      transaction commits, and no `logger` call occurs inside the `$transaction`
      callback (verifiable by reading the diff).
- [ ] A rotation whose transaction **throws** still emits its buffered trace,
      and the original exception still propagates unchanged.
- [ ] A `TraceBuffer.add` whose context throws does not break the rotation.
- [ ] The three Phase 1.6 race tests are unmodified and the suite is green.
- [ ] No credential field exists on `LogContext`; the redaction grep from
      §1.7.8 still finds zero matches at `LOG_LEVEL=debug`.

### Phase 1.7 acceptance criteria

- [ ] `LOG_LEVEL=verbose` shows `auth.refresh.rotated`; `LOG_LEVEL=log` does not,
      while `auth.login.success` and `auth.refresh.theft` still appear.
      (`debug` shows it too — it is the most inclusive level; see §1.7.10.)
- [ ] An invalid `LOG_LEVEL` fails at boot with the bad value named.
- [ ] A failed login emits `auth.login.failed` at `warn` with the attempted
      email, and no password appears anywhere in the output.
- [ ] Grep the complete log output of a login → refresh → logout cycle for the
      raw refresh token and for its SHA-256 hash: **zero matches**.
- [ ] Two concurrent requests carry different `requestId` values, and every line
      of one request shares one.
- [ ] Theft detection emits `auth.refresh.theft` at `error`.
- [ ] `npm run test` passes twice consecutively, and the three Phase 1.6 race
      tests are **byte-for-byte unmodified**.
- [ ] Typecheck and lint clean on `nestjs-inopack-graphql`.
- [ ] `docker inspect` on a deployed container reports the two log options.

### What not to do

- **Do not touch the 16 existing `console.*` calls.** They are out of scope by
  decision, not by oversight.
- **Do not add a global exception filter**, and do not change any error response.
- **Do not add `AsyncLocalStorage`** or correlate GraphQL operations.
- **Do not make `LoggingModule` `@Global()`.**
- **Do not log inside the rotation transaction** — §1.7.6.
- **Do not add a table, a migration, or a Prisma model.** If the plan seems to
  need one, the scope has drifted.
- **Do not modify `react-inopack`.**

## Phase 2 — Throttling & brute-force protection

### 2.1 Rate limits

- `@nestjs/throttler` with a **GraphQL-aware guard**: the stock guard reads
  `context.switchToHttp()`; override `getRequestResponse` via
  `GqlExecutionContext` (same pattern as `GqlAuthGuard.getRequest`). Skip WS
  subscription contexts.
- Global default generous (100 req/min/IP). Strict: REST `POST /auth/login` 5/min/IP,
  `POST /auth/refresh` 10/min/IP (per-route `@Throttle` on the controller — simpler
  than throttling GraphQL, another reason login moves to REST).
- Behind Netlify/proxy in prod: configure trust proxy so the real client IP is used.

### 2.2 Per-account lockout

- `users` additions (same migration style + prisma mirror): `failed_login_count INT
  NOT NULL DEFAULT 0`, `lockout_until DATETIME NULL`. No Redis in this stack — DB
  columns are fine at this user count.
- 5 consecutive failures ⇒ 15-min lockout. Locked/unknown/wrong-password all return
  the **same generic message** (the existing Spanish-facing "Could not log-in…"
  message — unify wording, in Spanish, while at it).
- Reset counter on success. Dummy bcrypt compare on unknown users to equalize timing.

### Phase 2 acceptance criteria

- [ ] 6th rapid login attempt from one IP is rejected.
- [ ] 6th consecutive wrong password locks the account even across IPs.
- [ ] Responses don't distinguish unknown user / wrong password / locked.

## Phase 3 — Email MFA, MFA enforcement, and admin password reset

Status: **RE-SCOPED 2026-09-09 (Mauricio).** The original design was TOTP
(authenticator app + `otplib` + QR enrollment). That design is **demoted to a
later option** — it may return, but only when Mauricio explicitly signals it.
Phase 3 is now **email MFA** plus two adjacent user-administration features. Not
started, and **not on this branch** — `feature/auth-mfa-phase2` is Phase 2 only.

### What Mauricio decided (2026-09-09)

| Question | Decision |
|---|---|
| MFA channel | **Email only.** A one-time code is emailed on login. No authenticator app, no TOTP secret, no recovery codes. |
| Who must use MFA? | **Per-user, set by an admin.** A checkbox on the user record enforces MFA for that account. Accounts without it **skip MFA entirely.** |
| Password reset | A **super-user** resets a user's password from the users admin panel. The reset does **not** set a working password — it **forces the affected user to choose a new password on their next login.** |
| TOTP | **Deferred.** Not built now; revisit only on an explicit signal from Mauricio. |

⚠️ **Load-bearing prerequisite — there is no email infrastructure in the backend
today.** No `nodemailer`, no mailer module, no SMTP/provider config (verified
2026-09-09). Email MFA cannot ship until a mail-sending capability exists, and
that capability brings its own failure mode: **if mail delivery is down or slow,
an MFA-enforced user cannot log in at all.** This is the central risk of the
channel choice and shapes the rest: it is why the enforce flag is *per-user*
(blast radius is bounded to enrolled accounts) and why the "skip MFA" default
matters — most accounts stay on the password-only path that already works.

### 3.1 Database (users additions + one table)

Same migration style as Phases 1–2 (raw SQL in `src/db/migrations/`, prisma
mirror, no `prisma migrate`):

- `users.mfa_enabled TINYINT(1) NOT NULL DEFAULT 0` — the admin checkbox. `1` ⇒
  this account must pass email MFA on every login; `0` ⇒ skips MFA.
- `users.must_change_password TINYINT(1) NOT NULL DEFAULT 0` — set by the
  super-user reset; forces a password change at next login, cleared once done.
- New table `email_mfa_codes`: `id`, `user_id` FK, `code_hash` CHAR(64) (never
  the raw code), `expires_at` DATETIME (short, ~10 min), `consumed_at` DATETIME
  NULL, `attempts INT NOT NULL DEFAULT 0`, `created_at`. One row per issued code;
  short TTL; attempt-limited.

### 3.2 Login flow (email MFA)

- Password ok + `mfa_enabled = 0` ⇒ token pair exactly as in Phase 1.
- Password ok + `mfa_enabled = 1` ⇒ **no tokens.** Generate a code, store its
  hash, email it, and return `{ mfaRequired: true, mfaToken }` — a short JWT
  (~2 min), claim `purpose: "mfa"`, separate `MFA_TOKEN_SECRET`, valid only for
  the verify endpoint.
- `POST /auth/mfa/verify` `{ mfaToken, code }` — validate hash + expiry + attempt
  count; on success mark `consumed_at` and issue a normal pair. **Cap attempts
  per code and throttle per IP** (a 6-digit email code is brute-forceable — reuse
  Phase 2's throttler).
- React: `mfaRequired` ⇒ code-entry screen inside the `AuthorizationWrapper`
  flow, in Spanish ("Código de verificación", "Reenviar código").

### 3.3 Forced password change (super-user reset)

- Super-user action in the users admin panel resets a target user: set
  `must_change_password = 1` and revoke that user's refresh families (existing
  `revokeAllForUser`), so a live session cannot be used to sidestep the change.
- On the target's next login the password verifies, but instead of a pair the
  flow requires a new password first — a `passwordChangeRequired` gate mirroring
  the `mfaRequired` gate. New password set ⇒ clear the flag ⇒ issue the pair.
- Role gate: only a super-user role may trigger the reset. Confirm which role id
  maps to "super user" (`src/common/dto/entities/auth/role.dto.ts`).

### 3.4 Hygiene

- Invalidate outstanding mfaTokens and all refresh families on any password
  change (unchanged intent from the original plan).
- Email code: single-use (`consumed_at`), short TTL, attempt-limited; a resend
  invalidates the user's prior unconsumed codes.

### Phase 3 acceptance criteria

- [ ] An MFA-enabled login never issues tokens on password alone; it requires a valid emailed code.
- [ ] An account without the flag logs in with no MFA step.
- [ ] The verify endpoint locks a code after N bad attempts and is IP-throttled.
- [ ] Email codes work exactly once and expire.
- [ ] A super-user reset forces the target to set a new password at next login and kills their existing sessions.
- [ ] Raw MFA codes are never stored (hash only).

### Phase 3 open questions (resolve at build time)

- Which mail transport/provider, and where its config/secrets live (follow the
  `constants/jwt.ts` env pattern; fail fast in production).
- Code length/format and TTL; per-code attempt cap and per-IP verify limit.
- The "super user" role definition and where the reset lives in the React users panel.
- Behaviour when mail delivery fails for an enforced user (resend UX; whether an admin bypass is needed).

## Cross-cutting

- All new secrets via env: `JWT_ACCESS_SECRET`, `MFA_TOKEN_SECRET`, plus the mail
  transport's credentials (Phase 3). `MFA_ENC_KEY` is dropped — email MFA stores
  no TOTP secret to encrypt.
- Unit tests (colocated `*.test.ts`, jest, as `auth.service.test.ts` does today):
  rotation + family revocation, lockout counter (Phase 2), email-code verify with
  single-use + expiry, and the forced-password-change gate (Phase 3). The user
  runs the suites.
- Activity log: consider logging login / logout / MFA events to `activities` via the
  existing pub-sub pattern — decide at implementation (business rule says mutations
  log; auth events are a natural extension for the audit trail).
- New deps: `@nestjs/throttler`, `cookie-parser` (backend, Phases 1–2); a mail
  transport for Phase 3 email MFA (e.g. `nodemailer` / `@nestjs-modules/mailer` —
  none installed today). `otplib` and `qrcode.react` are no longer needed unless
  TOTP is revived.

## Suggested build order

Phase 0 → 1.1–1.3 (backend behind the old flow) → 1.4 frontend cutover → 2 → 3.

⚠️ Superseded in part. That was the *build* order and it held: 0 → 1 → 1.5 → 1.6
is what happened. The line that followed it — "each phase independently
shippable; Phase 0 can ship today" — no longer describes how this ships.
Phases 0–1.6 ship together, as one unit, and Phase 2 starts only once they are in
production. See [Rollout and sequencing](#rollout-and-sequencing).
