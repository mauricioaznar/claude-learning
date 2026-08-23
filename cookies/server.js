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
const ABSOLUTE_MAX_AGE = 20 * 1000// 20 seconds
const SWEEP_INTERVAL = 15 * 1000 // 15 seconds


const COOKIE_NAME = "session_id"

app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use(cookieParser(process.env.COOKIE_SECRET));

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

function errorMiddleware(err, req, res, next) {
  err.status = err.status || 500
  console.error(err)
  if (err.status === 500) {
    return res.status(500).send("Internal Server Error");
  }

  return res.status(err.status).send(err.message)

}

async function auth (req, res, next) {
  const cookieValueUUID = getCookie(req)

  if (!cookieValueUUID) {
    return res.status(401).send("Unauthorized");
  }

  const [rows] = await pool.query(`select * from sessions where uuid = ?`, [cookieValueUUID])

  if (rows.length === 0) {
    return res.status(401).send("Unauthorized");
  }

  const session = rows[0];
  const now = Date.now()
  const userId = session.user_id;
  const user = await findUserById(userId);

  if (!user || now > session.expire_at || now > session.absolute_expire_at) {
    await pool.query(`delete from sessions where uuid = ?`, [cookieValueUUID])
    clearCookie(res)
    return res.status(401).send("Unauthorized");
  }



  const deadline = Math.min(SHORT_MAX_AGE + now, session.absolute_expire_at);
  setCookie(res, cookieValueUUID, now, deadline);
  await pool.query(`update sessions set expire_at = ? where uuid = ?`, [deadline, cookieValueUUID])
  // session.expireAt = deadline;



  req.user = {...user, password: undefined}

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

  const userSessionId = crypto.randomUUID()

  const now = Date.now()
  const slideExpireAt = now + SHORT_MAX_AGE
  const absoluteEnd= now  + ABSOLUTE_MAX_AGE


  await pool.query(`insert into sessions(uuid, expire_at, absolute_expire_at, user_id) values (?, ?, ?, ?)`, [userSessionId, slideExpireAt, absoluteEnd, user.id])
  setCookie(res, userSessionId, now, slideExpireAt)
  return res.json( "Login successfully" );
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
      await pool.query(`delete from sessions where expire_at <= ?`, [Date.now()])
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
