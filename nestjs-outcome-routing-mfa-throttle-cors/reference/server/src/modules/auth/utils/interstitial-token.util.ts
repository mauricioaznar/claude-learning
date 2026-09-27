import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { mfaConstants } from '../../../common/constants/mfa';

// The interstitial token bridges the gap between a correct password (or emailed
// code) and a real session. Signed with `MFA_TOKEN_SECRET`, not the access-token
// secret, and carrying a `purpose` claim — so it is worthless as an access token
// and worthless on the wrong endpoint.
//
// Free functions taking the `JwtService` explicitly rather than methods on a
// Nest service: nothing here is stateful, so they are trivially unit-testable
// with a real or stubbed `JwtService` and no Nest context.

// Sign a short-lived, single-purpose token for the gap between a correct
// password and a real session.
export function signInterstitialToken(
    jwt: JwtService,
    userId: number,
    purpose: string,
): string {
    return jwt.sign(
        { sub: userId, purpose },
        {
            secret: mfaConstants.tokenSecret,
            expiresIn: mfaConstants.tokenTtl,
        },
    );
}

// Verify one and return its subject, or throw 401. A bad signature, an expired
// token, or the wrong `purpose` are all indistinguishable to the caller — it is
// a 401 either way.
export function verifyInterstitialToken(
    jwt: JwtService,
    token: string,
    purpose: string,
): number {
    let payload: { sub?: unknown; purpose?: unknown };
    try {
        payload = jwt.verify(token, {
            secret: mfaConstants.tokenSecret,
        });
    } catch {
        throw new UnauthorizedException();
    }
    if (payload.purpose !== purpose || typeof payload.sub !== 'number') {
        throw new UnauthorizedException();
    }
    return payload.sub;
}
