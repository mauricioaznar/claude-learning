# Ex 3 review — pending todos

Review of the `auth` middleware + `GET /api/me`. The core works: the guard reads
the Bearer header, `verifyToken`s it, sets `req.user`, and `/api/me` renders from
it. These are the open items, roughly worst-first. Delete this file once burned down.

## 1. Logout doesn't drop the token — Ex 3's whole point is missing
`src/client/app.ts` logout handler still has the `TODO(phase-1)` and never clears
`accessToken`. Symptom: click "Log out", land on `/login`, but `render()` →
`fetchMe()` still sends the (valid, ~10s) token, `/api/me` returns the user, and
you bounce straight back to `/dashboard`. Ex 3's logout *is* "client drops the
token" — set `accessToken = null` in the handler. This is the one real functional
gap.

## 2. `/api/me` handler is inline in server.ts — breaks "server.ts is config only"
The route body lives in `server.ts` (`app.use('/api/me', authMiddleware, (req,res)=>…)`).
Project convention: server.ts wires things, holds no route logic. Move the handler
into a route module (e.g. `routes/me.ts` or a resource router) and mount it, the
same way `authRouter` is mounted.

## 3. `/api/me` strips `expireAt` by blacklist (`expireAt: undefined`)
`{ ...req.user, expireAt: undefined }` relies on JSON dropping `undefined` keys to
hide `expireAt`. It works, but a blacklist leaks by default — the next field added
to the payload ships to the client unless you remember to null it. Prefer an
explicit whitelist of client-facing fields (`displayName`, `username`, `userId`).

## 4. `authFetch` sends `Bearer null` when there's no token
On first load `accessToken` is null, so `fetchMe` sends `Authorization: Bearer null`.
It fails closed (verifyToken rejects → 401 → login view), so it's harmless, but it's
a garbage header. Attach the Authorization header only when a token exists.

## 5. Middleware doesn't validate the `Bearer ` scheme
`authorizationHeader.replace('Bearer ', '')` silently no-ops on a malformed header
(wrong scheme, no prefix) and passes the whole string to `verifyToken`. Fine as a
fail-closed path, but consider rejecting when the header doesn't start with
`Bearer ` so the failure is explicit.

## 6. `/api/me` is mounted with `app.use` (all methods, prefix match)
`app.use('/api/me', …)` also answers `POST /api/me` and `/api/me/anything`. For a
single GET resource, `app.get('/api/me', …)` (or a router with `.get('/')`) is
tighter.

## 7. Logout POSTs to `/api/auth/logout`, which doesn't exist
Hits the `/api` 404 net → 404. Harmless (the client ignores the response) and a
server-side logout only matters once there's a session to revoke (Phase 2). For now
either drop the fetch or leave a note that it's a placeholder.

## 8. Verify
- `npx tsc --noEmit -p tsconfig.server.json` clean.
- Valid token → `/api/me` returns the user; missing/tampered/expired → 401 and the
  client falls back to login.
- After fixing #1: logout actually strands you on `/login`.
