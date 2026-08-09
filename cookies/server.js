import path from "node:path";
import express from "express";
import * as crypto from "node:crypto";
import cookieParser from "cookie-parser";

const app = express();
const PORT = 3000;
const PUBLIC_DIR = path.join(import.meta.dirname, "public");

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

  SESSION_MAP.set(userSessionId, user.id)

  res.cookie('session_id', userSessionId, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 1000 })

  return res.json( "Login successfully" );
});

// ---------------------------------------------------------------------------
// EXERCISE 2 — read the cookie back and say who is logged in
// ---------------------------------------------------------------------------
app.get("/api/me", (req, res) => {
  const cookies = req.cookies

  const sessionId = cookies.session_id;

  if (!sessionId || !SESSION_MAP.has(sessionId)) {
    return res.status(401).json({error: "Invalid session"});
  }

  const userId = SESSION_MAP.get(sessionId)

  const user = findUserById(userId);

  if (!user) {
    return res.status(401).json({ error: "Invalid user id" });
  }

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
  res.clearCookie("session_id", { httpOnly: true, sameSite: "lax" });

  SESSION_MAP.delete(sessionId)

  return res.sendStatus(204);
});

// SPA fallback: any non-API path returns index.html so the client router can
// take over on a hard refresh or a pasted deep link.
app.get("/*splat", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
