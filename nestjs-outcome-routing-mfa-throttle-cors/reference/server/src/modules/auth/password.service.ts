import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SessionMeta } from '../../common/dto/entities';
import { PrismaService } from '../../common/modules/prisma/prisma.service';
import { PASSWORD_CHANGE_PURPOSE } from '../../common/constants/mfa';
import { assertPasswordStrength } from '../../common/constants/password-policy';
import { AppLoggerService } from '../../common/modules/logging/app-logger.service';
import { verifyInterstitialToken } from './utils/interstitial-token.util';
import { AuthOutcome } from './auth.types';
import { RefreshTokenService } from './refresh-token.service';
import { LoginService } from './login.service';

// Phase 3 §3.3: the super-user forced-password-change gate. Setting the flag
// lives here; completing the change lives here; the session revocations both
// steps depend on are delegated to `RefreshTokenService`, and the post-change
// re-entry into the gate fork is delegated to `LoginService`.
@Injectable()
export class PasswordService {
    constructor(
        private prisma: PrismaService,
        private logger: AppLoggerService,
        private jwtService: JwtService,
        private refreshTokenService: RefreshTokenService,
        private loginService: LoginService,
    ) {}

    // Super-user reset (§3.3). Does **not** set a new password — it flags the
    // account so the next successful login is forced through a password change,
    // and kills every existing session so a live token cannot sidestep it. The
    // target authenticates with their current password to reach the change gate.
    async requirePasswordChange(userId: number): Promise<void> {
        await this.prisma.users.update({
            where: { id: userId },
            data: { must_change_password: true },
        });
        // Revoke all families so a currently-open session cannot be used to keep
        // working around the forced change.
        await this.refreshTokenService.revokeAllForUser(userId);
        this.logger.warn('auth.password.reset_by_admin', { userId });
    }

    // Complete a forced password change. `changeToken` carries the identity from
    // the login that hit the gate. On success the flag clears, the new password
    // is stored, any session is revoked, and the flow re-enters
    // `decideAfterPassword` — so an MFA-enforced user is then sent to the MFA
    // step rather than straight to tokens.
    async changePassword(
        changeToken: string,
        newPassword: string,
        meta: SessionMeta = {},
    ): Promise<AuthOutcome> {
        const userId = verifyInterstitialToken(
            this.jwtService,
            changeToken,
            PASSWORD_CHANGE_PURPOSE,
        );
        assertPasswordStrength(newPassword);

        const user = await this.refreshTokenService.readActiveUser(userId);
        if (!user) {
            throw new UnauthorizedException();
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await this.prisma.users.update({
            where: { id: userId },
            data: {
                password: hashed,
                must_change_password: false,
                // A fresh password also clears any brute-force state.
                failed_login_count: 0,
                lockout_until: null,
            },
        });
        // The admin reset already revoked; do it again defensively in case a
        // session was somehow established in between.
        await this.refreshTokenService.revokeAllForUser(userId);

        this.logger.log('auth.password.changed', {
            userId,
            email: user.email,
            requestId: meta.requestId,
        });

        // Re-read so the decision sees `must_change_password = 0` and the live
        // `mfa_enabled` flag rather than the pre-update values.
        const refreshed = await this.refreshTokenService.readActiveUser(userId);
        // Unreachable in practice (we just updated the same active row), but the
        // type is nullable and a session must never be minted for a null user.
        if (!refreshed) {
            throw new UnauthorizedException();
        }
        return this.loginService.decideAfterPassword(refreshed, meta);
    }
}
