import React, { useEffect, useState } from 'react';
import { useCurrentUserQuery } from '../../../services';
import { bootstrapSession } from '../../../services/auth/access-token';
import DFullScreenLoader from '../../dum/simple/loader/d-full-screen-loader';
import LoginForm from './login-form';
import { DarkModeSync } from '../providers/dark-mode-sync';

interface AuthorizationWrapperProps {
    children: React.ReactElement<any, any> | null;
}

/*
 * This component is the application's startup state machine:
 *
 * 1. Unknown session: show the loader while `/auth/refresh` checks the cookie.
 * 2. No session: `currentUser` is absent, so show the login form.
 * 3. Authenticated: `currentUser` exists, so render the application.
 *
 * It does not hold either token. `access-token.ts` owns the in-memory access
 * token and the browser owns the httpOnly refresh cookie.
 */
export const AuthorizationWrapper = (props: AuthorizationWrapperProps) => {
    // The access token lives in memory, so a page reload starts with nothing.
    // Before asking the API who we are, spend the refresh cookie once to mint a
    // token — otherwise every reload would land on the login screen even with a
    // perfectly good session. A 401 here just means "not logged in"; it is not
    // an error state and shows no error UI.
    const [isSessionBootstrapped, setIsSessionBootstrapped] = useState(false);

    useEffect(() => {
        let isCancelled = false;
        void bootstrapSession().then(() => {
            if (!isCancelled) {
                setIsSessionBootstrapped(true);
            }
        });
        return () => {
            isCancelled = true;
        };
    }, []);

    const { loading: currentUserLoading, data } = useCurrentUserQuery({
        notifyOnNetworkStatusChange: true,
        // Holding the query back until the token attempt has finished is what
        // stops a guaranteed-401 first request on every reload.
        skip: !isSessionBootstrapped,
    });

    // Only block rendering on the *initial* load (no data yet).
    // While a background refetch is in flight (e.g. after a WS reconnect),
    // `loading` is true but `data` still holds the previous value — we must
    // keep children mounted in that case. Unmounting children would tear down
    // SubscriptionsProvider, close every subscription, collapse the lazy WS
    // socket, trigger another reconnect, and restart the whole cycle forever.
    const isInitialLoading =
        !isSessionBootstrapped || (currentUserLoading && !data);

    return isInitialLoading ? (
        <DFullScreenLoader />
    ) : !data?.currentUser ? (
        <LoginForm />
    ) : (
        <>
            <DarkModeSync />
            {props.children}
        </>
    );
};
