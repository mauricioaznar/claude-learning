import { createHash, randomInt } from 'crypto';
import { mfaConstants } from '../../../common/constants/mfa';

export function generateMfaCode(): string {
    // Uniform over [0, 10^length): `randomInt` is CSPRNG-backed and unbiased,
    // unlike `Math.floor(Math.random()*n)`. Zero-padded so a leading-zero
    // code is still the right length.
    const ceiling = 10 ** mfaConstants.codeLength;
    return randomInt(0, ceiling)
        .toString()
        .padStart(mfaConstants.codeLength, '0');
}

export function hashMfaCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
}
