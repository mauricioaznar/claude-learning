import { ApolloClient, from, InMemoryCache, split } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
// @ts-ignore
import { createUploadLink } from 'apollo-upload-client';
import { createClient } from 'graphql-ws';
import { store } from '../../app/store';
import apiUrl from '../../constants/api-url';
import { setConnectionStatus } from '../../features/connection-status/connection-status-slice';
import { pushMessage } from '../../features/global-messages/global-messages-slice';

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

const httpProtocol = apiUrl.startsWith('localhost') ? 'http' : 'https';
let httpLink = createUploadLink({
    uri: `${httpProtocol}://${apiUrl}/graphql`,
});

const authLink = setContext(async (_, { headers }) => {
    const token = localStorage.getItem('token');

    return {
        headers: {
            ...headers,
            authorization: token ? `Bearer ${token}` : null,
        },
    };
});

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
                    if (window.localStorage.getItem('token')) {
                        const message = 'Sesión expirada';
                        store.dispatch(
                            pushMessage({
                                message,
                                options: { variant: 'error' },
                            }) as any,
                        );
                        window.localStorage.removeItem('token');
                        const oldHeaders = operation.getContext().headers;
                        operation.setContext({
                            headers: {
                                ...oldHeaders,
                                authorization: null,
                            },
                        });

                        setTimeout(() => {
                            window.location.reload();
                        }, 2000);
                    }
                    return forward(operation);
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

const webSocketProtocol = apiUrl.startsWith('localhost') ? 'ws' : 'wss';

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
    url: `${webSocketProtocol}://${apiUrl}/graphql`,
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
    connectionParams: () => {
        const token = window.localStorage.getItem('token');
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
