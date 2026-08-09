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

### 4 — expire sessions server-side 🚧
`maxAge` only tells the *browser* to forget the cookie, so the Map entry outlived it
and a copied session ID worked forever.

The session value became `{ id, expireAt, absoluteExpireAt }`. `expireAt` slides
forward on every request (idle timeout), `absoluteExpireAt` is fixed at login and
caps the total lifetime. Expired sessions are deleted on lookup and answer 401.
The refreshed cookie carries the same `maxAge` so both clocks stay in step.

- [x] Periodic sweep for sessions nobody ever returns to. Lazy deletion only cleans
      up sessions someone comes back for, so abandoned ones accumulate. The sweep
      only reclaims memory — `/api/me` is what enforces expiry — which is exactly
      why its interval can be tuned freely on cost. If it were the enforcement
      point, a 60s interval would be a 60s window for accepting dead sessions.
- [ ] **Open: cap the two clocks against the absolute deadline.** Sliding expiry
      pushes `expireAt` forward with no ceiling, so it can end up past
      `absoluteExpireAt`, and the cookie's `Max-Age` can outlive the session by
      most of its length. The capped deadline should be computed **once** as an
      instant; the cookie's duration is then derived from it by subtraction.
      Currently the cap is written but unreachable — see the last two failures.

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

**`Date.now() * MAX_AGE` instead of `+`.** Produced a timestamp so large that
`new Date()` couldn't even render it — roughly 1.7 million years out. The
comparison still ran, it was just always false, so nothing ever expired and the
app behaved exactly as before. Arithmetic on timestamps fails silently. Naming
helped hide it: the field was called `absoluteMaxAge` but held an *instant*, and
next to a duration constant `*` looked as plausible as `+`. Durations get
`MAX_AGE` names, instants get `expiresAt` names.

**Expiry check deleted the session but didn't `return`.** Execution fell through,
the local `session` variable was still in scope, and the code below issued a fresh
session — deleting the expired one and immediately replacing it. Every rejection
path has to both stop and respond.

**Rotated the session ID on every request.** Meant as sliding expiry, but it
creates a race: two requests in flight both carry the old ID, the first deletes it,
and the second gets a spurious 401. Sliding expiry only needs the stored
`expireAt` pushed forward — the object in the Map can be mutated in place. Rotation
is a real technique, but it belongs at login, to prevent session fixation.

**Wrote `session.expiresAt` while everything else read `expireAt`.** JavaScript
happily created a second property. No error, and sliding expiry silently did
nothing. The kind of bug TypeScript catches on sight.

**Left `newSessionId` referenced after deleting the code that defined it.** 500 on
every successful `/api/me`. The loud counterpart to the silent typo above — both
were one-word mistakes, but only one announced itself.

**Re-sent the cookie without `maxAge`.** Re-sending replaces the cookie outright,
so the omitted field turned a 10-second persistent cookie into a session cookie
that lives until the browser closes — the opposite of keeping the two clocks in
sync. `curl` exposed it faster than a browser would: its jar file only stores
persistent cookies, so the cookie vanished between requests and every call 401'd.

**`SESSION_MAP[key]` instead of `SESSION_MAP.get(key)`.** Threw a TypeError inside a
`setInterval` callback, which nothing catches, so it killed the whole process — the
server was simply gone two seconds after a login. A `Map` keeps its entries in an
internal slot, not as object properties, so bracket access finds nothing and returns
`undefined`. The write direction is worse: `map[key] = v` silently creates a real
property that `.get`, `.size`, and iteration all ignore.

**`app.listen(...).close(cb)` chained in one expression.** Meant as "clean up when the
server closes", but `.close()` is a call, not a subscription — it ran immediately and
shut the server down before it finished coming up. The process exited with code **0**
and printed nothing at all, not even the startup URL, because the `listen` callback
never fired. A successful exit is a nastier symptom than a crash.

**`app.close()` in the SIGTERM handler.** `app` is the request handler; `app.listen()`
returns the `http.Server`. Only the server owns the socket, so only the server has
`close`. Lived in a branch that never runs in development — found only by actually
sending the signal.

**Compared a duration to an instant: `SHORT_MAX_AGE >= session.absoluteExpireAt`.**
`10000` versus `1786298953000`. Always false, so both branches of the new cap were
unreachable and the feature did nothing. The naming rule from the last round —
durations get `MAX_AGE` names, instants get `expiresAt` names — was already written
down, and both names were sitting on opposite sides of the same operator.

**Operator precedence: `Date.now() + flag ? a : b`.** `+` binds tighter than `?:`, so
the condition tested is `Date.now() + flag`, which is always truthy — one branch is
dead. Silent again: sessions still expired, just always on the absolute deadline, so
the idle timeout quietly stopped existing. Only visible by pinning the cookie by hand
and timing the status codes.

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

**Two kinds of timeout, and real systems want both.** An *idle* timeout resets on
activity, so working users aren't interrupted. An *absolute* timeout is fixed at
login and can't be extended — without it, a stolen session ID stays alive forever
just by being used.

**Session cookie vs persistent cookie.** No `Max-Age` or `Expires` means the
browser keeps it in memory and drops it when the window closes. With one, it goes
to disk and survives a restart. Re-sending a cookie replaces the whole thing, so
any option left out is lost.

**Timestamps fail quietly.** Bad date arithmetic doesn't crash, it just produces a
comparison that never fires. Test expiry with seconds-long timeouts and watch the
status codes; you cannot see this by reading the code.

**Map keys vs object keys.** Object property keys can only be strings or symbols;
anything else is coerced, so two different objects both become `"[object Object]"`
and collide into one slot. Map keys can be any value and are compared by identity —
`map.get({a:1})` misses an entry stored under a structurally identical object. Maps
also keep insertion order and give `.size` in constant time.

**Lazy expiry and the sweep answer different questions.** Lazy deletion on read is
what *enforces* expiry; the periodic sweep only reclaims memory from sessions nobody
returns to. Keep both, and never let the security property depend on the sweep's
interval — that interval is a performance knob.

**Signals.** `SIGTERM` is a polite "shut down" request from `kill`, Docker, systemd.
You can catch it and drain: stop accepting connections, finish in-flight requests,
close the pools, exit. `SIGINT` is `Ctrl-C`. `SIGKILL` (`kill -9`) cannot be caught.
Orchestrators send SIGTERM, wait ~30s, then SIGKILL — so anything keeping the event
loop alive, like a pending `setInterval`, is what stops you exiting in that window.
`clearInterval` on shutdown is explicit; `timer.unref()` is the blunt version that
just stops the timer counting as a reason to stay running.

## Things that keep biting

- Saving a file restarts `node --watch`, which wipes the Map — you get logged out
- `express.json()` only parses when the request has `Content-Type: application/json`
- Verify with `curl -i`, not the browser. Several bugs above looked fine in the UI.
