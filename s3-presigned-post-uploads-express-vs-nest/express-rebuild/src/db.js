import Database from "better-sqlite3";

// Shell (given): connection + schema only. The *queries* live in a repository
// you write during the refactor (Phase 2) — Phase 1 talks to this `db` directly.
// One SQLite file per module — self-contained, so the folder zips cleanly.
export const db = new Database("uploads.sqlite");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS uploads (
    id            TEXT PRIMARY KEY,
    key           TEXT NOT NULL,          -- the object's storage key
    filename      TEXT NOT NULL,          -- original name, for display/download
    content_type  TEXT NOT NULL,
    size          INTEGER NOT NULL,       -- bytes the client claims to send
    status        TEXT NOT NULL,          -- 'pending' until verified, then 'uploaded'
    created_at    INTEGER NOT NULL,
    completed_at  INTEGER                  -- set when verified
  );
`);
