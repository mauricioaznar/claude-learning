import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MFA_TOKEN_PURPOSE, PASSWORD_CHANGE_PURPOSE } from '../../../common/constants/mfa';
import {
    signInterstitialToken,
    verifyInterstitialToken,
} from './interstitial-token.util';

// The util signs and verifies with the same `mfaConstants.tokenSecret` (a dev
// fallback outside production), so a bare `JwtService` with no configured secret
// is enough — the secret travels in the per-call options.
const jwt = new JwtService({});

describe('interstitial token', () => {
    it('round-trips: a token signed for a purpose verifies back to its subject', () => {
        const token = signInterstitialToken(jwt, 42, MFA_TOKEN_PURPOSE);
        expect(verifyInterstitialToken(jwt, token, MFA_TOKEN_PURPOSE)).toBe(42);
    });

    it('rejects a token presented for the wrong purpose', () => {
        const token = signInterstitialToken(jwt, 42, MFA_TOKEN_PURPOSE);
        expect(() =>
            verifyInterstitialToken(jwt, token, PASSWORD_CHANGE_PURPOSE),
        ).toThrow(UnauthorizedException);
    });

    it('rejects a garbage / tampered token', () => {
        expect(() =>
            verifyInterstitialToken(jwt, 'not-a-jwt', MFA_TOKEN_PURPOSE),
        ).toThrow(UnauthorizedException);
    });
});
