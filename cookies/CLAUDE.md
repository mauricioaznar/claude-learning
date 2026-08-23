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

### 4 — expire sessions server-side ✅
`maxAge` only tells the *browser* to forget the cookie, so the Map entry outlived it
and a copied session ID worked forever.

The session value became `{ id, expireAt, absoluteExpireAt }`. `expireAt` slides
forward on every request (idle timeout), `absoluteExpireAt` is fixed at login and
caps the total lifetime. Expired sessions are deleted on lookup and answer 401.
The refreshed cookie's `maxAge` is derived from the capped deadline, so both clocks
stay in step and neither can outlive the absolute limit.

- [x] Periodic sweep for sessions nobody ever returns to. Lazy deletion only cleans
      up sessions someone comes back for, so abandoned ones accumulate. The sweep
      only reclaims memory — `/api/me` is what enforces expiry — which is exactly
      why its interval can be tuned freely on cost. If it were the enforcement
      point, a 60s interval would be a 60s window for accepting dead sessions.
- [x] Cap the two clocks against the absolute deadline. Sliding expiry pushed
      `expireAt` forward with no ceiling, so it could end up past
      `absoluteExpireAt` and the cookie's `Max-Age` could outlive the session.
      Landed as `Math.min(now + SHORT_MAX_AGE, session.absoluteExpireAt)` — one
      instant computed once, stored as `expireAt`, with the cookie's duration
      derived from it by subtraction. The `if/else` disappeared: the cap *is*
      `Math.min`, once both operands are instants.

Carried into 5 — closed on the behaviour, not on the structure:
`Date.now()` is still called several times per request, so the guard and the
arithmetic reason about different instants; capture one `now` at the top. The
deadline variable is named `candidate`, which doesn't say instant. And login
computes its deadline without the cap, so the rule lives in two places.

### 5 — auth middleware + a protected route ✅
The session lookup is currently inlined in `/api/me`. Add a second protected route
and you'd copy-paste it.

A middleware is `(req, res, next)`. It has exactly two legal endings: respond and
stop, or call `next()` and send nothing. Doing both throws, doing neither hangs the
request. It has no return value — it communicates by mutating `req`, which is all
`express.json()` and `cookieParser()` ever did to give you `req.body` and
`req.cookies`.

Decisions made, with the reasoning:

- **Attach a *sanitized* user, not the raw one.** `USERS` entries carry
  `password`, so attaching the raw object leaves every downstream route one
  `res.json(req.user)` from leaking it. Sanitize once at the boundary and no route
  *can* make that mistake. Not about mutation — `findUserById` returns a live
  reference either way, so that risk is symmetric and can't be the deciding factor.
- **Don't attach the session.** Not a token leak (the session id is the Map *key*,
  not the value); simply nothing downstream needs `expireAt`. Attach the smallest
  thing the consumer needs.
- **The sliding refresh moves into the middleware.** `/api/me` was a query with
  hidden side effects — *command-query separation*: a function should either do
  something or answer something. Consequence to remember: "activity" now means any
  authenticated request, so a polling SPA slides its own deadline forever and the
  idle timeout stops meaning anything.
- **401, not 403.** 401 = "I don't know who you are, authenticate and retry" (the
  name "Unauthorized" is a historical mistake). 403 = "I know who you are, you
  still can't have this" — that arrives with roles. There is no status for
  "expired"; the code tells the client *what to do*, and missing-cookie and
  expired-session both mean go log in again. Detail goes in the body.
- **Logout stays outside the middleware.** Not about cost. Logout must be
  *idempotent* — dead session, missing cookie, or called twice should all end the
  same way: no session, no cookie, success. Guard it with a middleware whose job is
  to 401 on invalid sessions and a user whose session expired while the laptop slept
  gets an error for a thing that already succeeded. There's also a mechanical
  conflict: the middleware issues a `Set-Cookie` to slide, logout issues one to
  clear, and which wins depends on header order.

- [x] Extract the lookup into middleware that sets `req.user`, or 401s
- [x] Fix the two `ReferenceError`s — login uses `userSessionId`, middleware uses
      `cookieValueUUID` consistently now
- [x] Add `/api/secret` and guard it with that middleware
- [x] Logout: 204 for both paths (revoked a session, or nothing to revoke). Both are
      successes with no body, which makes them identical to the caller — idempotent.
- [x] Share the cookie options with both `clearCookie` calls — extracted
      `getCookiesOptions()` so set and clear use the same attributes
- [x] Guard clause on the duration: throws if `<= 0` or `>= oneDay`, turning
      the instant-as-duration mistake from a silent 56-year cookie into a crash
- [x] One `now` at the top of login — four `Date.now()` calls collapsed to one

Settled: two-instants signature `(res, cookieValue, start, end)` with a guard
clause that throws on non-positive or absurdly large durations. Cookie options
shared via `getCookiesOptions()` so set and clear can't drift apart. The helper
stays a pure output function — it doesn't own the session invariant.

### 6 — persist sessions in MySQL ✅
The point isn't SQL, it's that swapping the Map for a table barely changes the
route code — `.get()` becomes a query and everything turns async.

- [x] `sessions` table: id, user_id, expires_at, absolute_expires_at (schema.sql,
      read and run on boot). Store `expires_at`/`absolute_expires_at` as BIGINT
      epoch ms (no timezone to get wrong)
- [x] `mysql2` promise pool in `db.js`; config via `--env-file`; `pool.end()` on
      shutdown. Always `?` placeholders, array params — never concatenation
- [x] Substitute each `SESSION_MAP` call with DML: login `INSERT`, `auth`
      (SELECT + slide UPDATE; DELETE + 401 on expiry), logout `DELETE`
      (idempotent), sweep `DELETE WHERE expire_at <= ?` inside a try/catch so a
      rejection in the timer can't kill the process
- [x] Global error handler: everything here is 500, log server-side, generic body
      (no `err.message` to the client) — every async query rejection forwards to it.
      `err.status || 500` default, `console.error(err)`, `return` on the 500 branch
      (generic body), `err.message` only for 4xx. Note for later: it logs every
      error, but only 500s reach it today (expected cases are handled inline). Once
      4xx get thrown in, move the log inside the `>= 500` branch so routine client
      mistakes don't spam the error log.
- [x] Sessions now survive restarts (login → kill node → restart → same cookie
      still 200 on a protected route) — confirmed

Deferred to the end of this exercise:
- [x] Reusable `cleanUp()` shared by SIGTERM **and** SIGINT — Ctrl-C drains too.
      One function: `server.close` → `clearInterval` → `pool.end`; both signals
      pass it directly (no wrapper, no bogus `err` param)
- [x] Move `USERS` into MySQL. `users` table (username UNIQUE, displayName,
      password), seeded idempotently with `INSERT IGNORE`, `sessions.user_id` now a
      real FK with `ON DELETE CASCADE`. `findUser`/`findUserById` are SELECTs
      returning `rows[0] ?? null`; every caller awaits. Verified end-to-end (login
      → `/api/me` → restart) — all green.

### 7 — signed cookies ✅
The bridge to tokens. `cookie-parser` can attach a signature so the server detects
tampering. Sit with what that implies: if the server can verify a value it never
stored, it doesn't need to look anything up. That is JWT in miniature.

- [x] Sign the session cookie and try editing it in DevTools
- [x] Watch the signature check reject the modified value — edit one char, `/api/me`
      returns 401

Signing and statelessness are **orthogonal**. Signing (HMAC) answers *did the
server issue this exact value, unmodified?* — it says nothing about what the value
carries. This exercise did only the signing move, on the value we already had (the
session UUID); the table stayed. Putting the payload *into* the cookie and dropping
the lookup is the separate next move — safe only *because* signing exists.

Three touch points, and the trap is the count: **one write, two reads.** The write
(`getCookiesOptions` → `signed: true`) is shared, so one change covered it. But the
reads had to move buckets: a verified signed cookie no longer lands in `req.cookies`
— it lands in `req.signedCookies`, already stripped of `s:` and verified. Missing
the second read (logout) is how this bites. You never parse the `s:uuid.sig`
structure yourself; passing the secret to `cookieParser()` makes it verify-then-
unwrap for you, returning the raw value, or `false` on a bad signature (falsy, so
the existing `if (!value)` 401s a forgery for free).

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

### Finally — 404 handler + request id ⬜
Deliberately deferred to the very end (after tokens), because it only pays off once
the error handler funnel is solid.
- [ ] A 404 isn't a thrown error — Express just runs out of handlers. Catch it with
      a terminal path-less middleware placed **after** all routes and **before** the
      4-arg error handler. Either respond 404 directly, or `next(err)` with
      `err.status = 404` to funnel it through the same handler.
- [ ] Ordering gotcha: `/*splat` already matches every GET (serves index.html), so a
      404 catcher after it only fires for non-GET methods. To 404 unknown `/api/*` as
      JSON, scope the catcher to `/api` and put it **before** the SPA fallback.
- [ ] Request id: assign `req.id = req.get("X-Request-Id") ?? crypto.randomUUID()`
      early, echo it in a response header, log it with `console.error(req.id, err)`,
      and return it in the 500 body — it's the safe bridge between the generic client
      message and the detailed server log.

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

**Called `findUser(userId)` when `findUserById(userId)` was meant.** One-arg call to a
two-arg function, so `password` was `undefined` and the lookup always missed. That made
`!user` always true — and `!user` sat in the *rejection* branch, which deletes the
session and clears the cookie. So every authenticated request destroyed the session it
had just validated: log in, get bounced straight back to login. Two finder functions
whose names differ by two characters and whose arities differ silently.

**`Math.Min`.** Capital M, doesn't exist, `TypeError: not a function` — but it sat
*behind* the `findUser` bug, which returned 401 before execution ever reached it. A
loud crash hidden by a silent wrong answer. Fixing one bug and immediately hitting
another is normal; it isn't evidence the first fix was wrong.

**`userSessionId` referenced inside the middleware — twice.** It's login's variable;
the middleware's is `cookieValueUUID`. 500 on every authenticated request. Same failure
as `newSessionId` further down, now three occurrences.

**`setCookie(res, userSessionId, SESSION_MAP)`.** Passed the entire session Map as the
`maxAge` duration. The `cookie` library validates it and throws, so login 500s. The
parameter was *named* `duration` and nothing objected until runtime — wrapping the
conversion in a function put the kind confusion behind a positional argument, where
it's less visible than it was inline. A helper centralises a mistake; it doesn't
prevent it.

**All four of the above came from accepting an IDE completion.** Autocomplete offers
what's *plausible* in a slot, not what's correct — `userSessionId` because the other
call site passes it, `SESSION_MAP` because it was the nearest identifier shaped like an
argument. Aimed exactly at the one thing this codebase has no defence against, since
JavaScript can't tell an instant from a duration or a Map from a number. Read the
arguments after pressing Tab.

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

**`SESSION_MAP.keys().forEach(...)` in the sweep.** `.keys()` returns a MapIterator, a
one-shot cursor with `.next()` — not an array — so it has no `.forEach`, and the call
threw. Because it lived in a `setInterval` nothing caught it, and the throw killed the
whole process ~15s after startup. Third sighting of "an uncaught throw in a timer takes
the server down" (see `SESSION_MAP[key]` and `.close()`). Fix: `Array.from(...)` to
materialise an array, or skip `.keys()` entirely — `Map` has its own `.forEach((value,
key) => …)`. An iterator is a cursor, not a collection; array methods live on
`Array.prototype`.

**`res.status(204)` without a sender — again.** Second occurrence, this time in the
logout idempotency path. Same bug as Exercise 3's `res.status(204)` that hung the
request until timeout. `status()` sets, it doesn't send — `sendStatus(204)` or
`.status(204).send()` is what actually transmits.

**`findUser` selected `username, displayName` but not `id`, and login inserts
`user.id` into `sessions.user_id`.** So the bind param was `undefined`. mysql2
rejects `undefined` outright (`Bind parameters must not contain undefined`), so
login threw → the error handler turned it into a 500. A SELECT's column list is a
contract with everything downstream that reads the row; login needed `id` and the
query silently didn't provide it. Not a null in the DB — a crash before the query
ran.

**`delete * from sessions`.** Copied the `SELECT *` shape into a DELETE, which has
no column list — invalid SQL. It sat inside the sweep's `try/catch`, so it threw
every 15s and only logged; the sweep silently reclaimed nothing. Caught by reading
it next to the valid `DELETE` in logout. The try/catch that (correctly) keeps a
timer rejection from killing the process also hides a permanently broken query —
a swallowed error is invisible until you check the logs.

**Sweep comparison inverted: `expire_at >= now`.** Selected the sessions still in
the *future* (valid) and spared the expired ones — it would have reaped exactly
what it should keep. `<= now` is "already past its deadline." Same class as the
Exercise 4 duration/instant mixups: an operator pointed the wrong way against a
timestamp, silently doing the opposite of the intent.

**`autoincrement` in the schema.** SQLite's spelling; MySQL is `AUTO_INCREMENT`.
Syntax error on the first statement, and since `schema.sql` runs top-to-bottom on
boot, nothing after it ran either — one wrong keyword took out the whole file.

**`getCookie()` read `req` with no `req` in scope.** Extracted the signed-cookie
read into a helper but wrote it as `function getCookie() { return
req.signedCookies[...] }` — `req` isn't a parameter and isn't module-scoped, so it
threw `ReferenceError` → 500 on every call site. Fourth sighting of the same family
(`newSessionId`, `userSessionId` ×2): referencing a name that isn't in scope. A
plain helper sees nothing of the request unless you hand it in — `setCookie`/
`clearCookie` take `res` for exactly this reason. Fix: `getCookie(req)`.

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

**`Secure` is the bug the browser hides and `curl` catches.** It means "only send this
over HTTPS", but browsers treat `localhost` as a trustworthy origin and keep sending it
over http anyway — so it looks fine in DevTools. `curl` special-cases nothing: the jar
records the flag and refuses to send the cookie over http, and every request after
login 401s. Ship `Secure` in production; the actual mistake was setting it on one of
the two writes of the same cookie and not the other.

**`Math.min` has the same precondition `>=` does.** Both mean "earlier" only when
both operands are the same kind. `Math.min(duration, instant)` returns the duration
every time — 10,000 is always smaller than 1.786e12 — so the cap silently inverts
instead of erroring. Changing the operator never fixes a kind mismatch; making both
sides instants is what fixes it.

**One `now` per request.** Reading `Date.now()` twice means comparing two different
instants. Usually that's sub-millisecond noise, but when the guard that proves a
value is positive and the subtraction that uses it read the clock separately, a
deadline can fall between them and produce a negative `Max-Age` — which tells the
browser to delete the cookie. Capturing `now` once turns a rare race into an
impossible one.

**Lazy expiry and the sweep answer different questions.** Lazy deletion on read is
what *enforces* expiry; the periodic sweep only reclaims memory from sessions nobody
returns to. Keep both, and never let the security property depend on the sweep's
interval — that interval is a performance knob.

**A function's contract is preconditions + postconditions.** What it demands of
callers, and what it guarantees in return. Most contracts are implicit — true but
checked by nothing. A guard clause makes a precondition explicit by throwing on
violation, converting a silent wrong answer into a loud crash. The best guard
clauses cover failure modes where the wrong input is the same type as the right
one — an instant where a duration belongs is still a number, but the gap between
any reasonable duration (~10k ms) and any timestamp (~1.7 trillion) is so wide
that a ceiling like one day catches it reliably.

**Centralise cookie attributes.** If set and clear don't share the same options
object, adding `Secure` or a `path` to the setter and forgetting the clear
produces a cookie that survives logout — invisible from the UI, exactly like the
`clearCookie(sessionId)` bug from Exercise 3.

**Signals.** `SIGTERM` is a polite "shut down" request from `kill`, Docker, systemd.
You can catch it and drain: stop accepting connections, finish in-flight requests,
close the pools, exit. `SIGINT` is `Ctrl-C`. `SIGKILL` (`kill -9`) cannot be caught.
Orchestrators send SIGTERM, wait ~30s, then SIGKILL — so anything keeping the event
loop alive, like a pending `setInterval`, is what stops you exiting in that window.
`clearInterval` on shutdown is explicit; `timer.unref()` is the blunt version that
just stops the timer counting as a reason to stay running.

**The error handler is a funnel, and status lives at the throw site.** A handler
can't infer a status from a bare `Error` — a dropped DB connection and a bad
request body are both just `Error`. So the code that *knows* attaches
`err.status` (400/404/409) when it throws; the handler reads `err.status ?? 500`.
Two families: **unexpected** failures (query rejection, bug) have no status, are
all 500, get logged server-side and a **generic** body — never `err.message`
(that's SQL, stacks, connection strings). **Deliberate** errors carry a status
and *may* expose `err.message`, because you wrote it for the client. Express 5
auto-forwards rejected async routes/middleware to the handler, which is why the
routes here need no `try/catch`. The handler's value even when it "just defaults
to 500": one place owns logging + response shape (DRY), and it's a safety net for
routes not written yet — they can't crash the process or leak internals.

**A request id bridges the generic message and the detailed log.** The client
gets "Internal Server Error" + an id; you grep the id in the log. Honor an
incoming `X-Request-Id` (a proxy sets it so one request traces across services),
generate one otherwise. The id is safe in the 500 body; `err.message` is not.

**A foreign key encodes a policy, not just a shape.** `ON DELETE CASCADE` on
`sessions.user_id` *is* "deleting a user revokes all their sessions" — the DB
enforces it so no application code has to remember to. The constraint lives on the
child (the table holding the reference), needs matching types and an InnoDB engine,
and the parent must be created first. Latent until something actually deletes a
user, but correct the moment that path appears.

**A boot-run schema needs idempotent seeds.** `CREATE TABLE IF NOT EXISTS` is
idempotent; a bare `INSERT` is not, so re-running `schema.sql` every boot (every
save under `--watch`) piles up duplicate rows. `INSERT IGNORE` fixes it *only* when
there's a `UNIQUE`/PK for the row to collide on — without one, each insert gets a
fresh auto-id and no conflict, so nothing is skipped. The unique key on the natural
handle (`username`) is what makes the seed safe *and* is correct on its own.

**mysql2 rejects `undefined` bind params.** A `?` bound to `undefined` throws
before the query runs — which is why a missing SELECT column surfaces as a loud
crash at the *next* insert, not a silent `NULL` in the row. Useful: the failure
points at the reader (the INSERT), not the writer (the SELECT that forgot a column).

**Sanitize at the query boundary.** Not `SELECT`-ing `password` is a cleaner way to
keep it off `req.user` than fetching it and scrubbing with `{...user, password:
undefined}`. Once the column never enters the row, the scrub is dead code and no
route can leak what was never loaded.

## Things that keep biting

- Needs Node **20.11+** (`import.meta.dirname`). On Node 16 the server dies at
  startup on `path.join(undefined)` before printing anything — `nvm use 20.19.3`
- Sessions now live in MySQL, so a `node --watch` restart no longer logs you out
  (that was the in-memory Map). The DB must be up, though — see `--env-file=.env`
- `express.json()` only parses when the request has `Content-Type: application/json`
- Verify with `curl -i`, not the browser. Several bugs above looked fine in the UI.
