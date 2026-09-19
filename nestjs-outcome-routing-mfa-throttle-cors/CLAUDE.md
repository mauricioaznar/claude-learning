# NestJS Auth Lab

**Status: planned — not scaffolded.** This file exists to hold the lab's
review-to-understand TODO and its intended scope. When starting the lab, ask Mau
for the INOPACK auth snippets (outcome enum + `decideAfterPassword` routing, MFA
challenge/verify/resend + interstitial-token shape, rate-limiter config, CORS +
cookie options) and agree the exercise path **before writing any code**.

Framework-accurate to INOPACK: NestJS backend, and a **separate React origin** so
credentialed CORS is real (not same-origin like the cookie labs). Reuses concepts
from `express-cookie-session-sliding-absolute-expiry/` and
`typescript-access-refresh-tokens-handrolled-jwt/` (token mint/verify, refresh
cookie, rotation) but rebuilds them in NestJS shape.

## Intended scope

- **Outcomes** — password → `decideAfterPassword` → where each outcome routes.
- **MFA** — challenge / verify / resend + the interstitial token.
- **Throttling** — rate limiting on the auth endpoints.
- **Refresh cookie** — SameSite / Secure / credentialed CORS, and why a wildcard
  origin can't carry credentials.

## Prod reference — review-to-understand

(INOPACK; tech debt; hands-on lab; shipped to prod; spare-time deep-read, not a
code task): the full auth flow — **outcomes** (password → `decideAfterPassword` →
where each outcome routes), **MFA** (challenge/verify/resend + the interstitial
token), **throttling** (rate limiting on the auth endpoints), and the
refresh-**cookie** setup (SameSite/Secure/credentialed CORS — see the
`feature/authentication-mfa` server prerequisite in Reminders). See
`docs/features/archived/feature-nestjs-auth-decomposition.md` + the auth
feature/plan docs.

## Exercises

_(TBD — agreed once the INOPACK snippets are in hand.)_

## Failures

_(symptom → cause → fix; recorded as they happen)_

## Learnings

_(plain-words concepts that stuck; written for a cold reader)_
