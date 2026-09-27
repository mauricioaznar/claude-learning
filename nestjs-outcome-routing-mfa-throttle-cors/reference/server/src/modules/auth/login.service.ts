import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginInput, SessionMeta, UserWithRoles } from '../../common/dto/entities';
import { PrismaService } from '../../common/modules/prisma/prisma.service';
import {
    LOGIN_FAILED_MESSAGE,
    loginLockout,
} from '../../common/constants/login-protection';
import {
    MFA_TOKEN_PURPOSE,
    PASSWORD_CHANGE_PURPOSE,
} from '../../common/constants/mfa';
import { AppLoggerService } from '../../common/modules/logging/app-logger.service';
import { signInterstitialToken } from './utils/interstitial-token.util';
import { AuthOutcome, AuthUser } from './auth.types';
import { RefreshTokenService } from './refresh-token.service';
import { MfaService } from './mfa.service';

// A real bcrypt hash to compare an attempted password against when the email is
// unknown, so an unknown account and a wrong password cost the same bcrypt time.
// Without it, "no such user" returns fast (no hash to check) while "wrong
// password" pays for a compare — a timing difference that lets an attacker
// enumerate valid emails. Computed once at module load; the plaintext is
// throwaway and never used again.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('inopack-timing-equalizer', 10);

@Injectable()
export class LoginService {
    constructor(
        private prisma: PrismaService,
        private logger: AppLoggerService,
        private jwtService: JwtService,
        private refreshTokenService: RefreshTokenService,
        private mfaService: MfaService,
    ) {}

    // Returns the user on valid credentials, `null` on any failure. The caller
    // cannot (and must not) tell *why* it failed — unknown email, wrong password
    // and a locked account all collapse to `null`, and the controller turns every
    // one into the same generic message (Phase 2 acceptance criterion 3).
    //
    // This method also owns the Phase 2 lockout bookkeeping, because it is the one
    // place that both knows whether the account exists and holds its counter: it
    // increments the failure count on a wrong password, freezes the account at the
    // threshold, and clears the count on success.
    async validateUser({
        email,
        password,
    }: {
        email: string;
        password: string;
    }): Promise<UserWithRoles | null> {
        const user = await this.prisma.users.findFirst({
            include: {
                // Only live role assignments may reach the token — a revoked
                // role must not keep granting access.
                user_roles: {
                    where: { active: 1 },
                },
            },
            where: {
                email: email,
                // A deactivated / soft-deleted user (`active = -1`) could log in
                // before this line existed.
                active: 1,
            },
        });
        if (!user) {
            // Unknown or deactivated account. Burn an equivalent bcrypt compare
            // so the response time matches the wrong-password path and cannot be
            // used to enumerate valid emails. There is no counter to touch — a
            // row that does not exist cannot be locked.
            await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
            return null;
        }

        // A disabled account never authenticates, whatever the password. It
        // collapses to the same `null` as every other failure so the response
        // stays one generic message (no "account disabled" oracle), and it is
        // checked before the password compare — like the lockout — so a disabled
        // account cannot be probed for its password either.
        if (user.login_disabled) {
            return null;
        }

        // A live lockout refuses the attempt before the password is even checked.
        // Checking first would both leak (via timing) whether the password was
        // right and let a persistent attacker keep the account frozen forever by
        // continuing to guess. Note this is *not* extended on each blocked
        // attempt — the window is fixed at lock time.
        if (user.lockout_until && user.lockout_until.getTime() > Date.now()) {
            return null;
        }

        let storedPassword = user.password;
        if (user.password.match(/^\$2y(.+)$/i)) {
            storedPassword = user.password.replace(/^\$2y(.+)$/i, '$2a$1');
        }
        const isMatch = await bcrypt.compare(password, storedPassword);
        if (!isMatch) {
            await this.registerFailedLogin(
                user.id,
                user.failed_login_count,
            );
            return null;
        }

        // Success wipes the slate: the counter resets and any expired lockout is
        // cleared. Guarded so the common case (a clean account) does no write.
        if (user.failed_login_count !== 0 || user.lockout_until !== null) {
            await this.prisma.users.update({
                where: { id: user.id },
                data: { failed_login_count: 0, lockout_until: null },
            });
        }

        return {
            ...user,
            password: undefined,
        };
    }

    // Records one wrong-password attempt and freezes the account once the
    // consecutive-failure threshold is reached. IP-independent by design: the
    // counter lives on the user row, so an attack that spreads guesses across many
    // IPs (to duck the per-IP rate limit) still trips the same lock. When it
    // locks, the counter is reset to 0 — after the window expires the account
    // starts fresh rather than re-locking on the very next miss.
    private async registerFailedLogin(
        userId: number,
        currentCount: number,
    ): Promise<void> {
        const nextCount = currentCount + 1;
        const shouldLock = nextCount >= loginLockout.maxFailedAttempts;
        await this.prisma.users.update({
            where: { id: userId },
            data: shouldLock
                ? {
                      failed_login_count: 0,
                      lockout_until: new Date(
                          Date.now() +
                              loginLockout.lockoutMinutes * 60 * 1000,
                      ),
                  }
                : { failed_login_count: nextCount },
        });
    }

    // REST login: full token pair. The caller (auth.controller) is responsible
    // for putting `refreshToken` into the cookie and returning only the access
    // token in the body.
    async loginWithCredentials(
        userInput: LoginInput,
        meta: SessionMeta = {},
    ): Promise<AuthOutcome> {
        this.logger.trace('auth.trace.login.begin', {
            email: userInput.email,
            ip: meta.ip ?? undefined,
            requestId: meta.requestId,
        });

        const user = await this.validateUser(userInput);

        this.logger.trace('auth.trace.login.validated', {
            email: userInput.email,
            // `validateUser` collapses "no such user", "deactivated user" and
            // "wrong password" into one `null`. The trace cannot pull them
            // apart either — see the warning on the failure branch below.
            detail: user ? 'found' : 'rejected',
            requestId: meta.requestId,
        });

        if (!user) {
            // `validateUser` returns `null` for an unknown email, a wrong
            // password *and* a locked account, and has already done the Phase 2
            // lockout bookkeeping internally. The response deliberately cannot
            // distinguish those cases — a distinct "locked" or "no such user"
            // message would leak whether an account exists (acceptance criterion
            // 3). The attempted email is still logged: a log is not
            // attacker-visible, so it may carry what the response may not.
            this.logger.warn('auth.login.failed', {
                email: userInput.email,
                ip: meta.ip ?? undefined,
                requestId: meta.requestId,
            });
            throw new BadRequestException(LOGIN_FAILED_MESSAGE);
        }

        // Password verified. What happens next depends on the account: an
        // MFA-enforced account, or one a super-user reset, is gated here rather
        // than handed a session outright. `decideAfterPassword` owns that fork
        // and is shared with the verify and change-password paths so the gates
        // cannot drift apart.
        return this.decideAfterPassword(user, meta);
    }

    // The single fork every "the password (or emailed code) was correct" path
    // funnels through, so login, `MfaService.verifyMfaCode` and
    // `PasswordService.changePassword` all apply the same rules in the same
    // order:
    //
    //   1. A forced password change wins first — a super-user set this state and
    //      the account cannot be used normally until it is resolved.
    //   2. Then MFA — an enforced account never gets tokens on the password
    //      alone (Phase 3 acceptance criterion 1). A code is emailed and the
    //      caller is handed an `mfaToken`, nothing more.
    //   3. Otherwise a normal session.
    //
    // Public because `PasswordService.changePassword` re-enters here after
    // clearing the flag, so an MFA-enforced user who was just forced to rotate
    // their password still lands on the MFA step next — the two gates compose
    // instead of one bypassing the other.
    async decideAfterPassword(
        user: AuthUser,
        meta: SessionMeta,
    ): Promise<AuthOutcome> {
        if (user.must_change_password) {
            this.logger.log('auth.password.change_required', {
                userId: user.id,
                email: user.email,
                requestId: meta.requestId,
            });
            return {
                kind: 'password_change_required',
                changeToken: signInterstitialToken(
                    this.jwtService,
                    user.id,
                    PASSWORD_CHANGE_PURPOSE,
                ),
            };
        }

        if (user.mfa_enabled) {
            // Emails the code first. If mail fails this throws and no token is
            // signed — an enforced account fails closed (no access) rather than
            // open, which is the whole point of gating on a channel that can be
            // down.
            await this.mfaService.sendMfaChallenge(user, meta);
            this.logger.log('auth.mfa.challenge_issued', {
                userId: user.id,
                email: user.email,
                ip: meta.ip ?? undefined,
                requestId: meta.requestId,
            });
            return {
                kind: 'mfa_required',
                mfaToken: signInterstitialToken(
                    this.jwtService,
                    user.id,
                    MFA_TOKEN_PURPOSE,
                ),
            };
        }

        return {
            kind: 'tokens',
            pair: await this.refreshTokenService.createSession(user, meta),
        };
    }
}
