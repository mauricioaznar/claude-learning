// Shared environment-reading helpers for the `constants/*` files. Each of those
// modules is the single access point for one area's configuration (jwt, mfa,
// mail, login-protection, …); they all read `process.env` the same two ways, so
// the readers live here once instead of being copy-pasted into each. Call sites
// still consume configuration through their own `constants/*` exports — only the
// two primitive readers are centralised.

// A numeric env var with a fallback and validation. An unset or empty value
// takes the fallback; a present value must parse to a finite, non-negative
// number or it is a hard error — a typo'd limit should fail loudly at boot, not
// silently become `NaN` and disable the protection it configures.
export function readNumber(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${name} must be a non-negative number, got "${raw}"`);
    }
    return value;
}

// A secret with a development-only fallback. A present value always wins. When
// unset, production is a hard boot failure — a fallback there would sign tokens
// with a value that is public in this repository — while outside production the
// fallback keeps local development and the test suite running without an env
// change. The `name` is in the message, so the caller need not add its own label.
export function readSecret(name: string, developmentFallback: string): string {
    const value = process.env[name];
    if (value) {
        return value;
    }
    if (process.env.NODE_ENV === 'production') {
        throw new Error(
            `${name} is not set. Production requires an explicit secret.`,
        );
    }
    return developmentFallback;
}
