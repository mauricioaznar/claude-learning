import {
    BadRequestException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SessionMeta, TokenPair } from '../../common/dto/entities';
import { PrismaService } from '../../common/modules/prisma/prisma.service';
import { MailService } from '../../common/modules/mail/mail.service';
import { AppLoggerService } from '../../common/modules/logging/app-logger.service';
import { mfaConstants, MFA_TOKEN_PURPOSE } from '../../common/constants/mfa';
import { generateMfaCode, hashMfaCode } from './utils/mfa-code.util';
import { verifyInterstitialToken } from './utils/interstitial-token.util';
import { AuthUser } from './auth.types';
import { RefreshTokenService } from './refresh-token.service';

/* ─────────────────────────── Phase 3 email MFA ───────────────────────────
 * The emailed one-time code and the two operations over it (verify, resend),
 * plus the challenge-send helper the login path calls. None of these touch the
 * rotation transaction, so §1.7.6's "no I/O inside the lock" rule does not apply
 * here — the logging is ordinary. Sessions are minted through
 * `RefreshTokenService`, and the user is re-read through it, so the MFA-verify
 * path mints a session the identical way login does.
 */
@Injectable()
export class MfaService {
    constructor(
        private jwtService: JwtService,
        private prisma: PrismaService,
        private logger: AppLoggerService,
        private mail: MailService,
        private refreshTokenService: RefreshTokenService,
    ) {}

    // Exchange a correct emailed code for a real session. The `mfaToken` proves
    // the password step already passed (so no password is re-checked); the code
    // proves control of the mailbox.
    async verifyMfaCode(
        mfaToken: string,
        code: string,
        meta: SessionMeta = {},
    ): Promise<TokenPair> {
        const userId = verifyInterstitialToken(
            this.jwtService,
            mfaToken,
            MFA_TOKEN_PURPOSE,
        );
        const user = await this.refreshTokenService.readActiveUser(userId);
        if (!user) {
            // Deactivated between login and verify. Nothing to grant.
            this.logger.warn('auth.mfa.verify.failed', {
                userId,
                reason: 'inactive',
                requestId: meta.requestId,
            });
            throw new UnauthorizedException();
        }

        const now = new Date();
        // The newest still-redeemable code. `sendMfaChallenge` consumes older
        // ones, so at most one row matches, but ordering by id desc makes that
        // explicit and independent of that invariant.
        const record = await this.prisma.email_mfa_codes.findFirst({
            where: {
                user_id: userId,
                consumed_at: null,
                expires_at: { gt: now },
            },
            orderBy: { id: 'desc' },
        });
        if (!record) {
            this.logger.warn('auth.mfa.verify.failed', {
                userId,
                reason: 'no_code',
                requestId: meta.requestId,
            });
            throw new UnauthorizedException(
                'El código expiró o no existe. Solicita uno nuevo.',
            );
        }

        // Attempt cap: a 6-digit code is only ~20 bits, so the per-IP throttle on
        // the route is not enough on its own — the code itself must burn after a
        // few wrong guesses. Checked before the compare so a locked code can
        // never be brute-forced one request past the limit.
        if (record.attempts >= mfaConstants.maxAttempts) {
            await this.prisma.email_mfa_codes.update({
                where: { id: record.id },
                data: { consumed_at: now },
            });
            this.logger.warn('auth.mfa.verify.locked', {
                userId,
                requestId: meta.requestId,
            });
            throw new UnauthorizedException(
                'Demasiados intentos. Solicita un nuevo código.',
            );
        }

        if (hashMfaCode(code) !== record.code_hash) {
            await this.prisma.email_mfa_codes.update({
                where: { id: record.id },
                data: { attempts: record.attempts + 1 },
            });
            this.logger.warn('auth.mfa.verify.failed', {
                userId,
                reason: 'wrong_code',
                requestId: meta.requestId,
            });
            throw new UnauthorizedException('Código incorrecto.');
        }

        // Correct. Single-use: consume it so a replay (or a second tab) cannot
        // redeem the same code.
        await this.prisma.email_mfa_codes.update({
            where: { id: record.id },
            data: { consumed_at: now },
        });
        this.logger.log('auth.mfa.verify.success', {
            userId,
            email: user.email,
            requestId: meta.requestId,
        });
        return this.refreshTokenService.createSession(user, meta);
    }

    // Re-issue a code for an in-progress MFA challenge (the "Reenviar código"
    // button). Gated by the same `mfaToken`, so only someone who already passed
    // the password step can trigger a send — and the route is tightly throttled
    // so it cannot be turned into a mailbox-spam or mail-cost amplifier.
    async resendMfaCode(
        mfaToken: string,
        meta: SessionMeta = {},
    ): Promise<void> {
        const userId = verifyInterstitialToken(
            this.jwtService,
            mfaToken,
            MFA_TOKEN_PURPOSE,
        );
        const user = await this.refreshTokenService.readActiveUser(userId);
        if (!user) {
            throw new UnauthorizedException();
        }
        await this.sendMfaChallenge(user, meta);
        this.logger.log('auth.mfa.resent', {
            userId,
            email: user.email,
            requestId: meta.requestId,
        });
    }

    // Generate a code, invalidate any earlier unconsumed ones, store the hash,
    // and email the raw digits. The raw code exists only in memory here and in
    // the outgoing mail — the DB only ever holds its SHA-256. Called by the login
    // path (`LoginService.decideAfterPassword`) and by `resendMfaCode`.
    async sendMfaChallenge(user: AuthUser, meta: SessionMeta): Promise<void> {
        const code = generateMfaCode();
        const now = new Date();

        // A resend (or a re-login) invalidates the user's prior unconsumed codes
        // so only the newest is redeemable — otherwise every old code stays live
        // until its TTL, widening the guessing surface.
        await this.prisma.email_mfa_codes.updateMany({
            where: { user_id: user.id, consumed_at: null },
            data: { consumed_at: now },
        });

        await this.prisma.email_mfa_codes.create({
            data: {
                user_id: user.id,
                code_hash: hashMfaCode(code),
                expires_at: new Date(
                    now.getTime() + mfaConstants.codeTtlMinutes * 60 * 1000,
                ),
                created_at: now,
            },
        });

        try {
            await this.mail.sendMfaCode({ to: user.email, code });
        } catch (error) {
            // Fail closed: the caller (decideAfterPassword) never signs an
            // mfaToken, so the login ends in an error rather than a bypass.
            this.logger.error(
                'auth.mfa.send_failed',
                { userId: user.id, requestId: meta.requestId },
                error,
            );
            throw new BadRequestException(
                'No pudimos enviar el código de verificación. Intenta de nuevo más tarde.',
            );
        }
    }
}
