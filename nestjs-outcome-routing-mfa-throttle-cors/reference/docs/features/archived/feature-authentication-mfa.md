# feature/authentication-mfa

Auth hardening: env secrets, slim JWT, refresh tokens, throttling, TOTP MFA.
Implements [plans/ongoing/auth-refresh-throttling-mfa.md](../../plans/ongoing/auth-refresh-throttling-mfa.md).

## Goals

Work through the plan phase by phase. They are *built* in order, but they do not
ship in order: Phases 0–1.6 go to production as one unit and Phase 2 begins only
afterwards — see the revised rollout policy below.

- **Phase 0** — quick wins: env-backed JWT secrets, `active = 1` on login, slim
  token payload, remove the legacy REST auth surface.
- **Phase 1** — refresh tokens (`refresh_tokens` table, rotation + family theft
  detection, httpOnly cookie, in-memory access token on the frontend).
- **Phase 2** — throttling (`@nestjs/throttler`, GraphQL-aware guard) and
  per-account lockout.
- **Phase 3** — TOTP MFA with recovery codes.

## Status

**2026-09-08 — local test gate GREEN (twice); activity-feed role gating folded in.**
The `auth.service.test.ts` suite (including the 1.6 rotation-race cases) passes
twice consecutively for the first time in this repo, after two fixes: (1) `.env.test`
`connection_limit=1 → 5` — the concurrency tests need ≥2 DB connections and had
deadlocked on a pool of one ever since they were introduced (pool=1 predated them),
which is why they were never green; (2) `isBenignRotationRace` now treats a
zero/negative grace window as unconditional theft, fixing a `DATETIME(0)` rounding
knife-edge that let a `grace=0` replay of a spent token read as a benign race once
the faster pool exposed it. Also **folded in, beyond the original Phase 0–1.7 scope:**
server-side role gating of the `activity` subscription (see Decisions). Remaining
before stage: typecheck/lint + the browser checks in the verification checklist.

**Phase 0 COMPLETE (2026-07-28)** — backend only; jest suite green, including the
two new `auth.service.test.ts` cases.

**Phase 1 COMPLETE — pending browser verification (2026-07-28)** — refresh
tokens, backend + frontend, both repos. Jest suite green including the 12 new
refresh-token cases. The browser checks below are still pending, and so is the
`CORS_ORIGINS` server prerequisite.

**Phase 1.5 CODE COMPLETE, NOT ACCEPTED — Phase 1.6 open (2026-07-28)** — all
nine findings from the external review of the Phase 1 diff are implemented, in
both repos, and a static review of *that* diff produced four more, now scoped as
[Phase 1.6](../../plans/ongoing/auth-refresh-throttling-mfa.md#phase-16--close-the-rotation-race-properly-and-finish-the-login-removal).
**Phase 1.6 CODE COMPLETE, NOT ACCEPTED (2026-07-28)** — all four items are
implemented. Both of 1.6's blockers are addressed in code:

- **The backend suite was red.** `auth.resolver.test.ts` executed the GraphQL
  `login` mutation that 1.5.6 deleted, so Jest could not pass at all — which made
  Phase 1.5's own "passes twice consecutively" criterion unreachable for a reason
  unrelated to what it was checking. The test is now `auth.controller.test.ts`
  and calls REST; the equally dead `get-token.ts` is deleted. **The suite has not
  been run — that it is green again is an expectation, not a result.**
- **The rotation/logout race was narrowed, not closed.** 1.5.4's conditional
  revoke left a window between the revoke and the successor insert, on the
  *winning* path. 1.6.1 closes it with a family-level `SELECT … FOR UPDATE` taken
  by rotation **and** by logout / `revokeFamily` / `revokeAllForUser`.

**Phase 1.7 (incl. 1.7.10) CODE COMPLETE, NOT ACCEPTED (2026-07-30)** —
structured application logging: a non-global `LoggingModule`, an env-backed
`LOG_LEVEL` threshold, a per-request correlation id on `auth/*`, eleven auth
events, a `verbose` decision tier with a `debug` step trace below it, and
container log rotation in both deploy workflows. No migration and no schema change, which is
why it ships with the 0–1.6 unit. Typecheck and lint are clean on the touched
files; **the Jest suite could not be run** — the generated Prisma client on this
machine predates the `refresh_tokens` model and Jest's `globalSetup` dies before
any test runs. See the Phase 1.7 verification list.

Nothing in 1.5, 1.6 or 1.7 is verified. Phases 2–3 not started, and Phase 2 waits
on 1.6 being *accepted*, not merely coded.

The hands-on verification is tracked as a per-pass working checklist in
[auth-mfa-manual-verification-checklist.md](auth-mfa-manual-verification-checklist.md)
(Pass 1 in progress — the `db:test:rebuild` blocker was cleared 2026-09-07).

Still outstanding from Phase 0, deliberately: the browser-level checks below have
**not** been done. The suite covers `validateUser`, not the wiring that carries
`role_ids` through `JwtStrategy` into `GqlRolesGuard` and
`isAccountClientRestricted`. Do them during local testing before the branch moves.

### Phase 0 — what changed (`nestjs-inopack-graphql`)

| Plan item | File | Change |
|---|---|---|
| 0.1 env secrets | `src/common/constants/jwt.ts` | `authSecret` / `fileSecret` now read `JWT_ACCESS_SECRET` / `JWT_FILE_SECRET`. Outside production a development fallback keeps local runs and the test suite working; **in production an unset secret throws at boot**. `jwtConstants` stays the single access point, so no call site moved. |
| 0.2 deactivated users | `src/modules/auth/auth.service.ts` | `validateUser` now filters `active: 1`. Also filters `user_roles` to `active: 1` — a revoked role assignment no longer reaches the token. |
| 0.3 slim payload | `auth.service.ts`, `strategies/jwt.strategy.ts`, `common/dto/entities/auth/auth.dto.ts` | Token payload is `{ sub, email, role_ids }` instead of the whole `users` row. New `AccessTokenPayload` / `AuthenticatedUser` types. `JwtStrategy#validate` maps the payload to `{ id, email, role_ids }`, so the ~50 `currentUser.id` call sites are untouched. It rejects a payload without `sub` (a legacy token) rather than producing `id: undefined`. |
| 0.3 role consumers | `guards/gql-roles.guard.ts`, `common/helpers/auth/is-account-client-restricted.ts`, `management/accounts/accounts.resolver.ts` | The only two readers of `user_roles` from the token now read `role_ids`. Six `UserWithRoles` annotations in the accounts resolver became `AuthenticatedUser`. |
| 0.4 legacy REST | `auth.controller.ts` (deleted), `auth.module.ts` | `POST /auth/login` and `GET /auth/users` removed — nothing in either repo consumed them, and `users` returned every user row **including password hashes**. Phase 1 reintroduces the controller for the cookie endpoints. |
| — | `.env.example`, `.env.test` | Document/set the two new variables. |
| — | `auth.service.test.ts` | Two tests: a deactivated user cannot log in; revoked role assignments are excluded. |

### Verification

- ✅ **Done 2026-07-28** — `npm run db:test:rebuild` then `npm run test`: suite
  green, including the two new `auth.service.test.ts` cases. The rebuild is only
  needed when the schema changes, not per run; see `docs/workflow.md` §Test
  database for why `pretest` no longer runs `prisma migrate dev`.
- ⬜ **Pending** — backend + frontend running: log out, log in again, confirm
  role-gated pages behave (a Ventas user still sees only client accounts — that
  path moved from `user_roles` to `role_ids`, and no automated test covers it).
- ⬜ **Pending** — confirm file downloads still work (`/files/:token/:filename`)
  — the files module's secret moved to env alongside the auth secret.

### Phase 1 — what changed

**`nestjs-inopack-graphql`**

| Plan item | File | Change |
|---|---|---|
| 1.1 table | `src/db/migrations/1788804218804-CreateRefreshTokens.ts` | New `refresh_tokens` table, house conventions (unsigned int PK, FK to `users`). No `active` column: `revoked_at` / `expires_at` carry the state. Unique index on `token_hash`, index on `family_id`. **Renamed twice, content unchanged.** First 2026-07-30 (`1785024000000-…` → `1785466780404-…`) to sort after `1785348109789-AddAccountTaxRequirements`, the `feature/general-updates-piu-piu` migration that reached production first. Then **2026-09-07** (`1785466780404-…` → `1788804218804-…`, class `CreateRefreshTokens1785466780404` → `…1788804218804`) after `origin/dev` was merged into this branch, so it again sorts last — after `1786060000000-AddOrderQuotations`. Safe because this migration had never run anywhere: it is absent from `db/schema.sql` (both the table and its `migrations` row), and the branch has never reached `stage`. The runner dedupes on **class name**, so any database that *had* already run an old class would re-run this one and fail on `CREATE TABLE`. |
| 1.1 prisma | `prisma/schema.prisma` | `refresh_tokens` model mirroring the migration + back-relation on `users`. |
| 1.2 lifetimes | `src/common/constants/jwt.ts` | Access TTL 12h → `JWT_ACCESS_TTL` (default `15m`). New `refreshTtlDays` (`REFRESH_TTL_DAYS`, 14) and `refreshReuseGraceSeconds` (`REFRESH_REUSE_GRACE_SECONDS`, 30). `fileExpiresIn` stays 12h. |
| 1.3 service | `src/modules/auth/auth.service.ts` | `loginWithCredentials` (new family), `rotateRefreshToken` (single-use rotation, theft ⇒ whole family revoked), `logout`, `revokeFamily`, `revokeAllForUser`. Refresh tokens are 64 random bytes stored as a SHA-256 digest. Rotation **re-reads the user**, so deactivation and role revocation take effect within one access-token lifetime. Expired rows for the user are swept on login. |
| 1.3 endpoints | `src/modules/auth/auth.controller.ts` (new) | `POST /auth/login`, `/auth/refresh`, `/auth/logout`. Body carries the access token only; the refresh token goes into the httpOnly cookie. |
| 1.3 cookie | `src/modules/auth/refresh-cookie.ts` (new) | Set / clear / read the `refresh_token` cookie. `httpOnly`, `Secure` in prod, `SameSite` per env, `Path=/auth`. |
| 1.2 CORS | `src/main.ts` | `enableCors()` (wildcard) → allowlist from `CORS_ORIGINS` + `credentials: true`. Credentialed requests forbid `*`, so this had to change. |
| — | `auth.module.ts` | Registers the controller; drops the dead `LocalStrategy` (file deleted — nothing ever used `AuthGuard('local')`). |
| — | `.env.example`, `.env.test` | New variables documented; tests pin `REFRESH_REUSE_GRACE_SECONDS=0`. |
| — | `auth.service.test.ts` | 10 new cases: issue, rotate, reuse-kills-family, expired, unknown, deactivated-user, logout, no-op logout, `revokeAllForUser`, per-device family isolation. |

**`react-inopack`**

| Plan item | File | Change |
|---|---|---|
| 1.4 token store | `src/services/auth/access-token.ts` (new) | Access token in a module variable, never localStorage. Single-flight refresh, `sessionKnownDead` short-circuit, `loginWithPassword`, `logoutSession`, `bootstrapSession`. |
| 1.4 links | `src/services/apollo/init-apollo-client.ts` | `authLink` reads memory; `errorLink` replaces "toast + reload" with silent refresh + replay (one retry per operation); `connectionParams` is async and awaits a fresh token on every WS (re)connect. |
| 1.4 bootstrap | `authorization-wrapper.tsx` | Spends the refresh cookie once before rendering; `currentUser` is `skip`ped until then. The `loading && !data` guard is preserved. |
| 1.4 login | `login-form.tsx` | POSTs to REST login, then `client.resetStore()` instead of `window.location.reload()`. Adds the failure toast that Apollo's error link used to provide. |
| 1.4 logout | `inopack-drawer.tsx` | `POST /auth/logout` (server-side revocation) before the reload. |
| — | `src/constants/api-url.ts` | Exports `apiHttpUrl` / `apiWsUrl` so the links and the REST calls cannot drift. |
| 🐞 found | `login-form.tsx` | **The password field was persisted to localStorage in plaintext.** It used the `useString` helper, which writes its value to `localStorage` on every keystroke — so `LoginForm_Password` held the user's actual password, and kept holding it after login. Switched to plain `useState` and added a one-time `removeItem` for anyone who already has one stored. The email keeps `useString`: that is a convenience, not a secret. |

### Phase 1 — deviations from the plan, and why

1. **Refresh-reuse grace window (new).** The plan says a re-presented rotated
   token is theft, full stop. In practice two browser tabs share one cookie and
   will present the same token within milliseconds of each other, which would log
   honest users out routinely. Reuse within `REFRESH_REUSE_GRACE_SECONDS`
   (default 30) is treated as that race and simply re-issues; outside it, the
   family dies. `.env.test` sets 0 so the theft test asserts the strict rule.
   The window is deliberately narrow in a second way: it applies **only while the
   family still has a live token**. A race always leaves one; logout, theft
   revocation and `revokeAllForUser` kill every row. Without that condition a
   logout could be undone by a stale tab, and theft detection would hand the
   thief a fresh pair seconds after firing. Both cases are covered by tests.
2. **Cookie `Path=/auth`, not `/auth/refresh`.** Path matching is per request
   path, so a cookie scoped to `/auth/refresh` never reaches `/auth/logout` and
   logout could not revoke anything. `/auth` still keeps it off `/graphql`, which
   is the property that matters.
3. **`POST /auth/logout` is `@Public()` and authenticates by the cookie.** The
   global `GqlAuthGuard` resolves its request through `GqlExecutionContext` and
   cannot authenticate a plain HTTP route at all (the same reason
   `FilesController` is public). Authenticating logout by the refresh cookie is
   also strictly better: an expired access token can still end its session.
4. **No `cookie-parser` dependency.** Reading one cookie is six lines, and
   hand-editing `package.json` desynchronises it from `package-lock.json`, which
   breaks `npm ci` — the install command this repo requires. `res.cookie()` /
   `res.clearCookie()` are Express core and need no package.
5. **The terminal "session is really gone" path still reloads.** The plan's goal
   — no reload when an access token expires — is met, because expiry is now
   invisible (refresh + replay). The reload survives only for the case where the
   refresh itself is rejected, where a full reset is what we want anyway and
   where flipping the auth boundary mid-flight has a documented history of
   subscription teardown loops (`docs/subscription-reconnect-fix.md`).
6. **The GraphQL `login` mutation is still there.** Kept for the cutover per the
   plan; nothing calls it now. **Delete it before Phase 2** — Phase 2 throttles
   the REST login route, and this mutation is an unthrottled way around it.

### Phase 1 — decisions

- **The refresh token is opaque random bytes, not a JWT.** Its only job is to
  name a database row, and that row is the authority. That is exactly what makes
  it revocable, which a JWT is not.
- **Stored as SHA-256, not bcrypt.** The input is 64 bytes of entropy, not a
  human password: there is nothing to slow down, and the lookup must be an
  indexed equality check.
- **Rotation re-reads the user.** This is the point where deactivating a user or
  revoking a role finally takes effect — within one access-token lifetime instead
  of never.
- **Login and logout stayed `@Public()` + manual validation.** Registering a
  global `ValidationPipe` for one controller would start validating every GraphQL
  input in the repo at the same time.
- **CORS became an allowlist.** Not a choice — credentialed requests cannot use
  `*`. Consequence: any browser origin not in `CORS_ORIGINS` loses API access.
  Non-browser callers are unaffected.

### Phase 1 — verification (all pending, user-run)

- ✅ **Done 2026-07-28** — `npm run db:generate`, `npm run db:test:rebuild`,
  `npm run test`: suite green, including the 12 new refresh-token cases. (The
  agent could not run `db:generate` itself — the running API holds
  `node_modules/.prisma/client/query_engine-windows.dll.node` open on Windows and
  Prisma fails with `EPERM`; stop the backend first.)
- ⬜ Typecheck / lint both repos.
- ⬜ Browser: log in, confirm the app loads with **no** token in localStorage
  (DevTools → Application → Local Storage) and a `refresh_token` cookie marked
  HttpOnly.
- ⬜ Browser: reload the page — the session must survive without the login screen.
- ⬜ Browser: leave the app open past 15 minutes (or set `JWT_ACCESS_TTL=1m`
  locally) and keep using it — queries must keep working with no toast and no
  reload, and subscriptions must survive a reconnect.
- ⬜ Browser: log out — confirm `POST /auth/logout` fires and that a second tab
  cannot keep working.
- ⬜ Still outstanding from Phase 0: role-gated pages behave (a Ventas user sees
  only client accounts) and file downloads still work.

### Phase 1.5 — what changed

The findings and their reasoning are in
[the plan's Phase 1.5 section](../../plans/ongoing/auth-refresh-throttling-mfa.md#phase-15--correctness-fixes-before-phase-2);
this is what the code now does.

**`nestjs-inopack-graphql`**

| Item | File | Change |
|---|---|---|
| 1.5.1 test teardown | `src/common/__tests__/helpers/setup-database.ts` | `refresh_tokens.deleteMany()` added to the level-4 block. Its FK to `users` is `RESTRICT`, so one surviving row made `users.deleteMany()` fail and killed the **second** consecutive run in global setup. |
| 1.5.3 cookie only on 401 | `src/modules/auth/auth.controller.ts` | The refresh `catch` clears the cookie only when the error is an `HttpException` with status 401 (new `isUnauthorized` helper). Anything else propagates as a 500 with the cookie intact, so a database blip no longer permanently logs users out. |
| 1.5.4 logout vs rotation | `src/modules/auth/auth.service.ts` | Rotation's `revokeToken` became a conditional `updateMany` on `{ id, revoked_at: null }`. `count === 0` means another request revoked the row first, and the response is **not** an automatic 401 — it re-reads the row and applies the same benign-race test as the reuse branch, now extracted into `isBenignRotationRace`. A concurrent rotation leaves a live successor and falls through; a concurrent logout leaves nothing live and correctly fails. |
| 1.5.4 seam | `auth.service.ts` | The rotation-time user re-read became `readActiveUser`. Same query, but it is the last read before the successor is written, which makes the race reproducible from a test. |
| 1.5.6 GraphQL login | `auth.resolver.ts`, `auth.service.ts`, `auth.dto.ts` | The `login` mutation, `AuthService#login` and the `AccessToken` `@ObjectType` are deleted. `LoginInput` stays as the shape the REST controller validates into — it is simply no longer reachable from any resolver, so it drops out of the generated schema. |
| 1.5.7 image env | `Dockerfile` | `ENV NODE_ENV=production` in the **runtime stage only** (not the builder, where it would change `npm ci`). The secret fail-fast and the `SameSite=none; Secure` cookie default no longer depend on an untracked server env file being right. |
| 1.5.8 CSRF | `src/common/constants/cors.ts` (new), `src/main.ts`, `src/modules/auth/guards/allowed-origin.guard.ts` (new), `auth.controller.ts` | `corsOrigins()` moved out of `main.ts` so the CORS config and the new guard read one list (resolved once — the guard runs per request and would otherwise re-warn on every login). `AllowedOriginGuard` is applied at the **class** level of `AuthController`, so a fourth cookie route cannot forget it. A present-but-unlisted `Origin` gets 403; an absent one is allowed, because browsers always send it on a cross-origin POST while curl, tests and server-to-server callers do not. |
| — | `auth.service.test.ts` | The two `AuthService#login` tests moved to `loginWithCredentials`. Two new tests spy on `readActiveUser` to interleave a logout / a competing rotation into `rotateRefreshToken`. ⚠️ **They test the branch decision, not atomicity** — `readActiveUser` runs *before* the conditional revoke, so neither touches the revoke→create window that Phase 1.6 item 1 covers. Keep them; do not read them as evidence the race is closed. |

**`react-inopack`**

| Item | File | Change |
|---|---|---|
| 1.5.2 token expiry | `src/services/auth/access-token.ts` | `adoptToken` decodes the JWT's payload segment and stores `exp * 1000`; `ensureAccessToken` refreshes when the token is missing **or** within 30s of expiry. An undecodable token stores `null`, which means *unknown* and is treated as **valid** — treating it as expired would refresh on every request. This is what makes a WebSocket reconnect past expiry present a fresh token instead of a dead one, and it makes HTTP refresh pre-emptively instead of after a 401 round trip. |
| 1.5.3 only 401 kills | `access-token.ts`, `src/services/apollo/init-apollo-client.ts` | `sessionKnownDead` is set only on 401/403. Any other non-2xx is handled like the existing network-error branch: drop the in-memory token, leave the session alive and retryable. `errorLink` correspondingly calls `endExpiredSession()` only when `isSessionKnownDead()`, since a `null` token now also means "the server had a bad moment". |
| 1.5.5 honest logout | `access-token.ts`, `src/app/app/inopack-drawer/inopack-drawer.tsx` | `logoutSession()` returns a boolean and keeps the in-memory token on failure. The drawer reloads only on success; otherwise it shows *"No se pudo cerrar la sesión, intenta de nuevo"* and stays put — JavaScript cannot clear an httpOnly cookie, so reloading after a failed call would have restored the session it just claimed to end. |
| 1.5.9 password sweep | `src/app/app/authorization-wrapper/login-form.tsx` | The cleanup iterates `localStorage` by index and removes every key ending in `_Password`, collecting first and deleting after (removing while iterating shifts the indices). CRA mangles `LoginForm.name` unstably across builds, so the old single-key removal could miss a password written by an earlier deploy. Plain `for` loop, no iterator spreading (es5 target). |
| 1.5.6 GraphQL login | `src/auth.gql`, `src/services/apollo/inopack-graphql-schema.ts` | The `Login` mutation is gone, along with its generated `LoginDocument` / `useLoginMutation` / `LoginMutation*` types and the now-orphaned `AccessToken`, `MutationLoginArgs` and `LoginInput` types. |

### Phase 1.5 — decisions and deviations

1. **The generated GraphQL file was hand-edited.** `codegen.yml` reads the schema
   from `http://localhost:3008/graphql`, so `npm run codegen` needs a running
   backend — which the agent does not start. The generated
   `inopack-graphql-schema.ts` was edited by hand to exactly what codegen will
   emit once the `login` mutation is gone from the running schema. **Re-run
   `npm run codegen` with the rebuilt backend up and confirm it produces no
   diff.** (`react-inopack/schema.graphql` is gitignored; it was updated locally
   for consistency and is regenerated by the same command.)
2. **The lost-the-race branch does not revoke the family.** It only 401s. In
   every realistic path that produces `count === 0` the family is already dead
   (logout, theft revocation) or deliberately alive (a concurrent rotation), so
   revoking again would be either a no-op or exactly the false positive the
   grace window exists to prevent.
3. **`isBenignRotationRace` takes `revokedAt` rather than the row**, so the
   lost-race branch can pass the freshly re-read value. The two callers share one
   decision, which is the point — they cannot drift apart.
4. ⚠️ **~~The residual rotation window is still open, deliberately.~~ Withdrawn
   — reopened as Phase 1.6 item 1.** The gap is not between the liveness check
   and the `create`, as the plan and this entry both said; it is between the
   **revoke** and the `create`, on the path every successful rotation takes. A
   logout landing there returns success and is then undone. The acceptance of
   this residual was based on the narrower description, so it does not carry.
5. **`AllowedOriginGuard` is a guard, not an inline check per route.** Applied at
   the controller class level it covers all three routes today and any route
   added later — these are the only paths a browser attaches the refresh cookie
   to, so forgetting it on a fourth is exactly the mistake to design out.
6. **The CORS allowlist is resolved once and cached.** The guard calls it per
   request; recomputing would re-emit the production "CORS_ORIGINS is not set"
   warning on every login. The environment does not change mid-process.

### Phase 1.5 — verification (all pending, user-run)

- ⬜ `npm run test` **twice in a row**, without `db:test:rebuild` in between.
  Both runs green. This is item 1.5.1's whole acceptance test, and the suite has
  three new cases (two rotation-race, plus the two migrated login cases).
- ⬜ `npm run codegen` in `react-inopack` with the backend running — confirm it
  reports no changes to `src/services/apollo/inopack-graphql-schema.ts`.
- ⬜ Typecheck / lint both repos.
- ⬜ Browser: set `JWT_ACCESS_TTL=1m`, open a page with a live subscription,
  leave it idle past expiry, force a reconnect (DevTools offline → online), and
  confirm the subscription resumes with no reload.
- ⬜ Browser: stop MySQL, trigger a refresh, confirm the user is **not** logged
  out and recovers when the database returns.
- ⬜ Browser: log out normally — confirm it reloads to the login screen. Then
  stop the API and log out again — confirm the Spanish error toast appears and
  the page does **not** reload.
- ⬜ Browser: put a `Whatever_Password` key in localStorage by hand, load the
  login screen, confirm it is gone.
- ⬜ `curl -X POST -H 'Origin: https://evil.example' <api>/auth/logout` → 403,
  and the same call with no `Origin` header still works.
- ⬜ Confirm a normal login still works from `http://localhost:3000` — the new
  guard rejects any origin missing from `CORS_ORIGINS`.

### Phase 1.6 — what changed

The findings and their reasoning are in
[the plan's Phase 1.6 section](../../plans/ongoing/auth-refresh-throttling-mfa.md#phase-16--close-the-rotation-race-properly-and-finish-the-login-removal);
this is what the code now does. **Nothing here has been run** — see the
verification list below.

**`nestjs-inopack-graphql`**

| Item | File | Change |
|---|---|---|
| 1.6.2 dead test | `src/modules/auth/auth.controller.test.ts` (was `auth.resolver.test.ts`) | Renamed, per Mauricio's decision: the file never tested the resolver, it tested logging in, and that moved to REST in 1.5.6. It now POSTs `/auth/login` and asserts a 200 with an `accessToken`. Sends no `Origin`, which `AllowedOriginGuard` allows by design. |
| 1.6.2 dead helper | `src/common/__tests__/helpers/get-token.ts` (deleted), `helpers/index.ts` | Deleted with its barrel export rather than migrated — it built the same dead mutation and had no callers. |
| 1.6.1 family lock | `src/modules/auth/auth.service.ts` | New private `lockFamily(tx, familyId)`: one `SELECT id, revoked_at, expires_at … WHERE family_id = ? FOR UPDATE`. Rotation wraps revoke → liveness check → successor insert in `$transaction`, opening with that lock. `revokeFamily` and `revokeAllForUser` take it too (the latter by `user_id`, a superset of any one family's rows), so the writer rotation must exclude — logout — actually is excluded. |
| 1.6.1 revoke | `auth.service.ts` | 1.5.4's conditional `updateMany` reverted to a plain update: under the lock no other writer can revoke the row, so the WHERE clause guarded nothing. The whole lost-the-race branch is gone with it — a rotation that arrives after the winner committed now finds a live successor and takes the pre-existing benign-race path instead of 401ing. |
| 1.6.1 plumbing | `auth.service.ts` | `issueTokenPair` and `revokeToken` take a client (`this.prisma` or `tx`); `isBenignRotationRace` takes the locked rows instead of querying, and is now synchronous; `revokeFamilyLocked` split out so rotation can revoke inside the transaction it already holds. |
| 1.6.4 dead dep | `auth.resolver.ts` | `AuthService` constructor parameter and import removed — `login` was its only user. |
| — | `auth.service.test.ts` | Two new tests plus a `raceInsideRotation` helper that opens the window at `issueTokenPair`. |

**`react-inopack`**

| Item | File | Change |
|---|---|---|
| 1.6.3 anonymous socket | `src/services/apollo/init-apollo-client.ts` | `connectionParams` distinguishes the two meanings of a null token. Session known dead ⇒ connect anonymously as before (the login screen's always-on subscriptions need that). Not known dead ⇒ **throw**, failing the connection attempt so the already-configured `shouldRetry` / `retryAttempts: Infinity` back off and retry, instead of leaving a healthy socket on which every protected subscription fails silently. |

### Phase 1.6 — decisions and deviations

1. **The failure paths return `null` instead of throwing.** Rotation's revoke
   and its successor insert now share a transaction, and an exception thrown
   inside a Prisma interactive transaction **rolls it back**. Throwing from the
   theft branch would therefore have revoked the family and immediately undone
   it — silently disabling theft detection while every existing test still
   passed. The callback returns `null` for "something was revoked, 401 the
   caller", and `rotateRefreshToken` throws after the transaction commits.
2. **`lockFamily` returns the rows it locks.** A locking read sees the latest
   committed data, but a *plain* read afterwards is served from the
   transaction's REPEATABLE READ snapshot and can still show pre-lock state.
   Reading the needed columns straight out of the `FOR UPDATE` result removes
   that trap; `isBenignRotationRace` now works off that array.
3. **The user re-read moved outside the transaction.** `readActiveUser` reads
   `users`, not the family, so it is not part of the invariant the lock
   protects, and holding a row lock across it would lengthen the critical
   section every concurrent rotation waits behind. It also keeps the two Phase
   1.5 race tests working: they spy on `readActiveUser`, and if that ran inside
   the lock, the competing operation they `await` there would block on it and
   deadlock the suite.
4. **The new tests synchronise explicitly; they do not sleep.** The seam cannot
   simply await the competing operation, because post-lock it blocks until the
   rotation commits. The first version waited a fixed 250 ms instead, which was
   wrong: a delay only *assumes* the competitor reached the window, so under a
   slow database or a starved connection pool the pre-fix implementation could
   have passed for the wrong reason — a false green on the one test whose whole
   job is to fail first. It now races two events, exactly one of which is
   reachable per implementation: the competitor **finishing** (only possible
   before the fix, where nothing blocks it, so its revoke is known to have
   committed) or the competitor **entering `lockFamily`** (only possible after
   it, where it must block there because the rotation already holds that
   family's lock). The `lockFamily` spy is armed inside the seam so it sees the
   competitor's call rather than the rotation's own, and is skipped when the
   method does not exist, which is what keeps the tests runnable against the
   pre-1.6.1 service. The seam also spreads its arguments rather than naming
   them, since 1.6.1 changed `issueTokenPair`'s signature.

   ⚠️ **The latch resolves on entry to `lockFamily`, before the locking query
   is issued** — necessarily, because resolving after would wait on a call that
   cannot return until the rotation commits. So it coordinates the interleaving
   and proves nothing about the lock: if `lockFamily` survived with its
   `FOR UPDATE` removed, both race tests could still pass. That gap is covered
   by the third test below, and the three only mean what they claim together.
5. **The lock itself is proven by contention, not by timing.** `the family lock
   blocks a second transaction on the same family` holds the family lock and has
   a second transaction attempt the same `lockFamily`, on **its own
   `PrismaClient`** so the one-second `innodb_lock_wait_timeout` it sets cannot
   leak onto a pooled connection the rest of the suite reuses. A real lock makes
   the contender fail with a lock wait timeout — a positive signal that says
   *why* it failed rather than an inference from how long something took, and
   the message match is what separates a genuine lock from `lockFamily` throwing
   for an unrelated reason. Without the `FOR UPDATE` the contender acquires
   immediately and the test fails. It then confirms the lock is released on
   commit. Unlike the two race tests this is a **mechanism** test, not a window
   test: against the pre-1.6.1 service it fails because `lockFamily` does not
   exist at all, which is a correct red rather than a demonstration of the bug.
6. **No migration and no schema change.** 1.6.1 is pure service logic; the
   `refresh_tokens` table is untouched.
7. **1.6.3's throw retries, but only because the thrown value is a plain
   `Error` — reviewed and confirmed 2026-07-28.** The concern raised was that
   graphql-ws 5.9.1 turns a throw in `connectionParams` into a 4005
   `InternalClientError` close, which is on its own fatal list and would bypass
   `shouldRetry`, terminating subscriptions rather than reconnecting. The close
   code is real but inert: the catch emits `error` *before* calling
   `socket.close(4005)`, `emit` is synchronous, and `errorOrClosed` is
   first-one-wins — it removes both listeners as it delivers the error, so the
   close event never reaches the retry logic. What that logic receives is the
   `Error`, and its fatal-code branch is gated on `isLikeCloseEvent`
   (`isObject(val) && 'code' in val && 'reason' in val`), which a plain `Error`
   fails. It falls through to `shouldRetry` and reconnects with backoff.
   **The footgun is now commented at the call site:** throwing anything carrying
   both `code` and `reason` would be read as a close event, match the fatal
   list, and kill every subscription. Re-check on a graphql-ws upgrade. This was
   established by reading `node_modules/graphql-ws/lib/client.js`, **not** at
   runtime — the browser check below is what actually confirms it.

### Phase 1.6 — verification (all pending, user-run)

⚠️ **Run the two new tests red first.** Both are written to fail against the
pre-1.6.1 service, and a test that cannot be made to fail is not testing the
window. Stash only `auth.service.ts` (`git stash push src/modules/auth/auth.service.ts`),
run them, confirm both fail, then restore:

- ⬜ `a logout inside the rotation window still ends the session` — expect
  `live` to be **1** before the fix, **0** after.
- ⬜ `a rotation that loses the window is not told its session is dead` —
  expect an `UnauthorizedException` before the fix, a token pair after.
- ⬜ `the family lock blocks a second transaction on the same family` — this one
  fails before the fix simply because `lockFamily` does not exist, which is a
  correct red but not a demonstration of the race. Its real check is a
  **mutation test**: with 1.6.1 applied, delete `FOR UPDATE` from `lockFamily`'s
  query and confirm this test fails while the two window tests may well still
  pass. That is the whole reason it exists, and it is the only way to see it
  working.
- ⬜ `npm run test` **twice in a row** without `db:test:rebuild` between them.
  This is also Phase 1.5.1's outstanding criterion, unreachable until now.
- ⬜ This machine has never had the Phase 1 migration applied — `npm run
  db:test:rebuild` is needed before the first run, with the backend stopped
  (Prisma's `EPERM` on the query engine DLL).
- ⬜ Typecheck / lint both repos.
- ⬜ Browser (1.6.3): stop the API, force a reconnect, restart the API, confirm
  subscriptions come back with no page reload.
- ⬜ Everything still outstanding from Phases 0, 1 and 1.5 above.

### Phase 1.7 — what changed

The reasoning is in
[the plan's Phase 1.7 section](../../plans/ongoing/auth-refresh-throttling-mfa.md#phase-17--structured-application-logging);
this is what the code now does. Backend only — `react-inopack` is untouched, and
there is **no migration, no Prisma model and no schema change**. **Nothing here
has been run** beyond typecheck and lint; see the verification list below.

**`nestjs-inopack-graphql`**

| Item | File | Change |
|---|---|---|
| 1.7.3 levels | `src/common/constants/logging.ts` (new) | `logLevels()`, env-backed, same shape as `constants/jwt.ts` / `constants/cors.ts`. Reads `LOG_LEVEL` as a *threshold* and returns the expanded tail; an unrecognised value throws at boot naming itself. Deliberately not memoised the way `corsOrigins()` is — it is called once, and the tests vary `NODE_ENV`. |
| 1.7.1 module | `src/common/modules/logging/logging.module.ts` (new) | Exports `AppLoggerService` and `RequestIdMiddleware`. **Not `@Global()`**, unlike `PrismaModule` / `PubSubModule` beside it: being imported explicitly is the point. |
| 1.7.1/1.7.2 logger | `src/common/modules/logging/app-logger.service.ts` (new) | `log/warn/error/debug(event, context)`. `LogContext` is a **closed** interface — no field exists for a password, an access token, a raw refresh token or a `token_hash`, so none can be passed. Values truncate at 200 chars; every emit body is wrapped in `try/catch` (Rule 1). |
| 1.7.4 correlation | `src/common/modules/logging/request-id.middleware.ts` (new) | `req.requestId = randomUUID().slice(0, 8)`, typed by declaration merging on Express's `Request`. Middleware rather than a controller helper, because guards run *after* middleware and `AllowedOriginGuard` logs too. |
| 1.7.3 wiring | `src/main.ts` | `NestFactory.create(AppModule, { logger: levels })` — that calls `Logger.overrideLogger` internally, so it applies process-wide. One `log`-level boot banner names the active threshold. |
| 1.7.4 plumbing | `src/common/dto/entities/auth/auth.dto.ts` | `SessionMeta` gains `requestId?: string`. Log-only; it cannot leak into `refresh_tokens` because `issueTokenPair` writes an explicit field-by-field allowlist rather than spreading `meta`. |
| 1.7.1 wiring | `src/modules/auth/auth.module.ts` | Imports `LoggingModule`; implements `NestModule` and applies `RequestIdMiddleware` to `auth/*` only. |
| 1.7.5/1.7.6 events | `src/modules/auth/auth.service.ts` | `logout` gains a `meta` parameter (the only signature change). The rotation `$transaction` callback now returns a discriminated `RotationOutcome` instead of `TokenPair \| null`, and **every** rotation log line is emitted after the commit, in a switch on `kind`. Eleven events across login / rotation / logout. |
| 1.7.5 events | `src/modules/auth/auth.controller.ts` | Injects the logger; the module-level `readCredentials` became a private method so `auth.login.malformed` can reach it. `sessionMeta(req)` populates `requestId`, and `logout` now passes it. |
| 1.7.5 events | `src/modules/auth/guards/allowed-origin.guard.ts` | Injects the logger; emits `auth.origin.rejected` at `warn` with the rejected origin in `reason` before the 403. |
| 1.7.8 tests | `src/common/constants/logging.test.ts` (new) | Per-`NODE_ENV` defaults, threshold expansion, and the boot failure on a bad value. |
| 1.7.8 tests | `src/common/modules/logging/app-logger.service.test.ts` (new) | Truncation, and Rule 1: a context whose getter throws must not make the call throw. |
| 1.7.8 tests | `src/modules/auth/auth.service.test.ts` | A `beforeAll` spy records every logged call for the whole run; four new cases assert the theft `error`, the attempted email on a failed login, `auth.logout.success`, and that **no** context anywhere carries a raw token, a hash, an access token or a forbidden key. The three Phase 1.6 race tests are unmodified. |
| 1.7.7 rotation | `.github/workflows/deploy-staging.yml`, `deploy-production.yml` | `--log-opt max-size=50m --log-opt max-file=5` on the long-lived `docker run -d` (not the `--rm` migration container). Docker's default json-file driver has no size limit and nothing collects these logs. |
| 1.7.9 docs | `.env.example`, `.env.test` | A `LOG_LEVEL` block explaining the threshold semantics; `LOG_LEVEL=warn` in the test env so the suite output stays readable. |

**Phase 1.7.10 — the `verbose` trace tier** (same branch, added after the rest of
1.7 landed):

| Item | File | Change |
|---|---|---|
| Re-tiering | `src/common/constants/logging.ts`, `src/modules/auth/auth.service.ts` | Nest orders `debug (0) < verbose (1) < log (2) < warn (3) < error (4)`, so **`debug` is the most inclusive level, not the least**. §1.7.5 had put the routine events at `debug` and left `verbose` empty, which would have made a step trace at `verbose` *hide* `auth.refresh.rotated`. The six routine events (`auth.refresh.rotated`, `.race`, `.no_token`, `.expired`, `auth.logout.unknown_token`, `.no_token`) moved to `verbose`, and the non-production / non-test default moved from `debug` to `verbose`. Granularity now increases monotonically as the level drops. |
| Trace API | `src/common/modules/logging/app-logger.service.ts` | New `verbose()` (completing the mirror of Nest's level names) and `trace()`, which emits at Nest's `debug` — the bottom rung, so the trace is the last thing on and the first thing off. `LogContext` gains `detail?: string` and `count?: number`; still a closed allowlist, still no credential field. |
| Buffer | `src/common/modules/logging/trace-buffer.ts` (new) | `TraceBuffer.add()` is an array push, not I/O, so it cannot roll a transaction back and does not lengthen the `FOR UPDATE` critical section; `flushTo(logger)` emits and empties. A plain class, one instance per rotation — a shared singleton would interleave two concurrent rotations into one unreadable stream. `add` and `flushTo` are both wrapped in `try/catch`. |
| Trace points | `src/modules/auth/auth.service.ts` | 19 `auth.trace.*` points across `loginWithCredentials`, `rotateRefreshToken` and `logout`. The buffered span is exactly the `$transaction` callback; `rotateRefreshToken` builds the buffer before the transaction, the callback only calls `trace.add`, and the flush plus `auth.trace.rotate.flushed` run in a `finally` around the `await` — before the outcome switch, so every outcome including the four 401s **and a transaction that throws** gets a complete narration (see deviation 10). **Zero `this.logger` calls inside the callback**, verifiable in the diff. |
| Tests | `src/common/modules/logging/trace-buffer.test.ts` (new) | Nothing emits before `flushTo`; a second flush cannot duplicate; `add` never throws on a hostile context; one bad entry does not lose the rest of the flush. |
| Tests | `src/common/constants/logging.test.ts`, `app-logger.service.test.ts`, `auth.service.test.ts` | The re-tiered defaults; `verbose` and `trace` land on the levels they claim; `auth.refresh.rotated` is asserted at `verbose`; and a new case checks the buffered span arrives as one block ending at `flushed`, with the outcome line after it. The auth suite's recording spy now also captures `verbose` and `trace`, so the redaction assertion scans the ~19 new trace contexts too. |
| Docs | `.env.example` | The `LOG_LEVEL` block now shows the full ladder and what each rung adds; the sample value moved from `debug` to `verbose`. |

### Phase 1.7 — decisions and deviations

1. **The wrapper's Nest `Logger` context comes from the event's namespace, not
   from the calling class.** The plan says "a Nest `Logger` whose context is the
   calling class"; getting the actual caller needs `Scope.TRANSIENT` plus
   `INQUIRER`, and a transient provider hands every consumer its own instance —
   which directly contradicts §1.7.8, where the tests replace one provider with
   a spy and expect to observe what the service logs through. So
   `auth.refresh.theft` renders under `[Auth]`: same "which part of the app"
   column, one instance, still mockable.
2. **The test spy replaces the resolved singleton's methods rather than
   overriding the provider.** `setupApp()` builds the whole `AppModule` and has
   no override seam, and adding one would change a helper every other suite in
   the repo shares. `app.get(AppLoggerService)` resolves the same instance
   `AuthService` holds, so the observation surface is identical.
3. **`auth.refresh.rotated` reports the *spent* token's id.** The successor's id
   is not returned by `issueTokenPair`, and the spent one is the value a reader
   already has from the preceding line.
4. **`auth.login.malformed` does not log the attempted email.** It fires exactly
   when the field is not a string, so there is no attempted address to record —
   only arbitrary input, and `LogContext` types `email` as a string.
5. **The rotation refactor kept `issueTokenPair`, `readActiveUser` and
   `lockFamily` at their current signatures and call positions**, as §1.7.6
   requires: the Phase 1.6 tests spy on all three to open their seams.
6. **1.7.10: `AppLoggerService.debug()` is kept even though nothing calls it.**
   After the re-tiering, `debug` holds the step trace and nothing else, and the
   trace goes through `trace()`. `debug()` stays because §1.7.1's stated design
   is an API that "mirrors Nest's level names", and this is a general facility
   other modules adopt on demand — a level mirror with a hole in it is worse
   than an uncalled method. It is exercised by `app-logger.service.test.ts`.
7. **1.7.10: `TraceBuffer` gained a `size` getter** beyond the spec's
   `add` / `flushTo`. `auth.trace.rotate.flushed` reports how many lines it
   emitted, and `flushTo` empties the buffer, so the count has to be read first.
   A read-only getter leaves `flushTo(logger): void` exactly as specified.
8. **1.7.10: the buffer reaches the callback by closure, not as a parameter.**
   Prisma fixes the callback signature at `(tx) => …`.
9. **1.7.10: `race_verdict`'s "ms since revocation" is recomputed** rather than
   returned from `isBenignRotationRace`, whose signature the Phase 1.6 tests
   depend on. It is two `getTime()` calls — no query, nothing that can fail
   under the lock.
10. **~~1.7.10: the buffer is not flushed if `$transaction` itself throws.~~
    Closed 2026-07-30.** The gap was real — a lock wait timeout, a dropped
    connection or a deadlock discarded that request's narration, which is
    precisely the narration most worth having. The flush now sits in a
    `finally`.

    The obvious form, `.finally()` on the promise, does **not** compile: this
    repo targets `es2017` and `Promise.prototype.finally` is ES2018. Raising the
    target to reach it would change how the whole backend compiles, on a branch
    about to ship — not a trade worth making for a log line.

    So `$transaction(...)` is assigned to a `rotation` promise and awaited in a
    `try`, with the flush in the `finally`. That keeps the ~128-line callback at
    its existing indentation, so the diff of Phase 1.6's critical section stays
    reviewable instead of being buried under a whole-block re-indent. A promise
    is eager, so splitting the call from the `await` does not change when the
    transaction runs, and the `try` attaches in the same tick — there is no
    window for an unhandled rejection. The `finally` cannot mask the original
    exception: every `AppLoggerService` method swallows its own errors (Rule 1)
    and `flushTo` is `try/finally`.

### Phase 1.7 — verification (all pending, user-run)

⚠️ **The suite could not be run on this machine.** The generated Prisma client in
`node_modules/.prisma` predates the Phase 1 `refresh_tokens` model, so Jest's
`globalSetup` fails in `setup-database.ts` before any test executes
(`Property 'refresh_tokens' does not exist on type 'PrismaService'`). That is the
same blocker Phase 1.6 recorded, and it needs `npm run db:generate` with the
backend stopped.

- ⬜ `npm run db:generate` (backend stopped — Prisma's `EPERM` on the query
  engine DLL), then `npm run test` **twice in a row**.
- ⬜ The three Phase 1.6 race tests still pass, **byte-for-byte unmodified**. If
  one needs editing to go green, the 1.7.6 refactor changed behaviour rather
  than observation.
- ⬜ `LOG_LEVEL=verbose` shows `auth.refresh.rotated`; `LOG_LEVEL=log` does not,
  while `auth.login.success` and `auth.refresh.theft` still appear.
- ⬜ (1.7.10) `LOG_LEVEL=debug` narrates a full login → refresh → logout with
  `auth.trace.*` lines; `LOG_LEVEL=verbose` shows the §1.7.5 events and **no**
  trace lines; `LOG_LEVEL=log` shows neither.
- ⬜ (1.7.10) The trace lines emitted from inside the rotation transaction
  appear **after** it commits — and the redaction grep below still finds zero
  matches at `LOG_LEVEL=debug`, which is the level that prints the most.
- ⬜ An invalid `LOG_LEVEL` fails at boot with the bad value named.
- ⬜ Grep the complete log output of a login → refresh → logout cycle for the
  raw refresh token and for its SHA-256 hash: **zero matches**.
- ⬜ Two concurrent requests carry different `requestId` values, and every line
  of one request shares one.
- ⬜ `docker inspect` on a deployed container reports the two log options.

### Authentication learning guide

The tutorial, diagrams, numbered reading order, checkpoint questions, complete
function call flows, and later test-learning path live in the separate
[authentication learning guide](../../guides/authentication-mfa-learning-guide.md).
Keeping the tutorial separate makes this feature record remain a concise source
of truth for status, decisions, rollout, and verification.

### Rollout policy (revised 2026-07-28)

⚠️ **Revised.** The earlier policy — all four phases built and tested locally
before anything ships — no longer applies. Phases 0–1.6 ship **together, as one
unit, all the way to production**, and Phase 2 is not started until they are
there. The authoritative statement is
[Rollout and sequencing](../../plans/ongoing/auth-refresh-throttling-mfa.md#rollout-and-sequencing)
in the plan; the order is:

1. Local verification of Phases 0, 1, 1.5 and 1.6 together (the lists above).
2. Mauricio approves. Nothing moves before this.
3. Ship to `stage` — **after** setting the deployment prerequisites below on the
   staging server, not after the push.
4. Extended manual testing on `stage` until demonstrably stable.
5. Ship to production.
6. Only then begin Phase 2.

What carries over unchanged: nothing goes to `stage` without approval, and no
phase ships on its own.

### ⚠️ Deployment prerequisites — before the branch reaches `stage`

1. **Add both variables to the server env file, or the API will not boot**
   (`NODE_ENV=production` makes the missing secret a hard failure):
   - staging `162.243.171.217`: `/root/inopack/.env`
   - production `159.223.100.185`: `/root/inopack.env`
   ```bash
   openssl rand -base64 48
   ```
   Staging redeploys on every push to `stage`, so the env file must be updated
   **before** the first push, not after.
2. **Everyone is logged out once.** Both the signing secret and the payload
   shape change, so every existing 12h localStorage token becomes invalid. The
   frontend's existing `errorLink` already handles this (toast "Sesión expirada"
   → reload → login). The plan accepts this (§1.5).
3. **⚠️ Phase 1 — `CORS_ORIGINS` must be set on both servers, or the frontend
   stops working entirely.** The API no longer answers `Access-Control-Allow-
   Origin: *`; it answers with an allowlist, because a wildcard cannot carry
   credentials and the refresh cookie is credentialed. Set it to the exact
   Netlify origin for that tier, scheme included, comma-separated if there is
   more than one:
   ```
   CORS_ORIGINS=https://<netlify-origin-for-this-tier>
   ```
   **This value is not recorded anywhere in the repo** — [deployment.md](../../deployment.md)
   documents the API hosts (`inopack-api.mauaznar.com`,
   `staging-inopack.mauaznar.com`) and the `REACT_APP_API_URL` each Netlify
   context uses, but not the Netlify site's own domain. Read it off the Netlify
   dashboard (or the browser address bar) before the first push to `stage`, and
   include the custom domain as well if one is configured.
4. **Cookie `SameSite` defaults to `none` in production** (with `Secure`),
   because a Netlify origin and `*.mauaznar.com` are different registrable
   domains, i.e. cross-site — `lax` would make the browser silently drop the
   cookie and nobody could stay logged in. If the frontend ever moves onto a
   `*.mauaznar.com` host, set `AUTH_COOKIE_SAMESITE=lax`, which is stronger.
5. **✅ Resolved in Phase 1.5 (item 1.5.7): the runtime image now pins
   `ENV NODE_ENV=production`.** It previously came only from the server env
   files (`/root/inopack/.env`, `/root/inopack.env`), since both GitHub Actions
   workflows start the container with `--env-file` and nothing else, and two
   behaviours hinge on it: the hard boot failure on a missing JWT secret
   (without it the API quietly falls back to the development secret that is
   public in this repository) and the cookie's `SameSite=none; Secure` default
   (without it the cookie is `lax` and not `Secure`, so the browser drops it
   cross-site — login *appears* to succeed and the session simply never
   persists, with nothing in the logs). An env file can still override the image
   value deliberately, so setting `AUTH_COOKIE_SAMESITE=none` explicitly is
   still worth doing; it just is no longer load-bearing.
6. **The new `refresh_tokens` migration runs on deploy** like any other; no
   manual step, but it is the first schema change on this branch.

#### Summary — what each env file needs

| Variable | Required? | Notes |
|---|---|---|
| `NODE_ENV=production` | No (Phase 1.5) | Now pinned in the runtime image. An env file still overrides it, so do not set it to anything else. |
| `JWT_ACCESS_SECRET` | **Yes** (Phase 0) | `openssl rand -base64 48`. Different value per tier. |
| `JWT_FILE_SECRET` | **Yes** (Phase 0) | Same generator, different value. |
| `CORS_ORIGINS` | **Yes** (Phase 1) | Exact Netlify origin for that tier, scheme included, no trailing slash. |
| `AUTH_COOKIE_SAMESITE=none` | Recommended | Not strictly required if `NODE_ENV=production` is set, but makes the cookie independent of it. |
| `JWT_ACCESS_TTL` | No | Defaults to `15m`. |
| `REFRESH_TTL_DAYS` | No | Defaults to `14`. |
| `REFRESH_REUSE_GRACE_SECONDS` | No | Defaults to `30`. |
| `LOG_LEVEL` | No (Phase 1.7) | Threshold, not a list: the named level and every louder one. `debug < verbose < log < warn < error`, so `debug` is the **most** inclusive. Defaults to `log` in production (`verbose`-level rotation success stays off), `warn` under `NODE_ENV=test`, `verbose` otherwise. **An unrecognised value is a hard boot failure** and names itself in the error. |

## Decisions

- **`req.user` keeps an `id` field** rather than exposing `sub` to call sites.
  The plan's payload is `sub`/`email`/role ids; mapping `sub → id` inside
  `JwtStrategy#validate` gives the same slim token without touching ~50
  resolvers.
- **Development keeps a fallback secret.** Failing fast in dev and test too
  would have meant every worktree and CI checkout needs an env edit before it
  runs, for no security gain — the fallback value is only ever used where the
  old hardcoded `'secretKey'` already applied.
- **Legacy REST routes deleted rather than deprecated.** Confirmed no consumer
  in `nestjs-inopack-graphql`, `react-inopack`, or `react-dashboards`.
- **Type annotations left as `User` on the ~42 other `@CurrentUser()`
  parameters.** They only read `.id` / `.email`, both still present. Sweeping
  them to `AuthenticatedUser` is cosmetic and would have tripled the Phase 0
  diff; do it opportunistically.
- **`grace=0` is a strict mode, not a knife-edge (2026-09-08).**
  `isBenignRotationRace` short-circuits a zero/negative grace window to "always
  theft" before the timestamp math, because `refresh_tokens.revoked_at` is
  `DATETIME(0)` and MySQL rounds a just-revoked token up to ~0.5s in the future —
  which made `now - revoked_at` negative and let a strict `grace=0` replay slip
  through as benign. The production default (30s) dwarfs the rounding and is
  unchanged.
- **Activity subscription is role-gated server-side (2026-09-08, folded in).**
  The `activity` feed was ungated — every socket saw every entity's snackbar
  (Ventas saw Gastos and vice-versa). Pre-existing on `dev`, not an auth-branch
  regression, but fixed here. Two layers: a `@RolesDecorator` **admits** the
  socket (coarse, all-or-nothing, all it can be for a one-topic multi-entity
  feed), and a per-event `@Subscription({ filter })` enforces **strict
  per-module isolation** via `ACTIVITY_VISIBILITY` + `canSeeActivity`. Policy:
  Sales/Production/Expenses each see only their module; employees → Production +
  HR; resources → Expenses; users → Super only; global roles (Super / General /
  Asistente General) see all (users still Super-only). The `paginatedActivities`
  **query** is intentionally left open (GENERAL_VIEW, no snapshots).
- **One shared role rule, `roleSatisfiesGate` (2026-09-08).** Extracted the
  guard's global-role semantics into `src/modules/auth/role-access.ts`; both
  `GqlRolesGuard` and the activity filter call it, so the two cannot drift. The
  guard structurally cannot do the per-event filtering itself — it runs once at
  subscribe time and never sees the per-event payload — so the entity→roles
  mapping stays in the resolver.

## Remaining work

- Run the Phase 1, Phase 1.5 **and** Phase 1.6 verification lists above, then
  Phase 2 → 3 per the plan.
- ⚠️ **`npm run codegen` in `react-inopack` is still unconfirmed.** Phase 1.5
  hand-edited the generated `src/services/apollo/inopack-graphql-schema.ts`
  because `codegen.yml` reads the schema from a running backend. Run it with the
  backend up and confirm it produces no diff before trusting that file. Phase 1.6
  touched no `.gql` file, so it does not change what codegen should emit.
- ✅ **Done in Phase 1.5:** the GraphQL `login` mutation is deleted in both repos.
- **Resolved (Phase 1): the files/memory-token secret mismatch is unreachable.**
  `FilesController` verifies with `authSecret` while `MemoryTokenService` signs
  with `fileSecret`, but `MemoryTokenService` has **no callers anywhere in the
  backend**, and no code in `react-inopack` requests a `/files/:token/:filename`
  URL. Nothing signs a file token, so nothing can fail to verify one. Left
  untouched rather than "fixed" — picking a mapping for a dead path is guesswork.
  The real question is whether the whole files/memory-token surface should be
  deleted; that is a separate cleanup, not auth hardening.
- ✅ `LocalStrategy` deleted in Phase 1 (registered as a provider, never used by
  any guard).
- Refresh rows are swept only on the owner's next login. If the table ever grows
  enough to matter, add a scheduled cleanup — not needed at this user count.
