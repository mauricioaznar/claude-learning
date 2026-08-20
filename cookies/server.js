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
app.use(cookieParser())

// Lab shortcut: passwords are plaintext so the focus stays on cookies.
// Real systems must store a slow hash (bcrypt/argon2), never the password.
const USERS = [
  { id: 1, username: "mau", password: "hunter2", displayName: "Mxau" },
  { id: 2, username: "ada", password: "lovelace", displayName: "Ada" },
];

const SESSION_MAP = new Map()

function findUser(username, password) {
  return USERS.find((u) => u.username === username && u.password === password);
}

function findUserById(id) {
  return USERS.find((u) => u.id === id);
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
  const options = { httpOnly: true, sameSite: 'lax' }

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

function clearCookie(res) {
  res.clearCookie(COOKIE_NAME, getCookiesOptions())
}

function errorMiddleware(err, req, res, next) {
  if (err.status >= 500 && err.status < 600) {
    res.status(500).send("Internal Server Error");
  }

  return res.status(err.status).send(err.message)

}

function auth (req, res, next) {
  const cookieValueUUID = req.cookies[COOKIE_NAME]

  if (!cookieValueUUID || !SESSION_MAP.has(cookieValueUUID)) {
    return res.status(401).send("Unauthorized");
  }

  const session = SESSION_MAP.get(cookieValueUUID)
  const now = Date.now()
  const userId = session.id;
  const user = findUserById(userId);

  if (!user || now > session.expireAt || now > session.absoluteExpireAt) {
    SESSION_MAP.delete(cookieValueUUID)
    clearCookie(res)
    return res.status(401).send("Unauthorized");
  }



  const deadline = Math.min(SHORT_MAX_AGE + now, session.absoluteExpireAt);
  setCookie(res, cookieValueUUID, now, deadline);
  session.expireAt = deadline;



  req.user = {...user, password: undefined}

  next()
}


// ---------------------------------------------------------------------------
// EXERCISE 1 — log in and hand the browser a cookie
// ---------------------------------------------------------------------------
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  const user = findUser(username, password);

  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const userSessionId = crypto.randomUUID()

  const now = Date.now()
  const slideExpireAt = now + SHORT_MAX_AGE
  const absoluteEnd= now  + ABSOLUTE_MAX_AGE


  await pool.query(`
    insert into sessions(uuid, expire_at, absolute_expire_at, user_id) values (?, ?, ?, ?)
  `, [userSessionId, slideExpireAt, absoluteEnd, user.id])
  // SESSION_MAP.set(userSessionId, { id: user.id, expireAt: slideExpireAt, absoluteExpireAt: absoluteEnd})
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
app.post("/api/logout", (req, res) => {

  const sessionId = req.cookies.session_id;

  if (!sessionId) {
    // send status doesnt need to send a body back
    return res.sendStatus(204);
  }

  // http only removes document.cookie prevents theft
  // sameSite: "lax" only from same origin. other domains cannot send the cookie through, will get rejected. links are ok from other webiste to this domain localhost:3000, strict prevents those links from sending the cookie
  clearCookie(res)
  SESSION_MAP.delete(sessionId)

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

  intervalRef =setInterval(() => {
    const deletedKeys = []
    Array.from(SESSION_MAP.keys()).forEach(key => {
      const session = SESSION_MAP.get(key)
      // expires at reflects the true expiration date so no need to include the absolute here since there is a ceiling
      if (Date.now() > session.expireAt) {
        deletedKeys.push(key)
      }
    })

    deletedKeys.forEach(key => {
      SESSION_MAP.delete(key)
    })
  }, SWEEP_INTERVAL) // set timing on set interval into an amount not to small (too frequent) or to big (avoid saved stale sessions)// to avoid loading server.
})

process.on("SIGTERM", async () => {
  server.close(() => {
    clearInterval(intervalRef);
    pool.end(); // release the pool's sockets so the event loop can drain
  });
});
