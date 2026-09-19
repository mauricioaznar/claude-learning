import { db } from "./db.js";

// Thin data-access layer. The route handlers talk to this, never to SQL
// directly — that keeps the "where metadata lives" seam swappable (a real app
// would point this at Postgres, etc.).

const insertStmt = db.prepare(`
  INSERT INTO uploads (id, key, filename, content_type, size, status, created_at)
  VALUES (@id, @key, @filename, @contentType, @size, 'pending', @createdAt)
`);

const byIdStmt = db.prepare(`SELECT * FROM uploads WHERE id = ?`);
const listStmt = db.prepare(`SELECT * FROM uploads ORDER BY created_at DESC`);
const markUploadedStmt = db.prepare(`
  UPDATE uploads SET status = 'uploaded', completed_at = @completedAt WHERE id = @id
`);
const deleteStmt = db.prepare(`DELETE FROM uploads WHERE id = ?`);

const toRecord = (row) =>
  row && {
    id: row.id,
    key: row.key,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };

export const repository = {
  create({ id, key, filename, contentType, size }) {
    insertStmt.run({
      id,
      key,
      filename,
      contentType,
      size,
      createdAt: Date.now(),
    });
    return this.getById(id);
  },

  getById(id) {
    return toRecord(byIdStmt.get(id));
  },

  list() {
    return listStmt.all().map(toRecord);
  },

  markUploaded(id) {
    markUploadedStmt.run({ id, completedAt: Date.now() });
    return this.getById(id);
  },

  remove(id) {
    deleteStmt.run(id);
  },
};
