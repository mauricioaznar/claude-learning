import { INestApplication } from '@nestjs/common';
import { setupApp } from '../../common/__tests__/helpers/setup-app';
import request from 'supertest';
import { adminUser } from '../../common/__tests__/objects/auth/users';

// This file was `auth.resolver.test.ts` until Phase 1.6. It never tested the
// resolver: it tested logging in, and Phase 1.5.6 moved that from the GraphQL
// `login` mutation to `POST /auth/login`, because a cookie needs a stable URL
// path and Phase 2 throttles the REST route.
//
// No `Origin` header is sent, which `AllowedOriginGuard` allows on purpose —
// browsers always send one on a cross-origin POST, non-browser callers like
// supertest never do.
describe('AuthController', () => {
    let app: INestApplication;

    beforeEach(async () => {
        app = await setupApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it('user logs in', async () => {
        const response = await request(app.getHttpServer())
            .post('/auth/login')
            .send({
                email: adminUser.email,
                password: adminUser.password,
            });

        expect(response.status).toBe(200);
        expect(response.body.accessToken).toBeDefined();
    });
});
