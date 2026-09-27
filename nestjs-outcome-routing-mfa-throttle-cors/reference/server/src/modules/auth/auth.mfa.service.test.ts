import { INestApplication } from '@nestjs/common';
import { setupApp } from '../../common/__tests__/helpers/setup-app';
import { UserService } from './users/user.service';
import { AuthService } from './auth.service';
import { MailService } from '../../common/modules/mail/mail.service';
import { PrismaService } from '../../common/modules/prisma/prisma.service';
import { roles } from '../../common/__tests__/objects/auth/roles';
import { mfaConstants } from '../../common/constants/mfa';
import { createHash } from 'crypto';
import {
    AppLoggerService,
    LogContext,
} from '../../common/modules/logging/app-logger.service';

// Phase 3: email MFA, the super-user forced-password-change gate, and the
// interstitial-token isolation both rely on. Kept out of `auth.service.test.ts`
// so its whole-run redaction assertion is not disturbed by these accounts (this
// file makes the same redaction claim for the emailed code).

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

let app: INestApplication;
let userService: UserService;
let authService: AuthService;
let prisma: PrismaService;

// Every code the service tried to email, newest last. The spy both captures the
// raw code (the DB only stores its hash, so tests have no other way to learn it)
// and keeps the dev-console mail line out of the test output.
let sentCodes: string[] = [];

// Recorded for the redaction assertion at the bottom, same technique as
// `auth.service.test.ts`.
const loggedCalls: {
    level: string;
    event: string;
    context: LogContext;
}[] = [];

beforeAll(async () => {
    app = await setupApp();
    userService = app.get(UserService);
    authService = app.get(AuthService);
    prisma = app.get(PrismaService);

    const mail = app.get(MailService);
    jest.spyOn(mail, 'sendMfaCode').mockImplementation((async ({
        code,
    }: {
        code: string;
    }) => {
        sentCodes.push(code);
    }) as any);

    const logger = app.get(AppLoggerService);
    for (const level of [
        'log',
        'warn',
        'error',
        'debug',
        'verbose',
        'trace',
    ] as const) {
        jest.spyOn(logger, level).mockImplementation(((
            event: string,
            context: LogContext,
        ) => {
            loggedCalls.push({ level, event, context });
        }) as any);
    }
});

afterAll(async () => {
    await app.close();
});

async function createUser(
    email: string,
    { mfaEnabled = false }: { mfaEnabled?: boolean } = {},
) {
    return userService.create({
        email,
        first_name: 'first',
        last_name: 'last',
        password: 'password123',
        roles,
        mfa_enabled: mfaEnabled,
    });
}

function lastCode(): string {
    return sentCodes[sentCodes.length - 1];
}

describe('email MFA login', () => {
    it('an MFA-enabled login emails a code and issues no tokens on the password alone', async () => {
        const user = await createUser('mfa-login@email.com', {
            mfaEnabled: true,
        });
        const before = sentCodes.length;

        const outcome = await authService.loginWithCredentials({
            email: user.email,
            password: 'password123',
        });

        expect(outcome.kind).toBe('mfa_required');
        if (outcome.kind !== 'mfa_required') throw new Error('unreachable');
        expect(typeof outcome.mfaToken).toBe('string');

        // A code was emailed…
        expect(sentCodes.length).toBe(before + 1);
        // …and crucially no session exists yet.
        const sessions = await prisma.refresh_tokens.count({
            where: { user_id: user.id },
        });
        expect(sessions).toBe(0);
    });

    it('a valid emailed code completes the login', async () => {
        const user = await createUser('mfa-verify@email.com', {
            mfaEnabled: true,
        });
        const outcome = await authService.loginWithCredentials({
            email: user.email,
            password: 'password123',
        });
        if (outcome.kind !== 'mfa_required') throw new Error('expected mfa');

        const pair = await authService.verifyMfaCode(
            outcome.mfaToken,
            lastCode(),
        );

        expect(typeof pair.accessToken).toBe('string');
        expect(typeof pair.refreshToken).toBe('string');
        const sessions = await prisma.refresh_tokens.count({
            where: { user_id: user.id },
        });
        expect(sessions).toBe(1);
    });

    it('an account without the flag logs in with no MFA step', async () => {
        const user = await createUser('mfa-disabled@email.com');
        const before = sentCodes.length;

        const outcome = await authService.loginWithCredentials({
            email: user.email,
            password: 'password123',
        });

        expect(outcome.kind).toBe('tokens');
        expect(sentCodes.length).toBe(before);
    });

    it('a wrong code is rejected, and the code locks after the attempt cap', async () => {
        const user = await createUser('mfa-attempts@email.com', {
            mfaEnabled: true,
        });
        const outcome = await authService.loginWithCredentials({
            email: user.email,
            password: 'password123',
        });
        if (outcome.kind !== 'mfa_required') throw new Error('expected mfa');
        const good = lastCode();

        // Burn the attempt budget on wrong guesses.
        for (let i = 0; i < mfaConstants.maxAttempts; i++) {
            await expect(
                authService.verifyMfaCode(outcome.mfaToken, '000000'),
            ).rejects.toThrow();
        }

        // Now even the correct code is refused — the row is locked/burned.
        await expect(
            authService.verifyMfaCode(outcome.mfaToken, good),
        ).rejects.toThrow();

        // A resend issues a fresh, usable code.
        await authService.resendMfaCode(outcome.mfaToken);
        const pair = await authService.verifyMfaCode(
            outcome.mfaToken,
            lastCode(),
        );
        expect(typeof pair.accessToken).toBe('string');
    });

    it('an emailed code works exactly once', async () => {
        const user = await createUser('mfa-single-use@email.com', {
            mfaEnabled: true,
        });
        const outcome = await authService.loginWithCredentials({
            email: user.email,
            password: 'password123',
        });
        if (outcome.kind !== 'mfa_required') throw new Error('expected mfa');
        const code = lastCode();

        await authService.verifyMfaCode(outcome.mfaToken, code);
        // A replay of the same (now consumed) code fails.
        await expect(
            authService.verifyMfaCode(outcome.mfaToken, code),
        ).rejects.toThrow();
    });

    it('an expired code is rejected', async () => {
        const user = await createUser('mfa-expired@email.com', {
            mfaEnabled: true,
        });
        const outcome = await authService.loginWithCredentials({
            email: user.email,
            password: 'password123',
        });
        if (outcome.kind !== 'mfa_required') throw new Error('expected mfa');

        await prisma.email_mfa_codes.updateMany({
            where: { user_id: user.id, consumed_at: null },
            data: { expires_at: new Date(Date.now() - 1000) },
        });

        await expect(
            authService.verifyMfaCode(outcome.mfaToken, lastCode()),
        ).rejects.toThrow();
    });

    it('a resend invalidates the previous code', async () => {
        const user = await createUser('mfa-resend@email.com', {
            mfaEnabled: true,
        });
        const outcome = await authService.loginWithCredentials({
            email: user.email,
            password: 'password123',
        });
        if (outcome.kind !== 'mfa_required') throw new Error('expected mfa');
        const first = lastCode();

        await authService.resendMfaCode(outcome.mfaToken);
        const second = lastCode();
        expect(second).not.toEqual(first);

        // The superseded code no longer works…
        await expect(
            authService.verifyMfaCode(outcome.mfaToken, first),
        ).rejects.toThrow();
        // …the newest one does.
        const pair = await authService.verifyMfaCode(outcome.mfaToken, second);
        expect(typeof pair.accessToken).toBe('string');
    });

    it('stores only the hash of the code, never the raw digits', async () => {
        const user = await createUser('mfa-hash@email.com', {
            mfaEnabled: true,
        });
        await authService.loginWithCredentials({
            email: user.email,
            password: 'password123',
        });
        const code = lastCode();

        const row = await prisma.email_mfa_codes.findFirst({
            where: { user_id: user.id },
            orderBy: { id: 'desc' },
        });
        expect(row?.code_hash).toEqual(sha256(code));
        expect(row?.code_hash).not.toEqual(code);
    });
});

describe('super-user forced password change', () => {
    it('forces a new password at next login and kills existing sessions', async () => {
        const user = await createUser('reset-basic@email.com');
        // A live session exists before the reset.
        const before = await authService.loginWithCredentials({
            email: user.email,
            password: 'password123',
        });
        if (before.kind !== 'tokens') throw new Error('expected tokens');

        await authService.requirePasswordChange(user.id);

        // The existing session is dead.
        await expect(
            authService.rotateRefreshToken(before.pair.refreshToken),
        ).rejects.toThrow();

        // The current password still authenticates, but only to the change gate.
        const gated = await authService.loginWithCredentials({
            email: user.email,
            password: 'password123',
        });
        expect(gated.kind).toBe('password_change_required');
        if (gated.kind !== 'password_change_required')
            throw new Error('unreachable');

        const changed = await authService.changePassword(
            gated.changeToken,
            'brand-new-password1',
        );
        expect(changed.kind).toBe('tokens');

        // Old password is gone; new one logs in cleanly.
        await expect(
            authService.loginWithCredentials({
                email: user.email,
                password: 'password123',
            }),
        ).rejects.toThrow();
        const relogin = await authService.loginWithCredentials({
            email: user.email,
            password: 'brand-new-password1',
        });
        expect(relogin.kind).toBe('tokens');
    });

    it('still requires MFA after a forced change on an MFA-enabled account', async () => {
        const user = await createUser('reset-mfa@email.com', {
            mfaEnabled: true,
        });
        await authService.requirePasswordChange(user.id);

        const gated = await authService.loginWithCredentials({
            email: user.email,
            password: 'password123',
        });
        if (gated.kind !== 'password_change_required')
            throw new Error('expected change gate');

        // The change does not hand out tokens — it drops the user onto the MFA
        // step, so the two gates compose instead of one bypassing the other.
        const after = await authService.changePassword(
            gated.changeToken,
            'brand-new-password1',
        );
        expect(after.kind).toBe('mfa_required');
    });

    it('rejects a new password that does not meet the policy', async () => {
        const user = await createUser('reset-weak@email.com');
        await authService.requirePasswordChange(user.id);
        const gated = await authService.loginWithCredentials({
            email: user.email,
            password: 'password123',
        });
        if (gated.kind !== 'password_change_required')
            throw new Error('expected change gate');

        // assertPasswordStrength throws before any DB write, so the change token
        // is not spent — the same gate can be re-tried for each failing case.
        // Too short.
        await expect(
            authService.changePassword(gated.changeToken, 'short'),
        ).rejects.toThrow();
        // Long enough, letters + digits, but no symbol.
        await expect(
            authService.changePassword(gated.changeToken, 'password1234'),
        ).rejects.toThrow();
        // Long enough, letters + a symbol, but no digit.
        await expect(
            authService.changePassword(gated.changeToken, 'password-only!'),
        ).rejects.toThrow();
    });
});

describe('interstitial token isolation', () => {
    it('an MFA token cannot be used on the change-password path, and vice-versa', async () => {
        // A change token from a reset flow…
        const resetUser = await createUser('cross-change@email.com');
        await authService.requirePasswordChange(resetUser.id);
        const gated = await authService.loginWithCredentials({
            email: resetUser.email,
            password: 'password123',
        });
        if (gated.kind !== 'password_change_required')
            throw new Error('expected change gate');

        // …is rejected by the MFA verify endpoint (wrong `purpose`).
        await expect(
            authService.verifyMfaCode(gated.changeToken, '000000'),
        ).rejects.toThrow();

        // An MFA token from a login…
        const mfaUser = await createUser('cross-mfa@email.com', {
            mfaEnabled: true,
        });
        const mfaOutcome = await authService.loginWithCredentials({
            email: mfaUser.email,
            password: 'password123',
        });
        if (mfaOutcome.kind !== 'mfa_required')
            throw new Error('expected mfa');

        // …is rejected by the change-password endpoint (wrong `purpose`).
        await expect(
            authService.changePassword(
                mfaOutcome.mfaToken,
                'brand-new-password',
            ),
        ).rejects.toThrow();
    });
});

// Last in the file: asserts over the whole run's log, mirroring the redaction
// test in auth.service.test.ts but for the emailed code.
describe('MFA logging redaction', () => {
    it('never logs a raw MFA code anywhere in the run', async () => {
        // Value-equality rather than a substring scan: a 6-digit code could
        // coincidentally appear *inside* an unrelated logged value (a UUID's
        // digits), which would flake. What matters is that no context field
        // *is* a code.
        const loggedValues = loggedCalls.flatMap((call) =>
            Object.values(call.context).map((value) => String(value)),
        );
        for (const code of sentCodes) {
            expect(loggedValues).not.toContain(code);
        }
        // No credential-shaped key smuggled a value into a log context either.
        const forbiddenKeys = ['code', 'code_hash', 'password', 'mfaToken'];
        for (const call of loggedCalls) {
            for (const key of Object.keys(call.context)) {
                expect(forbiddenKeys).not.toContain(key);
            }
        }
    });
});
