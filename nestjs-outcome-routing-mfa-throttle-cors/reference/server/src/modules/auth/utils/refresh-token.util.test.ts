import { createHash } from 'crypto';
import { hashRefreshToken } from './refresh-token.util';

describe('hashRefreshToken', () => {
    it('produces the SHA-256 hex digest of the raw token', () => {
        const raw = 'a-raw-refresh-token-value';
        const expected = createHash('sha256').update(raw).digest('hex');
        expect(hashRefreshToken(raw)).toBe(expected);
    });

    it('is deterministic — the same input always hashes the same way', () => {
        expect(hashRefreshToken('same')).toBe(hashRefreshToken('same'));
    });

    it('returns a 64-character lowercase hex string', () => {
        expect(hashRefreshToken('anything')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('maps different inputs to different digests', () => {
        expect(hashRefreshToken('one')).not.toBe(hashRefreshToken('two'));
    });
});
