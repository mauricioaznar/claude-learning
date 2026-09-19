import crypto from "node:crypto";
import express from "express";
import { HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { config } from "./src/config.js";
import { repository } from "./src/repository.js";
import { s3 } from "./src/s3.js";

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

  const { url, fields } = await createPresignedPost(s3, {
    Bucket: config.s3.bucket,
    Key: key,
    Conditions: [
      ["content-length-range", 1, config.maxFileSizeBytes],
      ["eq", "$Content-Type", config.allowedContentType],
    ],
    Fields: { "Content-Type": config.allowedContentType },
    Expires: config.uploadUrlTtlSeconds,
  });

  // `upload.url` + `upload.fields` are what the browser needs to POST the file
  // straight to storage (see public/app.js).
  res.status(201).json({ id, key, upload: { url, fields } });
});

// E4 — Complete + verify.
// The client calls this after uploading. We HEAD the object to prove it really
// landed (and that its size is within the cap) before trusting the row.
app.post("/uploads/:id/complete", async (req, res) => {
  const record = repository.getById(req.params.id);
  if (!record) return res.status(404).json({ error: "unknown upload" });

  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: config.s3.bucket, Key: record.key })
    );
    if (head.ContentLength > config.maxFileSizeBytes) {
      return res.status(413).json({ error: "stored object exceeds cap" });
    }
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
      // Signed but never actually uploaded.
      return res.status(409).json({ error: "object not found in storage" });
    }
    throw err;
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

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: record.key,
      ResponseContentDisposition: `attachment; filename="${record.filename}"`,
    }),
    { expiresIn: config.downloadUrlTtlSeconds }
  );

  res.json({ url });
});

app.listen(config.port, () => {
  console.log(`s3-presigned-post-uploads (express) listening on http://localhost:${config.port}`);
});
