import { Request, Response } from 'express';

/*
 * The refresh cookie belongs to the browser, not to React.
 *
 * `setRefreshCookie` and `clearRefreshCookie` produce response headers. The
 * browser applies those headers to its cookie store. `readRefreshCookie` reads
 * the cookie back from a later request. Because the cookie is `httpOnly`, no
 * frontend function can inspect, copy, or delete its value directly; frontend
 * requests use `credentials: 'include'` and let the browser handle it.
 */

export const REFRESH_COOKIE_NAME = 'refresh_token';

// Scoped to `/auth`, not to `/` — the browser then attaches the refresh token
// to the three auth endpoints and to nothing else. In particular it is never
// sent on `/graphql`, which is what keeps a CSRF-triggered GraphQL request from
// riding on the session.
//
// The plan said `/auth/refresh`. It has to be `/auth` in practice: cookie Path
// matching is per-request-path, so a cookie scoped to `/auth/refresh` would not
// be delivered to `/auth/logout`, and logout could never revoke the session it
// is trying to end.
export const REFRESH_COOKIE_PATH = '/auth';

function isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
}

// SameSite decides whether the browser attaches this cookie on a request the
// frontend origin makes to the API origin.
//
// - Dev: `localhost:3000` -> `localhost:3008` is *same-site* (port is not part
//   of a site), so `lax` works and keeps the cookie off third-party navigations.
// - Prod: the app is on `grupoinopack.app` and the API on
//   `server.grupoinopack.app` — the same registrable domain, i.e. *same-site*,
//   so `AUTH_COOKIE_SAMESITE=lax` is set: stronger than `none` because the
//   refresh cookie is never attached on cross-site requests. (Until the
//   api-hostname-migration, 2026-09, the API lived on `*.mauaznar.com` — a
//   different registrable domain, cross-site — which forced `none`.)
//
// Overridable, and the default below stays `none` in production as a
// conservative fallback for a deployment whose API is *not* co-domained with the
// frontend. Both current tiers set `AUTH_COOKIE_SAMESITE=lax` explicitly, so
// that default is not exercised in practice.
function cookieSameSite(): 'lax' | 'strict' | 'none' {
    const configured = (process.env.AUTH_COOKIE_SAMESITE || '').toLowerCase();
    if (
        configured === 'lax' ||
        configured === 'strict' ||
        configured === 'none'
    ) {
        return configured;
    }
    return isProduction() ? 'none' : 'lax';
}

export function setRefreshCookie(
    res: Response,
    token: string,
    expiresAt: Date,
): void {
    const sameSite = cookieSameSite();
    res.cookie(REFRESH_COOKIE_NAME, token, {
        httpOnly: true,
        secure: sameSite === 'none' || isProduction(),
        sameSite,
        path: REFRESH_COOKIE_PATH,
        expires: expiresAt,
    });
}

export function clearRefreshCookie(res: Response): void {
    const sameSite = cookieSameSite();
    // The clearing cookie must match name + path + sameSite + secure of the one
    // it replaces, otherwise the browser keeps the original alongside it.
    res.clearCookie(REFRESH_COOKIE_NAME, {
        httpOnly: true,
        secure: sameSite === 'none' || isProduction(),
        sameSite,
        path: REFRESH_COOKIE_PATH,
    });
}

// Deliberately not `cookie-parser`. Reading one cookie is six lines, and adding
// a runtime dependency by hand desynchronises package.json from
// package-lock.json — which breaks `npm ci`, the install command this repo
// requires (see docs/memory/reference_graphql_install.md).
export function readRefreshCookie(req: Request): string | null {
    const header = req.headers?.cookie;
    if (!header) {
        return null;
    }
    const parts = header.split(';');
    for (const part of parts) {
        const separator = part.indexOf('=');
        if (separator === -1) {
            continue;
        }
        if (part.slice(0, separator).trim() === REFRESH_COOKIE_NAME) {
            return decodeURIComponent(part.slice(separator + 1).trim());
        }
    }
    return null;
}
