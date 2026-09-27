import { apiHttpUrl } from '../../constants/api-url';

/*
 * LEARNING MAP — frontend session state
 *
 * This module is the only owner of the access token. UI components call these
 * operations instead of reading or writing credentials themselves:
 *
 * - `loginWithPassword` starts a session. It no longer always yields a token:
 *   the server may answer that email MFA or a forced password change is needed
 *   first (see `LoginOutcome`), so the caller drives a short state machine.
 * - `verifyMfaCode` / `resendMfaCode` complete the email-MFA step; a verified
 *   code adopts the access token exactly as a plain login would.
 * - `changePasswordWithToken` completes the forced-password-change step, which
 *   ends either in a session or in the MFA step (an account can enforce both).
 * - `bootstrapSession` restores a session after a reload by spending the
 *   browser's refresh cookie once.
 * - `ensureAccessToken` gives Apollo a usable token, refreshing early when the
 *   current one is near expiry.
 * - `logoutSession` asks the server to revoke the session before clearing the
 *   in-memory token.
 *
 * Notice what is absent: there is no refresh-token variable, and no variable for
 * the short-lived `mfaToken` / `changeToken` interstitial tokens either. The
 * refresh cookie is httpOnly, so the browser attaches it to
 * `credentials: 'include'` requests and React never sees its value. The
 * interstitial tokens *are* seen by React, but they belong to one in-progress
 * login and nothing else, so the login screen holds them in component state and
 * hands them back here as arguments — they live in memory only, never in
 * localStorage, and die with the login attempt.
 */

// The access token lives in a module variable and nowhere else.
//
// It used to live in localStorage, which means any script that ends up on the
// page — a compromised dependency, an XSS payload — can read it and keep it. A
// module variable dies with the tab and cannot be read cross-origin. The cost is
// that a page reload starts with no token; that is what the refresh cookie is
// for (`bootstrapSession` below re-mints one before the app renders).
let accessToken: string | null = null;

// When the token in memory stops being accepted, as epoch milliseconds. `null`
// means *unknown*, not *expired* — see `readExpiry`.
let accessTokenExpiresAt: number | null = null;

// Refresh this long before the token actually dies, so a request that is already
// in flight when the clock ticks over does not arrive with a just-expired token.
// Also absorbs small client/server clock differences.
const EXPIRY_SKEW_MS = 30_000;

// Single-flight: many requests can fail with 401 at the same moment (a page with
// eight queries on it). Without this they would each POST /auth/refresh, and
// since refresh *rotates* the token, all but one would present an
// already-spent token and trip the server's theft detection — logging the user
// out for behaving normally.
let refreshInFlight: Promise<string | null> | null = null;

// Set once a refresh has been *rejected* — 401 or 403. It means "there is no
// session", and it stops every later call from re-asking the server the same
// question, which matters most on the login screen where the WebSocket client
// retries forever. Deliberately not set for a 500 or a network error: those are
// transient, and treating them as "logged out" would let a five-second database
// blip sign out everyone whose token happened to be refreshing.
let sessionKnownDead = false;

// Read `exp` out of the JWT so we can refresh *before* the server rejects us.
//
// Decoding a token on the client is only safe because this is a scheduling hint
// and never a trust decision — the server remains the only thing that validates
// the signature. We are asking "is it worth sending?", not "is it genuine?".
//
// Returns `null` when the token cannot be decoded, and `null` must be read as
// *unknown*, which callers treat as *assume valid*. Treating it as expired would
// refresh on literally every request.
function readExpiry(token: string | null): number | null {
    if (!token) {
        return null;
    }
    const segments = token.split('.');
    if (segments.length !== 3) {
        return null;
    }
    try {
        // base64url -> base64: the JWT alphabet swaps two characters and drops
        // the padding, and `atob` accepts neither.
        let payload = segments[1].replace(/-/g, '+').replace(/_/g, '/');
        while (payload.length % 4 !== 0) {
            payload += '=';
        }
        const claims = JSON.parse(window.atob(payload));
        return typeof claims?.exp === 'number' ? claims.exp * 1000 : null;
    } catch (e) {
        return null;
    }
}

function adoptToken(token: string | null, sessionIsDead: boolean): void {
    accessToken = token;
    accessTokenExpiresAt = readExpiry(token);
    sessionKnownDead = sessionIsDead;
}

// Drops the token without touching `sessionKnownDead`: the session may well
// still be good, we just have nothing usable in hand right now.
function clearToken(): void {
    accessToken = null;
    accessTokenExpiresAt = null;
}

function hasUsableToken(): boolean {
    if (!accessToken) {
        return false;
    }
    if (accessTokenExpiresAt === null) {
        return true;
    }
    return Date.now() + EXPIRY_SKEW_MS < accessTokenExpiresAt;
}

export function isSessionKnownDead(): boolean {
    return sessionKnownDead;
}

// Exchange the httpOnly refresh cookie for a new access token. `credentials:
// 'include'` is what tells the browser to attach that cookie to a cross-origin
// request; without it the call is anonymous and always fails.
export function refreshAccessToken(): Promise<string | null> {
    if (refreshInFlight) {
        return refreshInFlight;
    }

    refreshInFlight = fetch(`${apiHttpUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
    })
        .then(async (response) => {
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    // The server actually rejected the cookie: 401 here is the
                    // normal "not logged in" answer, not an error.
                    adoptToken(null, true);
                } else {
                    // A 500 says nothing about whether the session is valid.
                    // Same handling as the network failure below: forget the
                    // token, keep the session retryable.
                    clearToken();
                }
                return null;
            }
            const body = await response.json();
            const token =
                typeof body?.accessToken === 'string' ? body.accessToken : null;
            adoptToken(token, token === null);
            return token;
        })
        .catch(() => {
            // Network failure — the session may well still be valid, so do not
            // mark it dead or a flaky connection would log the user out.
            clearToken();
            return null;
        })
        .then((token) => {
            refreshInFlight = null;
            return token;
        });

    return refreshInFlight;
}

// What callers should use: returns a token that is actually worth sending,
// minting a new one when the one we hold is missing or about to expire.
//
// The expiry check is what makes subscriptions survive. HTTP is self-healing —
// a 401 goes through `errorLink`, which refreshes and replays — but a WebSocket
// bypasses `errorLink` entirely and is only authenticated once, at
// `connection_init`. An idle tab whose socket drops after expiry would otherwise
// reconnect presenting the dead token and every subscription on it would fail
// silently until some HTTP query happened to refresh.
export function ensureAccessToken(): Promise<string | null> {
    if (hasUsableToken()) {
        return Promise.resolve(accessToken);
    }
    if (sessionKnownDead) {
        return Promise.resolve(null);
    }
    return refreshAccessToken();
}

// Called once at startup, before the app renders anything: a reload has no
// in-memory token, and the only way to know whether the user is still logged in
// is to try the cookie.
export function bootstrapSession(): Promise<string | null> {
    return refreshAccessToken();
}

// What the login endpoints can answer with. A password-only account gets a
// token straight away; an MFA-enforced account gets a short-lived `mfaToken`
// and no token yet; an account flagged by an admin reset gets a `changeToken`
// and must pick a new password first. The two interstitial tokens are opaque to
// the client — it only carries them back to the endpoint that issued them.
export type LoginOutcome =
    | { status: 'authenticated' }
    | { status: 'mfaRequired'; mfaToken: string }
    | { status: 'passwordChangeRequired'; changeToken: string };

// NestJS error bodies are `{ statusCode, message, error }`, where `message` is a
// string or an array of strings (class-validator). Pull the human message out so
// the login screens can show the server's own Spanish text — a wrong/expired MFA
// code, a too-short password — instead of a generic client-side string. Falls
// back when there is no JSON body (a bare 429/500).
async function readServerMessage(
    response: Response,
    fallback: string,
): Promise<string> {
    try {
        const body = await response.json();
        const message = body?.message;
        if (typeof message === 'string' && message.length > 0) {
            return message;
        }
        if (Array.isArray(message) && typeof message[0] === 'string') {
            return message[0];
        }
    } catch (e) {
        // No JSON body to read — use the fallback.
    }
    return fallback;
}

// Map a login/verify/change success body to a `LoginOutcome`, adopting the token
// only when the server actually issued one. Every endpoint that can end a login
// (login, mfa/verify, password/change) returns one of these three shapes, so the
// mapping lives in one place and the caller never inspects the raw body.
function adoptOutcome(body: any): LoginOutcome {
    if (typeof body?.accessToken === 'string') {
        adoptToken(body.accessToken, false);
        return { status: 'authenticated' };
    }
    if (body?.mfaRequired === true && typeof body?.mfaToken === 'string') {
        return { status: 'mfaRequired', mfaToken: body.mfaToken };
    }
    if (
        body?.passwordChangeRequired === true &&
        typeof body?.changeToken === 'string'
    ) {
        return {
            status: 'passwordChangeRequired',
            changeToken: body.changeToken,
        };
    }
    throw new Error('Unexpected login response');
}

export async function loginWithPassword(
    email: string,
    password: string,
): Promise<LoginOutcome> {
    const response = await fetch(`${apiHttpUrl}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });

    // A failed password login is deliberately generic (Phase 2 returns one
    // unified message for unknown user / wrong password / locked), so there is
    // nothing worth surfacing from the body — the caller shows its own Spanish
    // line. A 429 from the throttler lands here too and is treated the same.
    if (!response.ok) {
        throw new Error('Could not log-in with the provided credentials');
    }

    return adoptOutcome(await response.json());
}

// Complete the email-MFA step. On success the server sets the refresh cookie and
// returns an access token, which we adopt exactly as a plain login does — the
// caller then bootstraps the session identically. On a wrong/expired code the
// server's Spanish message is thrown so the code screen can show it in place,
// without dropping the user back to the password form.
export async function verifyMfaCode(
    mfaToken: string,
    code: string,
): Promise<void> {
    const response = await fetch(`${apiHttpUrl}/auth/mfa/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken, code }),
    });

    if (!response.ok) {
        throw new Error(
            await readServerMessage(response, 'No se pudo verificar el código'),
        );
    }

    const body = await response.json();
    if (typeof body?.accessToken !== 'string') {
        throw new Error('No se pudo verificar el código');
    }
    adoptToken(body.accessToken, false);
}

// Ask the server to email a fresh code, invalidating any prior unconsumed one.
// Throttled server-side (~3/min/IP); a 429 surfaces its message here.
export async function resendMfaCode(mfaToken: string): Promise<void> {
    const response = await fetch(`${apiHttpUrl}/auth/mfa/resend`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken }),
    });

    if (!response.ok) {
        throw new Error(
            await readServerMessage(response, 'No se pudo reenviar el código'),
        );
    }
}

// Complete the forced-password-change step. The result is either a session
// (token adopted) or — for an account that ALSO enforces MFA — the MFA step,
// because the server composes the two gates. Returning a `LoginOutcome` lets the
// caller reuse the same routing it uses for a plain login. A rejected password
// (server-side min length, etc.) throws the server's Spanish message.
export async function changePasswordWithToken(
    changeToken: string,
    newPassword: string,
): Promise<LoginOutcome> {
    const response = await fetch(`${apiHttpUrl}/auth/password/change`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeToken, newPassword }),
    });

    if (!response.ok) {
        throw new Error(
            await readServerMessage(
                response,
                'No se pudo cambiar la contraseña',
            ),
        );
    }

    return adoptOutcome(await response.json());
}

// Returns whether the session was actually ended server-side, and the caller
// must respect the answer.
//
// This used to swallow the status and clear local state regardless. JavaScript
// cannot delete an httpOnly cookie, so when the request never landed the cookie
// survived, the bootstrap refresh restored the session moments later, and the
// user had been told they logged out when they had not. On failure we now keep
// the in-memory token too, leaving a working session rather than a half-broken
// one.
export async function logoutSession(): Promise<boolean> {
    try {
        // Server-side revocation: dropping the token locally would leave the
        // refresh family alive and usable by anyone holding the cookie.
        const response = await fetch(`${apiHttpUrl}/auth/logout`, {
            method: 'POST',
            credentials: 'include',
        });
        if (!response.ok) {
            return false;
        }
    } catch (e) {
        return false;
    }

    adoptToken(null, true);
    return true;
}
