import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

import { appConfig } from './common/helpers/app/app-config';
import { corsOrigins } from './common/constants/cors';
import { logLevels } from './common/constants/logging';
import { trustProxyHops } from './common/constants/login-protection';

async function bootstrap() {
    // Resolved before the factory call so the boot banner below can name the
    // threshold. Passing the list to `NestFactory.create` calls
    // `Logger.overrideLogger` internally, so it applies to every `Logger`
    // instance in the process and not just the bootstrap one.
    const levels = logLevels();
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        logger: levels,
    });
    // Trust the reverse proxy in front of the API so `req.ip` reflects the real
    // client (from `X-Forwarded-For`) rather than the proxy's address. Phase 2's
    // per-IP throttling depends on this; the hop count must match the deployment
    // topology (see `constants/login-protection`).
    app.set('trust proxy', trustProxyHops());
    // The allowlist lives in `common/constants/cors` because the auth
    // controller's CSRF guard has to enforce the same list — see the comment
    // there for why the wildcard had to go.
    app.enableCors({
        origin: corsOrigins(),
        // Without this the browser drops the refresh cookie on both the request
        // and the `Set-Cookie` response.
        credentials: true,
    });
    await appConfig({ app });
    await app.listen(3008);

    // The only way to confirm in production that `LOG_LEVEL` actually took
    // effect. Emitted at `log`, so it is invisible at `warn`/`error` — which is
    // correct: someone running at `error` did not ask for a boot banner.
    new Logger('Bootstrap').log(
        `log level ${levels[0]} (enabled: ${levels.join(', ')})`,
    );
}

void bootstrap();
