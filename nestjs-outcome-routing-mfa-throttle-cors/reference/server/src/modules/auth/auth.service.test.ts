import { INestApplication } from '@nestjs/common';
import { UserService } from './users/user.service';
import { setupApp } from '../../common/__tests__/helpers/setup-app';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { roles } from '../../common/__tests__/objects/auth/roles';
import { PrismaService } from '../../common/modules/prisma/prisma.service';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { jwtConstants } from '../../common/constants/jwt';
import {
    LOGIN_FAILED_MESSAGE,
    loginLockout,
} from '../../common/constants/login-protection';
import { TokenPair } from '../../common/dto/entities';
import {
    AppLoggerService,
    LogContext,
} from '../../common/modules/logging/app-logger.service';

// The service stores a digest, never the raw token, so the tests have to hash
// the same way to look a row up.
function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

// A promise plus the function that settles it.
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

// Runs `competing` inside a rotation's *critical section* — the window between
// the presented row being revoked and its successor being inserted. That window
// is what Phase 1.6.1 closes, and the two tests using this helper are the only
// ones that reach it: the older race tests spy on `readActiveUser`, which runs
// before the revoke, so they cover the branch decision and not the interleaving.
//
// `issueTokenPair` is the seam because it is the last step of a rotation, after
// the revoke, and since 1.6.1 it runs inside the transaction holding the family
// lock.
//
// There is deliberately **no sleep here**. A fixed delay would only *assume* the
// competing operation reached the window — under a slow database or a starved
// connection pool it could still be queued, and the pre-fix implementation would
// then pass the test for the wrong reason. Instead the seam waits for whichever
// of two events happens first, and exactly one of them is possible per
// implementation:
//
//   * the competitor **finishes** — the only outcome before the fix, where
//     nothing blocks it. Reaching here then means its revoke has committed,
//     which is precisely the interleaving under test; or
//   * the competitor **reaches `lockFamily`** — the only outcome after the fix,
//     where it must block there, because this rotation already holds that
//     family's lock. Waiting for it to finish would deadlock instead.
//
// The `lockFamily` spy is armed here rather than up front so that it observes
// the competitor's call and not the rotation's own, and it is skipped entirely
// when the method does not exist — which is what lets this run unchanged against
// the pre-1.6.1 service and show the tests failing first.
//
// ⚠️ The latch resolves on *entry* to `lockFamily`, before the locking query is
// issued — deliberately, since resolving after would wait on a call that cannot
// return until this rotation commits, i.e. a deadlock. So it coordinates the
// interleaving but proves **nothing** about the lock itself: if `lockFamily`
// still existed and no longer locked anything, these two tests could pass
// anyway. The test that proves the row lock actually blocks a competitor is
// `the family lock blocks a second transaction on the same family` below, and
// the pair of them only means what it claims **together**.
function raceInsideRotation(competing: () => Promise<unknown>) {
    let competingResult: Promise<unknown> = Promise.resolve();

    const seam = jest.spyOn(refreshTokenService as any, 'issueTokenPair');
    // Args are spread rather than named so the seam does not depend on
    // `issueTokenPair`'s signature, which 1.6.1 changed.
    seam.mockImplementationOnce((async (...args: any[]) => {
        const reachedLock = deferred();
        const originalLockFamily = (refreshTokenService as any).lockFamily;
        const lockSpy =
            typeof originalLockFamily === 'function'
                ? jest
                      .spyOn(refreshTokenService as any, 'lockFamily')
                      .mockImplementation((async (...lockArgs: any[]) => {
                          reachedLock.resolve();
                          return originalLockFamily.apply(
                              refreshTokenService,
                              lockArgs,
                          );
                      }) as any)
                : null;

        competingResult = competing().catch((error) => error);
        await Promise.race([competingResult, reachedLock.promise]);

        if (lockSpy) {
            // Only affects later calls; the competitor is already inside the
            // real method, blocked on the lock.
            lockSpy.mockRestore();
        }
        return (refreshTokenService as any).issueTokenPair(...args);
    }) as any);

    return {
        async finish() {
            seam.mockRestore();
            return competingResult;
        },
    };
}

let app: INestApplication;
let userService: UserService;
let authService: AuthService;
// Phase 5d split the rotation internals (`issueTokenPair`, `lockFamily`,
// `readActiveUser`) out of `AuthService` into `RefreshTokenService`. The race
// tests spy on those private methods, so they must target the instance that
// actually owns them now — `authService` is a thin facade that delegates
// `rotateRefreshToken`/`logout`/etc. to this service, and the internal
// `this.<method>` calls happen here.
let refreshTokenService: RefreshTokenService;
let prisma: PrismaService;

// Phase 3 turned `loginWithCredentials` into a three-way outcome. Every user in
// this file is password-only (no MFA, no forced change), so login always
// resolves to `{ kind: 'tokens' }`; this unwraps to the `TokenPair` the refresh
// tests have always worked with, and asserts the kind so a regression that
// silently gated one of these accounts fails loudly here.
async function loginForTokens(
    email: string,
    password = 'password123',
): Promise<TokenPair> {
    const outcome = await authService.loginWithCredentials({ email, password });
    if (outcome.kind !== 'tokens') {
        throw new Error(`expected a token pair, got "${outcome.kind}"`);
    }
    return outcome.pair;
}

// Every context this file logs, in order, for the whole run. Recorded from
// `beforeAll` rather than per test on purpose: the redaction assertion at the
// bottom claims that **no** line anywhere carries a credential, and that claim
// is only worth making over the complete run.
//
// The spy replaces the resolved singleton's methods rather than overriding the
// provider in a testing module, because `setupApp()` builds the whole
// `AppModule` and has no override seam. Same observation surface, no change to
// a helper every other suite shares — and mocking the implementation away also
// keeps the suite's own login noise off the console.
// `trace` is in the list on purpose, not just for tidiness: the 1.7.10 trace
// points are ~20 new places a credential could leak, and the redaction
// assertion below is only worth anything if it scans them too.
const loggedCalls: {
    level: 'log' | 'warn' | 'error' | 'debug' | 'verbose' | 'trace';
    event: string;
    context: LogContext;
}[] = [];

beforeAll(async () => {
    app = await setupApp();
    userService = app.get(UserService);
    authService = app.get(AuthService);
    refreshTokenService = app.get(RefreshTokenService);
    prisma = app.get(PrismaService);

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

describe('validates user', () => {
    it('returns user with roles if user is valid', async () => {
        const user = await userService.create({
            email: 'validateuservalidemail@email.com',
            first_name: 'first name 1',
            last_name: 'last name 2',
            password: 'password123',
            roles: roles,
        });

        const userWithRoles = await authService.validateUser({
            email: user.email,
            password: 'password123',
        });

        expect(userWithRoles).toBeDefined();
        expect(userWithRoles?.id).toBeDefined();
        expect(Array.isArray(userWithRoles?.user_roles)).toBe(true);
    });

    it('returns null if user is not valid', async () => {
        const userWithRoles = await authService.validateUser({
            email: 'nonexistentuseremail@email.com',
            password: 'randompassword',
        });

        expect(userWithRoles).toBeFalsy();
    });

    it('returns null if the user is deactivated', async () => {
        const user = await userService.create({
            email: 'deactivateduser@email.com',
            first_name: 'first name 1',
            last_name: 'last name 2',
            password: 'password123',
            roles: roles,
        });

        // Soft-delete convention: live rows are `active = 1`.
        await prisma.users.update({
            data: { active: -1 },
            where: { id: user.id },
        });

        const userWithRoles = await authService.validateUser({
            email: user.email,
            password: 'password123',
        });

        expect(userWithRoles).toBeFalsy();
    });

    it('excludes revoked role assignments from the token roles', async () => {
        const user = await userService.create({
            email: 'revokedroleuser@email.com',
            first_name: 'first name 1',
            last_name: 'last name 2',
            password: 'password123',
            roles: roles,
        });

        await prisma.user_roles.updateMany({
            data: { active: -1 },
            where: { user_id: user.id },
        });

        const userWithRoles = await authService.validateUser({
            email: user.email,
            password: 'password123',
        });

        expect(userWithRoles?.user_roles).toHaveLength(0);
    });
});

describe('logins user', () => {
    it('returns accessToken if user is valid', async () => {
        await userService.create({
            email: 'loginuseremail@email.com',
            first_name: 'first name 1',
            last_name: 'last name 2',
            password: 'password123',
            roles: roles,
        });

        // `loginWithCredentials` is the only login path now — the GraphQL
        // `login` mutation and `AuthService#login` were deleted, because Phase 2
        // throttles the REST route and an unthrottled mutation beside it would
        // be a way straight around the rate limit.
        const { accessToken } = await loginForTokens('loginuseremail@email.com');

        expect(typeof accessToken).toBe('string');
    });

    it('fails if user credentials are not valid', async () => {
        expect.hasAssertions();

        try {
            await authService.loginWithCredentials({
                email: 'loginuserinvalidemail@email.com',
                password: 'password123',
            });
        } catch (e) {
            // The exact generic message, in Spanish. Asserting equality (not a
            // loose match) is deliberate: criterion 3 requires this to be the
            // *same* string for unknown email, wrong password and a locked
            // account, so the test pins the shared constant.
            expect(e.response.message).toBe(LOGIN_FAILED_MESSAGE);
        }
    });
});

describe('login lockout', () => {
    it('locks the account after the threshold of wrong passwords, then refuses even the correct one', async () => {
        const user = await userService.create({
            email: 'lockout-victim@email.com',
            first_name: 'first name 1',
            last_name: 'last name 2',
            password: 'correct-password',
            roles: roles,
        });

        // One short of nothing special — walk the counter up to the threshold.
        for (let i = 0; i < loginLockout.maxFailedAttempts; i++) {
            const attempt = await authService.validateUser({
                email: user.email,
                password: 'wrong-password',
            });
            expect(attempt).toBeNull();
        }

        const locked = await prisma.users.findUniqueOrThrow({
            where: { id: user.id },
        });
        expect(locked.lockout_until).not.toBeNull();
        expect(locked.lockout_until!.getTime()).toBeGreaterThan(Date.now());

        // The lock is what matters: even the correct password is refused while
        // it stands. This is the IP-independent half of the protection — the
        // counter lives on the row, not on an address.
        const whileLocked = await authService.validateUser({
            email: user.email,
            password: 'correct-password',
        });
        expect(whileLocked).toBeNull();
    });

    it('resets the failure counter on a successful login', async () => {
        const user = await userService.create({
            email: 'lockout-reset@email.com',
            first_name: 'first name 1',
            last_name: 'last name 2',
            password: 'correct-password',
            roles: roles,
        });

        // Stay one below the threshold so no lock lands.
        for (let i = 0; i < loginLockout.maxFailedAttempts - 1; i++) {
            await authService.validateUser({
                email: user.email,
                password: 'wrong-password',
            });
        }

        const beforeSuccess = await prisma.users.findUniqueOrThrow({
            where: { id: user.id },
        });
        expect(beforeSuccess.failed_login_count).toBe(
            loginLockout.maxFailedAttempts - 1,
        );
        expect(beforeSuccess.lockout_until).toBeNull();

        // A correct login wipes the counter clean.
        const ok = await authService.validateUser({
            email: user.email,
            password: 'correct-password',
        });
        expect(ok).not.toBeNull();

        const afterSuccess = await prisma.users.findUniqueOrThrow({
            where: { id: user.id },
        });
        expect(afterSuccess.failed_login_count).toBe(0);
        expect(afterSuccess.lockout_until).toBeNull();
    });
});

describe('login disabled', () => {
    it('refuses a disabled account even with the correct password', async () => {
        const user = await userService.create({
            email: 'disabled-login@email.com',
            first_name: 'first name 1',
            last_name: 'last name 2',
            password: 'password123',
            roles: roles,
        });
        await prisma.users.update({
            where: { id: user.id },
            data: { login_disabled: true },
        });

        const attempt = await authService.validateUser({
            email: 'disabled-login@email.com',
            password: 'password123',
        });
        expect(attempt).toBeNull();
    });

    it('kills refresh for a disabled account: rotation revokes the family', async () => {
        const user = await userService.create({
            email: 'disabled-refresh@email.com',
            first_name: 'first name 1',
            last_name: 'last name 2',
            password: 'password123',
            roles: roles,
        });
        const pair = await loginForTokens('disabled-refresh@email.com');

        await prisma.users.update({
            where: { id: user.id },
            data: { login_disabled: true },
        });

        // Refresh reads the user through `readActiveUser`, which now excludes
        // disabled accounts, so rotation takes its inactive branch: it rejects…
        await expect(
            authService.rotateRefreshToken(pair.refreshToken),
        ).rejects.toThrow();

        // …and that branch revokes the whole family — no live rows remain.
        const live = await prisma.refresh_tokens.count({
            where: { user_id: user.id, revoked_at: null },
        });
        expect(live).toBe(0);
    });
});

describe('refresh tokens', () => {
    async function createUserAndLogin(email: string) {
        await userService.create({
            email,
            first_name: 'first name 1',
            last_name: 'last name 2',
            password: 'password123',
            roles: roles,
        });
        return loginForTokens(email);
    }

    it('issues a refresh token alongside the access token on login', async () => {
        const pair = await createUserAndLogin('refreshlogin@email.com');

        expect(typeof pair.accessToken).toBe('string');
        expect(typeof pair.refreshToken).toBe('string');
        expect(pair.refreshExpiresAt.getTime()).toBeGreaterThan(Date.now());

        // The raw token must never be what is stored.
        const stored = await prisma.refresh_tokens.findFirst({
            where: { token_hash: sha256(pair.refreshToken) },
        });
        expect(stored).toBeTruthy();
        expect(stored?.revoked_at).toBeNull();
    });

    it('rotates: a refresh returns a new pair and spends the old token', async () => {
        const first = await createUserAndLogin('refreshrotate@email.com');

        const second = await authService.rotateRefreshToken(first.refreshToken);

        expect(second.refreshToken).not.toEqual(first.refreshToken);

        const oldRow = await prisma.refresh_tokens.findFirst({
            where: { token_hash: sha256(first.refreshToken) },
        });
        const newRow = await prisma.refresh_tokens.findFirst({
            where: { token_hash: sha256(second.refreshToken) },
        });

        expect(oldRow?.revoked_at).not.toBeNull();
        expect(newRow?.revoked_at).toBeNull();
        // Rotation stays inside the same session.
        expect(newRow?.family_id).toEqual(oldRow?.family_id);
    });

    it('reusing a rotated refresh token revokes the whole family', async () => {
        // Relies on REFRESH_REUSE_GRACE_SECONDS=0 in .env.test — with the
        // production grace window this reuse would read as two tabs racing.
        const first = await createUserAndLogin('refreshtheft@email.com');
        const second = await authService.rotateRefreshToken(first.refreshToken);

        await expect(
            authService.rotateRefreshToken(first.refreshToken),
        ).rejects.toThrow();

        // The token the honest client is holding must die too — that is the
        // point: we cannot tell victim from thief, so the session ends.
        const secondRow = await prisma.refresh_tokens.findFirst({
            where: { token_hash: sha256(second.refreshToken) },
        });
        expect(secondRow).toBeTruthy();

        const live = await prisma.refresh_tokens.count({
            where: { family_id: secondRow?.family_id, revoked_at: null },
        });
        expect(live).toBe(0);

        await expect(
            authService.rotateRefreshToken(second.refreshToken),
        ).rejects.toThrow();
    });

    describe('reuse grace window', () => {
        // `.env.test` pins the grace to 0 so the theft test above asserts the
        // strict rule. These two re-open it to cover the production default:
        // `jwtConstants` is read per call, so mutating it is a legitimate seam.
        const original = jwtConstants.refreshReuseGraceSeconds;

        beforeEach(() => {
            jwtConstants.refreshReuseGraceSeconds = 30;
        });

        afterEach(() => {
            jwtConstants.refreshReuseGraceSeconds = original;
        });

        it('treats an immediate reuse as two tabs racing, not as theft', async () => {
            const first = await createUserAndLogin('refreshgrace@email.com');
            const second = await authService.rotateRefreshToken(
                first.refreshToken,
            );

            // The second tab was still holding the pre-rotation token.
            const third = await authService.rotateRefreshToken(
                first.refreshToken,
            );

            expect(third.accessToken).toBeTruthy();
            // The token the first tab received must survive: killing it is
            // exactly the false positive this window exists to prevent.
            await expect(
                authService.rotateRefreshToken(second.refreshToken),
            ).resolves.toBeTruthy();
        });

        it('a rotation that loses the race to another rotation still gets its own pair', async () => {
            // The mirror image of the logout test below: the conditional revoke
            // must not simply 401 when it loses, or the second tab of an honest
            // two-tab session would be told its session is dead — the exact
            // false positive this window exists to prevent.
            const pair = await createUserAndLogin('refreshrotaterace@email.com');

            const readActiveUser = jest.spyOn(
                refreshTokenService as any,
                'readActiveUser',
            );
            readActiveUser.mockImplementationOnce(((userId: number) =>
                // A competing rotation of the same token lands first: it spends
                // the row and leaves a live successor behind.
                authService
                    .rotateRefreshToken(pair.refreshToken)
                    .then(() =>
                        (refreshTokenService as any).readActiveUser(userId),
                    )) as any);

            try {
                const loser = await authService.rotateRefreshToken(
                    pair.refreshToken,
                );
                expect(loser.refreshToken).toBeTruthy();
            } finally {
                readActiveUser.mockRestore();
            }

            const spent = await prisma.refresh_tokens.findFirst({
                where: { token_hash: sha256(pair.refreshToken) },
            });
            // Both successors are live and belong to the same session. That is
            // harmless — deliberately not prevented (see the plan's "what not to
            // do").
            const live = await prisma.refresh_tokens.count({
                where: { family_id: spent?.family_id, revoked_at: null },
            });
            expect(live).toBe(2);
        });

        it('a rotation that loses the window is not told its session is dead', async () => {
            // The mirror image of the logout test: same window, competing
            // rotation instead of a logout. The grace window has to be open for
            // this to be meaningful — with it pinned to 0 the loser is supposed
            // to fail.
            const pair = await createUserAndLogin(
                'refreshrotatewindow@email.com',
            );

            const race = raceInsideRotation(() =>
                authService.rotateRefreshToken(pair.refreshToken),
            );

            // `race.finish()` restores the `issueTokenPair` seam; run it in a
            // `finally` so that if the winning rotation throws or times out, the
            // spy is still torn down and the failure cannot leak into later tests.
            let loser: unknown;
            try {
                await expect(
                    authService.rotateRefreshToken(pair.refreshToken),
                ).resolves.toBeTruthy();
            } finally {
                loser = await race.finish();
            }

            // Before 1.6.1 the loser read the row mid-window: revoked, and with
            // no live successor in the family *yet*, which reads as "this
            // session is over". So it threw 401 — and since a 401 is precisely
            // what makes the controller clear the refresh cookie, that response
            // would have deleted the cookie the winner had just set.
            expect(loser).not.toBeInstanceOf(Error);
            expect((loser as TokenPair).refreshToken).toBeTruthy();
        });

        it('does not let the grace window resurrect a logged-out session', async () => {
            // The window only covers a race, which always leaves a live token in
            // the family. Logout revokes every row, so there is nothing to race
            // with and the reuse must fail even though it is "recent".
            const pair = await createUserAndLogin('refreshgracelogout@email.com');
            await authService.logout(pair.refreshToken);

            await expect(
                authService.rotateRefreshToken(pair.refreshToken),
            ).rejects.toThrow();
        });
    });

    it('rejects an expired refresh token', async () => {
        const pair = await createUserAndLogin('refreshexpired@email.com');

        await prisma.refresh_tokens.updateMany({
            data: { expires_at: new Date(Date.now() - 1000) },
            where: { token_hash: sha256(pair.refreshToken) },
        });

        await expect(
            authService.rotateRefreshToken(pair.refreshToken),
        ).rejects.toThrow();
    });

    it('rejects an unknown or missing refresh token', async () => {
        await expect(
            authService.rotateRefreshToken('not-a-real-token'),
        ).rejects.toThrow();
        await expect(authService.rotateRefreshToken(null)).rejects.toThrow();
    });

    it('stops rotating once the user is deactivated', async () => {
        const email = 'refreshdeactivated@email.com';
        const pair = await createUserAndLogin(email);

        await prisma.users.updateMany({
            data: { active: -1 },
            where: { email },
        });

        // The access token already issued stays valid until it expires — that is
        // the cost of stateless JWTs — but the session cannot be renewed.
        await expect(
            authService.rotateRefreshToken(pair.refreshToken),
        ).rejects.toThrow();
    });

    it('logout revokes the session server-side', async () => {
        const pair = await createUserAndLogin('refreshlogout@email.com');

        await authService.logout(pair.refreshToken);

        await expect(
            authService.rotateRefreshToken(pair.refreshToken),
        ).rejects.toThrow();
    });

    it('a logout concurrent with a rotation leaves no live token in the family', async () => {
        const pair = await createUserAndLogin('refreshlogoutrace@email.com');

        // The race cannot be produced with real concurrency here, so we open the
        // window deliberately. Rotation re-reads the user *after* validating the
        // refresh row and *before* writing its successor, which is exactly the
        // gap the conditional revoke closes — so logging out from inside that
        // read reproduces "logout landed mid-rotation".
        const readActiveUser = jest.spyOn(
            refreshTokenService as any,
            'readActiveUser',
        );
        readActiveUser.mockImplementationOnce(((userId: number) =>
            authService
                .logout(pair.refreshToken)
                // The once-implementation is spent by now, so this re-entry
                // reaches the real method.
                .then(() =>
                    (refreshTokenService as any).readActiveUser(userId),
                )) as any);

        try {
            // Before the fix this resolved: the rotation revoked its row
            // unconditionally and inserted a live successor into a family the
            // user had just ended.
            await expect(
                authService.rotateRefreshToken(pair.refreshToken),
            ).rejects.toThrow();
        } finally {
            readActiveUser.mockRestore();
        }

        const spent = await prisma.refresh_tokens.findFirst({
            where: { token_hash: sha256(pair.refreshToken) },
        });
        expect(spent).toBeTruthy();

        const live = await prisma.refresh_tokens.count({
            where: { family_id: spent?.family_id, revoked_at: null },
        });
        expect(live).toBe(0);
    });

    it('a logout inside the rotation window still ends the session', async () => {
        const pair = await createUserAndLogin('refreshlogoutwindow@email.com');

        const race = raceInsideRotation(() =>
            authService.logout(pair.refreshToken),
        );

        // The rotation itself succeeds: it is a legitimate refresh that had
        // already won its row before the logout arrived. What must not survive
        // is the *session*. `race.finish()` runs in a `finally` so a throw or
        // timeout here still tears down the seam instead of leaking it.
        try {
            await expect(
                authService.rotateRefreshToken(pair.refreshToken),
            ).resolves.toBeTruthy();
        } finally {
            await race.finish();
        }

        const spent = await prisma.refresh_tokens.findFirst({
            where: { token_hash: sha256(pair.refreshToken) },
        });
        const live = await prisma.refresh_tokens.count({
            where: { family_id: spent?.family_id, revoked_at: null },
        });
        // Before 1.6.1 this was 1. The logout landed between the revoke and the
        // insert, found no live row to revoke, and returned success — then the
        // rotation inserted a live successor into the session the user had just
        // been told was over.
        expect(live).toBe(0);
    });

    it('the family lock blocks a second transaction on the same family', async () => {
        // The two race tests coordinate on `lockFamily` being *entered*, which
        // says nothing about whether it locks — they would still pass if the
        // method survived with its `FOR UPDATE` removed. This is the test that
        // closes that hole, and it is the only one here that observes the row
        // lock directly rather than through rotation logic.
        //
        // Deterministic by construction: the contender is given a one-second
        // `innodb_lock_wait_timeout`, so a genuinely contended lock fails fast
        // and *says why*, instead of being inferred from how long something
        // took. Without a real lock it acquires immediately and the test fails.
        const pair = await createUserAndLogin('refreshfamilylock@email.com');
        const stored = await prisma.refresh_tokens.findFirst({
            where: { token_hash: sha256(pair.refreshToken) },
        });
        const familyId = String(stored?.family_id);

        // Its own client, so the short lock timeout cannot leak onto a pooled
        // connection the rest of the suite goes on to reuse. `lockFamily` takes
        // its client as an argument, so it works unchanged against this one.
        const contender = new PrismaClient();
        let acquiredWhileHeld = false;
        let contendedError: unknown = null;

        try {
            await prisma.$transaction(async (tx) => {
                await (refreshTokenService as any).lockFamily(tx, familyId);

                contendedError = await contender
                    .$transaction(async (tx2) => {
                        await tx2.$executeRawUnsafe(
                            'SET SESSION innodb_lock_wait_timeout = 1',
                        );
                        await (refreshTokenService as any).lockFamily(
                            tx2,
                            familyId,
                        );
                        acquiredWhileHeld = true;
                        return null;
                    })
                    .catch((error) => error);
            });
        } finally {
            await contender.$disconnect();
        }

        expect(acquiredWhileHeld).toBe(false);
        // The message is what discriminates a real lock from `lockFamily`
        // simply throwing for some unrelated reason.
        expect(String(contendedError)).toMatch(/lock wait timeout/i);

        // ...and the lock is released on commit, not held forever.
        await expect(
            prisma.$transaction(async (tx) =>
                (refreshTokenService as any).lockFamily(tx, familyId),
            ),
        ).resolves.toBeDefined();
    });

    it('logout on an unknown token is a no-op', async () => {
        await expect(
            authService.logout('not-a-real-token'),
        ).resolves.toBeUndefined();
        await expect(authService.logout(null)).resolves.toBeUndefined();
    });

    it('revokeAllForUser ends every session the user has', async () => {
        const email = 'refreshallsessions@email.com';
        const first = await createUserAndLogin(email);
        // A second login is a second device: its own family.
        const second = await loginForTokens(email);

        const user = await prisma.users.findFirst({ where: { email } });
        expect(user).toBeTruthy();
        await authService.revokeAllForUser(Number(user?.id));

        await expect(
            authService.rotateRefreshToken(first.refreshToken),
        ).rejects.toThrow();
        await expect(
            authService.rotateRefreshToken(second.refreshToken),
        ).rejects.toThrow();
    });

    it('a new login starts a separate family, so revoking one leaves the other alone', async () => {
        const email = 'refreshfamilies@email.com';
        const laptop = await createUserAndLogin(email);
        const phone = await loginForTokens(email);

        await authService.logout(laptop.refreshToken);

        await expect(
            authService.rotateRefreshToken(laptop.refreshToken),
        ).rejects.toThrow();
        await expect(
            authService.rotateRefreshToken(phone.refreshToken),
        ).resolves.toBeTruthy();
    });
});

// ⚠️ Last in the file deliberately. The final test asserts over `loggedCalls` as
// a whole, so it has to run after everything else has had its chance to log.
describe('auth logging', () => {
    async function createUserAndLogin(email: string) {
        await userService.create({
            email,
            first_name: 'first name 1',
            last_name: 'last name 2',
            password: 'password123',
            roles: roles,
        });
        return loginForTokens(email);
    }

    // Earlier tests in this file already trip several of these events, so each
    // case reads only the slice it produced itself.
    function since(mark: number, event: string) {
        return loggedCalls.slice(mark).find((call) => call.event === event);
    }

    it('emits auth.refresh.theft at error when a spent token is replayed', async () => {
        // Relies on REFRESH_REUSE_GRACE_SECONDS=0 in `.env.test`, exactly as the
        // theft test above does.
        const first = await createUserAndLogin('logtheft@email.com');
        await authService.rotateRefreshToken(first.refreshToken);

        const mark = loggedCalls.length;
        await expect(
            authService.rotateRefreshToken(first.refreshToken),
        ).rejects.toThrow();

        const theft = since(mark, 'auth.refresh.theft');
        expect(theft).toBeDefined();
        // The one `error` on a non-exceptional path. If this ever drops to
        // `warn` it stops being the line someone greps for first.
        expect(theft?.level).toEqual('error');
        expect(theft?.context.familyId).toBeTruthy();
        expect(theft?.context.tokenId).toEqual(expect.any(Number));
    });

    // 1.7.10. `auth.refresh.rotated` used to sit at `debug`, which in Nest is
    // the *most* inclusive level — so a step trace placed at `verbose` would
    // have been hidden by `LOG_LEVEL=verbose` while the coarser line showed.
    it('emits the routine rotation events at verbose, not debug', async () => {
        const pair = await createUserAndLogin('logtier@email.com');

        const mark = loggedCalls.length;
        await authService.rotateRefreshToken(pair.refreshToken);

        expect(since(mark, 'auth.refresh.rotated')?.level).toEqual('verbose');
    });

    // The observable half of §1.7.6 / 1.7.10: everything the `$transaction`
    // callback narrates is collected in memory and emitted afterwards. From
    // outside, that looks like the buffered span arriving as one contiguous
    // block ending at `flushed` — an inline `logger` call inside the callback
    // could not produce that ordering relative to the outcome line.
    it('emits the in-transaction trace only after the transaction returns', async () => {
        const pair = await createUserAndLogin('logtrace@email.com');

        const mark = loggedCalls.length;
        await authService.rotateRefreshToken(pair.refreshToken);

        const events = loggedCalls.slice(mark).map((call) => call.event);
        const userRead = events.indexOf('auth.trace.rotate.user_read');
        const locked = events.indexOf('auth.trace.rotate.family_locked');
        const flushed = events.indexOf('auth.trace.rotate.flushed');
        const rotated = events.indexOf('auth.refresh.rotated');

        expect(userRead).toBeGreaterThan(-1);
        expect(locked).toBeGreaterThan(userRead);
        expect(events.indexOf('auth.trace.rotate.successor_created')).toEqual(
            flushed - 1,
        );
        // The outcome line comes after the whole narration.
        expect(rotated).toEqual(flushed + 1);
        // `count` on `flushed` is how many buffered lines were emitted.
        expect(
            since(mark, 'auth.trace.rotate.flushed')?.context.count,
        ).toBeGreaterThan(0);
    });

    it('emits auth.login.failed at warn carrying the attempted email', async () => {
        const mark = loggedCalls.length;

        await expect(
            authService.loginWithCredentials({
                email: 'logloginfailed@email.com',
                password: 'not-the-password',
            }),
        ).rejects.toThrow();

        const failed = since(mark, 'auth.login.failed');
        expect(failed?.level).toEqual('warn');
        // Deliberate asymmetry with the HTTP response, which must not
        // distinguish an unknown user from a wrong password. A log is not
        // attacker-visible.
        expect(failed?.context.email).toEqual('logloginfailed@email.com');
        expect(failed?.context).not.toHaveProperty('password');
    });

    it('emits auth.logout.success once the family is revoked', async () => {
        const pair = await createUserAndLogin('loglogout@email.com');

        const mark = loggedCalls.length;
        await authService.logout(pair.refreshToken);

        const success = since(mark, 'auth.logout.success');
        expect(success?.level).toEqual('log');
        expect(success?.context.userId).toEqual(expect.any(Number));
    });

    // The automated half of the redaction criterion. `token_hash` is on the
    // forbidden list next to the raw token because it is the unique lookup key
    // for a session row — logging it is logging a credential-equivalent.
    it('never logs a raw refresh token or its hash, anywhere in the run', async () => {
        const login = await createUserAndLogin('logredaction@email.com');
        const rotated = await authService.rotateRefreshToken(
            login.refreshToken,
        );
        await authService.logout(rotated.refreshToken);

        const serialized = JSON.stringify(loggedCalls);
        for (const raw of [login.refreshToken, rotated.refreshToken]) {
            expect(serialized).not.toContain(raw);
            expect(serialized).not.toContain(sha256(raw));
        }
        // Access tokens are JWTs and equally must not appear.
        expect(serialized).not.toContain(login.accessToken);
        expect(serialized).not.toContain('password123');

        // And nothing named its way in either: `LogContext` is a closed
        // interface, but TypeScript's excess-property check only fires on object
        // literals, so this is the runtime half of that guarantee.
        const forbiddenKeys = [
            'token',
            'tokenHash',
            'token_hash',
            'rawToken',
            'refreshToken',
            'accessToken',
            'password',
        ];
        for (const call of loggedCalls) {
            for (const key of Object.keys(call.context)) {
                expect(forbiddenKeys).not.toContain(key);
            }
        }
    });
});
