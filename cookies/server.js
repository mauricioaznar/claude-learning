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
// EXERCISE 5 — auth middleware
// ---------------------------------------------------------------------------

function setCookie(res, cookieValue, start, end) {

  res.cookie(COOKIE_NAME, cookieValue, { maxAge: end - start, httpOnly: true, sameSite: 'lax' });
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
    res.clearCookie(COOKIE_NAME)
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
app.post("/api/login", (req, res) => {
  const { username, password } = req.body ?? {};
  const user = findUser(username, password);

  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const userSessionId = crypto.randomUUID()

  SESSION_MAP.set(userSessionId, { id: user.id, expireAt: Date.now() + SHORT_MAX_AGE, absoluteExpireAt: Date.now() + ABSOLUTE_MAX_AGE})
  setCookie(res, userSessionId, Date.now(), Date.now() + SHORT_MAX_AGE)
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

process.on("SIGTERM", () => {
  server.close(() => {
    clearInterval(intervalRef);
  });
});
