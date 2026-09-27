import {
    ApolloClient,
    from,
    HttpLink,
    InMemoryCache,
    Observable,
    split,
} from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient } from 'graphql-ws';
import { store } from '../../app/store';
import { apiHttpUrl, apiWsUrl } from '../../constants/api-url';
import { setConnectionStatus } from '../../features/connection-status/connection-status-slice';
import { pushMessage } from '../../features/global-messages/global-messages-slice';
import {
    ensureAccessToken,
    isSessionKnownDead,
    refreshAccessToken,
} from '../auth/access-token';

/*
 * LEARNING MAP — how Apollo uses authentication
 *
 * Apollo has two transports and both need an access token:
 *
 * - Normal queries/mutations use HTTP. `authLink` gets a usable token and adds
 *   the Authorization header. If the API still returns 401, `errorLink`
 *   refreshes once and replays that operation.
 * - Subscriptions use WebSocket. They bypass the HTTP links, so
 *   `connectionParams` gets a usable token whenever the socket connects or
 *   reconnects.
 *
 * This file never reads the refresh cookie. When it needs a new access token it
 * calls `access-token.ts`; that module POSTs `/auth/refresh` and the browser
 * attaches the httpOnly cookie automatically.
 *
 * The final `splitLink` is the fork: subscriptions go to `wsLink`; every other
 * GraphQL operation goes through `authLink -> errorLink -> httpLink`.
 */

// const defaultOptions = {
//     watchQuery: {
//         fetchPolicy: 'no-cache',
//         errorPolicy: 'ignore',
//     },
//     query: {
//         fetchPolicy: 'no-cache',
//         errorPolicy: 'all',
//     },
// }

let httpLink = new HttpLink({
    uri: `${apiHttpUrl}/graphql`,
});

const authLink = setContext(async (_, { headers }) => {
    // The token comes from memory now, not localStorage. `ensureAccessToken`
    // also covers the case where we hold no token but a refresh cookie might
    // still be good — it mints one instead of sending an anonymous request.
    const token = await ensureAccessToken();

    return {
        headers: {
            ...headers,
            authorization: token ? `Bearer ${token}` : null,
        },
    };
});

// Terminal state: the refresh cookie is gone or rejected, so there is nothing
// left to renew. Announce it once and reload — a reload is a clean reset of
// every module-level cache, and it lands on the login screen because the
// bootstrap refresh will come back 401.
//
// This is deliberately *not* what happens when an access token merely expires.
// That case is now invisible: the link below refreshes and replays the request.
let sessionExpiredHandled = false;

function endExpiredSession() {
    if (sessionExpiredHandled) {
        return;
    }
    sessionExpiredHandled = true;
    store.dispatch(
        pushMessage({
            message: 'Sesión expirada',
            options: { variant: 'error' },
        }) as any,
    );
    setTimeout(() => {
        window.location.reload();
    }, 2000);
}

const errorLink = onError(
    ({ graphQLErrors, networkError, operation, forward }) => {
        if (graphQLErrors) {
            for (let err of graphQLErrors) {
                const error = err as unknown as {
                    extensions?: {
                        code: string;
                    };
                    message: string | string[];
                };

                if (
                    error.extensions?.code.toLowerCase() ===
                        'unauthenticated' ||
                    (typeof error.message === 'string' &&
                        err.message.toLowerCase() === 'unauthorized')
                ) {
                    // Already showing the login screen: an unauthenticated
                    // answer is the expected one, so let it through quietly
                    // rather than toasting and reloading in a loop.
                    if (isSessionKnownDead()) {
                        return;
                    }

                    // One retry per operation. Without this guard a request that
                    // is rejected for a reason a new token cannot fix would
                    // refresh-and-replay forever.
                    if (operation.getContext().hasRetriedAfterRefresh) {
                        endExpiredSession();
                        return;
                    }

                    // Returning an Observable from onError makes Apollo wait on
                    // it instead of surfacing the error — this is the silent
                    // refresh-and-replay. The user sees a slightly slower
                    // request, nothing else.
                    return new Observable<any>((observer) => {
                        let subscription: { unsubscribe: () => void } | null =
                            null;

                        // Force a refresh rather than `ensureAccessToken`: the
                        // token in memory is precisely the one the server just
                        // rejected.
                        refreshAccessToken()
                            .then((token) => {
                                if (!token) {
                                    // No token is not the same as no session: a
                                    // 500 or a dropped connection also lands
                                    // here, and those recover. Only tear the
                                    // session down when the server actually
                                    // rejected the cookie.
                                    if (isSessionKnownDead()) {
                                        endExpiredSession();
                                    }
                                    observer.error(err);
                                    return;
                                }

                                operation.setContext((previous: any) => ({
                                    ...previous,
                                    headers: {
                                        ...(previous?.headers || {}),
                                        authorization: `Bearer ${token}`,
                                    },
                                    hasRetriedAfterRefresh: true,
                                }));

                                subscription = forward(operation).subscribe(
                                    observer,
                                );
                            })
                            .catch((refreshError) => {
                                observer.error(refreshError);
                            });

                        return () => {
                            if (subscription) {
                                subscription.unsubscribe();
                            }
                        };
                    });
                } else {
                    if (Array.isArray(error.message)) {
                        error.message.forEach((message) => {
                            store.dispatch(
                                pushMessage({
                                    message,
                                    options: { variant: 'error' },
                                }),
                            );
                        });
                    } else {
                        store.dispatch(
                            pushMessage({
                                message: err.message,
                                options: { variant: 'error' },
                            }),
                        );
                    }
                }
            }
        }

        // To retry on network errors, we recommend the RetryLink
        // instead of the onError link. This just logs the error.
        if (networkError) {
            networkError.message = 'Connection error, try again later.';
        }
    },
);

// Dead-connection detection. A WebSocket that is silently dropped by a proxy,
// load balancer, or a sleeping laptop becomes "half-open": it looks alive but
// delivers nothing. graphql-ws only auto-reconnects once it sees a real
// `close`, so we have to provoke one. We ping while idle (`keepAlive`) and, if
// the server does not answer with a pong in time, force-close the socket so the
// retry machinery kicks in.
let activeSocket: WebSocket | null = null;
let pingTimeout: ReturnType<typeof setTimeout> | undefined;

// Tracks whether we have ever been connected, so the very first `connected`
// event does not trigger a refetch and reconnects do.
let hasConnectedBefore = false;

const wsClient = createClient({
    url: `${apiWsUrl}/graphql`,
    lazy: true,
    // Defensive: don't close the socket the instant the last subscription
    // unsubscribes — wait a few seconds so a brief 0-subscriber window (a
    // transient unmount) reuses the still-open socket instead of churning a
    // close/reconnect. (The React 18 StrictMode dev double-mount that first
    // exposed the disconnect is gone now — we dropped StrictMode in index.tsx,
    // which was the real fix — but this guard is cheap insurance.)
    lazyCloseTimeout: 5_000,
    keepAlive: 10_000, // ping the server after 10s of inactivity
    shouldRetry: () => true, // retry on any closure, not just "fatal" ones
    retryAttempts: Infinity, // keep trying for as long as the tab is open
    // Evaluated on every (re)connect, so it must be able to *wait* for a token:
    // the server only checks credentials at `connection_init`, and a socket that
    // reconnects after the access token expired would otherwise hand over a
    // dead one and fail every subscription on it — silently, because
    // subscriptions never reach `errorLink`. `ensureAccessToken` inspects the
    // token's `exp`, so an idle tab reconnecting past expiry mints a fresh one
    // here instead of presenting the dead one it still holds.
    connectionParams: async () => {
        const token = await ensureAccessToken();

        // A null token means one of two opposite things, and connecting anyway
        // is only right for one of them.
        //
        // If the session is known dead, anonymous is correct: `onConnect` on the
        // server accepts a tokenless socket on purpose, because the login screen
        // has always-on subscriptions that need one. Retrying would just spin.
        //
        // If it is *not* known dead, the refresh merely failed — a 500, a
        // network blip — and the token is temporarily unavailable. Connecting
        // anonymously there is the trap: the socket comes up healthy, every
        // protected subscription on it fails, and nothing retries, because
        // `shouldRetry` only fires on a close and subscriptions never reach
        // `errorLink`. The tab keeps a live, useless connection. Throwing fails
        // the connection attempt instead, which is what `shouldRetry` and
        // `retryAttempts: Infinity` above are already configured to handle.
        //
        // ⚠️ The thrown value must stay a plain `Error`, and the reason is not
        // obvious. graphql-ws 5.9.1 handles a throw here by emitting `error` and
        // *then* closing the socket with 4005 `InternalClientError` — a code on
        // its own fatal list, which would refuse to retry. That close never
        // reaches the retry logic: `emit` is synchronous and `errorOrClosed` is
        // first-one-wins, so the error is delivered and both listeners are
        // removed before the close event arrives. What the retry logic sees is
        // this `Error`, and its fatal-code branch is gated on `isLikeCloseEvent`
        // (`isObject(val) && 'code' in val && 'reason' in val`), which a plain
        // `Error` fails — so it falls through to `shouldRetry` and reconnects.
        //
        // The consequence is a live footgun: throwing anything that carries both
        // `code` and `reason` would be read as a close event, match the fatal
        // list, and terminate every subscription instead of retrying. Do not
        // attach those properties here, and re-check this on a graphql-ws
        // upgrade.
        if (!token && !isSessionKnownDead()) {
            throw new Error(
                'No access token available for the subscription socket',
            );
        }

        return {
            isWebSocket: true,
            authorization: token ? `Bearer ${token}` : null,
        };
    },
    on: {
        connecting: () => {
            store.dispatch(setConnectionStatus('connecting'));
        },
        connected: (socket) => {
            activeSocket = socket as WebSocket;
            store.dispatch(setConnectionStatus('connected'));

            // On a *reconnect* (not the first connect), events that fired while
            // we were offline are gone — the server PubSub does not replay them.
            // Re-run every active query so the UI reconciles immediately instead
            // of showing stale data.
            if (hasConnectedBefore) {
                apolloClient.refetchQueries({ include: 'active' });
            }
            hasConnectedBefore = true;
        },
        ping: (received) => {
            // `received: false` means we just *sent* a ping; start the pong timer.
            if (!received) {
                pingTimeout = setTimeout(() => {
                    if (activeSocket?.readyState === WebSocket.OPEN) {
                        activeSocket.close(4408, 'Request Timeout');
                    }
                }, 5_000); // wait 5s for the pong, otherwise consider it dead
            }
        },
        pong: (received) => {
            // A pong came back: the connection is alive, cancel the kill timer.
            if (received && pingTimeout) {
                clearTimeout(pingTimeout);
            }
        },
        closed: () => {
            if (pingTimeout) {
                clearTimeout(pingTimeout);
            }
            store.dispatch(setConnectionStatus('disconnected'));
        },
        error: () => {
            store.dispatch(setConnectionStatus('disconnected'));
        },
    },
});

const wsLink = new GraphQLWsLink(wsClient);

// const linkMiddleware = new ApolloLink((operation, forward) => {
//     return forward(operation);
// })

const splitLink = split(
    ({ query }) => {
        const definition = getMainDefinition(query);
        return (
            definition.kind === 'OperationDefinition' &&
            definition.operation === 'subscription'
        );
    },
    wsLink,
    from([authLink, errorLink, httpLink]),
);

export class ApolloClientWs extends ApolloClient<any> {
    constructor(props: any) {
        super(props);

        this.dispose = this.dispose.bind(this);
    }

    async dispose() {
        // await wsClient.terminate();
    }
}

export const apolloClient = new ApolloClientWs({
    link: splitLink,
    cache: new InMemoryCache(),
});
