import { Injectable } from '@nestjs/common';
import {
    LoginInput,
    SessionMeta,
    TokenPair,
    UserWithRoles,
} from '../../common/dto/entities';
import { AuthOutcome } from './auth.types';
import { LoginService } from './login.service';
import { RefreshTokenService } from './refresh-token.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';

// Re-exported so the pre-split import site — `import { AuthService, AuthOutcome }
// from './auth.service'` in `auth.controller.ts` — keeps working unchanged.
export { AuthOutcome } from './auth.types';

/*
 * The auth god-service was split (Phase 5d) into four cohesive services:
 *
 *   • LoginService        — validateUser, lockout bookkeeping, loginWithCredentials,
 *                           and the post-password gate fork (decideAfterPassword).
 *   • RefreshTokenService — the whole session lifecycle: createSession, rotation,
 *                           logout, family/user revocation, and the user re-read.
 *   • MfaService          — email one-time-code verify / resend / challenge-send.
 *   • PasswordService     — the super-user forced-password-change gate.
 *
 * `AuthService` is a thin facade over them, kept so the controller and resolver
 * call sites (and the existing tests) did not churn in the split commit. It holds
 * no logic of its own — every method delegates. Inline it later if the facade
 * stops earning its keep; until then it is the stable public surface.
 */
@Injectable()
export class AuthService {
    constructor(
        private loginService: LoginService,
        private refreshTokenService: RefreshTokenService,
        private mfaService: MfaService,
        private passwordService: PasswordService,
    ) {}

    validateUser(credentials: {
        email: string;
        password: string;
    }): Promise<UserWithRoles | null> {
        return this.loginService.validateUser(credentials);
    }

    loginWithCredentials(
        userInput: LoginInput,
        meta: SessionMeta = {},
    ): Promise<AuthOutcome> {
        return this.loginService.loginWithCredentials(userInput, meta);
    }

    rotateRefreshToken(
        rawToken: string | null,
        meta: SessionMeta = {},
    ): Promise<TokenPair> {
        return this.refreshTokenService.rotateRefreshToken(rawToken, meta);
    }

    logout(rawToken: string | null, meta: SessionMeta = {}): Promise<void> {
        return this.refreshTokenService.logout(rawToken, meta);
    }

    revokeAllForUser(userId: number): Promise<void> {
        return this.refreshTokenService.revokeAllForUser(userId);
    }

    verifyMfaCode(
        mfaToken: string,
        code: string,
        meta: SessionMeta = {},
    ): Promise<TokenPair> {
        return this.mfaService.verifyMfaCode(mfaToken, code, meta);
    }

    resendMfaCode(mfaToken: string, meta: SessionMeta = {}): Promise<void> {
        return this.mfaService.resendMfaCode(mfaToken, meta);
    }

    requirePasswordChange(userId: number): Promise<void> {
        return this.passwordService.requirePasswordChange(userId);
    }

    changePassword(
        changeToken: string,
        newPassword: string,
        meta: SessionMeta = {},
    ): Promise<AuthOutcome> {
        return this.passwordService.changePassword(
            changeToken,
            newPassword,
            meta,
        );
    }
}
