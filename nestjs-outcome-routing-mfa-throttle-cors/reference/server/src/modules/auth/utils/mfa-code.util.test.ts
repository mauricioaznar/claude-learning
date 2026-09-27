import { createHash } from 'crypto';
import { mfaConstants } from '../../../common/constants/mfa';
import { generateMfaCode, hashMfaCode } from './mfa-code.util';

describe('generateMfaCode', () => {
    it('always returns exactly codeLength digits, zero-padded', () => {
        // Many iterations because the low-value codes (leading zeros) are the
        // ones a non-padded implementation would emit too short.
        for (let i = 0; i < 1000; i++) {
            const code = generateMfaCode();
            expect(code).toHaveLength(mfaConstants.codeLength);
            expect(code).toMatch(/^[0-9]+$/);
        }
    });
});

describe('hashMfaCode', () => {
    it('produces the SHA-256 hex digest of the code', () => {
        const expected = createHash('sha256').update('123456').digest('hex');
        expect(hashMfaCode('123456')).toBe(expected);
    });

    it('is deterministic and 64 hex chars', () => {
        expect(hashMfaCode('000000')).toBe(hashMfaCode('000000'));
        expect(hashMfaCode('000000')).toMatch(/^[0-9a-f]{64}$/);
    });
});
