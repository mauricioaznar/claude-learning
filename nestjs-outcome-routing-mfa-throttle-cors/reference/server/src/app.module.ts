import { CacheModule, Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { AuthModule } from './modules/auth/auth.module';
import { ApolloError } from 'apollo-server-express';
import { GraphQLError, GraphQLFormattedError } from 'graphql';
import { FilesModule } from './modules/files/files.module';
import { MemoryTokenModule } from './modules/memory-token/memory-token.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { ProductionModule } from './modules/production/production.module';
import { SalesModule } from './modules/sales/sales.module';
import { APP_GUARD } from '@nestjs/core';
import { GqlAuthGuard } from './modules/auth/guards/gql-auth.guard';
import { GqlRolesGuard } from './modules/auth/guards/gql-roles.guard';
import { PrismaModule } from './common/modules/prisma/prisma.module';
import { SummariesModule } from './modules/summaries/summaries.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { PubSubModule } from './common/modules/pub-sub/pub-sub.module';
import { AuditUsersModule } from './common/services/entities/audit-users.module';
import { ManagementModule } from './modules/management/management.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { UserConfigModule } from './modules/user-config/user-config.module';

@Module({
    imports: [
        PrismaModule,
        PubSubModule,
        AuditUsersModule,
        GraphQLModule.forRoot({
            autoSchemaFile: 'schema.gql',
            installSubscriptionHandlers: true,
            subscriptions: {
                'graphql-ws': {
                    onConnect: (ctx: any) => {
                        if (!ctx || !ctx.connectionParams) {
                            throw new ApolloError(
                                `'Connection params' must be included with the 'authorization' header included`,
                            );
                        }

                        // Do NOT reject a socket that lacks a token here.
                        // Authentication is enforced per-operation by GqlAuthGuard,
                        // so an unauthenticated client (e.g. the login screen, where
                        // the always-on subscriptions still open the lazy socket) may
                        // connect and simply receive auth errors when it subscribes.
                        // Stash the auth params on `extra` so the per-operation
                        // `context` factory below can rebuild a request from them.
                        if (ctx.extra) {
                            ctx.extra.connectionParams = ctx.connectionParams;
                        }
                        return { connectionParams: ctx.connectionParams };
                    },
                },
            },
            formatError: (error: any) => {
                if (error instanceof GraphQLError) {
                    const graphQLFormattedError: GraphQLFormattedError = {
                        message:
                            error.extensions?.exception?.response?.messag ||
                            error.message,
                    };
                    return graphQLFormattedError;
                } else if (error instanceof ApolloError) {
                    if (!!error?.extensions?.response?.message) {
                        return {
                            message: error.extensions.response.message,
                        };
                    } else {
                        return {
                            message: error.message,
                        };
                    }
                }
                return error;
            },
            context: (ctx: any) => {
                // HTTP (queries/mutations): the Express request is on ctx.req.
                if (ctx?.req) {
                    return { req: ctx.req };
                }
                // WebSocket (graphql-ws subscriptions): rebuild a minimal request
                // whose `headers` carry the auth token, so the same JWT auth guard
                // and roles guard work exactly as they do over HTTP. The token may
                // live at the top level, under `extra`, or (legacy) on connection.
                const connectionParams =
                    ctx?.connectionParams ??
                    ctx?.extra?.connectionParams ??
                    ctx?.connection?.context ??
                    {};
                return { req: { headers: connectionParams } };
            },
        }),
        CacheModule.register({ ttl: 0, isGlobal: true }),
        AuthModule,
        UserConfigModule,
        ProductionModule,
        MaintenanceModule,
        ManagementModule,
        SalesModule,
        PayrollModule,
        SummariesModule,
        MemoryTokenModule,
        ActivitiesModule,
        FilesModule,
    ],
    providers: [
        {
            provide: APP_GUARD,
            useClass: GqlAuthGuard,
        },
        {
            provide: APP_GUARD,
            useClass: GqlRolesGuard,
        },
    ],
})
export class AppModule {}
