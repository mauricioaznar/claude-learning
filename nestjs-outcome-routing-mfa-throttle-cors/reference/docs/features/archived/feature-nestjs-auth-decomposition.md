# feature/nestjs-auth-decomposition

Phase 5 maintainability: decompose modules/auth — roles/ + users/ folders, extract pure utils, split the 1258-line auth.service god-service behind a thin facade. Behaviour-preserving, guarded by existing auth tests.

**Plan (source of truth):**
[docs/plans/ongoing/nestjs-maintainability-refactor.md](../../plans/ongoing/nestjs-maintainability-refactor.md) — Phase 5.

## Goals

Behaviour-preserving decomposition of `modules/auth/`. The clutter is not the file
count (21 files, helpers already foldered) but two files: `auth.service.ts` (1,258
lines, five unrelated responsibilities) and its mirror `auth.service.test.ts` (923
lines). Four ordered slices, risk climbing monotonically, each its own commit:

- **5a — `roles/` folder** (isolated; do first).
- **5b — `users/` folder** (one external importer; the file that forced the timing gate).
- **5c — pure-util extraction** (no DI, lowest risk).
- **5d — god-service split** behind an `AuthService` facade (the main event).

The public method surface the controller/resolver call stays unchanged (facade
preserves it); schema unchanged; every existing auth test stays green (they are the
safety net).

## Status

**✅ ALL SLICES VERIFIED (2026-09-12).** Full suite green — **16 suites / 133 tests**,
including the retargeted rotation-seam tests, the MFA/controller tests, and the three new
util tests — and `npm run build` (`nest build`, whole-project `tsc`) reports **no error**.
The green `setupApp()` boot proves the DI wiring of all four new services + facade (the
"compiles clean, fails at bootstrap" risk is cleared). Backend-only, no schema/codegen
change, so the frontend is unaffected. **Ready to ship to `dev`.**

Branched from `origin/dev` **2026-09-12**, after confirming the Phase 5 hard timing
gate is **cleared**: `feature/auth-mfa-phase2` is archived and its MFA code is present
on `origin/master`, `origin/stage` and `origin/dev` (auth.service.ts 1266 lines,
`auth.mfa.service.test.ts` present on all three); Phases 0–1.7 shipped to prod
2026-09-08; the prod-gating `api-hostname-migration` completed 2026-09-11.

- **5a — `roles/` folder — ✅ CODE DONE (unverified).** Moved `role.service.ts`,
  `role.resolver.ts`, `role-access.ts` into `src/modules/auth/roles/`. Guard
  (`guards/gql-roles.guard.ts`) and decorator (`decorators/role.decorator.ts`) **kept
  in place** — see Decisions. Import paths fixed at 6 sites. `app.module.ts` untouched.
- **5b — `users/` folder — ✅ CODE DONE (unverified).** Moved `user.service.ts` +
  `user.service.test.ts` into `src/modules/auth/users/`. Fixed 5 references: the one
  external importer (`common/__tests__/helpers/setup-database.ts`) plus 4 intra-module
  (`auth.module.ts`, `auth.resolver.ts`, `auth.mfa.service.test.ts`,
  `auth.service.test.ts`) — more than the plan's estimate of 1, because the two auth
  test files also import `UserService`. **Ceiling stands:** no `UsersModule` — the user
  GraphQL surface (`users` query, `resetUserPassword`) still lives in `auth.resolver.ts`;
  carving a `user.resolver.ts` out is the optional follow-up **5b′**, not done here.
- **5c — pure-util extraction — ✅ CODE DONE (unverified).** Lifted the pure helpers
  out of `auth.service.ts` into `src/modules/auth/utils/`: `refresh-token.util.ts`
  (`hashRefreshToken`), `mfa-code.util.ts` (`generateMfaCode`, `hashMfaCode`),
  `interstitial-token.util.ts` (`signInterstitialToken` / `verifyInterstitialToken`).
  The two interstitial functions take the `JwtService` as an explicit first argument
  (caller passes `this.jwtService`) — that is what makes them free functions with no
  class state, unit-testable with a bare `JwtService`. `assertPasswordStrength` was
  **already** a util (`common/constants/password-policy.ts`) — the plan listed it but it
  needed no move. `auth.service.ts`: 1266 → 1224 lines; dropped now-unused `createHash`
  and `randomInt` from the `crypto` import; call sites rewired to the free functions.
  Added colocated unit tests for all three util files (`*.util.test.ts`). No method here
  was referenced outside `auth.service.ts`, so no test spied on them — extraction is
  transparent to the existing suite.
- **5d — god-service split — ✅ CODE DONE (unverified).** Split `auth.service.ts`
  (1224 → **98 lines**) into four `@Injectable` services in `modules/auth/`, per the
  plan's method map, with `AuthService` kept as a thin delegating facade:
  - `refresh-token.service.ts` (`RefreshTokenService`) — the session lifecycle:
    `createSession`, `rotateRefreshToken`, `logout`, `revokeFamily`, `revokeAllForUser`,
    `lockFamily`, `revokeFamilyLocked`, `issueTokenPair`, `signAccessToken`,
    `readActiveUser`, `isBenignRotationRace`, `revokeToken`. **Leaf** (no auth-service
    deps). `createSession` and `readActiveUser` made **public** (cross-service callers).
  - `mfa.service.ts` (`MfaService`) — `verifyMfaCode`, `resendMfaCode`, `sendMfaChallenge`;
    injects `RefreshTokenService`.
  - `login.service.ts` (`LoginService`) — `validateUser`, `registerFailedLogin`,
    `loginWithCredentials`, `decideAfterPassword`; injects `RefreshTokenService` + `MfaService`.
    `decideAfterPassword` made **public** (re-entered by password change). Owns `DUMMY_PASSWORD_HASH`.
  - `password.service.ts` (`PasswordService`) — `requirePasswordChange`, `changePassword`;
    injects `RefreshTokenService` + `LoginService`.
  - Shared types → `auth.types.ts` (`AuthOutcome`, `AuthUser`, `TokenSubject`); `AuthOutcome`
    re-exported from `auth.service.ts` so the controller import is untouched.
  - `auth.module.ts` registers all four alongside the facade; only `AuthService` is exported,
    so the module's public DI surface is unchanged.
  - **DI graph is an acyclic DAG** — `password → login → mfa → refresh-token` (all also →
    refresh-token) — so no `forwardRef` was needed; Nest instantiates leaf-first.
  - **Facade tactic** keeps every controller/resolver/test call site unchanged.

  **Test handling (deviation from the plan, deliberate):** rather than split
  `auth.service.test.ts` into `login.service.test.ts` / `refresh-token.service.test.ts`,
  the rotation-seam **spies were retargeted in place** to the `RefreshTokenService`
  instance (`app.get(RefreshTokenService)`), because the private methods they spy on
  (`issueTokenPair`, `lockFamily`, `readActiveUser`) moved there and the internal
  `this.<method>` calls now happen on that instance. This meets the acceptance criterion
  (every existing test green, public surface unchanged) with far less churn than a
  923-line blind test-file split — the cosmetic split is tracked as optional follow-up
  **5d′**. `auth.mfa.service.test.ts` and `auth.controller.test.ts` needed **no** change
  (they only touch the facade + the shared `MailService`/logger singletons).

Verification is Mauricio's (backend 3008 + frontend 3000, `npm run test`, typecheck) —
the agent does not run servers/builds/tests.

## Decisions

- **5a: the role-authz guard and decorator stay in `guards/`/`decorators/`; only the
  three role-domain files move into `roles/`.** `gql-roles.guard.ts` sits alongside
  `gql-auth.guard.ts` and `allowed-origin.guard.ts` and is registered app-level via
  `APP_GUARD`; splitting one guard out of `guards/` would fragment that folder for less
  cohesion than it buys. `role-access.ts` (the shared `roleSatisfiesGate` rule) **does**
  move, since it is role policy consumed by both the guard and the `activities` feed
  filter. Consequence: `app.module.ts` needs no change (roles reach it only through
  `AuthModule`); the external `activities.resolver.ts` import becomes
  `../auth/roles/role-access`.

## Remaining work

All four slices (5a–5d) are **code-complete and verified** (tests + build green,
2026-09-12). Next: `scripts/ship.sh -y dev`. Optional follow-ups, not blocking: **5b′**
(carve a real `UsersModule` / `user.resolver.ts` out of `auth.resolver.ts`) and **5d′**
(split `auth.service.test.ts` into `login.service.test.ts` / `refresh-token.service.test.ts`
to mirror the new services).
