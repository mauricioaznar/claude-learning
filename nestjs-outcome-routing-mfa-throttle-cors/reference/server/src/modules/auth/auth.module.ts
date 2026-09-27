import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginService } from './login.service';
import { RefreshTokenService } from './refresh-token.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { jwtConstants } from '../../common/constants/jwt';
import { authThrottle } from '../../common/constants/login-protection';
import { AuthResolver } from './auth.resolver';
import { UserService } from './users/user.service';
import { RoleResolver } from './roles/role.resolver';
import { RoleService } from './roles/role.service';
import { LoggingModule } from '../../common/modules/logging/logging.module';
import { RequestIdMiddleware } from '../../common/modules/logging/request-id.middleware';
import { MailModule } from '../../common/modules/mail/mail.module';

@Module({
    imports: [
        PassportModule,
        JwtModule.register({
            secret: jwtConstants.authSecret,
            signOptions: { expiresIn: jwtConstants.authExpiresIn },
        }),
        // Imported explicitly rather than picked up from a global module: this
        // is the first consumer of the logger, and the next one imports it the
        // same deliberate way. `AllowedOriginGuard` and `AuthController` both
        // inject `AppLoggerService`, so this line is what makes them resolvable.
        LoggingModule,
        // Phase 3 email MFA sends the one-time code through this. Imported
        // explicitly (not global), the same way LoggingModule is — AuthService
        // is its only consumer today.
        MailModule,
        // Phase 2 rate limiting. Registered here, not globally in `AppModule`,
        // and applied only to the REST auth routes via `@UseGuards(ThrottlerGuard)`
        // on the controller. A *global* per-IP throttle was deliberately not used:
        // most users share one facility WAN IP, so a global cap on GraphQL traffic
        // would throttle the whole office as one client. The `ttl`/`limit` here is
        // the per-route default (e.g. logout); `@Throttle` overrides it on login
        // and refresh.
        ThrottlerModule.forRoot({
            ttl: authThrottle.ttlSeconds,
            limit: authThrottle.defaultLimit,
        }),
    ],
    // `auth.controller.ts` is back, but only for the httpOnly refresh-cookie
    // endpoints (login / refresh / logout). The legacy `GET /auth/users` route
    // deleted in Phase 0 — it returned every user row including password
    // hashes — is not coming back.
    controllers: [AuthController],
    providers: [
        // `AuthService` is a thin facade (Phase 5d) over the four services below,
        // which hold the actual behaviour. All are registered here; only the
        // facade is exported, so the module's public DI surface is unchanged.
        AuthService,
        LoginService,
        RefreshTokenService,
        MfaService,
        PasswordService,
        UserService,
        // `LocalStrategy` used to sit here. It was registered but never used —
        // nothing ever applied `AuthGuard('local')` — so it was deleted along
        // with its file when this module gained the REST controller.
        JwtStrategy,
        AuthResolver,
        RoleResolver,
        RoleService,
    ],
    exports: [AuthService],
})
export class AuthModule implements NestModule {
    // `auth/*` and nothing else. The correlation id is scoped to the three
    // cookie endpoints because that is the whole of Phase 1.7's scope — GraphQL
    // operations are deliberately not correlated (no `AsyncLocalStorage`), and a
    // request id stamped on routes nothing logs from would be dead weight.
    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(RequestIdMiddleware).forRoutes('auth/*');
    }
}
