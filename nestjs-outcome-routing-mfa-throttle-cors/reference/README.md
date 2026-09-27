# INOPACK auth reference (read-only snapshot)

The answer key for this lab: the production auth flow, copied from the INOPACK
repos on 2026-09-26. Read it; don't edit it. Paths below mirror the originals.

| Folder | Source repo | Commit |
| --- | --- | --- |
| `server/` | `nestjs-inopack-graphql` (branch `dev`) | `65e5cae` (2026-09-17) |
| `client/` | `react-inopack` | `28d06136` (2026-09-17) |
| `docs/` | `inopack-claude` umbrella `docs/` | working tree, 2026-09-26 |

## Map: where each topic lives

**Outcomes (the state machine)**
- `server/src/modules/auth/auth.types.ts` — `AuthOutcome`: the three results.
- `server/src/modules/auth/login.service.ts` — `validateUser` (password + lockout),
  `loginWithCredentials`, and `decideAfterPassword` (the fork everything funnels through).
- `server/src/modules/auth/auth.controller.ts` — `respondWithOutcome`: outcome → HTTP body/cookie.
- `client/src/app/app/authorization-wrapper/login-form.tsx` — the same machine on the React side (`LoginStep`).
- `client/src/services/auth/access-token.ts` — parses a response body back into a `LoginOutcome`.

**MFA + the interstitial token**
- `server/src/modules/auth/mfa.service.ts` — challenge (send), verify, resend.
- `server/src/modules/auth/utils/interstitial-token.util.ts` — sign/verify with a `purpose` claim.
- `server/src/modules/auth/utils/mfa-code.util.ts` — code generation + SHA-256.
- `server/src/common/constants/mfa.ts` — TTLs, attempt cap, purposes.
- `server/src/db/migrations/1789100000000-AddEmailMfaAndPasswordReset.ts` — schema.
- `client/.../mfa-code-form.tsx`

**Forced password change**
- `server/src/modules/auth/password.service.ts` — admin reset + `changePassword`, which re-enters `decideAfterPassword`.
- `server/src/common/constants/password-policy.ts`
- `client/.../password-change-form.tsx`

**Throttling + lockout**
- `server/src/common/constants/login-protection.ts` — per-IP limits, per-account lockout, `trust proxy`.
- `server/src/modules/auth/auth.module.ts` — `ThrottlerModule`, and why it isn't global.
- `@Throttle` decorators in `auth.controller.ts`.

**Refresh cookie + CORS + CSRF**
- `server/src/modules/auth/refresh-cookie.ts` — SameSite / Secure / Path.
- `server/src/common/constants/cors.ts` + `server/src/main.ts` — the allowlist, `credentials: true`.
- `server/src/modules/auth/guards/allowed-origin.guard.ts` — the Origin check on cookie routes.
- `server/src/modules/auth/refresh-token.service.ts` — `createSession`, rotation, `readActiveUser`.

**Access token + guards (server)**
- `server/src/common/constants/jwt.ts` (+ `env.ts`) — access TTL, refresh TTL, reuse grace window.
- `server/src/modules/auth/strategies/jwt.strategy.ts` — Bearer token → `req.user`.
- `server/src/modules/auth/guards/gql-auth.guard.ts` + `decorators/public.decorator.ts` — global guard, opt-out.
- `server/src/modules/auth/decorators/current-user.decorator.ts`
- `server/src/modules/auth/utils/refresh-token.util.ts` — opaque token generation + hashing.
- `server/src/modules/auth/auth.resolver.ts`, `server/src/common/dto/entities/auth/auth.dto.ts`
- `server/src/app.module.ts` — global guards, and WebSocket auth (`onConnect` stashes
  `connectionParams`; `context` rebuilds `req.headers` so the same guard runs).
- `server/src/db/migrations/1788804218804-CreateRefreshTokens.ts`,
  `1789000000000-AddLoginLockoutColumns.ts` — the rest of the schema.

**Client session lifecycle (the React half)**
- `client/src/app/app/authorization-wrapper/authorization-wrapper.tsx` — boot: `bootstrapSession`
  spends the refresh cookie once, then shows the app or the login machine.
- `client/src/services/apollo/init-apollo-client.ts` — auth link (attach token) + error link
  (401 → `refreshAccessToken` once → replay); WS `connectionParams`.
- `client/src/app/app/providers/subscriptions-provider.tsx` — why subscriptions are boot-only
  (frozen `connectionParams`, no refresh-and-replay over WS).
- `client/src/app/app/inopack-drawer/inopack-drawer.tsx` — `logoutSession` (search for it; the rest is UI).
- `client/src/services/auth/password-policy.ts`, `.../auth-screen-layout.tsx`, `client/src/index.tsx` (mounting).

**Tests (useful as behavior specs)**
- `server/src/modules/auth/auth.mfa.service.test.ts`
- `server/src/modules/auth/utils/interstitial-token.util.test.ts`
- `server/src/modules/auth/auth.controller.test.ts`, `auth.service.test.ts`
- `server/src/modules/auth/utils/refresh-token.util.test.ts`, `mfa-code.util.test.ts`

**Docs**
- `docs/plans/archived/auth-refresh-throttling-mfa.md` — the technical plan (long).
- `docs/features/archived/feature-authentication-mfa.md`, `feature-auth-mfa-phase2.md` — feature records.
- `docs/features/archived/feature-nestjs-auth-decomposition.md` — the split into Login/Mfa/Password/RefreshToken services.
- `docs/guides/authentication-mfa-learning-guide.md` — ⚠️ **stale**: says Phases 2–3
  aren't implemented, but the code above has both. Trust the code.

Not copied: the rest of the app (Prisma schema, mail/logging modules, roles/users,
non-auth GraphQL resolvers, `.env`s). Follow imports into those only by name.
