import { TokenPair } from '../../common/dto/entities';

// The three ways a password-verified login can end. Phase 1 only ever produced
// tokens; Phase 3 adds two interstitial states that issue *no* session and
// instead hand back a short-lived, single-purpose token gating the next step:
//
//   • `mfa_required`             — the account has email MFA enforced. A code was
//                                  emailed; the holder must POST it to
//                                  `/auth/mfa/verify` with `mfaToken`.
//   • `password_change_required` — a super-user forced a password change. The
//                                  holder must POST a new password to
//                                  `/auth/password/change` with `changeToken`.
//
// Both gates come *before* tokens exist, so neither can be skipped by replaying
// an access token — there isn't one yet.
export type AuthOutcome =
    | { kind: 'tokens'; pair: TokenPair }
    | { kind: 'mfa_required'; mfaToken: string }
    | { kind: 'password_change_required'; changeToken: string };

// The minimum the post-password flow needs about a user. Both `validateUser`'s
// `UserWithRoles` and a fresh `readActiveUser` row satisfy it structurally, so
// the login path and the verify/change paths share one decision function.
export interface AuthUser {
    id: number;
    email: string;
    // Optional so both `validateUser`'s `UserWithRoles` (where the flags are
    // declared optional) and a `readActiveUser` row satisfy this. The gate
    // checks are truthiness tests, so an absent flag reads as "off" — the safe
    // default for both MFA enforcement and a forced password change. Boolean
    // because Prisma maps the TINYINT(1) columns to Boolean.
    mfa_enabled?: boolean;
    must_change_password?: boolean;
    user_roles: { role_id?: number | null }[];
}

// The minimum a token needs to describe its bearer. Both `validateUser`'s return
// and a freshly re-read user row satisfy it, which is why rotation can reuse the
// same signing path as login.
export interface TokenSubject {
    id: number;
    email: string;
    user_roles: { role_id?: number | null }[];
}
