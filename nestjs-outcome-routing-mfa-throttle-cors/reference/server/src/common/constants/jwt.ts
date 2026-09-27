// Single access point for every JWT secret. Call sites (auth.module,
// jwt.strategy, files.module, memory-token.module) keep importing
// `jwtConstants`; only the source of the values changed — they now come from the
// environment instead of being hardcoded in this file.
//
// `readSecret` (shared, in `./env`) makes an unset secret a hard boot failure in
// production — a fallback there would silently sign tokens with a value that is
// public in this repository — while keeping the fallback in dev and test.
import { readNumber, readSecret } from './env';

// The file token keeps the old 12h lifetime; only the *access* token shortened.
const fileExpiresIn = '43200s';

export const jwtConstants = {
    authSecret: readSecret('JWT_ACCESS_SECRET', 'secretKey'),
    fileSecret: readSecret('JWT_FILE_SECRET', 'fileSecret'),

    // Phase 1: the access token drops from 12h to minutes. A stolen access
    // token is only useful until it expires and there is no server-side way to
    // revoke a JWT, so a short life *is* the revocation mechanism. The session
    // itself no longer depends on this value — the refresh cookie keeps it
    // alive silently.
    authExpiresIn: process.env.JWT_ACCESS_TTL || '15m',
    fileExpiresIn,

    // Refresh token lifetime. This is the real "how long can I stay logged in
    // without typing my password" number.
    refreshTtlDays: readNumber('REFRESH_TTL_DAYS', 14),

    // Grace period for refresh-token reuse. Rotation means the token that was
    // just spent becomes invalid, and re-presenting a spent token is the signal
    // for token theft. But two browser tabs sharing one cookie will legitimately
    // present the same token within milliseconds of each other, so a zero grace
    // period logs honest users out. Inside the window a reuse is treated as that
    // benign race and simply re-issues; outside it, it is theft and the whole
    // family dies. Set to 0 in `.env.test` so the theft path is asserted exactly.
    refreshReuseGraceSeconds: readNumber('REFRESH_REUSE_GRACE_SECONDS', 30),
};
