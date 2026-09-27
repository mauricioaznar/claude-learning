import {
    BadRequestException,
    Body,
    Controller,
    HttpCode,
    HttpException,
    HttpStatus,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService, AuthOutcome } from './auth.service';
import { Public } from './decorators/public.decorator';
import { AllowedOriginGuard } from './guards/allowed-origin.guard';
import { SessionMeta, TokenPair } from '../../common/dto/entities';
import { AppLoggerService } from '../../common/modules/logging/app-logger.service';
import {
    authThrottle,
    LOGIN_FAILED_MESSAGE,
} from '../../common/constants/login-protection';
import {
    clearRefreshCookie,
    readRefreshCookie,
    setRefreshCookie,
} from './refresh-cookie';

/*
 * LEARNING MAP — the browser/API boundary
 *
 * The controller is intentionally thin. Each endpoint translates HTTP into an
 * `AuthService` call, then decides where the two returned credentials belong:
 *
 *     access token  -> JSON response body -> frontend memory
 *     refresh token -> Set-Cookie header  -> browser-managed httpOnly cookie
 *
 * JavaScript can read the first credential but cannot read the second. On a
 * later refresh or logout request, the browser attaches the cookie
 * automatically and this controller reads it from the request.
 *
 * Follow one complete login in this order:
 * `login` -> `AuthService.loginWithCredentials` -> `respondWithPair`.
 */

// REST, not GraphQL, on purpose: these three endpoints exist to move an
// httpOnly cookie, and a cookie needs a stable URL path to be scoped to. The
// GraphQL transport cannot set one portably through the upload link.
//
// Every route is `@Public()` because the globally registered `GqlAuthGuard`
// resolves its request through `GqlExecutionContext`, which has no meaningful
// `req` on a plain HTTP route (the same reason `FilesController` is public).
// These endpoints therefore authenticate themselves: `login` by password,
// `refresh` and `logout` by the refresh cookie.
//
// `AllowedOriginGuard` is applied at the class level so it covers all three
// routes and cannot be forgotten on a fourth — these are the only routes a
// browser sends the refresh cookie to, which is exactly what makes them the
// CSRF targets.
//
// `ThrottlerGuard` (Phase 2) rides alongside it, also class-wide. It rate-limits
// per client IP; the per-route `@Throttle` decorators below set the strict login
// and refresh limits, and any route without one falls back to the module's
// default. It relies on `req.ip` being the real client address — see the
// `trust proxy` setup in `main.ts`.
@Controller('auth')
@UseGuards(AllowedOriginGuard, ThrottlerGuard)
export class AuthController {
    constructor(
        private authService: AuthService,
        private logger: AppLoggerService,
    ) {}

    @Public()
    // Strict: a person logs in a few times a minute at most, so 5/min/IP is
    // roomy for humans and hostile to a credential-stuffing script. Paired with
    // the per-account lockout in `AuthService`, which catches an attack spread
    // across many IPs to stay under this per-IP ceiling.
    @Throttle(authThrottle.loginLimit, authThrottle.ttlSeconds)
    @Post('login')
    @HttpCode(HttpStatus.OK)
    async login(
        @Body() body: unknown,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<AuthResponse> {
        // Hand-validated rather than via a global ValidationPipe: this app has
        // never registered one, and adding it globally would start validating
        // every GraphQL input in the repo at the same time.
        const credentials = this.readCredentials(body, req);

        const outcome = await this.authService.loginWithCredentials(
            credentials,
            sessionMeta(req),
        );
        // Phase 3: a login no longer always produces tokens. It may instead hand
        // back an MFA or password-change gate, which carry no cookie.
        return this.respondWithOutcome(res, outcome);
    }

    @Public()
    // The brute-force surface: a 6-digit code is only ~20 bits. Tightly capped
    // per IP on top of the per-code `attempts` counter in the service.
    @Throttle(authThrottle.mfaVerifyLimit, authThrottle.ttlSeconds)
    @Post('mfa/verify')
    @HttpCode(HttpStatus.OK)
    async verifyMfa(
        @Body() body: unknown,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<{ accessToken: string }> {
        const { mfaToken, code } = this.readStringFields(
            body,
            ['mfaToken', 'code'],
            req,
        );
        const pair = await this.authService.verifyMfaCode(
            mfaToken,
            code,
            sessionMeta(req),
        );
        // A correct code always ends in a real session — the cookie is set here.
        return this.respondWithPair(res, pair);
    }

    @Public()
    // Capped low: this endpoint sends mail, so it must not be usable to spam a
    // victim's inbox or run up a mail bill.
    @Throttle(authThrottle.mfaResendLimit, authThrottle.ttlSeconds)
    @Post('mfa/resend')
    @HttpCode(HttpStatus.OK)
    async resendMfa(
        @Body() body: unknown,
        @Req() req: Request,
    ): Promise<{ success: true }> {
        const { mfaToken } = this.readStringFields(body, ['mfaToken'], req);
        await this.authService.resendMfaCode(mfaToken, sessionMeta(req));
        return { success: true };
    }

    @Public()
    @Post('password/change')
    @HttpCode(HttpStatus.OK)
    async changePassword(
        @Body() body: unknown,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<AuthResponse> {
        const { changeToken, newPassword } = this.readStringFields(
            body,
            ['changeToken', 'newPassword'],
            req,
        );
        const outcome = await this.authService.changePassword(
            changeToken,
            newPassword,
            sessionMeta(req),
        );
        // A change can resolve straight to tokens, or — for an MFA-enforced
        // account — into the MFA gate. `respondWithOutcome` handles both.
        return this.respondWithOutcome(res, outcome);
    }

    @Public()
    // Looser than login: a legitimate tab rotates its token as the access token
    // expires, and several tabs share the cookie, so honest traffic here is
    // higher. Still bounded so a stolen-cookie replay loop cannot pound it.
    @Throttle(authThrottle.refreshLimit, authThrottle.ttlSeconds)
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    async refresh(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<{ accessToken: string }> {
        try {
            const pair = await this.authService.rotateRefreshToken(
                readRefreshCookie(req),
                sessionMeta(req),
            );
            return this.respondWithPair(res, pair);
        } catch (error) {
            // Only a genuine 401 may destroy the cookie. A 401 means the token
            // really is worthless, so dropping it stops the browser replaying it
            // on every reload. Anything else — a database blip, a bug — is
            // transient, and clearing the cookie for it would turn five seconds
            // of downtime into "everyone mid-refresh is permanently logged
            // out". Let those propagate as a 500 with the cookie intact; the
            // client retries and recovers.
            if (isUnauthorized(error)) {
                clearRefreshCookie(res);
            }
            throw error;
        }
    }

    @Public()
    @Post('logout')
    @HttpCode(HttpStatus.OK)
    async logout(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<{ success: true }> {
        await this.authService.logout(readRefreshCookie(req), sessionMeta(req));
        clearRefreshCookie(res);
        return { success: true };
    }

    // The refresh token goes into the cookie and nowhere else; the response body
    // carries only the short-lived access token, which the frontend keeps in a
    // module variable rather than in localStorage.
    private respondWithPair(
        res: Response,
        pair: TokenPair,
    ): { accessToken: string } {
        setRefreshCookie(res, pair.refreshToken, pair.refreshExpiresAt);
        return { accessToken: pair.accessToken };
    }

    // Translate the service's three-way outcome into an HTTP response. Only the
    // `tokens` case sets a cookie; the two gates hand back a body-only token that
    // the frontend holds in memory for the next step (verify / change).
    private respondWithOutcome(
        res: Response,
        outcome: AuthOutcome,
    ): AuthResponse {
        switch (outcome.kind) {
            case 'tokens':
                return this.respondWithPair(res, outcome.pair);
            case 'mfa_required':
                return { mfaRequired: true, mfaToken: outcome.mfaToken };
            case 'password_change_required':
                return {
                    passwordChangeRequired: true,
                    changeToken: outcome.changeToken,
                };
        }
    }

    // A method rather than the module-level function it used to be, purely so it
    // can reach the injected logger. This is one of the two events the *service*
    // can never report: a body this malformed never becomes a service call at
    // all, so the transport is the only layer that sees it.
    private readCredentials(
        body: unknown,
        req: Request,
    ): { email: string; password: string } {
        const candidate = body as {
            email?: unknown;
            password?: unknown;
        } | null;
        const email = candidate?.email;
        const password = candidate?.password;
        if (typeof email !== 'string' || typeof password !== 'string') {
            // No `email` in the context on purpose: whatever is in that field is
            // not a string, so it is not an attempted address — it is arbitrary
            // input, and `LogContext` types `email` as a string.
            this.logger.warn('auth.login.malformed', {
                ip: req.ip ?? undefined,
                requestId: req.requestId,
            });
            throw new BadRequestException(LOGIN_FAILED_MESSAGE);
        }
        return { email, password };
    }

    // Same hand-validation as `readCredentials`, generalised for the Phase 3
    // routes: every named field must be a non-empty string or the request is a
    // 400. Returns a typed object keyed by the requested fields.
    private readStringFields<K extends string>(
        body: unknown,
        fields: K[],
        req: Request,
    ): Record<K, string> {
        const candidate = body as Record<string, unknown> | null;
        const result = {} as Record<K, string>;
        for (const field of fields) {
            const value = candidate?.[field];
            if (typeof value !== 'string' || value.length === 0) {
                this.logger.warn('auth.request.malformed', {
                    ip: req.ip ?? undefined,
                    requestId: req.requestId,
                });
                throw new BadRequestException('Solicitud inválida.');
            }
            result[field] = value;
        }
        return result;
    }
}

// A Phase 3 login/refresh/change response. Exactly one shape is populated:
// `accessToken` for a real session, or one of the two gates. REST/JSON is loose
// enough that a single optional-fields object is clearer here than a union.
interface AuthResponse {
    accessToken?: string;
    mfaRequired?: boolean;
    mfaToken?: string;
    passwordChangeRequired?: boolean;
    changeToken?: string;
}

// `UnauthorizedException` is an `HttpException` with status 401, and so is
// anything else that means the same thing — matching on the status rather than
// the class keeps this true for whatever the service throws next.
function isUnauthorized(error: unknown): boolean {
    return (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.UNAUTHORIZED
    );
}

function sessionMeta(req: Request): SessionMeta {
    return {
        userAgent: req.headers['user-agent'] ?? null,
        // `main.ts` now sets `trust proxy`, so behind Nginx this is the real
        // client address rather than the proxy's — which is what makes per-IP
        // throttling meaningful. Stored as informational metadata only; nothing
        // authenticates on it.
        ip: req.ip ?? null,
        // Put there by `RequestIdMiddleware`, which `AuthModule` applies to
        // `auth/*`. Log-only; `issueTokenPair` never writes it to a row.
        requestId: req.requestId,
    };
}
