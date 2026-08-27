import {RowDataPacket} from "mysql2";

export interface UserRow extends RowDataPacket {
    username: string;
    password: string;
    displayName: string;
    id: number;
}

export interface SessionRow extends RowDataPacket {
    sessionUuid: string;
    userId: number;
    absoluteExpireAt: number;
}

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

