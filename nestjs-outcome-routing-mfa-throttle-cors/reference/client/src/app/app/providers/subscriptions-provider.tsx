import {
    clearActivitiesModule,
    clearAuthModule,
    clearManagement,
    clearProductionModule,
    clearSalesModule,
    useActivitySubscription,
    useAccountSubscription,
    useEmployeeSubscription,
    useOrderAdjustmentSubscription,
    useOrderProductionSubscription,
    useOrderQuotationSubscription,
    useOrderRequestSubscription,
    useOrderSaleSubscription,
    useProductSubscription,
    useTransferSubscription,
    useUserSubscription,
    useExpensesSubscription,
    useResourcesSubscription,
    useMachineSubscription,
    useExpenseResourceSubscription,
    ActivityTypeName,
} from '../../../services';
import { useAppDispatch } from '../../hooks';
import { pushMessage } from '../../../features/global-messages/global-messages-slice';
import {
    formatActivityMessage,
    isSnapshotCaptureFailed,
} from '../../../helpers';

// Mounted under AuthorizationWrapper, so it only renders once the user is logged
// in — that's what keeps the websocket from opening (and erroring) pre-login.
//
// GUARD-RAIL — keep subscriptions boot-only. Every hook below subscribes once,
// right after `connection_init`, while the socket's token is fresh; a reconnect
// re-runs `connection_init` (fresh token) and re-subscribes them all, so they
// are always authenticated against a live token.
//
// Do NOT add a per-page `useSubscription`. `connectionParams` is sent ONCE at
// `connection_init` and later `Subscribe` messages reuse it, so a subscription
// that starts mid-session on a socket that has been open >15 min (the access
// token TTL) authenticates against the FROZEN, now-expired token. The server's
// per-operation `GqlAuthGuard` rejects it, and — because subscriptions bypass
// `errorLink` — it fails SILENTLY with no refresh-and-replay.
//
// Need live data on a new page? Add one more cache-clearing subscription here
// (the page's active query then refetches). Only if you truly need a streamed
// page-scoped payload should you touch the socket's auth lifecycle — see the
// options weighed in docs (proactive recycle vs. reactive self-heal).
export function SubscriptionsProvider() {
    const dispatch = useAppDispatch();

    useProductSubscription({
        onSubscriptionData: ({ client }) => {
            clearProductionModule(client.cache);
        },
    });

    useOrderProductionSubscription({
        onSubscriptionData: ({ client }) => {
            clearProductionModule(client.cache);
        },
    });

    useEmployeeSubscription({
        onSubscriptionData: ({ client }) => {
            clearProductionModule(client.cache);
        },
    });

    useOrderAdjustmentSubscription({
        onSubscriptionData: ({ client }) => {
            clearProductionModule(client.cache);
        },
    });

    useOrderSaleSubscription({
        onSubscriptionData: ({ client }) => {
            clearSalesModule(client.cache);
        },
    });

    useOrderRequestSubscription({
        onSubscriptionData: ({ client }) => {
            clearSalesModule(client.cache);
        },
    });

    useOrderQuotationSubscription({
        onSubscriptionData: ({ client }) => {
            clearSalesModule(client.cache);
        },
    });

    useAccountSubscription({
        onSubscriptionData: ({ client }) => {
            // Also clears getAccountProducts (catalog now lives on the account
            // upsert), so the order-request product picker refetches.
            clearSalesModule(client.cache);
        },
    });

    useUserSubscription({
        onSubscriptionData: ({ client }) => {
            clearAuthModule(client.cache);
        },
    });

    useActivitySubscription({
        onSubscriptionData: ({ client, subscriptionData }) => {
            clearActivitiesModule(client.cache);

            // Pop a snackbar for live create/update events (deletes stay on the
            // activities page only). Reuses the same labels as that page.
            //
            // This remains the ONE snackbar source. Entity subscriptions only
            // clear caches, so a normal upsert still produces exactly one
            // message — a failed capture changes that message's tone, it does
            // not add a second one, and it never says the save failed.
            const activity = subscriptionData.data?.activity;
            if (activity) {
                const snapshotStatus = activity.snapshot_status;
                const captureFailed = isSnapshotCaptureFailed(snapshotStatus);
                const variant = captureFailed
                    ? 'warning'
                    : activity.type === ActivityTypeName.Create
                    ? 'success'
                    : activity.type === ActivityTypeName.Delete
                    ? 'error'
                    : 'info';
                dispatch(
                    pushMessage({
                        message: formatActivityMessage(activity),
                        options: {
                            variant,
                            activityType: activity.type,
                            snapshotStatus,
                        },
                    }),
                );
            }
        },
    });

    useTransferSubscription({
        onSubscriptionData: ({ client }) => {
            clearManagement(client.cache);
        },
    });

    useExpensesSubscription({
        onSubscriptionData: ({ client }) => {
            clearManagement(client.cache);
        },
    });

    useResourcesSubscription({
        onSubscriptionData: ({ client }) => {
            clearManagement(client.cache);
        },
    });

    useMachineSubscription({
        onSubscriptionData: ({ client }) => {
            clearProductionModule(client.cache);
        },
    });

    useExpenseResourceSubscription({
        onSubscriptionData: ({ client }) => {
            clearManagement(client.cache);
        },
    });

    return null;
}
