import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { AccessTokenPayload, SessionMeta, TokenPair } from '../../common/dto/entities';
import { PrismaService } from '../../common/modules/prisma/prisma.service';
import { jwtConstants } from '../../common/constants/jwt';
import { AppLoggerService } from '../../common/modules/logging/app-logger.service';
import { TraceBuffer } from '../../common/modules/logging/trace-buffer';
import { hashRefreshToken } from './utils/refresh-token.util';
import { AuthUser, TokenSubject } from './auth.types';

/*
 * LEARNING MAP — backend session lifecycle
 *
 * The refresh-token service owns the whole session lifecycle:
 *
 * 1. `createSession` starts a fresh family after a password (or emailed code)
 *    has been verified by another service.
 * 2. `rotateRefreshToken` keeps that session alive without asking for the
 *    password again. It spends the old refresh token and creates a new one.
 * 3. `logout` ends the session represented by the refresh-token family.
 *
 * Two different tokens are involved:
 *
 * - The access token is a short-lived signed JWT. The frontend sends it on
 *   GraphQL requests, and the API can validate it without querying the DB.
 * - The refresh token is a long-lived random secret. Only its SHA-256 hash is
 *   stored in the DB; the browser carries the raw value in an httpOnly cookie.
 *
 * A `family_id` means "one login session". Every rotation adds a row to the
 * same family. Revoking the family therefore signs out that device/session,
 * while a separate login on another device has a different family.
 *
 * This service never writes cookies or HTTP responses. `AuthController` owns
 * that transport boundary and splits the `TokenPair` returned here.
 */

// Every write to a refresh-token family goes through one of these, so the same
// code serves a standalone call (`this.prisma`) and a call already inside a
// transaction (`tx`). `PrismaService` is a `PrismaClient` and satisfies it.
type PrismaClientLike = Prisma.TransactionClient;

// What `lockFamily` returns: the family's rows as they exist *now*, read under
// `FOR UPDATE`. Deliberately not a Prisma model read — see `lockFamily`.
interface LockedFamilyRow {
    id: number;
    revoked_at: Date | null;
    expires_at: Date;
}

// What one pass through the rotation transaction decided.
//
// The callback used to return `TokenPair | null`, which is enough to pick an
// HTTP status but not enough to say *which* of six things happened — and saying
// which is the whole job of the log line. It cannot say so by logging in place:
// an exception thrown inside a Prisma interactive transaction rolls it back, so
// a `TypeError` in a log call would undo the revocation it was describing, and
// log I/O under `SELECT … FOR UPDATE` lengthens the critical section every
// concurrent rotation queues behind. So the callback *reports* and
// `rotateRefreshToken` logs after the commit.
type RotationOutcome =
    | { kind: 'rotated'; pair: TokenPair; tokenId: number }
    | { kind: 'race'; pair: TokenPair }
    | { kind: 'theft'; tokenId: number }
    | { kind: 'expired' }
    | { kind: 'inactive' }
    | { kind: 'row_missing' };

@Injectable()
export class RefreshTokenService {
    constructor(
        private jwtService: JwtService,
        private prisma: PrismaService,
        private logger: AppLoggerService,
    ) {}

    // Everything that turns a verified user into a live session: sweep their
    // expired refresh rows, start a fresh family, issue the pair, and log the
    // success. Called by the login path and by the MFA-verify / password-change
    // paths so they all mint sessions the identical way.
    async createSession(
        user: AuthUser,
        meta: SessionMeta,
    ): Promise<TokenPair> {
        // Opportunistic housekeeping: a user who logs in regularly would
        // otherwise accumulate one dead row per rotation forever. Cheap, indexed
        // by user_id, and only touches rows that can no longer authenticate
        // anything.
        const swept = await this.prisma.refresh_tokens.deleteMany({
            where: { user_id: user.id, expires_at: { lt: new Date() } },
        });

        this.logger.trace('auth.trace.login.swept', {
            userId: user.id,
            count: swept.count,
            requestId: meta.requestId,
        });

        // A new login starts a new family: signing in on a phone must not be
        // collateral damage when the laptop's session is revoked for theft.
        // No lock needed — a brand-new `family_id` has no other writer.
        const familyId = randomUUID();

        this.logger.trace('auth.trace.login.family_created', {
            userId: user.id,
            familyId,
            requestId: meta.requestId,
        });

        const pair = await this.issueTokenPair(this.prisma, {
            user,
            familyId,
            meta,
        });

        // `email` alongside `userId` because `userId=47` names nobody to the
        // human reading `docker logs` during an incident.
        this.logger.log('auth.login.success', {
            userId: user.id,
            email: user.email,
            familyId,
            ip: meta.ip ?? undefined,
            requestId: meta.requestId,
        });

        return pair;
    }

    // Exchange a refresh token for a fresh pair. Every successful rotation
    // invalidates the token that was presented — that single-use property is
    // what makes a stolen token detectable.
    async rotateRefreshToken(
        rawToken: string | null,
        meta: SessionMeta = {},
    ): Promise<TokenPair> {
        this.logger.trace('auth.trace.rotate.begin', {
            ip: meta.ip ?? undefined,
            requestId: meta.requestId,
        });

        if (!rawToken) {
            // `verbose`, never `warn`. The frontend posts to `/auth/refresh` on
            // **every** page load, including for a logged-out visitor, and the
            // 401 there is the designed "not logged in" answer. At `warn` every
            // anonymous page view writes a warning and the level stops meaning
            // anything.
            this.logger.verbose('auth.refresh.no_token', {
                requestId: meta.requestId,
            });
            throw new UnauthorizedException();
        }

        // Only to learn *which* family to lock. `family_id` and `user_id` never
        // change once a row is written, so reading them outside the lock is
        // safe; every field the decision below turns on (`revoked_at`,
        // `expires_at`) is re-read under it.
        const presented = await this.prisma.refresh_tokens.findUnique({
            where: { token_hash: hashRefreshToken(rawToken) },
        });
        if (!presented) {
            // No user id to give: the hash matched nothing, so there is no row
            // and no owner. `ip` is all this line can offer.
            this.logger.warn('auth.refresh.unknown_token', {
                ip: meta.ip ?? undefined,
                requestId: meta.requestId,
            });
            throw new UnauthorizedException();
        }

        this.logger.trace('auth.trace.rotate.presented_found', {
            userId: presented.user_id,
            familyId: presented.family_id,
            tokenId: presented.id,
            requestId: meta.requestId,
        });

        // Deliberately outside the transaction. It reads `users`, not this
        // family, so it is not part of the invariant the lock protects, and
        // holding a row lock across an unrelated query would lengthen the
        // critical section every concurrent rotation has to wait behind.
        const user = await this.readActiveUser(presented.user_id);

        this.logger.trace('auth.trace.rotate.user_read', {
            userId: presented.user_id,
            // This is the point where deactivating a user takes effect: the
            // refresh row is still perfectly valid, the *user* is not.
            detail: user ? 'active' : 'inactive',
            requestId: meta.requestId,
        });

        // ⚠️ Everything the callback narrates goes in here, not through
        // `this.logger`. See `TraceBuffer`: a throw inside a Prisma interactive
        // transaction rolls it back, and I/O under `FOR UPDATE` lengthens the
        // critical section every concurrent rotation queues behind. Captured by
        // the closure rather than passed as an argument because Prisma fixes the
        // callback's signature at `(tx) => …`.
        const trace = new TraceBuffer();

        // Every non-pair outcome means "something was revoked and the caller
        // gets a 401". The failure paths cannot simply throw from inside the
        // callback: an exception rolls the transaction back, which would undo
        // the very revocation being performed — theft detection would then
        // revoke the family and immediately give it back.
        //
        // ⚠️ **Nothing in here logs**, for the same reason and one more: see
        // `RotationOutcome`. The callback names what happened; the switch below
        // the commit says it out loud.
        // Started here but awaited below, so the flush can sit in a `finally`
        // without re-indenting this whole callback. A promise is eager, so
        // splitting the call from the `await` changes nothing about when the
        // transaction runs, and the `try` attaches in the same tick — there is
        // no window for an unhandled rejection.
        const rotation: Promise<RotationOutcome> = this.prisma.$transaction(
            async (tx): Promise<RotationOutcome> => {
                const family = await this.lockFamily(tx, presented.family_id);

                trace.add('auth.trace.rotate.family_locked', {
                    familyId: presented.family_id,
                    count: family.length,
                    detail: `${
                        family.filter((row) => !row.revoked_at).length
                    } live`,
                });

                const stored = family.find(
                    (row) => Number(row.id) === presented.id,
                );
                if (!stored) {
                    trace.add('auth.trace.rotate.row_missing', {
                        tokenId: presented.id,
                    });
                    return { kind: 'row_missing' };
                }

                trace.add('auth.trace.rotate.row_found', {
                    tokenId: presented.id,
                });

                const now = new Date();

                if (stored.revoked_at) {
                    trace.add('auth.trace.rotate.revoked_row_seen', {
                        tokenId: presented.id,
                        detail: 'presented token has already been spent',
                    });

                    const benign = this.isBenignRotationRace(
                        stored.revoked_at,
                        family,
                        now,
                    );

                    trace.add('auth.trace.rotate.race_verdict', {
                        familyId: presented.family_id,
                        detail: benign ? 'benign' : 'theft',
                        // Recomputed rather than returned by
                        // `isBenignRotationRace`, whose signature stays as the
                        // Phase 1.6 tests expect. Pure arithmetic — no query,
                        // no I/O, nothing that can fail under the lock.
                        count: now.getTime() - stored.revoked_at.getTime(),
                    });

                    if (!benign) {
                        // Either the reuse is too old to be a race, or the
                        // session is already over. We cannot tell a replayed
                        // copy from the honest client holding the same value, so
                        // the whole family goes.
                        await this.revokeFamilyLocked(tx, presented.family_id);
                        return { kind: 'theft', tokenId: presented.id };
                    }
                    // Benign race — fall through and issue a new pair in this
                    // family. Reaching here under the lock means the winner has
                    // already committed its successor, so the liveness test
                    // above saw it. That is what stops an honest second tab
                    // being told its session is dead.
                }

                const expired = stored.expires_at.getTime() <= now.getTime();

                trace.add('auth.trace.rotate.expiry_checked', {
                    tokenId: presented.id,
                    detail: expired ? 'expired' : 'live',
                });

                if (expired) {
                    // Just expired, not stolen — kill this row, leave the family
                    // alone.
                    await this.revokeToken(tx, presented.id);
                    return { kind: 'expired' };
                }

                if (!user) {
                    await this.revokeFamilyLocked(tx, presented.family_id);
                    return { kind: 'inactive' };
                }

                // Read before the revoke below overwrites the distinction: a row
                // that was already revoked and survived the liveness test got
                // here through the benign-race branch, and the two deserve
                // different lines.
                // Truthiness, matching every other `revoked_at` test in this
                // method: the value comes from a raw query, and the branches
                // above already treat it that way.
                const wasBenignRace = Boolean(stored.revoked_at);

                if (!stored.revoked_at) {
                    // Unconditional on purpose. `stored` came from the locking
                    // read above and no other writer can revoke it while this
                    // transaction holds the family lock, so the conditional
                    // `updateMany` Phase 1.5.4 used has nothing left to guard
                    // against — the lock, not the WHERE clause, is what makes
                    // this safe now.
                    await this.revokeToken(tx, presented.id);

                    trace.add('auth.trace.rotate.row_revoked', {
                        tokenId: presented.id,
                    });
                }

                // Inside the transaction, so the revoke above and this insert
                // commit together. That is the whole point of 1.6.1: a logout
                // can no longer land between them, see an empty family, report
                // success, and then be undone by the successor appearing a
                // moment later.
                const pair = await this.issueTokenPair(tx, {
                    user,
                    familyId: presented.family_id,
                    meta,
                });

                trace.add('auth.trace.rotate.successor_created', {
                    familyId: presented.family_id,
                    detail: wasBenignRace
                        ? 'second live token in this family'
                        : 'replaces the spent token',
                });

                return wasBenignRace
                    ? { kind: 'race', pair }
                    : { kind: 'rotated', pair, tokenId: presented.id };
            },
        );

        // The flush happens outside the transaction either way, so a throw here
        // can no longer roll anything back — which is what makes this the only
        // safe place to emit what the callback wanted to say. Before the switch,
        // so the narration is complete for *every* outcome, including the four
        // that end in a 401.
        //
        // `finally` rather than a plain statement after the `await`: a rotation
        // that throws — a lock-wait timeout, a dropped connection, a deadlock —
        // is precisely the case whose narration is worth having, and a flush
        // placed after the `await` is the one case that never runs. It cannot
        // mask the original exception: every `AppLoggerService` method swallows
        // its own errors (§1.7.6 Rule 1) and `flushTo` is `try/finally`.
        let outcome: RotationOutcome;
        try {
            outcome = await rotation;
        } finally {
            const buffered = trace.size;
            trace.flushTo(this.logger);
            this.logger.trace('auth.trace.rotate.flushed', {
                count: buffered,
                requestId: meta.requestId,
            });
        }

        switch (outcome.kind) {
            case 'rotated':
                // `tokenId` is the row that was *spent*, not the successor: it
                // is the one a reader has from the previous line, and the
                // successor's id is not known outside `issueTokenPair`.
                this.logger.verbose('auth.refresh.rotated', {
                    userId: presented.user_id,
                    familyId: presented.family_id,
                    tokenId: outcome.tokenId,
                    requestId: meta.requestId,
                });
                return outcome.pair;
            case 'race':
                this.logger.verbose('auth.refresh.race', {
                    userId: presented.user_id,
                    familyId: presented.family_id,
                    requestId: meta.requestId,
                });
                return outcome.pair;
            case 'theft':
                // The highest-value line in the system, and the only `error` on
                // a non-exceptional path — it is what someone greps for first.
                this.logger.error('auth.refresh.theft', {
                    userId: presented.user_id,
                    familyId: presented.family_id,
                    tokenId: outcome.tokenId,
                    ip: meta.ip ?? undefined,
                    requestId: meta.requestId,
                });
                break;
            case 'expired':
                this.logger.verbose('auth.refresh.expired', {
                    userId: presented.user_id,
                    familyId: presented.family_id,
                    requestId: meta.requestId,
                });
                break;
            case 'inactive':
                this.logger.warn('auth.refresh.user_inactive', {
                    userId: presented.user_id,
                    familyId: presented.family_id,
                    requestId: meta.requestId,
                });
                break;
            case 'row_missing':
                this.logger.warn('auth.refresh.row_missing', {
                    userId: presented.user_id,
                    familyId: presented.family_id,
                    requestId: meta.requestId,
                });
                break;
        }

        throw new UnauthorizedException();
    }

    // Logout is authenticated by the cookie itself, so an expired access token
    // still ends the session properly. An unknown token is not an error: the
    // desired end state (this browser holds no live session) already holds.
    //
    // The revocation goes through `revokeFamily`, which takes the family lock —
    // so a logout racing a rotation now waits for that rotation to commit and
    // then revokes its successor too, instead of revoking an empty family.
    async logout(
        rawToken: string | null,
        meta: SessionMeta = {},
    ): Promise<void> {
        this.logger.trace('auth.trace.logout.begin', {
            requestId: meta.requestId,
        });

        if (!rawToken) {
            // Neither this nor `unknown_token` below is a failure — the desired
            // end state (this browser holds no live session) already holds,
            // which is why both return silently. Hence `verbose`.
            this.logger.verbose('auth.logout.no_token', {
                requestId: meta.requestId,
            });
            return;
        }
        const stored = await this.prisma.refresh_tokens.findUnique({
            where: { token_hash: hashRefreshToken(rawToken) },
        });
        if (!stored) {
            this.logger.verbose('auth.logout.unknown_token', {
                requestId: meta.requestId,
            });
            return;
        }

        this.logger.trace('auth.trace.logout.row_found', {
            userId: stored.user_id,
            familyId: stored.family_id,
            requestId: meta.requestId,
        });

        // No buffer needed here: `revokeFamily` opens and closes its own
        // transaction internally, so this call site is never inside one.
        await this.revokeFamily(stored.family_id);

        this.logger.trace('auth.trace.logout.family_revoked', {
            familyId: stored.family_id,
            requestId: meta.requestId,
        });

        // After the revocation, not before: this line means the session is
        // actually over.
        this.logger.log('auth.logout.success', {
            userId: stored.user_id,
            familyId: stored.family_id,
            requestId: meta.requestId,
        });
    }

    // Ends one session (one device / one rotation chain).
    //
    // Takes the family lock, and must: a transaction around rotation alone would
    // exclude nothing, because the writer rotation needs to be excluded *by* is
    // this one. Revoking without the lock is what let a logout slip between a
    // rotation's revoke and its insert, revoke an empty family, and report a
    // success the successor then quietly undid.
    async revokeFamily(familyId: string): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            await this.lockFamily(tx, familyId);
            await this.revokeFamilyLocked(tx, familyId);
        });
    }

    // Ends every session a user has. Phase 3 calls it on password change and on
    // the super-user reset, and it is what an admin "cerrar sesiones" action
    // would use.
    //
    // Locks by `user_id` rather than by family: a user's rows are a superset of
    // any one family's, so this contends on the same physical rows as
    // `lockFamily` and the two serialize correctly.
    async revokeAllForUser(userId: number): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`
                SELECT id
                FROM refresh_tokens
                WHERE user_id = ${userId}
                FOR UPDATE
            `;
            const now = new Date();
            await tx.refresh_tokens.updateMany({
                data: { revoked_at: now, updated_at: now },
                where: { user_id: userId, revoked_at: null },
            });
        });
    }

    // Locks every row of one family for the rest of the caller's transaction and
    // returns their current state. Two jobs in one statement on purpose:
    //
    // A locking read returns the latest committed rows, but a *plain* read
    // afterwards would be served from this transaction's REPEATABLE READ
    // snapshot and could still show the pre-lock state. Reading the columns the
    // caller needs directly out of the `FOR UPDATE` result sidesteps that
    // entirely, so the decision is provably made on post-lock data.
    private async lockFamily(
        tx: PrismaClientLike,
        familyId: string,
    ): Promise<LockedFamilyRow[]> {
        return tx.$queryRaw<LockedFamilyRow[]>`
            SELECT id, revoked_at, expires_at
            FROM refresh_tokens
            WHERE family_id = ${familyId}
            FOR UPDATE
        `;
    }

    // Assumes the caller already holds the family lock. Split from
    // `revokeFamily` so rotation can revoke inside the transaction it is already
    // holding instead of deadlocking against itself.
    private async revokeFamilyLocked(
        tx: PrismaClientLike,
        familyId: string,
    ): Promise<void> {
        const now = new Date();
        await tx.refresh_tokens.updateMany({
            data: { revoked_at: now, updated_at: now },
            where: { family_id: familyId, revoked_at: null },
        });
    }

    // `client` is `this.prisma` on the login path and the open transaction on the
    // rotation path, so the successor row is written inside whatever unit of work
    // the caller established.
    private async issueTokenPair(
        client: PrismaClientLike,
        {
            user,
            familyId,
            meta,
        }: {
            user: TokenSubject;
            familyId: string;
            meta: SessionMeta;
        },
    ): Promise<TokenPair> {
        // Opaque random bytes, not a JWT. A refresh token carries no claims —
        // its only job is to name a row in the database, and that row is the
        // authority. That is precisely what lets us revoke it, which a JWT
        // cannot do.
        const refreshToken = randomBytes(64).toString('base64url');
        const now = new Date();
        const refreshExpiresAt = new Date(
            now.getTime() + jwtConstants.refreshTtlDays * 24 * 60 * 60 * 1000,
        );

        await client.refresh_tokens.create({
            data: {
                user_id: user.id,
                token_hash: hashRefreshToken(refreshToken),
                family_id: familyId,
                expires_at: refreshExpiresAt,
                created_at: now,
                updated_at: now,
                user_agent: meta.userAgent ? meta.userAgent.slice(0, 255) : null,
                ip: meta.ip ? meta.ip.slice(0, 45) : null,
            },
        });

        return {
            accessToken: this.signAccessToken(user),
            refreshToken,
            refreshExpiresAt,
        };
    }

    private signAccessToken(user: TokenSubject): string {
        const payload: AccessTokenPayload = {
            sub: user.id,
            email: user.email,
            role_ids: user.user_roles
                .map((userRole) => userRole.role_id)
                .filter((roleId): roleId is number => roleId != null),
        };
        return this.jwtService.sign(payload);
    }

    // Re-read the user on every rotation instead of trusting the refresh row.
    // This is the point where deactivating a user or revoking a role actually
    // takes effect: at most one access-token lifetime after the change, rather
    // than never. Public because the MFA-verify and password-change paths re-read
    // the user the same way before minting a session.
    //
    // A seam for `auth.service.test.ts`, which spies on it to interleave a
    // competing operation into a rotation. Since 1.6.1 it runs *before* the
    // family lock is taken, so that seam is a pre-lock one: those tests show the
    // rotation makes the right decision when it finds the family already
    // changed. The seam *inside* the critical section is `issueTokenPair`.
    async readActiveUser(userId: number) {
        return this.prisma.users.findFirst({
            include: { user_roles: { where: { active: 1 } } },
            // `login_disabled: false` here is what makes the disable flag end a
            // live session, not just block new password logins: every
            // token-issuing path (refresh rotation, MFA verify/resend,
            // change-password) reads the user through this method, so a disabled
            // account comes back `null` and the caller takes its inactive branch —
            // which, on rotation, revokes the token family.
            where: { id: userId, active: 1, login_disabled: false },
        });
    }

    // The one decision that separates "two tabs raced" from "this session was
    // deliberately ended", used by both places that can find a revoked row: the
    // client re-presenting an already-spent token, and a rotation that lost the
    // race to revoke its own row. They must never drift apart — treating a
    // logout as a race resurrects the session, and treating a race as a logout
    // signs honest users out.
    //
    // A race always leaves a *live successor* in the family, because the request
    // that won it inserted one. Logout, theft revocation and `revokeAllForUser`
    // revoke every row instead, so an empty family is the signal that the
    // session is over.
    // Takes the locked family rows rather than querying: they are the post-lock
    // truth, and re-reading here would reintroduce exactly the snapshot problem
    // `lockFamily` exists to avoid. Synchronous as a result.
    private isBenignRotationRace(
        revokedAt: Date,
        family: LockedFamilyRow[],
        now: Date,
    ): boolean {
        const graceMs = jwtConstants.refreshReuseGraceSeconds * 1000;

        // A zero- (or negative-) width grace window means there is no tolerance
        // at all: re-presenting a spent token is theft, never a race. This is
        // handled before the timestamp comparison on purpose. `revoked_at` is
        // `DATETIME(0)`, so MySQL rounds it to whole seconds on write — a token
        // revoked at `…SS.750` persists as `…(SS+1).000`, i.e. up to ~0.5s in
        // the future — and `now - revokedAt` can come back negative. With a
        // strict `> graceMs` test and `graceMs === 0`, that negative value would
        // slip past the guard and, finding the live successor, wrongly read as
        // benign. Collapsing the window here keeps `grace=0` strict regardless
        // of clock rounding; the production default (30s) dwarfs that rounding
        // and takes the path below unchanged.
        if (graceMs <= 0) {
            return false;
        }

        const revokedMsAgo = now.getTime() - revokedAt.getTime();
        if (revokedMsAgo > graceMs) {
            return false;
        }
        return family.some(
            (row) => !row.revoked_at && row.expires_at.getTime() > now.getTime(),
        );
    }

    private async revokeToken(
        client: PrismaClientLike,
        id: number,
    ): Promise<void> {
        const now = new Date();
        await client.refresh_tokens.update({
            data: { revoked_at: now, updated_at: now },
            where: { id },
        });
    }
}
