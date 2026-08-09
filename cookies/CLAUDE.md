# Cookie auth lab

Express + a small SPA, used to learn cookie-based sessions from scratch.
`npm run dev` in this folder, then http://localhost:3000. Log in with `mau` / `hunter2`.

Sessions live in an in-memory `Map` on purpose — replacing it is Exercise 6.

## Exercises

### 1 — set a cookie on login ✅
Generate a random session ID, store `id → user.id` in a module-scope Map, send it
with `res.cookie()` using `httpOnly`, `sameSite`, and `maxAge`.

### 2 — read the cookie back ✅
Parse cookies with `cookie-parser`, look the session up, return the user without
the password. 401 both when the cookie is missing and when the session is unknown.

### 3 — log out ✅
Delete the session from the Map (the actual revocation), clear the cookie
(housekeeping), respond 204.

### 4 — expire sessions server-side ⬜
`maxAge` only tells the *browser* to forget the cookie. The Map entry lives forever,
so a copied session ID works indefinitely and the Map grows without bound.

- [ ] Store `{ userId, expiresAt }` instead of a bare user ID
- [ ] On lookup, treat an expired session as invalid and delete it (lazy expiry)
- [ ] Add a periodic sweep for sessions nobody ever revisits (eager expiry)
- [ ] Keep the cookie's `maxAge` in sync with the server's expiry
- [ ] Consider idle timeout (resets on activity) plus an absolute cap

### 5 — auth middleware + a protected route ⬜
The session lookup is currently inlined in `/api/me`. Add a second protected route
and you'd copy-paste it.

- [ ] Extract the lookup into middleware that sets `req.user`, or 401s
- [ ] Add `/api/secret` and guard it with that middleware

### 6 — persist sessions in MySQL ⬜
The point isn't SQL, it's that swapping the Map for a table barely changes the
route code — `.get()` becomes a query and everything turns async.

- [ ] `sessions` table: id, user_id, expires_at, absolute_expires_at
- [ ] Store `expires_at` as BIGINT epoch ms (no timezone to get wrong)
- [ ] Always use `?` placeholders, never string concatenation — SQL injection
- [ ] Sessions now survive restarts, and cleanup is one DELETE query

### 7 — signed cookies ⬜
The bridge to tokens. `cookie-parser` can attach a signature so the server detects
tampering. Sit with what that implies: if the server can verify a value it never
stored, it doesn't need to look anything up. That is JWT in miniature.

- [ ] Sign the session cookie and try editing it in DevTools
- [ ] Watch the signature check reject the modified value

### Then — access tokens + refresh tokens
A **refresh token** is basically the session already built here: long-lived, stored
server-side, revocable by deleting it. An **access token** is the new idea:
short-lived and self-contained, checked by signature instead of a lookup.

Both exist because a self-contained token can't be revoked — so you make it expire
in minutes and back it with something that can. Reference vs self-contained is the
fork: a session ID is a coat-check ticket, a JWT is a signed passport.

For a browser SPA like this one, cookie sessions are usually the better choice.
Tokens matter for mobile apps, third-party API access, and services that can't
share a session store.

## Failures

**`crypto.createSecretKey()` used as a session ID.** Cookie went out as `j:{}` —
an empty object. It builds a key for encryption, not a random string, and it's
derived from its input so every login produced the same value. Worse, a `KeyObject`
used as a Map key can never be matched by the string arriving in a cookie, since
Map compares objects by reference. Fix: `crypto.randomUUID()`. Session IDs must be
**random** (so they can't be derived) and **strings** (so lookups work).

**Response shape disagreed with the client.** Server returned `{user:{...}}`, the
SPA read `user.displayName` off the wrapper and got `undefined` — and because the
wrapper is truthy, it rendered a broken dashboard instead of redirecting. Two
correct halves that disagreed on shape. Pick one and make both ends match.

**`res.clearCookie(sessionId)` passed the value, not the name.** Sent
`Set-Cookie: 3906f68b-...=;` for a cookie that never existed, while the real
`session_id` survived in the browser. **Invisible from the UI** — the app still
redirected to login because the Map delete worked. Only the raw headers showed it.

**`res.status(204)` with nothing after it.** `status()` sets, it doesn't send. The
request hung until timeout, so `await fetch(...)` never resolved and the logout
button appeared completely dead. Fix: `res.sendStatus(204)`. Every path through a
handler must reach a sender exactly once.

**`res.status(204).json("...")` silently dropped the body.** 204 means no content,
so Express discarded the string without warning.

**`res.cookie()` called after `res.json()`.** Headers go out before the body, so
once you send, they're frozen and the `Set-Cookie` never appeared. All header work
comes first.

**`!SESSION_MAP.get(id)` as an existence check.** Tests whether the *value* is
truthy, so a user with `id: 0` would be rejected despite a valid session. Use
`.has()` — ask the question you actually mean.

**`res.user(401)` instead of `res.status(401)`.** Typo in a branch that almost
never runs, which is exactly why it would have sat there undetected.

## Learnings

**HTTP is stateless.** Every request arrives with no memory of the last one. A
session is just server-side memory plus a reference the browser carries back.

**The cookie holds a reference, not data.** Store a random ID and keep the user
mapping on the server. Put `user=mau` in a cookie and anyone can edit it to
`user=admin` in DevTools.

**The browser sends the cookie back by itself.** No client code. You never
regenerate a session ID — you issue it once and the browser returns it.

**Anything the browser enforces is advisory.** `maxAge`, `httpOnly`, and
`sameSite` are instructions to the browser. `curl` ignores all of them. Only
server-side checks are real — which is why deleting the session, not clearing the
cookie, is what actually logs someone out.

**The flags cover different attacks.** `httpOnly` stops JavaScript *reading* the
cookie (theft via XSS). `sameSite` stops the browser *sending* it cross-site
(CSRF — where the attacker never reads it, just borrows your browser's authority).
`Secure` restricts it to HTTPS. None substitutes for another.

**Client-side routing is UX, not security.** The server hands `index.html` to
anyone; the SPA then asks `/api/me` who they are. Protect data, not pages — every
protected endpoint guards itself.

**Setting vs sending.** `res.status()` and `res.set()` configure; `res.send()`,
`res.json()`, `res.end()`, and `res.sendFile()` transmit.

**Status codes.** 204 means "success, no body" — not "nothing happened". 401 means
"authenticate and retry", which is odd advice for logout.

**`express.static` is middleware that only sometimes responds.** It runs on every
request but calls `next()` when no file matches, which is why it must come before
the routes.

**`fetch` doesn't throw on 4xx/5xx.** Only on network failure. Always check
`res.ok`.

## Things that keep biting

- Saving a file restarts `node --watch`, which wipes the Map — you get logged out
- `express.json()` only parses when the request has `Content-Type: application/json`
- Verify with `curl -i`, not the browser. Several bugs above looked fine in the UI.
