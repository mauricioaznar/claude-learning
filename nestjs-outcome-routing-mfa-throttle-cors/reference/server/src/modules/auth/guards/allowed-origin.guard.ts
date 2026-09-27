import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { isAllowedOrigin } from '../../../common/constants/cors';
import { AppLoggerService } from '../../../common/modules/logging/app-logger.service';

// CSRF protection for the cookie endpoints.
//
// In production the refresh cookie is `SameSite=None` (the frontend and the API
// are on different registrable domains), so the browser attaches it to
// cross-site requests too. A cross-site form POST is a *simple request*: there
// is no preflight, and CORS only stops the attacker from **reading** the
// response — it does not stop the request from executing. Without this guard any
// page on the internet could force-log-out a signed-in user (`/auth/logout`
// takes no body at all) or post credentials to `/auth/login` and leave the
// victim signed into an attacker-controlled account.
//
// Tokens cannot be stolen this way — the response is unreadable cross-origin —
// so this is nuisance-to-moderate rather than critical. The fix is small enough
// not to weigh that up.
//
// An **absent** `Origin` is allowed on purpose: browsers always send one on a
// cross-origin POST, while curl, the test suite and server-to-server callers
// send none. Rejecting them would break non-browser use without protecting
// anything.
@Injectable()
export class AllowedOriginGuard implements CanActivate {
    // Nest instantiates guards through the DI container of the module that
    // applies them, so this resolves because `AuthModule` imports
    // `LoggingModule`. It is also why `RequestIdMiddleware` had to be
    // middleware: guards run after middleware, so `request.requestId` is already
    // set by the time this reads it.
    constructor(private logger: AppLoggerService) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request>();
        const origin = request?.headers?.origin;

        if (!origin) {
            return true;
        }

        if (!isAllowedOrigin(origin)) {
            // The rejected origin goes in `reason`: it is the single fact that
            // tells a misconfigured `CORS_ORIGINS` apart from an actual
            // cross-site attempt, and it is attacker-supplied, so the logger's
            // truncation applies to it.
            this.logger.warn('auth.origin.rejected', {
                reason: origin,
                requestId: request.requestId,
            });
            throw new ForbiddenException();
        }

        return true;
    }
}
