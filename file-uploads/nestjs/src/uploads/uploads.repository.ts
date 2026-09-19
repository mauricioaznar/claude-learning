import { Injectable } from "@nestjs/common";
import Database from "better-sqlite3";

export interface UploadRecord {
  id: string;
  key: string;
  filename: string;
  contentType: string;
  size: number;
  status: "pending" | "uploaded";
  createdAt: number;
  completedAt: number | null;
}

// Same SQLite storage as the Express module, but expressed as an @Injectable
// provider: the service asks for UploadsRepository in its constructor and Nest
// hands it over. In Express this was a plain imported object.
@Injectable()
export class UploadsRepository {
  private db = new Database("uploads.sqlite");

  constructor() {
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS uploads (
        id            TEXT PRIMARY KEY,
        key           TEXT NOT NULL,
        filename      TEXT NOT NULL,
        content_type  TEXT NOT NULL,
        size          INTEGER NOT NULL,
        status        TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        completed_at  INTEGER
      );
    `);
  }

  private toRecord = (row: any): UploadRecord | undefined =>
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

  create(input: {
    id: string;
    key: string;
    filename: string;
    contentType: string;
    size: number;
  }): UploadRecord {
    this.db
      .prepare(
        `INSERT INTO uploads (id, key, filename, content_type, size, status, created_at)
         VALUES (@id, @key, @filename, @contentType, @size, 'pending', @createdAt)`
      )
      .run({ ...input, createdAt: Date.now() });
    return this.getById(input.id)!;
  }

  getById(id: string): UploadRecord | undefined {
    return this.toRecord(
      this.db.prepare(`SELECT * FROM uploads WHERE id = ?`).get(id)
    );
  }

  list(): UploadRecord[] {
    return this.db
      .prepare(`SELECT * FROM uploads ORDER BY created_at DESC`)
      .all()
      .map(this.toRecord) as UploadRecord[];
  }

  markUploaded(id: string): UploadRecord {
    this.db
      .prepare(
        `UPDATE uploads SET status = 'uploaded', completed_at = @completedAt WHERE id = @id`
      )
      .run({ id, completedAt: Date.now() });
    return this.getById(id)!;
  }
}
