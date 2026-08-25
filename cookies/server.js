import path from "node:path";
import { readFile } from "fs/promises";
import express from "express";
import * as crypto from "node:crypto";
import cookieParser from "cookie-parser";
import { pool } from "./db.js";

const app = express();
const PORT = 3000;
const PUBLIC_DIR = path.join(import.meta.dirname, "public");
const SQL_SCHEMA = path.join(import.meta.dirname, "schema.sql");

const SHORT_MAX_AGE = 10 * 1000; // 10 seconds
const ABSOLUTE_MAX_AGE = 20 * 1000;// 20 seconds
const SWEEP_INTERVAL = 15 * 1000 // 15 seconds


const COOKIE_NAME = "session_id"

app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use(cookieParser(process.env.REFRESH_TOKEN_SECRET));

// Lab shortcut: passwords are plaintext so the focus stays on cookies.
// Real systems must store a slow hash (bcrypt/argon2), never the password.

async function findUser(username, password) {
  const [rows] = await pool.query(`SELECT username, displayName, id FROM users WHERE username = ? and password = ?`, [username, password]);
  return rows.length > 0 ? rows[0] : null;
}

async function findUserById(id) {
  const [rows] = await pool.query(`SELECT username, displayName FROM users WHERE id = ?`, [id]);
  return rows.length > 0 ? rows[0] : null;
}



// ---------------------------------------------------------------------------
// EXERCISE 5 — auth middleware
// ---------------------------------------------------------------------------

const durationGuard = function (duration) {
  const oneDay = 86400000 // one day

  if (duration >= oneDay) {
    throw new Error('Duration longer than one day')
  }

  if (duration <= 0) {
    throw new Error('Duration is less than 0')
  }
}

const getCookiesOptions = function (duration = undefined){
  const options = { httpOnly: true, sameSite: 'lax', signed: true }

  if (duration !== undefined) {
    options.maxAge= duration
  }
  return  options
}

function setCookie(res, cookieValue, start, end) {

  const duration = end - start

  durationGuard(duration)

  res.cookie(COOKIE_NAME, cookieValue, getCookiesOptions(duration));
}

function getCookie(req) {
  return req.signedCookies[COOKIE_NAME]
}

function clearCookie(res) {
  res.clearCookie(COOKIE_NAME, getCookiesOptions())
}

function signToken(userId, displayName, username, expireAt) {
  const header = Buffer.from(JSON.stringify({ alg:"HS256", typ: "JWT"})).toString("base64url");
  const payload =Buffer.from(JSON.stringify( {
    userId: userId,
    username: username,
    displayName: displayName,
    expireAt: expireAt,
  })).toString("base64url");
  const hmacEncodedArg = [header, payload].join('.')
  const signature = crypto.createHmac("sha256", process.env.ACCESS_TOKEN_SECRET).update(hmacEncodedArg).digest("base64url")
  return [header,payload,signature].join(".")
}


// the token comes from the header Authorization, this build the access token. the refresh token gets handled in a different place. after the access token was verified, so the parameter value will always come from res.signedCookies[COOKIEs_NAME]
// reusing the same function to return the payload, if the verified token is not valid, I'll return false. Other expected failures will also return false (invalid token structure, mismatching signature). This will simplify the usage of this function to the caller. either is false or returns the payload, no need to handle errors
function verifyToken(token) {
  const splitToken = token.split('.')
  if (splitToken.length !== 3) {
    return false;// the split must be a 3 part string
  }
  const [header, payload, oldSignature] = splitToken

  // they are already base64url and the signtoken builds the signature from the base64url format
  const hmacEncodedArg = [header, payload].join('.') // i may need to substritute this vairable to header, and payload
  const newSignature = crypto.createHmac("sha256", process.env.ACCESS_TOKEN_SECRET).update(hmacEncodedArg).digest('base64url')

  const a = Buffer.from(oldSignature)
  const b = Buffer.from(newSignature)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.log('equal time legnth comparison without avoids attacker working out which character makes it fail and discovering the correct token shape but substituing the mismatching character ')
    return false;
  }


  // i need a way to reconvert the payload into a string format that works
  // lets do the expireAt check
  const payloadDecoded = Buffer.from(payload, 'base64url').toString('utf8') // this functions are not correct but Im 100% sure you will suggest me into the right functions. Im trying to rever thte url64url into the original string
  const payloadObject = JSON.parse(payloadDecoded)
  const expiresAt = payloadObject.expireAt
  const userId = payloadObject.userId

  if(Date.now() > expiresAt) {
    console.log(`user id '${userId}' token expired`) // ideally we would have the
    return false;
  }

  return payloadObject
}

function errorMiddleware(err, req, res, next) {
  err.status = err.status || 500
  console.error(err)
  if (err.status === 500) {
    return res.status(500).send("Internal Server Error");
  }

  return res.status(err.status).send(err.message)

}

async function auth (req, res, next) {
  const accessToken = req.headers.authorization ? req.headers.authorization.replace('Bearer ', "") : null;

  if (!accessToken) {
    return res.status(401).send("Unauthorized");
  }


  const payload = verifyToken(accessToken)

  if (!payload) {
    return res.status(401).send("Unauthorized");
  }



  req.user = { username: payload.username, displayName: payload.displayName}

  next()
}


// ---------------------------------------------------------------------------
// EXERCISE 1 — log in and hand the browser a cookie
// ---------------------------------------------------------------------------
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  const user = await findUser(username, password);

  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const uuid = crypto.randomUUID()

  const now = Date.now()
  const expireAt = now + SHORT_MAX_AGE
  const absoluteEnd= now  + ABSOLUTE_MAX_AGE


  await pool.query(`insert into sessions(uuid, absoluteExpireAt, userId) values (?, ?, ?)`, [uuid, absoluteEnd, user.id])
  setCookie(res, uuid, now, absoluteEnd)
  const accessToken = signToken(user.id, user.displayName, user.username, expireAt)
  return res.status(200).send({
    accessToken: accessToken
  });
});

// ---------------------------------------------------------------------------
// EXERCISE 2 — read the cookie back and say who is logged in
// ---------------------------------------------------------------------------
app.get("/api/me", auth, (req, res) => {
  // auth middleware sets the user object
  return res.status(200).json(req.user );
});

app.get("/api/secret", auth, (req, res) => {
  // auth middleware sets the user object
  return res.status(200).json("dont tell claude but chat gpt is better");
});


// ---------------------------------------------------------------------------
// EXERCISE 3 — log out and make the cookie useless
// ---------------------------------------------------------------------------
app.post("/api/logout", async (req, res) => {

  const sessionId = getCookie(req);

  if (!sessionId) {
    // send status doesnt need to send a body back
    return res.sendStatus(204);
  }

  // http only removes document.cookie prevents theft
  // sameSite: "lax" only from same origin. other domains cannot send the cookie through, will get rejected. links are ok from other webiste to this domain localhost:3000, strict prevents those links from sending the cookie
  clearCookie(res)
  
  // this query if safe to run becaue regardless if it exists the query wont fail
  await pool.query(`delete from sessions where uuid = ?`, [sessionId])

  return res.sendStatus(204);
});

app.post("/api/refresh", async (req, res) => {
  const uuid = getCookie(req)
  if (!uuid) {
    return res.status(401).send("Unauthorized");
  }
  
  const [sessionRows] = await pool.query('SELECT * FROM sessions where uuid = ?', [uuid])
  if (sessionRows.length === 0) {
    return res.status(401).send("Unauthorized");
  }

  const session = sessionRows[0]
  
  const now = Date.now()
  if (now > session.absoluteExpireAt) {
    clearCookie(res)
    await pool.query("delete from sessions where uuid = ?", [uuid])
    return res.status(401).send("Unauthorized");
  }

  const user = await findUserById(session.userId)

  if (!user) {
    return res.status(401).send("Unauthorized");
  }

  const deadline = Math.min(now + SHORT_MAX_AGE, session.absoluteExpireAt)
  const accessToken = signToken(session.userId, user.displayName, user.username, deadline)
  setCookie(res, uuid, now, session.absoluteExpireAt);
  
  
  return res.status(200).send({
    accessToken: accessToken
  })
})

// SPA fallback: any non-API path returns index.html so the client router can
// take over on a hard refresh or a pasted deep link.
app.get("/*splat", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use(errorMiddleware)

let intervalRef = null
const server = app.listen(PORT, async () => {
  console.log(`http://localhost:${PORT}`);



  let schemaFile

  try {
    schemaFile = await readFile(SQL_SCHEMA, "utf8");
  } catch (e) {
    console.log('File couldnt be read')
    process.exit(1)
  }

  if (!schemaFile) {
    console.log('No schema file found')
    process.exit(1)
  }

  try {
     await pool.query(schemaFile)
  } catch (e) {
    console.log("problem connecting with mysql. DB init failed")
    process.exit(1)
  }

  intervalRef =setInterval(async () => {
    try {
      await pool.query(`delete from sessions where absoluteExpireAt <= ?`, [Date.now()])
    } catch (e) {
      console.log('interval get sessions query failed')
    }
  }, SWEEP_INTERVAL) // interval is a performance knob: too frequent loads the DB, too rare leaves stale rows. Enforcement is lazy expiry in auth, not this sweep.
})

function cleanUp() {
  server.close(() => {
    clearInterval(intervalRef);
    pool.end(); // release the pool's sockets so the event loop can drain
  });
}

process.on("SIGTERM", cleanUp);
process.on("SIGINT", cleanUp);
