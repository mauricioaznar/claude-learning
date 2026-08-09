# Cookie auth lab — progress

## Exercise 1 — set a cookie on login ✅
Generate a random session ID, store `id → user.id` in a module-scope Map, send it
with `res.cookie()` using `httpOnly`, `sameSite`, and `maxAge`.

## Exercise 2 — read the cookie back ✅
Parse cookies with `cookie-parser`, look the session up, return the user without
the password. 401 both when the cookie is missing and when the session is unknown.

## Exercise 3 — log out ✅
- [x] `res.sendStatus(204)` — `res.status(204)` alone never sends, the request hangs
- [x] `res.clearCookie("session_id", ...)` — first arg is the name, not the value
- [x] `SESSION_MAP.delete(sessionId)` — this is the actual revocation

## Exercise 4 — expire sessions server-side ⬜
`maxAge` only tells the *browser* to forget the cookie. The Map entry lives forever,
so a copied session ID works indefinitely and the Map grows without bound.

- [ ] Store `{ userId, expiresAt }` instead of a bare user ID
- [ ] On lookup, treat an expired session as invalid and delete it (lazy expiry)
- [ ] Add a periodic sweep for sessions nobody ever revisits (eager expiry)
- [ ] Keep the cookie's `maxAge` in sync with the server's expiry

## Exercise 5 — auth middleware + a protected route ⬜
The session lookup is currently inlined in `/api/me`. Add a second protected route
and you'd copy-paste it.

- [ ] Extract the lookup into middleware that sets `req.user`, or 401s
- [ ] Add `/api/secret` and guard it with that middleware
- [ ] Confirm the guard runs on the server, not in the client router

## Exercise 6 — persist sessions in MySQL ⬜
The point isn't SQL, it's that swapping the Map for a table barely changes the
route code — `.get()` becomes a query and everything turns async.

- [ ] `sessions` table: id, user_id, expires_at, absolute_expires_at
- [ ] Store `expires_at` as BIGINT epoch ms (no timezone to get wrong)
- [ ] Always use `?` placeholders, never string concatenation — SQL injection
- [ ] Sessions now survive restarts, and cleanup is one DELETE query

## Exercise 7 — signed cookies ⬜
The bridge to tokens. `cookie-parser` can attach a signature so the server detects
tampering. Sit with what that implies: if the server can verify a value it never
stored, it doesn't need to look anything up. That is JWT in miniature.

- [ ] Sign the session cookie and try editing it in DevTools
- [ ] Watch the signature check reject the modified value

## Then — access tokens + refresh tokens
- A **refresh token** is basically the session already built here: long-lived,
  stored server-side, revocable by deleting it.
- An **access token** is the new idea: short-lived and self-contained, checked by
  signature instead of a lookup. No database round trip per request.
- The reason both exist: a self-contained token can't be revoked, so you make it
  expire in minutes and back it with something that can.

Reference vs self-contained is the fork. A session ID is a coat-check ticket;
a JWT is a signed passport.

Note: for a browser SPA like this one, cookie sessions are usually the better
choice. Tokens matter for mobile apps, third-party API access, and services that
can't share a session store.

## Ideas beyond the lab
- Hash passwords with bcrypt/argon2 instead of storing plaintext
- Rotate the session ID on login (prevents session fixation)
- Move sessions to Redis so they survive restarts and expire via native TTL
- Idle timeout (resets on activity) vs absolute timeout (fixed at login) — enforce both

## Things that keep biting
- Saving a file restarts `node --watch`, which wipes the Map — you get logged out
- `res.cookie()` must come before `res.json()`; headers are sent before the body
- Anything the browser enforces (`maxAge`, `httpOnly`, `sameSite`) is advisory —
  `curl` ignores all of it. Only server-side checks are real.
