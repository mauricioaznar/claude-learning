import path from "node:path";
import express from "express";
import * as crypto from "node:crypto";
import cookieParser from "cookie-parser";

const app = express();
const PORT = 3000;
const PUBLIC_DIR = path.join(import.meta.dirname, "public");

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
// EXERCISE 1 — log in and hand the browser a cookie
// ---------------------------------------------------------------------------
app.post("/api/login", (req, res) => {
  const { username, password } = req.body ?? {};
  const user = findUser(username, password);

  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const userSessionId = crypto.randomUUID()

  SESSION_MAP.set(userSessionId, { id: user.id, expireAt: Date.now() + SHORT_MAX_AGE, absoluteExpireAt: Date.now() + ABSOLUTE_MAX_AGE})

  res.cookie(COOKIE_NAME, userSessionId, { httpOnly: true, sameSite: "lax", maxAge: SHORT_MAX_AGE})

  return res.json( "Login successfully" );
});

// ---------------------------------------------------------------------------
// EXERCISE 2 — read the cookie back and say who is logged in
// ---------------------------------------------------------------------------
app.get("/api/me", (req, res) => {
  const cookies = req.cookies

  const sessionId = cookies[COOKIE_NAME];

  if (!sessionId || !SESSION_MAP.has(sessionId)) {
    return res.status(401).json({error: "Invalid session"});
  }

  // check session expiration on memory
  const session = SESSION_MAP.get(sessionId)


  //check if session has expired absolutely
  if(Date.now() > session.expireAt ||  Date.now() > session.absoluteExpireAt  ) {
    SESSION_MAP.delete(sessionId);
    res.clearCookie(COOKIE_NAME)
    return res.status(401).json({ error: "Session expired login again" });
  }

  const user = findUserById(session.id);

  if (!user) {
    return res.status(401).json({ error: "Invalid user" });
  }

  let suggestedExpirationSurpassesAbsolute = SHORT_MAX_AGE >= session.absoluteExpireAt

  res.cookie(COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: suggestedExpirationSurpassesAbsolute ? session.absoluteExpireAt - Date.now() : SHORT_MAX_AGE
  })
  session.expireAt = Date.now() + suggestedExpirationSurpassesAbsolute? session.absoluteExpireAt : Date.now() +  SHORT_MAX_AGE;

  // and reply with the user. If there is no valid session, reply 401.
  return res.status(200).json({...user, password: undefined } );
});

// ---------------------------------------------------------------------------
// EXERCISE 3 — log out and make the cookie useless
// ---------------------------------------------------------------------------
app.post("/api/logout", (req, res) => {

  const sessionId = req.cookies.session_id;

  if (!sessionId) {
    return res.status(401).json({error: "Invalid session"});
  }

  // http only removes document.cookie prevents theft
  // sameSite: "lax" only from same origin. other domains cannot send the cookie through, will get rejected. links are ok from other webiste to this domain localhost:3000, strict prevents those links from sending the cookie
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax" });

  SESSION_MAP.delete(sessionId)

  return res.sendStatus(204);
});

// SPA fallback: any non-API path returns index.html so the client router can
// take over on a hard refresh or a pasted deep link.
app.get("/*splat", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});


let intervalRef = null
const server = app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);

  intervalRef =setInterval(() => {
    const deletedKeys = []
    SESSION_MAP.keys().forEach(key => {
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

process.on("SIGTERM", () => {
  server.close(() => {
    clearInterval(intervalRef);
  });
});
