import { createRoot } from 'react-dom/client';
import App from './app/App';
import dayjs from 'dayjs';
import utcPlugin from 'dayjs/plugin/utc';
// Ships inside dayjs itself — not a new dependency. Needed by the audit
// surfaces, which render timestamps on the America/Mexico_City business day the
// activities filter is defined in. Requires the utc plugin above.
import timezonePlugin from 'dayjs/plugin/timezone';
import isTomorrow from 'dayjs/plugin/isTomorrow';
import relativeTime from 'dayjs/plugin/relativeTime';
import localeData from 'dayjs/plugin/localeData';
import * as serviceWorker from './serviceWorker';
import 'dayjs/locale/es';
import { GlobalMessagesSnackbar } from './features/global-messages/global-messages-snackbar';
import { Providers } from './app/app/providers/providers';
import { AuthorizationWrapper } from './app/app/authorization-wrapper/authorization-wrapper';
import { SubscriptionsProvider } from './app/app/providers/subscriptions-provider';

dayjs.extend(isTomorrow);
dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);
dayjs.extend(relativeTime);
dayjs.extend(localeData);
dayjs.locale('es');
dayjs.localeData();

// React 18: render via createRoot (the old ReactDOM.render is removed).
// NOTE: intentionally NOT wrapped in <React.StrictMode>. In dev, StrictMode
// double-invokes effects (mount→unmount→mount); combined with this Apollo
// version's useSubscription, the StrictMode unmount drops all subscriptions and
// the remount fails to re-register them with the lazy graphql-ws client — so
// active subscribers stay 0 and the socket closes, leaving the app permanently
// "disconnected" in dev. StrictMode has no effect in production builds anyway.
const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
    <Providers>
        <AuthorizationWrapper>
            <>
                <App />
                <SubscriptionsProvider />
            </>
        </AuthorizationWrapper>
        <GlobalMessagesSnackbar />
    </Providers>,
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
