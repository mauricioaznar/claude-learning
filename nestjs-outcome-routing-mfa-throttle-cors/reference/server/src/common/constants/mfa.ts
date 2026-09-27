// Single access point for Phase 3 email MFA. Same shape as `constants/jwt.ts`
// and `constants/login-protection.ts`: every value is read from the environment
// once, validated here, and consumed through the exported objects so call sites
// never touch `process.env` directly.
//
// The MFA challenge has two independent secrets protecting two things:
//   • the emailed *code* (six digits) proves the person reading the mailbox is
//     the one logging in — it is hashed at rest and attempt-limited;
//   • the *mfaToken* (a short JWT) proves the password step already succeeded,
//     so the verify endpoint does not re-accept a password. It is signed with
//     its own secret and grants nothing but the verify call.

// `readSecret` applies the same boot discipline as JWT_ACCESS_SECRET: in
// production an unset MFA_TOKEN_SECRET is a hard failure (a fallback there would
// sign mfaTokens with a value public in this repository), which is why it is in
// the stage/prod deployment prerequisites — set it before Phase 3 ships.
import { readNumber, readSecret } from './env';

// The `purpose` claim distinguishes the two short-lived "interstitial" tokens
// issued after a password succeeds but before a full session exists. Both are
// signed with `tokenSecret`; the purpose is what stops one being replayed where
// the other is expected (and stops either being confused with an access token,
// which carries no `purpose` at all). Always check it on verify.
export const MFA_TOKEN_PURPOSE = 'mfa';
export const PASSWORD_CHANGE_PURPOSE = 'password_change';

export const mfaConstants = {
    // How many digits the emailed code has. Six is the familiar length; the
    // per-code attempt cap and the per-IP throttle on the verify route are what
    // make ~20 bits of entropy safe, not the length itself.
    codeLength: readNumber('MFA_CODE_LENGTH', 6),

    // How long an emailed code stays redeemable. Short on purpose — long enough
    // to receive an email and type it, short enough that an intercepted code is
    // usually already dead.
    codeTtlMinutes: readNumber('MFA_CODE_TTL_MINUTES', 10),

    // Wrong guesses allowed against one code before it is burned. The verify
    // endpoint increments this per attempt and refuses the code once it is hit,
    // so a stolen mfaToken cannot be used to grind all 10^6 codes.
    maxAttempts: readNumber('MFA_MAX_ATTEMPTS', 5),

    tokenSecret: readSecret('MFA_TOKEN_SECRET', 'dev-mfa-secret-change-me'),

    // The mfaToken lifetime. ⚠️ Must be **≥ codeTtlMinutes**: the token is what
    // carries the "password already verified" state to the verify call, so if it
    // died before the code the user would be forced to re-enter their password
    // while holding a still-valid code. Defaulted to the same 10 minutes so the
    // whole challenge has one coherent window.
    tokenTtl: process.env.MFA_TOKEN_TTL || '10m',
};
