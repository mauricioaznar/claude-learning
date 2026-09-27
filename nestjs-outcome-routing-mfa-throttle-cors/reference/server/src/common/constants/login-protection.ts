// Single access point for Phase 2's brute-force protections: per-IP rate limits
// on the auth routes and per-account lockout after repeated wrong passwords.
// Modelled on `constants/jwt.ts` — every value is read from the environment once,
// validated here, and consumed through the exported objects so call sites never
// touch `process.env` directly.
//
// The two protections are independent and complementary:
//   • rate limiting is per IP and short-window — it slows an attacker (or a
//     runaway client) hammering the login endpoint;
//   • lockout is per account and IP-independent — it stops a distributed
//     password-guessing attack that spreads its attempts across many IPs to stay
//     under the per-IP limit.

import { readNumber } from './env';

// The generic Spanish message returned for every failed login, whatever the
// actual cause. Unknown email, wrong password and a locked account must be
// indistinguishable in the *response* (Phase 2 acceptance criterion 3): a
// different message for "no such user" would let an attacker enumerate valid
// accounts, and a distinct "your account is locked" would confirm both that the
// email exists and that the lockout landed. The distinction is still made in the
// logs — those are not attacker-visible. The malformed-body 400 in the
// controller shares this exact string for the same reason.
export const LOGIN_FAILED_MESSAGE =
    'No se pudo iniciar sesión con las credenciales proporcionadas';

// Per-IP rate limits for the REST auth routes, in requests per `ttlSeconds`.
// Applied by `@nestjs/throttler` (see `AuthModule` + `AuthController`). Login is
// the strict one — a human logs in a handful of times a minute at most, so 5 is
// generous for people and tight for a script. Refresh is looser because a busy
// tab legitimately rotates more often. `defaultLimit` covers any other auth
// route (e.g. logout) that carries no explicit `@Throttle`.
export const authThrottle = {
    ttlSeconds: readNumber('AUTH_THROTTLE_TTL', 60),
    loginLimit: readNumber('AUTH_THROTTLE_LOGIN_LIMIT', 5),
    refreshLimit: readNumber('AUTH_THROTTLE_REFRESH_LIMIT', 10),
    defaultLimit: readNumber('AUTH_THROTTLE_DEFAULT_LIMIT', 20),
    // Phase 3 email MFA. `mfa/verify` is the brute-force surface — a 6-digit code
    // is only ~20 bits — so it gets its own tight per-IP cap on top of the
    // per-code `attempts` counter. `mfa/resend` is capped low so the endpoint
    // cannot be used to spam a victim's mailbox or run up a mail bill.
    mfaVerifyLimit: readNumber('AUTH_THROTTLE_MFA_VERIFY_LIMIT', 10),
    mfaResendLimit: readNumber('AUTH_THROTTLE_MFA_RESEND_LIMIT', 3),
};

// Per-account lockout. `maxFailedAttempts` consecutive wrong passwords freeze the
// account for `lockoutMinutes`; a successful login resets the counter. The plan's
// spec is "5 consecutive failures ⇒ 15-min lockout", so the account locks on the
// 5th wrong password and the 6th attempt is refused by the lockout check.
export const loginLockout = {
    maxFailedAttempts: readNumber('LOGIN_MAX_FAILED_ATTEMPTS', 5),
    lockoutMinutes: readNumber('LOGIN_LOCKOUT_MINUTES', 15),
};

// Express `trust proxy` setting. Per-IP throttling is only meaningful if `req.ip`
// is the real client address, and in production the API sits behind a reverse
// proxy (Nginx) that puts the client IP in `X-Forwarded-For`. The value is the
// number of trusted proxy hops in front of the app — 1 for a single Nginx. It
// must match the real topology: too low and every client looks like the proxy
// (throttled as one), too high and a client can spoof `X-Forwarded-For` to dodge
// the limit. Bump `TRUST_PROXY_HOPS` if another hop (e.g. a CDN) is added.
export function trustProxyHops(): number {
    return readNumber('TRUST_PROXY_HOPS', 1);
}
