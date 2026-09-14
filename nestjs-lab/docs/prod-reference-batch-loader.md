# Prod reference — the INOPACK batch loader (Phase 2)

**Review-to-understand, not a code task.** This is the real `toOne`/`toMany` +
`createBatchLoader` code shipped to prod in INOPACK, saved here so I can read it
line by line before rebuilding my own from scratch in Phase 2 of this lab.

Original lives at `common/helpers/graphql/batch-loader.ts` in INOPACK; the plan
that introduced it is `docs/features/archived/feature-nestjs-resolvefield-loaders.md`.

The one subtle part is the **two-hop scheduler** (`Promise.resolve().then(() =>
process.nextTick(...))`): the batch closes only after the microtask queue is
fully drained, so `load()` calls that arrive from *nested* promise continuations
(the second level down — `product` inside each row's `products`) still land in
the same batch. Everything else is bookkeeping.

## `common/helpers/graphql/batch-loader.ts`

```ts
// Request-scoped batching for GraphQL resolve-fields.
//
// A resolve-field runs once per parent, so a list of N parents costs N queries:
// a 20-row plan with two products each was 1 + 20 (`products` per row) + 40
// (`product` per row product). A loader collects the keys every sibling field
// asks for during the same tick, runs ONE query for the whole batch, and hands
// each caller its own slice.
//
// Written here rather than installed (`dataloader`) because it is forty lines
// with no dependency, and because the batching decision — WHEN a batch closes —
// is the only subtle part and is better read than trusted. The scheduling below
// is the same one that package uses.
//
// A loader caches, so it MUST NOT outlive one request. It therefore lives on the
// GraphQL context object (see getRequestLoader), never on a resolver: Nest
// resolvers are singletons and a loader held there would serve stale rows to
// every later request.

export interface BatchLoader<K, V> {
    // Resolves once the batch this key joined has run. Repeated keys within a
    // request share one promise, so the same product asked for by ten rows is
    // fetched — and stored — once.
    load(key: K): Promise<V | undefined>;
}

// Given every key collected for one batch, return a map from key to value.
// Missing keys are legitimate (a soft-deleted product, a row with none) and
// surface as `undefined` to that caller only.
type BatchFn<K, V> = (keys: K[]) => Promise<Map<K, V>>;

export function createBatchLoader<K, V>(
    batchFn: BatchFn<K, V>,
): BatchLoader<K, V> {
    const cache = new Map<K, Promise<V | undefined>>();
    let queue: K[] = [];
    let scheduled: Promise<Map<K, V>> | null = null;

    const schedule = (): Promise<Map<K, V>> => {
        if (!scheduled) {
            scheduled = new Promise<Map<K, V>>((resolve, reject) => {
                // Two hops, deliberately. The microtask lets the sibling
                // resolvers that graphql-js starts in the same stack enqueue
                // their keys; Node then drains its nextTick queue only once the
                // microtask queue is empty, so a field resolved from ANOTHER
                // promise's continuation (the second level down — `product`
                // inside each row's `products`) still lands in this batch.
                void Promise.resolve().then(() => {
                    process.nextTick(() => {
                        const keys = queue;
                        queue = [];
                        scheduled = null;
                        batchFn(keys).then(resolve, reject);
                    });
                });
            });
        }
        return scheduled;
    };

    return {
        load(key: K): Promise<V | undefined> {
            const cached = cache.get(key);
            if (cached) return cached;

            queue.push(key);
            const result = schedule().then((values) => values.get(key));
            cache.set(key, result);
            return result;
        },
    };
}

// The GraphQL context object, as this app builds it (`{ req }` for both HTTP and
// websocket operations). Loaders are attached lazily under `loaders`.
export interface LoaderContext {
    loaders?: Map<string, unknown>;
}

// The one legitimate place to build a loader: lazily, on the request's context,
// under a name unique to what it loads. `create` runs at most once per request.
export function getRequestLoader<K, V>(
    context: LoaderContext,
    name: string,
    create: () => BatchLoader<K, V>,
): BatchLoader<K, V> {
    if (!context.loaders) {
        context.loaders = new Map<string, unknown>();
    }
    const existing = context.loaders.get(name);
    if (existing) return existing as BatchLoader<K, V>;

    const loader = create();
    context.loaders.set(name, loader);
    return loader;
}

// Fold a flat result set into the map a batch function must return: one entry
// per requested key, empty list included, so a parent with no children resolves
// to [] instead of undefined.
export function groupByKey<K, T>(
    keys: K[],
    items: T[],
    keyOf: (item: T) => K | null | undefined,
): Map<K, T[]> {
    const grouped = new Map<K, T[]>();
    keys.forEach((key) => grouped.set(key, []));
    items.forEach((item) => {
        const key = keyOf(item);
        if (key === null || key === undefined) return;
        const group = grouped.get(key);
        if (group) group.push(item);
    });
    return grouped;
}

// ── Generic resolve-field helpers ────────────────────────────────────────────
// Almost every N+1 resolve-field is one of two shapes. These wrap the loader
// above so a field body is a single call rather than a hand-rolled
// getRequestLoader/createBatchLoader block, and so the fix is expressed once
// instead of pasted across ~50 fields. A field keeps its own `name` (unique per
// type+field, e.g. 'OrderSale.account') so its loader is isolated on the request
// context — except audit users, which deliberately SHARE one name across every
// type so a page's created_by + updated_by collapse into a single users query.

// to-one-by-FK: the parent carries a foreign key; return the referenced row, or
// null when the key is absent or nothing matches. `batchFn` receives the deduped,
// non-null keys and returns the rows in any order; `keyOf` maps a row back to the
// key it answers so the batch can be indexed.
export async function toOne<K, V>(
    context: LoaderContext,
    name: string,
    key: K | null | undefined,
    batchFn: (keys: K[]) => Promise<V[]>,
    keyOf: (value: V) => K,
): Promise<V | null> {
    if (key === null || key === undefined) return null;
    const loader = getRequestLoader<K, V>(context, name, () =>
        createBatchLoader<K, V>(async (keys) => {
            const rows = await batchFn(keys);
            const byKey = new Map<K, V>();
            for (const row of rows) byKey.set(keyOf(row), row);
            return byKey;
        }),
    );
    return (await loader.load(key)) ?? null;
}

// to-many-by-parent-id: return the children whose foreign key points back to this
// parent id — [] when none. `batchFn` receives the parent ids and returns a FLAT
// child list; `parentKeyOf` maps each child to the parent id it belongs under, and
// groupByKey folds the flat list into one list per requested id.
export async function toMany<K, C>(
    context: LoaderContext,
    name: string,
    parentId: K,
    batchFn: (keys: K[]) => Promise<C[]>,
    parentKeyOf: (child: C) => K | null | undefined,
): Promise<C[]> {
    const loader = getRequestLoader<K, C[]>(context, name, () =>
        createBatchLoader<K, C[]>(async (keys) => {
            const rows = await batchFn(keys);
            return groupByKey(keys, rows, parentKeyOf);
        }),
    );
    return (await loader.load(parentId)) ?? [];
}
```

## Usage — the two field shapes

to-one (parent carries the FK):

```ts
@ResolveField(() => Account, { nullable: true })
account(
    @Parent() orderQuotation: OrderQuotation,
    @Context() ctx: LoaderContext,
): Promise<Account | null> {
    return toOne(
        ctx,
        'OrderQuotation.account',
        orderQuotation.account_id,
        (ids) => this.service.getAccountsByIds(ids),
        (a) => a.id,
    );
}
```

to-many (children point back at the parent id):

```ts
@ResolveField(() => [AccountProduct])
account_products(
    @Parent() account: Account,
    @Context() ctx: LoaderContext,
): Promise<AccountProduct[]> {
    return toMany(
        ctx,
        'Account.account_products',
        account.id,
        (ids) => this.service.getAccountProductsByAccountIds(ids),
        (p) => p.account_id,
    );
}
```

## Gotchas worth carrying into the rebuild

- **The cache stores promises, rejections included.** If `batchFn` throws, every
  key in that batch rejects and those rejected promises stay cached — a re-`load`
  of the same key returns the rejection, not a retry. One poison key fails the
  whole batch. (Same as `dataloader`; fine because the loader dies with the request.)
- **In `toOne`/`toMany`, only the first call's `batchFn`/`keyOf` win.** `getRequestLoader`
  memoizes by `name` and runs `create()` once per request; later calls pass their
  own closures, which are silently ignored. Harmless while they're identical per
  field — a real trap if the same `name` ever maps to two different batch functions.
- **`name` is load-bearing and unchecked** (`existing as BatchLoader<K,V>`). Two
  fields sharing a `name` share a loader and cache — a bug by accident, the
  audit-user single-query collapse on purpose. Same mechanism, opposite intent.
- **`groupByKey` pre-seeds every key with `[]`**, and `toOne` returns `?? null`,
  so a parent with no match resolves to `[]`/`null` instead of `undefined`.
