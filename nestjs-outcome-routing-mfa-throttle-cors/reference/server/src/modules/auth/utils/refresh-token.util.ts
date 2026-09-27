import { createHash } from 'crypto';

// SHA-256 rather than bcrypt on purpose: the input is 64 bytes of entropy,
// not a human password, so there is nothing to brute-force and the lookup
// must be a plain indexed equality check. Storing the digest means a leaked
// database dump contains no usable session.
export function hashRefreshToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
}
