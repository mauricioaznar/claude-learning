import crypto from "node:crypto";

// A JWT is not encrypted and not magic. It is three base64url strings joined by
// dots:  base64url(header) . base64url(payload) . base64url(HMAC)
// Anyone can read the header and payload (base64url is just encoding, not a
// secret). The signature is the only defended part: it proves the server issued
// this exact header+payload and nobody edited them. Whoever holds the secret can
// recompute the signature; nobody else can forge one.

// The payload — what the token carries. `auth` will read this straight off the
// verified token with NO database lookup, which is the whole point of an access
// token. `expireAt` is epoch milliseconds (matches Date.now()); note that a
// "real" JWT uses `exp` in *seconds* — we keep ms here to match the session
// clocks and stay consistent with the rest of the lab.
export interface AccessTokenPayload {
  userId: number;
  displayName: string;
  username: string;
  expireAt: number;
}

// The signing secret. `process.env.X` is typed `string | undefined`, so guard it
// once here — a missing secret should fail loudly at boot, not silently sign
// tokens with the string "undefined".
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
if (!ACCESS_TOKEN_SECRET) {
  throw new Error("ACCESS_TOKEN_SECRET is not set");
}

/**
 * signToken — build a signed access token from the payload fields.
 *
 * Steps (this is yours to write):
 *   1. Build the header object: { alg: "HS256", typ: "JWT" }.
 *   2. Build the payload object from the args (userId, displayName, username, expireAt).
 *   3. base64url-encode each: JSON.stringify -> Buffer.from(...) -> .toString("base64url").
 *      (Node's Buffer supports "base64url" directly — url-safe, no "=" padding.)
 *   4. Form the signing input string: `${encodedHeader}.${encodedPayload}`.
 *   5. HMAC-SHA256 that string with SECRET (crypto.createHmac), then base64url the
 *      digest: crypto.createHmac("sha256", SECRET).update(input).digest("base64url").
 *   6. Join all three with dots and return the string.
 *
 * Tip: the encode-to-base64url step happens for header, payload, AND you'll
 * reuse the exact same input string in verifyToken — a small `base64url(obj)`
 * helper here pays off twice. A helper takes plain values and returns a string;
 * it never sees req/res.
 */
export function signToken(
  payload: AccessTokenPayload,

): string {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const encodedHeader = Buffer.from(JSON.stringify({alg: "HS256", typ: "JWT"})).toString('base64url')
    const hmacArg = encodedHeader + '.' + encodedPayload
    const signature = crypto.createHmac('sha256', ACCESS_TOKEN_SECRET).update(hmacArg).digest("base64url")
    return hmacArg + "." + signature
}

/**
 * verifyToken — validate a token and hand back a payload you can trust, or a
 * single falsy value on ANY expected failure. It must never throw on garbage
 * input: a malformed, tampered, or expired token is a normal "no" answer, not a
 * crash. Callers (the `auth` middleware) treat falsy as "not authenticated".
 *
 * Principles (the order and the traps matter more than the keystrokes):
 *   - Verify the signature FIRST, then trust the payload. Anything you read out
 *     of the payload before the HMAC checks out is attacker-controlled data.
 *   - The constant-time compare has a direction and a length trap:
 *     `crypto.timingSafeEqual(a, b)` returns TRUE when the buffers are equal,
 *     and THROWS if their lengths differ — so length-guard before you call it,
 *     and be deliberate about which outcome means "reject".
 *   - Decoding the payload is TWO steps: base64url -> string, then string ->
 *     object. `Buffer.from(x, "base64url").toString("utf8")` gives you the JSON
 *     *text*; you still have to parse it into an object before `.expireAt` means
 *     anything. A cast (`as AccessTokenPayload`) changes what the compiler
 *     believes, not what you actually hold at runtime.
 *   - Expiry is checked HERE, not in the middleware. verifyToken is the pure,
 *     reusable gate: every caller should get "valid signature AND not expired"
 *     from one place. The middleware's job is req/res plumbing (read the header,
 *     set req.user, send 401) — not crypto or clock logic.
 */
export function verifyToken(token: string): AccessTokenPayload | false {
    const splitToken = token.split('.')
    if (splitToken.length !== 3) {
        return false
    }
    const [headerEncoded, payloadEncoded, signature] = splitToken

    const revisedSignature = crypto.createHmac('sha256', ACCESS_TOKEN_SECRET).update(`${headerEncoded}.${payloadEncoded}`).digest('base64url')
    const a = Buffer.from(signature)
    const b = Buffer.from(revisedSignature)
    if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return false
    }

    const payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8')) as AccessTokenPayload

    const { expireAt } = payload
    const now = Date.now()
    if (expireAt < now) {
        return false
    }

    return payload
}
