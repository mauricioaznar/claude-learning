# feature/auth-mfa-phase2

Auth Phase 2/3: post-production-rollout hardening (see plan auth-refresh-throttling-mfa)

Continuation of the auth hardening program. Phases 0–1.7 (env secrets, slim JWT,
refresh-token rotation, CSRF origin guard, structured logging) shipped to
**production on 2026-09-08** and are now live; this branch picks up the two phases
that were deliberately gated on that rollout.

**Plan (source of truth):**
[docs/plans/ongoing/auth-refresh-throttling-mfa.md](../../plans/ongoing/auth-refresh-throttling-mfa.md)
— Phase 2 §2.1–2.2, Phase 3 §3.1–3.4, Cross-cutting, and Rollout and sequencing.
**What already shipped:**
[docs/features/archived/feature-authentication-mfa.md](../archived/feature-authentication-mfa.md).

## Goals

- **Phase 2 — Throttling & brute-force protection.** Per-IP rate limits on the REST
  auth routes and per-account lockout, so the rewritten login surface cannot be
  brute-forced. (Plan §2.1–2.2.)
- **Phase 3 — Email MFA + user administration.** Re-scoped 2026-09-09 (was TOTP):
  email one-time-code MFA, a per-user "enforce MFA" flag (accounts without it skip
  MFA), and a super-user password reset that forces the target to set a new password
  at next login. TOTP is deferred. (Plan §3.1–3.4 — rewritten.)

The plan's build order is strict: **Phase 2 before Phase 3** — both change the login
path Phases 0–1 rewrote, so they stack on that surface one at a time
(plan → Rollout and sequencing, Suggested build order).

## Status

**PHASE 2 + PHASE 3 (BACKEND + REACT) CODE COMPLETE, NOTHING VERIFIED (2026-09-09).**
Phase 2 (throttling, per-account lockout, unified message, trust-proxy), the Phase 3
**backend** (email MFA, per-user enforce flag, super-user forced-password-change gate),
and the Phase 3 **React** frontend (MFA code screen, forced-password-change screen,
users-panel MFA checkbox + super-user reset) are all written but unrun. Per Mauricio's
instruction, Phase 2 was **not** verified on its own — the phases are tested together.
The React work still needs `npm run codegen` (backend up) to regenerate the committed
hooks it consumes, then the user's own frontend+backend run — see **Implemented — Phase 3
React** below.

Verification is blocked on the user's machine actions: `npm install` (pulls
`nodemailer` + `@nestjs/throttler`), `npm run db:generate` (types the new columns +
`email_mfa_codes` model), `npm run db:test:rebuild` (applies both new migrations), then
`npm run test` and typecheck. See **Verification** below.

Branched from `origin/dev` after the Phase 0–1.7 unit reached production, so it
already contains all shipped auth work.

**⛳ Prod rollout is gated on [api-hostname-migration](../../plans/archived/api-hostname-migration.md) (✅ complete 2026-09-11).**
That migration moves the API onto `*.grupoinopack.app` (same-site refresh cookie `None→Lax`)
and stands up the `grupoinopack.app` mail identity (SPF/DKIM/DMARC) this feature's prod
email-MFA needs. Do the migration first; this feature reaches prod as its Phase D
(`dev → master`, **not** `feature → master`). Stage verification (the Phase 2/3 checklist)
can proceed independently in the meantime.

## Decisions

Design decisions already settled in the plan (not re-litigated here):

- Login throttling targets the **REST** `POST /auth/login` (5/min/IP) and
  `POST /auth/refresh` (10/min/IP) — one reason the GraphQL `login` mutation was
  deleted in Phase 1.5.6; a GraphQL login would be an unthrottled bypass.
- Lockout state lives in **DB columns** on `users` (`failed_login_count`,
  `lockout_until`), not Redis — fine at this user count. 5 failures ⇒ 15-min lockout.
- Login responses must **not distinguish** unknown user / wrong password / locked
  (unified Spanish message; dummy bcrypt compare to equalize timing).
- Phase 3 MFA (re-scoped 2026-09-09) uses a short-lived `mfaToken` (`purpose: "mfa"`,
  `MFA_TOKEN_SECRET`) that only grants the verify endpoint. Channel is **email**, not
  TOTP — no encrypted secret, no `MFA_ENC_KEY`.

_New decisions taken during implementation get appended here._

**Phase 2 implementation decisions (2026-09-09):**

- **Throttling scoped to the auth REST routes, not global GraphQL** — a deliberate
  deviation from the plan's "generous global 100/min/IP". Two reasons: (1) most users
  share one facility WAN IP, so a per-IP cap on GraphQL would throttle the whole office
  as a single client on a normal dashboard query burst; (2) this app's GraphQL context
  exposes only `{ req }` (no `res`), so a global GraphQL-aware guard needs extra
  plumbing for no acceptance-criteria gain — only the login route is tested. `@Throttle`
  sits on `POST /auth/login` (5/60) and `/auth/refresh` (10/60) via `ThrottlerModule`
  registered inside `AuthModule`. **Revisit if a global GraphQL cap is wanted.**
- **Lockout fires on the 5th consecutive wrong password** (plan §2.2: "5 consecutive
  failures ⇒ 15-min lockout"), so the 6th attempt is refused by the lock. The counter
  resets to 0 when the lock lands, so the account starts fresh after the window.
- **All limits/timings are env-configurable** through
  `src/common/constants/login-protection.ts` (`AUTH_THROTTLE_*`, `LOGIN_MAX_FAILED_ATTEMPTS`,
  `LOGIN_LOCKOUT_MINUTES`, `TRUST_PROXY_HOPS`), with the plan's numbers as defaults —
  no `.env` change required to ship the defaults.
- **`TRUST_PROXY_HOPS` defaults to 1** (single Nginx). ⚠️ This must match the real prod
  topology: too low collapses every client to the proxy IP (throttled as one), too high
  lets a client spoof `X-Forwarded-For` to dodge the limit. Confirm the hop count on the
  server before relying on per-IP limits in prod.
- **Timing equalization** uses a `bcrypt.hashSync` dummy hash computed once at module
  load; unknown emails pay the same compare cost as wrong passwords.
- Rate-limit state is **in-process memory** (`@nestjs/throttler` default storage): it
  resets on API restart and is per-instance. Acceptable for login throttling at this
  scale; the per-account lockout (DB-backed) is the durable, cross-instance protection.

## Implemented — Phase 2 (plan §2.1–2.2)

Files touched (all `nestjs-inopack-graphql`):

- `package.json` — added `@nestjs/throttler@^2.0.1` (v2 is the Nest-8 line).
- `src/common/constants/login-protection.ts` **(new)** — single access point for the
  rate limits, lockout numbers, trust-proxy hops, and the shared Spanish
  `LOGIN_FAILED_MESSAGE`; all env-configurable with the plan's defaults.
- `src/db/migrations/1789000000000-AddLoginLockoutColumns.ts` **(new)** — adds
  `users.failed_login_count` and `users.lockout_until`. A separate migration, not an
  edit to the shipped `CreateRefreshTokens` one (that has already run in prod).
- `prisma/schema.prisma` — mirrored the two columns on `model users`.
- `src/modules/auth/auth.module.ts` — `ThrottlerModule.forRoot(...)` scoped to this module.
- `src/modules/auth/auth.controller.ts` — `ThrottlerGuard` class-wide, `@Throttle` on
  login (5/60) and refresh (10/60), and the malformed-body 400 now uses the shared message.
- `src/main.ts` — `app.set('trust proxy', trustProxyHops())`.
- `src/modules/auth/auth.service.ts` — lockout bookkeeping folded into `validateUser`
  (increment on wrong password, freeze at the threshold, reset on success), dummy-hash
  timing equalization, `registerFailedLogin` helper, shared Spanish message.
- `src/modules/auth/auth.service.test.ts` — message assertion pinned to the constant;
  new `login lockout` describe (locks at threshold + refuses correct password while
  locked; resets counter on success).

Acceptance: 6th rapid login/IP rejected · 6th consecutive wrong password locks the
account across IPs · responses don't distinguish the three failure causes. **All coded,
none verified yet** — see verification below.

## Verification (the user runs these)

1. `cd nestjs-inopack-graphql && npm install` — pull `@nestjs/throttler` into the lock.
2. `npm run db:generate` — regenerate the Prisma client so `failed_login_count` /
   `lockout_until` are typed (otherwise the service + tests won't compile).
3. `npm run db:test:rebuild` — apply the new migration to the test DB.
4. `npm run test` — the `login lockout` tests are the Phase 2 coverage; the whole suite
   must still pass (twice consecutively, per the standing rule).
5. Typecheck/lint both repos.
6. Browser/manual: 6 rapid logins from one client → the 6th is a 429; 5 wrong passwords
   → account locked ~15 min and the *correct* password is refused with the same generic
   message; confirm the message reads identically for unknown email, wrong password, and
   locked.
7. Before stage/prod: confirm `TRUST_PROXY_HOPS` matches the real proxy topology.

## Implemented — Phase 3 backend (plan §3.1–3.4)

Files touched (all `nestjs-inopack-graphql`):

- `src/db/migrations/1789100000000-AddEmailMfaAndPasswordReset.ts` **(new)** —
  `users.mfa_enabled`, `users.must_change_password`, and the `email_mfa_codes` table
  (hashed code, short TTL, `attempts`, `consumed_at`). Separate migration from the
  frozen Phase 2 one.
- `prisma/schema.prisma` — mirrored the two columns (as `Boolean`, see the
  compile-fix decision below) + the new model.
- `src/common/__tests__/helpers/setup-database.ts` — deletes `email_mfa_codes` before
  `users` (the §1.5.1 RESTRICT-FK trap, now for the new table).
- `src/common/constants/mfa.ts` **(new)** — `MFA_TOKEN_SECRET` (fail-fast in prod like
  `JWT_ACCESS_SECRET`), code length/TTL/attempt cap, `mfaToken` TTL, and the two
  interstitial `purpose` claims.
- `src/common/constants/mail.ts` **(new)** — transport selection (SMTP when `MAIL_HOST`
  set; console in dev; **`unconfigured` → throws in prod** so codes never leak to logs).
- `src/common/constants/login-protection.ts` — added `mfaVerifyLimit` (10/min) and
  `mfaResendLimit` (3/min) to `authThrottle`.
- `src/common/modules/mail/` **(new)** — `MailService` (nodemailer behind a one-seam
  switch) + `MailModule`, imported explicitly by `AuthModule`.
- `src/modules/auth/auth.service.ts` — `loginWithCredentials` now returns a three-way
  `AuthOutcome`; `decideAfterPassword` forks (password-change → MFA → tokens);
  `createSession`, `verifyMfaCode`, `resendMfaCode`, `requirePasswordChange`,
  `changePassword`, and the code/token helpers.
- `src/modules/auth/auth.controller.ts` — `POST /auth/mfa/verify`, `/auth/mfa/resend`,
  `/auth/password/change`; `respondWithOutcome` maps the outcome (cookie only on tokens).
- `src/modules/auth/auth.resolver.ts` — super-user `resetUserPassword` mutation
  (re-injects `AuthService`); `mfa_enabled` accepted on create/update, surfaced on `User`.
- `src/modules/auth/user.service.ts` — persists `mfa_enabled`; audit snapshot now
  includes `mfa_enabled` + `must_change_password`.
- `src/common/dto/entities/auth/auth.dto.ts` — `mfa_enabled` on `User`/inputs; the two
  flags on `UserWithRoles`.
- `package.json` — `nodemailer@^6.9.13` + `@types/nodemailer`.
- `.env.example` / `.env.test` — MFA + mail blocks; `MFA_TOKEN_SECRET`.
- Tests: `src/modules/auth/auth.mfa.service.test.ts` **(new)** — MFA issue/verify,
  attempt cap, single-use, expiry, resend-invalidation, hash-only storage, super-user
  reset, gate composition, interstitial-token isolation, code-redaction. Existing
  `auth.service.test.ts` updated for the new `AuthOutcome` return.

**Phase 3 backend decisions (2026-09-09):**

- **Mail transport is provider-agnostic and fails closed.** `MailService` picks SMTP
  (nodemailer) when `MAIL_HOST` is set, a console transport in dev (logs the code at
  `debug` — testable with no mail server), and refuses to send in production when
  unconfigured. A mail outage therefore *denies* an MFA-enforced login rather than
  leaking a code to `docker logs` or granting access. No paid service is required for
  the code volume; any SMTP relay (Workspace / domain host / a free transactional tier)
  works. **Real SMTP must be set on stage/prod before any account has `mfa_enabled=1`.**
- **Gate order: forced password change → MFA → tokens**, in one shared
  `decideAfterPassword`. `changePassword` re-enters it, so an MFA-enforced user who was
  just forced to rotate still hits the MFA step — the gates compose, neither bypasses
  the other (honours acceptance criterion 1).
- **Two interstitial tokens, one secret, two `purpose` claims** (`mfa`,
  `password_change`), signed with `MFA_TOKEN_SECRET`. The purpose is always checked, so
  neither can be replayed on the other's endpoint or as an access token. `mfaToken` TTL
  defaults to the code TTL so it never dies while a valid code is still in the inbox.
- **The super-user reset sets no working password.** It flags
  `must_change_password=1` and revokes the target's refresh families; the target
  authenticates with their *current* password to reach the change gate, then must pick
  a new one. This is a forced-rotation feature, not a forgotten-password recovery (which
  would need a mailed reset link — deliberately out of scope).
- **Code brute-force is bounded twice**: a per-code `attempts` cap (burns the code) and
  a tight per-IP throttle on `/auth/mfa/verify`. Codes are single-use (`consumed_at`),
  short-TTL, and a resend invalidates prior unconsumed codes. Only the SHA-256 is stored.
- **The reset mutation is not activity-audited** (unlike create/update) — it is a
  security action captured by the structured `auth.password.reset_by_admin` log instead.
  Toggling `mfa_enabled` *is* audited: it flows through `updateUser`, and the snapshot
  `select` now lists the flag.

**Phase 3 backend compile fix (2026-09-09) — the two flag columns are `Boolean`, not
`Int`:** The first `nest build` of this code failed with 9 type errors. The columns were
mirrored in `schema.prisma` as `Int @db.TinyInt`, so Prisma typed them `number`, which
clashed with the GraphQL `@Field(() => Boolean) mfa_enabled: boolean` on the `User` DTO —
every function that returns a raw `users` row as a `User` (the repo's normal pattern)
broke, and `UserWithRoles` redeclared the flags as `number` against the base `boolean`.
This repo models **all** TINYINT(1) booleans as Prisma `Boolean` (44 of them); the two
Phase 3 columns were the only deviation. Fix: `schema.prisma` → `Boolean @default(false)`
(the migration's `tinyint(1)` DDL is unchanged — Prisma maps `Boolean` to `TINYINT(1)` in
MySQL); the two `? 1 : 0` writes → `true/false`; `AuthUser` and the `UserWithRoles`
`must_change_password` decl → `boolean`; the redundant `UserWithRoles.mfa_enabled`
redeclaration dropped (inherited from `User`). The GraphQL `User.mfa_enabled` field stays
`Boolean`, so the React codegen output is unaffected. Needs `npm run db:generate` (to
retype the client) + `nest build` to re-verify.

## Implemented — Phase 3 React (react-inopack)

Files touched (all `react-inopack`):

- `src/services/auth/access-token.ts` — `loginWithPassword` now returns a three-way
  `LoginOutcome` (`authenticated` / `mfaRequired` / `passwordChangeRequired`) instead of
  `void`; new `verifyMfaCode`, `resendMfaCode`, `changePasswordWithToken`, and the
  `readServerMessage` / `adoptOutcome` helpers. Interstitial `mfaToken` / `changeToken`
  are never stored here — they are passed in as arguments and held in the login screen's
  component state (memory only, like the access token, never localStorage).
- `src/app/app/authorization-wrapper/login-form.tsx` — rewritten as a small state
  machine (credentials → mfa | passwordChange → mfa), owning the single `finishLogin`
  (`client.resetStore()`) action and the stale-`_Password` localStorage sweep. Preserves
  the token-adoption + session-bootstrap path unchanged; does **not** touch the
  `isInitialLoading = loading && !data` guard in `authorization-wrapper.tsx`.
- `src/app/app/authorization-wrapper/auth-screen-layout.tsx` **(new)** — shared centred
  card (avatar + title + form) so the three steps read as one flow.
- `src/app/app/authorization-wrapper/credentials-form.tsx` **(new)** — the original
  password screen, extracted; reports its `LoginOutcome` up.
- `src/app/app/authorization-wrapper/mfa-code-form.tsx` **(new)** — Spanish "Código de
  verificación" screen: 6-digit input, "Verificar" → `/auth/mfa/verify`, "Reenviar
  código" → `/auth/mfa/resend`. A wrong/expired code shows the server's Spanish message
  in place and keeps the user on the step.
- `src/app/app/authorization-wrapper/password-change-form.tsx` **(new)** — Spanish new +
  confirm password form (min 8), POSTs `/auth/password/change`; routes the outcome
  (session, or the MFA step if the account also enforces MFA).
- `src/app/pages/auth/users/users/users-page.gql` — added `mfa_enabled` to the list.
- `src/app/pages/auth/users/users/users-page.tsx` — new left-aligned "MFA" column
  (Sí/No) and a super-user-only "Restablecer contraseña" row action behind a Spanish
  `DConfirmationModal`, calling `resetUserPassword`.
- `src/app/smart/forms/upsert/auth/user/s-upsert-user-dialog.gql` — `mfa_enabled` added
  to the `UserDialog` query; new `ResetUserPassword` mutation.
- `src/app/smart/forms/upsert/auth/user/user-form.tsx` — `mfa_enabled` on the form model
  (`IUser`/`IUserWithPassword`), a `RhCheckbox` in the General tab, and the flag passed on
  both create and update.

**Phase 3 React decisions (2026-09-09):**

- **Interstitial tokens live in React component state, not `access-token.ts`.** The
  access-token module stays the sole owner of the *session* (access token + refresh
  cookie); the short-lived `mfaToken`/`changeToken` belong to one in-progress login, so
  the login screen holds them and passes them back as arguments. Still memory-only.
- **The two multi-outcome steps share one router (`handleOutcome`).** A password change
  that still needs MFA takes the identical path as a login that needs MFA, so the gates
  compose on the client exactly as they do on the server.
- **`resetUserPassword` uses `Float!`** in the `.gql` — the resolver's `@Args('UserId')`
  is an untyped `number`, matching the sibling `getUser (UserId: Float!)` query.
- **The reset button is gated on `RoleId.Super` client-side purely to avoid a dead
  click** — the mutation is `RoleId.SUPER`-guarded on the server regardless.

### Phase 3 React — verify (the user runs these)
1. `cd react-inopack && npm run codegen` — **backend must be up on :3008** for
   introspection. Regenerates the committed `inopack-graphql-schema.ts` so
   `useResetUserPasswordMutation` and the `mfa_enabled` fields/inputs exist. Watch the
   Windows CRA stale-`.cache` trap.
2. Typecheck/lint both repos.
3. Frontend + backend running (his own): MFA-enabled login shows the code screen and
   verifies; a super-user reset forces the target through the change-password screen at
   next login; the users list shows the MFA column and the reset action only for a super
   user.

### Phase 3 backend — verify (the user runs these)
1. `cd nestjs-inopack-graphql && npm install` — pulls `nodemailer`.
2. `npm run db:generate` — types the new columns + `email_mfa_codes`.
3. `npm run db:test:rebuild` — applies both new migrations.
4. `npm run test` — the new `auth.mfa.service.test.ts` + the whole suite, twice.
5. Typecheck/lint both repos.

### Update 2026-09-10 — unified password policy + reset moved into the user dialog

Two changes on top of the Phase 3 UI, both requested by Mauricio:

**1. Unified password strength policy.** Before this, there was no single policy:
the forced-change flow enforced min-8 on the backend, and the admin user form
enforced min-10 on the frontend only (backend accepted any `@IsString()`), with
no complexity rules anywhere. The agreed policy (2026-09-10) is **≥ 10 characters
and at least one letter, one number and one symbol** (the letter rule stops an
all-digits/all-symbol password; "symbol" is any non-alphanumeric).

- **Backend authority:** `src/common/constants/password-policy.ts` **(new)** —
  the rule list + `assertPasswordStrength` (throws a 400 naming the unmet rules).
  `auth.service.ts` `changePassword` now calls it (its private min-8
  `assertPasswordStrength` is deleted). The `auth.mfa.service.test.ts`
  new-password literals gained a digit to stay policy-compliant, and the
  "too-short" test now also asserts the no-symbol and no-digit cases reject.
- **Frontend mirror:** `react-inopack` `src/services/auth/password-policy.ts`
  **(new)** — identical rules, plus `evaluatePassword` (per-rule live pass/fail)
  and `isPasswordValid`. Used by the admin user form (yup) and the forced-change
  screen.
- **Live requirements popup:** `dum/simple/inputs/password-requirements-popover.tsx`
  **(new, presentational)** — a passive popover that ticks each rule green as the
  user types. Wired into **both** flows: the admin dialog password field (a local
  `PasswordField` in `user-form.tsx` that reads the RHF value) and the
  "Cambiar contraseña" login screen (`password-change-form.tsx`, plain inputs).
  Both password inputs on the admin form are now `type='password'` (they rendered
  in cleartext before).
- ⚠️ **Deliberate scope choice — backend enforcement is NOT added to
  `userService.create` / `update`.** Those are the admin create/edit paths; the
  policy there is enforced on the frontend (yup + popup) only, as it already was.
  Adding the backend gate would reject the ~30 weak fixture passwords
  (`password123`, `correct-password`, …) across `auth.service.test.ts` and
  `auth.mfa.service.test.ts` and require rewriting every create+login pair — a
  large, error-prone change bundled into a UI task. Left as an **optional
  follow-up** (add `assertPasswordStrength` to create/update + a fixture pass).
  The self-service forced-change path *is* backend-gated.

**2. Forced password reset moved from a row button to a dialog checkbox.** The
users-page "Restablecer contraseña" `LockResetIcon` row action + its
`DConfirmationModal` are removed. Reset is now an **edit-only, super-user-only**
checkbox in the user dialog's General tab ("Forzar cambio de contraseña en el
próximo inicio de sesión"), beside the MFA checkbox, with helper text spelling out
the consequence (sessions closed + forced change). On save, if checked, the
existing `resetUserPassword` mutation runs after `updateUser`. It stays a distinct
mutation (not folded into `updateUser`) because it has a side effect — session
revocation — and is a one-shot action, unlike the persistent `mfa_enabled` flag.
`users-page.tsx` loses its reset state/handler/imports; `UserForm` gains the
super-user check (`useCurrentUserQuery` + `RoleId.Super`) and the reset mutation.

**No codegen:** no `.gql` operation changed — `resetUserPassword` and the
`mfa_enabled` fields already existed. Frontend typecheck/lint + the backend suite
still need a run (the §0 gate must be **re-run** after these changes).

### Update 2026-09-10 (2) — root account + login-disable flags

Two more `users` flags plus a one-time data fix, all in a single migration
`src/db/migrations/1789200000000-AddRootAndDisabledFlags.ts` **(new)**:
`is_root tinyint(1) default 0`, `login_disabled tinyint(1) default 0`, then a
seed of id=1 — `is_root=1`, `email='administracion@grupoinopack.com'`,
`first_name='admin'`, `last_name=''`, `fullname='admin'` (a no-op on the
`--no-data` test DB; flips the real account on app/prod). Mirrored in
`schema.prisma` as `Boolean`. The `down` drops only the columns — it does **not**
revert the email/name, because the operator will reuse the old address
(`mauricioaznar94@gmail.com`) for a *separate* named super-user, so restoring it
onto id=1 would collide on the unique email.

**Operational intent (Mauricio, 2026-09-10):** the root (id=1) becomes a low-use
"admin" break-glass account. A separate, named super-user
(`mauricioaznar94@gmail.com`, Mauricio Aznar Rivas, Super) will be created on prod
for day-to-day work; root's password is reset manually on prod and its usage kept
to a minimum.

**Last name is now optional.** The users form no longer requires it
(`last_name` uses `yup.string().defined()` — blank allowed), and
`user.service` builds `fullname` from the parts actually present
(`buildFullName`), so an account with only a first name is `"admin"`, not
`"admin "`. The DTO keeps `last_name` as a GraphQL string; the client sends `''`
when blank, so there is no nullable-output ripple.

**`is_root` — a protected account, DB-only.** It is on **no** GraphQL input
(`CreateUserInput`/`UpdateUserInput`), so nothing in the app can set or clear it —
the only way to grant or move root is in MySQL. That is the deliberate recovery
path: if the root loses email access, flip `is_root` onto another account by hand.
It is surfaced **read-only** on the `User` type for gating + display.

- **Root protection (backend gate):** `auth.resolver.ts` `assertEditableBy` **(new
  private)** — `updateUser` and `resetUserPassword` throw `ForbiddenException`
  when the target `is_root` and the actor isn't that same user. So no other user
  (Super included) can edit, re-role, MFA-toggle, disable, or force-reset the
  root. `resetUserPassword` gained a `@CurrentUser` arg for this.
- **Frontend:** the user dialog opens **read-only** (form `disabled`) with an info
  Alert when a non-owner opens a root account (`currentUser.id !== user.id`); the
  users list marks it `"(root)"`. Enforcement is still the backend gate; this only
  avoids a dead-end save.

**`login_disabled` — block login without deleting.** Distinct from `active`
(soft-delete, which also hides the row and has no UI); a disabled account stays
visible and manageable.

- **Login gate:** `validateUser` returns `null` for a disabled account (same
  generic failure message — no "disabled" oracle), checked before the password
  compare like the lockout.
- **Session kill:** `readActiveUser` now filters `login_disabled: false`, so every
  token-issuing path (refresh rotation, MFA verify/resend, change-password) treats
  a disabled account as inactive — and rotation's inactive branch revokes the
  family. On top of that, `updateUser` calls `revokeAllForUser` whenever the saved
  state is disabled, so an admin disabling a user **ends the live session at once**
  (the access token still lives out its ≤15-min TTL but cannot be refreshed).
  Decision confirmed with Mauricio 2026-09-10 (kill immediately, not just block
  future logins).
- **Editable** via a dialog checkbox ("Deshabilitar acceso…"), persisted through
  `create`/`update` like `mfa_enabled`. The users list shows an "Acceso" column
  (Activo/Deshabilitado). Both flags are added to the audit snapshot.

**Tests:** `auth.service.test.ts` gains a `login disabled` describe — a disabled
account is refused even with the correct password, and a disabled account's refresh
rotation rejects and leaves zero live rows in the family. Root protection is
resolver-level (covered by the manual checklist, not a unit test).

**Codegen required:** new `is_root`/`login_disabled` fields on `User` +
`login_disabled` on the two inputs + the two queries — run `npm run codegen`
(backend up). ⚠️ On the local **app** DB the new migration also flips id=1's email
to `administracion@grupoinopack.com`, so log in with that address after
`migration:run`.

### Cross-cutting (plan → Cross-cutting)
- New env secret: `MFA_TOKEN_SECRET` (Phase 3) — set on stage/prod before that flow
  ships, same boot discipline as `JWT_ACCESS_SECRET`. `MFA_ENC_KEY` is dropped (no TOTP
  secret to encrypt).
- New deps: `@nestjs/throttler` (done, Phase 2); a mail transport for Phase 3 email MFA
  (none installed). `otplib` / `qrcode.react` only if TOTP is revived.
- Consider logging login/logout/MFA events to `activities` via the existing pub-sub
  pattern (decide at implementation).

### Update 2026-09-10 (3) — stage mail transport + sender-domain decision

**Stage SMTP = Google Workspace SMTP relay (Path B), IP-allowlist auth.** App Passwords
are **disabled** on the `grupoinopack.com` Workspace (the Path A route), so stage uses the
relay: `MAIL_HOST=smtp-relay.gmail.com`, `MAIL_PORT=587`, **no** `MAIL_USER`/`MAIL_PASS`
(the relay trusts the droplet's IP — matches `MailService.getTransporter`'s
`auth: undefined` when the user is blank), `MAIL_FROM=no-reply@grupoinopack.com`,
`MAIL_FROM_NAME=INOPACK`. Relay set to "only addresses in my domains" + require TLS + the
droplet IP allowlisted. Both `smtp.gmail.com:587` and `smtp-relay.gmail.com:587` pass
egress from the droplet; the `grupoinopack.com` SPF already includes `_spf.google.com`
(so the aligned-SPF path carries DMARC even without a domain DKIM key, and the relay adds
its own `gappssmtp.com` DKIM signature).

**DNS-control constraint + sender-domain decision (option 1, chosen 2026-09-10).**
`grupoinopack.com` DNS is hosted at **Neubox** (`ns*.neubox.net`) and Mauricio has **no
access**, so a `grupoinopack.com` DKIM record cannot be published and DKIM authentication
in the Admin console fails at the DNS step. This is a standing operational risk (no way to
rotate DKIM, fix deliverability, or manage MX for the org domain). **Decision: option 1 —
move the mail *sender identity* to a domain Mauricio controls.** Add one of his domains to
this Workspace as a secondary domain, verify it, publish self-managed SPF + DKIM + DMARC,
and set `MAIL_FROM=no-reply@<controlled-domain>` for prod — making the email channel
independent of Neubox. Deferred until after the stage §3 pass (stage keeps sending as
`grupoinopack.com` on aligned SPF, which is sufficient for the internal-inbox delivery
test). **Do before enabling MFA for real external-mailbox users on prod.** (Option 2 —
repointing `grupoinopack.com`'s nameservers to a provider Mauricio controls — was set
aside; it needs registrar access that may also sit with Neubox.)

**Stage delivery test — ✅ RESOLVED 2026-09-11 (see root-cause block below).** Branch
shipped to `stage`; stage API boots clean (secrets present, migrations applied, root
login = `administracion@grupoinopack.com`). *Originally* the SMTP smoke test **failed**: every
`sendMfaCode` from the droplet (`162.243.171.217`, container is `--network host`) is
refused by Google with `421-4.7.0 Try again later, closing connection. (EHLO)`
(`support.google.com/a/answer/3221692`), logged as `auth.mfa.send_failed`. Consistent
across retries over ~10 min. Notably a bare `openssl s_client -starttls smtp` EHLO to the
same host returns `250` — so TCP/TLS/egress are fine; only the **relay submission** is
deferred. Diagnosis so far: outbound IPv4 confirmed `162.243.171.217` (no IPv6), SPF ok,
`MAIL_USER/PASS` blank (IP-auth). Leading hypotheses: (a) the IP isn't actually authorized
for relay (allowlist mismatch / not-yet-propagated — Workspace relay changes can take
hours), or (b) **DigitalOcean-IP reputation** deferral on Google's relay, which
IP-allowlisting can't always overcome.

**✅ Positive captured:** the mailer **fail-closed** path is verified on stage — each
failed send denied the login (no `mfaToken` issued, no bypass), i.e. the stage-only
"real-SMTP fail-closed" checklist item passed.

**✅ ROOT CAUSE FOUND & FIXED 2026-09-11 — invalid EHLO hostname (not reputation, not
allowlist).** A full `swaks` transcript to `smtp-relay.gmail.com:587` from the droplet
succeeded end-to-end (EHLO→STARTTLS→EHLO→MAIL FROM→RCPT→DATA all `250`, Google echoing
`[162.243.171.217]` — the IP is authorized). Seconds later the *app* still failed with the
same `421-4.7.0 … (EHLO)`, stack top `SMTPConnection._actionEHLO`. The only difference:
`swaks` sent `EHLO stage.grupoinopack.com` (a valid FQDN); nodemailer sent no `name`, so it
EHLO'd as the **bare OS hostname `ubuntu-s-1vcpu-2gb-nyc1`**, which Google's relay rejects.
This **rules out DO-IP reputation and allowlist/propagation** entirely — the IP was
authorized all along. Fix: added `MAIL_EHLO_NAME` (`constants/mail.ts`, defaults to the
`MAIL_FROM` domain) and passed it as nodemailer's `name` in `MailService.getTransporter`,
so the client greets with a valid FQDN. Stage env may set `MAIL_EHLO_NAME=stage.grupoinopack.com`;
without it the code still falls back to `grupoinopack.com` (never the bare hostname again).

**✅ VERIFIED END-TO-END ON STAGE 2026-09-11.** Stage env set
`MAIL_EHLO_NAME=stage.grupoinopack.com`, backend redeployed (new code + env in one motion).
A real MFA login now **sends** (no `421`, no `auth.mfa.send_failed`) and the code **arrived
in the `administracion@grupoinopack.com` inbox** (delivered, not just relay-accepted; not
spam-filtered on the aligned-SPF path). The stage mail transport is unblocked. *Still
deferred for prod:* option 1 (move sender identity to a Mauricio-controlled domain with
self-managed SPF/DKIM/DMARC) before enabling MFA for external-mailbox users — an
inbox-delivery guarantee for non-`grupoinopack.com` recipients, independent of Neubox.

**Next steps (later branch): SUPERSEDED 2026-09-11** — the `421` was the invalid-EHLO
hostname (see the root-cause block), not IP authorization or reputation; the swaks/relay
diagnostics are moot. Remaining real work is the stage §3/§4/§8 passes and the prod rollout
below. **✅ Stage §3/§4/§8 passes done 2026-09-11** (real SMTP + real-domain session kill;
see the checklist). Remaining: the `grupoinopack.app` sender switch (stage → prod) and the
prod rollout below; §2 (stage throttle) and §7 (cross-origin/WS) are not yet run on stage.

## Mail rollout — grupoinopack.app sender identity (stage first), then prod + deploy

Folded from [api-hostname-migration](../../plans/archived/api-hostname-migration.md)
Phase D. Per Mauricio (2026-09-11) the mail-identity switch is **rehearsed on stage first**,
same discipline as the hostname cutover — stage moves to the `grupoinopack.app` sender
identity and is verified before prod.

**Key simplification:** `grupoinopack.app` DNS is at **Netlify (Mauricio controls it)**, so
it *is* the controlled sender domain option 1 called for — no `mauricioaznar.com` (dropped
2026-09-11), and the Neubox "no DNS access" blocker was `grupoinopack.com`'s, not `.app`'s.

**One-time domain setup (domain-wide — both tiers use it; do during the stage rehearsal):**
1. Add `grupoinopack.app` as a **Workspace secondary domain** and verify it (the Workspace
   is `grupoinopack.com`; sending as `@grupoinopack.app` requires it registered there).
2. In **Netlify DNS** (`grupoinopack.app` zone): **SPF** TXT `v=spf1 include:_spf.google.com ~all`;
   **custom DKIM** (Admin → Apps → Gmail → Authenticate email → generate → publish the
   record in Netlify DNS); **DMARC** `_dmarc.grupoinopack.app`
   `v=DMARC1; p=none; rua=mailto:…` (tighten to quarantine/reject after monitoring).
   Published once; used by mail sent from either droplet.

**Stage rehearsal (droplet `162.243.171.217` — already relay-allowlisted):**
3. Stage env (`/root/inopack/.env`): `MAIL_FROM=no-reply@grupoinopack.app` (was
   `…@grupoinopack.com`); `MAIL_EHLO_NAME=stage-server.grupoinopack.app` already set.
   Recreate the stage container.
4. Verify: send a real MFA code to an **external** mailbox; confirm **inbox** delivery (not
   spam) and, in the received headers, `spf=pass`, `dkim=pass` (`d=grupoinopack.app`),
   `dmarc=pass`. That proves the self-managed auth before prod touches it.

**Prod (only after stage passes):**
5. **Allowlist the prod IP `159.223.100.185`** on the Workspace SMTP relay (DNS already done).
6. Prod env (`/root/inopack.env`): `MAIL_HOST=smtp-relay.gmail.com`, `MAIL_PORT=587`, **no**
   `MAIL_USER`/`MAIL_PASS` (IP auth), `MAIL_FROM=no-reply@grupoinopack.app`,
   `MAIL_EHLO_NAME=server.grupoinopack.app`, `MAIL_FROM_NAME=INOPACK`. (EHLO-FQDN fix ships
   in the feature code, graphql ≥ 7.41.6.)
7. **Deploy:** ship `feature/auth-mfa-phase2` to prod via **`dev → master`** (feature →
   `dev`, then `dev → master`) — **not** `feature → master`. Prod deploys on push to
   `master` (non-destructive — no DB reset).
8. Post-deploy: run §3/§4/§8 against prod, send an external MFA code, confirm inbox, *then*
   enable `mfa_enabled=1` per account.

### Carried over from the shipped unit (watch, not code)
- Phase 1 was promoted to prod with the **time-based soak accepted as risk** (A.4
  silent access-token expiry, B past-TTL reconnect, E long-idle). Watch prod behaviour
  over the first hours/day; fold any finding into this branch as a fix.
