// The single source of truth for which browser origins may talk to this API.
//
// Two things read it and they must never disagree: `main.ts` hands it to
// `enableCors`, and `AllowedOriginGuard` rejects cross-site posts to the cookie
// endpoints. A list that drifted between them would either lock the frontend out
// or leave the CSRF door open on exactly the routes the guard exists to protect.
//
// CORS was `app.enableCors()` with no arguments until Phase 1, i.e. `Access-
// Control-Allow-Origin: *`. A wildcard is incompatible with credentialed
// requests: the browser refuses to send the refresh cookie unless the API names
// the exact origin *and* allows credentials. So the open door had to become an
// allowlist.
//
// Consequence to keep in mind when deploying: an origin missing from this list
// can no longer talk to the API from a browser. Non-browser callers (scripts,
// server-to-server, curl) are unaffected — CORS is enforced by browsers, not by
// the server.
function resolveCorsOrigins(): string[] {
    const configured = (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);

    if (configured.length > 0) {
        return configured;
    }

    if (process.env.NODE_ENV === 'production') {
        // Not a boot failure — refusing to start would take a running API down
        // over a missing variable. But the frontend is broken until this is set,
        // so say so loudly in the logs.
        // eslint-disable-next-line no-console
        console.warn(
            'CORS_ORIGINS is not set. Browser requests from the frontend will be ' +
                'rejected and the refresh cookie will not be sent. Set it to the ' +
                'frontend origin(s), comma separated.',
        );
    }

    return ['http://localhost:3000'];
}

// Resolved once. The environment does not change while the process runs, and the
// guard below calls this per request — recomputing (and re-warning) on every
// login would be pure noise.
let resolved: string[] | null = null;

export function corsOrigins(): string[] {
    if (resolved === null) {
        resolved = resolveCorsOrigins();
    }
    return resolved;
}

export function isAllowedOrigin(origin: string): boolean {
    return corsOrigins().indexOf(origin) !== -1;
}
