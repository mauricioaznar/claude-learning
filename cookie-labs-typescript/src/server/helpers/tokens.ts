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
const SECRET = process.env.ACCESS_TOKEN_SECRET;
if (!SECRET) {
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
  userId: number,
  displayName: string,
  username: string,
  expireAt: number,
): string {
  throw new Error("signToken: not implemented");
}
