import crypto from "node:crypto";
import express from "express";

import { config } from "./src/config.js";
import { repository } from "./src/repository.js";
import { createS3Storage } from "./src/s3.js";

// Build the storage adapter once, from config. From here on the handlers speak
// only the contract (signUpload / headObject / getDownloadUrl / deleteObject) —
// the vendor SDK is sealed inside src/s3-storage.js and never imported here.
const storage = createS3Storage(config.s3);

const app = express();
app.use(express.json());
app.use(express.static("public"));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// --- Read side --------------------------------------------------------------
app.get("/uploads", (req, res) => {
  res.json(repository.list());
});

// --- Write side -------------------------------------------------------------

// E2 — Sign an upload.
// Control-plane only: validate, record, and hand back a signed POST. No bytes
// pass through here. The content-length-range condition means S3 itself rejects
// an oversized file even if the client lies about `size`.
app.post("/uploads", async (req, res) => {
  const { filename, contentType, size } = req.body ?? {};

  if (typeof filename !== "string" || filename.trim() === "") {
    return res.status(400).json({ error: "filename is required" });
  }
  // Wrong media type is a 415, not a 400: the request is well-formed, the
  // *type* is unsupported.
  if (contentType !== config.allowedContentType) {
    return res.status(415).json({
      error: `contentType must be ${config.allowedContentType}`,
    });
  }
  // Too big is a 413. This is the server's cheap first line of defence; the S3
  // policy below is the real one that can't be bypassed.
  if (!Number.isInteger(size) || size <= 0 || size > config.maxFileSizeBytes) {
    return res.status(413).json({
      error: `size must be 1..${config.maxFileSizeBytes} bytes`,
    });
  }

  const id = crypto.randomUUID();
  const key = `uploads/${id}.pdf`; // random, unguessable

  repository.create({ id, key, filename, contentType, size });

  // Key generation stays here (it needs the id from the repository); the module
  // is handed a key and stays storage-generic.
  const upload = await storage.signUpload({
    key,
    contentType: config.allowedContentType,
    maxBytes: config.maxFileSizeBytes,
    expiresIn: config.uploadUrlTtlSeconds,
  });

  // `upload.url` + `upload.fields` are what the browser needs to POST the file
  // straight to storage (see public/app.js).
  res.status(201).json({ id, key, upload });
});

// E4 — Complete + verify.
// The client calls this after uploading. We HEAD the object to prove it really
// landed (and that its size is within the cap) before trusting the row.
app.post("/uploads/:id/complete", async (req, res) => {
  const record = repository.getById(req.params.id);
  if (!record) return res.status(404).json({ error: "unknown upload" });

  const head = await storage.headObject(record.key);
  if (!head) {
    // Signed but never actually uploaded.
    return res.status(409).json({ error: "object not found in storage" });
  }
  if (head.contentLength > config.maxFileSizeBytes) {
    return res.status(413).json({ error: "stored object exceeds cap" });
  }

  res.json(repository.markUploaded(record.id));
});

// E5 — Download.
// Return a short-lived signed GET URL; the browser pulls bytes straight from
// storage. ResponseContentDisposition makes the browser download with the
// original filename instead of the opaque key.
app.get("/uploads/:id/url", async (req, res) => {
  const record = repository.getById(req.params.id);
  if (!record) return res.status(404).json({ error: "unknown upload" });

  const url = await storage.getDownloadUrl({
    key: record.key,
    filename: record.filename,
    expiresIn: config.downloadUrlTtlSeconds,
  });

  res.json({ url });
});

// E7 — Delete.
// The row is our authority: no row means genuinely nothing to delete → 404.
// Otherwise delete the *file first* (idempotent at S3), then the row. If the
// storage delete throws, we bail before touching the row — the failure is
// visible (a live row still points at the object) rather than a silent orphan.
// Hard delete, so a repeat call finds no row and returns 404; full 204-on-repeat
// idempotency would need a soft-delete tombstone, which this lab opted out of.
app.delete("/uploads/:id", async (req, res) => {
  const record = repository.getById(req.params.id);
  if (!record) return res.status(404).json({ error: "unknown upload" });

  await storage.deleteObject(record.key);
  repository.remove(record.id);

  res.status(204).end();
});

app.listen(config.port, () => {
  console.log(`s3-presigned-post-uploads (express) listening on http://localhost:${config.port}`);
});
