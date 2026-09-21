import express from "express";
import crypto from "node:crypto"
import { config } from "./src/config.js";
import {db} from "./src/db.js";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";


export const client = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});


// Shell (given): boots Express, serves the compiled client from public/, and
// exposes /health. That's ALL — the upload flow is yours to build.

const app = express();
app.use(express.json());
app.use(express.static("public"));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ── PHASE 1 STARTS HERE ──────────────────────────────────────────────────────
// Build the upload flow "everything mixed" first, then refactor (see CLAUDE.md):
//
//   Phase 1 — everything mixed: import @aws-sdk right here, `new S3Client()`
//     inline from config.s3, validate by hand (400/415/413), talk to the `db`
//     from ./src/db.js inline. No factory, no contract, no repository. Implement
//     all five endpoints:
//       POST   /uploads              — validate + sign a presigned POST
//       POST   /uploads/:id/complete — HEAD-verify the object, mark uploaded (409 if absent)
//       GET    /uploads/:id/url      — presigned GET (download)
//       GET    /uploads              — list
//       DELETE /uploads/:id          — file first, then row; 204 / 404
//
//   Phase 2 — extract the seams: pull the vendor SDK into a single
//     `createS3Storage(config)` factory in ./src/s3.js exposing the four-verb
//     contract (signUpload / headObject / getDownloadUrl / deleteObject), and a
//     `repository` in ./src/repository.js. Handlers then speak only the contract.
//     Acceptance: `grep -rln 'from "@aws-sdk' src server.js` → only src/s3.js.
//
// The sibling ../express/ is the answer key — resist reading it until you've
// tried each phase.



app.post("/uploads", async (req, res) => {
  const { filename, contentType, size } = req.body ?? {};
  if (!filename || !size || !contentType) {
    return res.sendStatus(400);
  }
  if (size > config.maxFileSizeBytes) {
    return res.sendStatus(413);
  }
  if (contentType !== config.allowedContentType) {
    return res.sendStatus(415);
  }


  const id = crypto.randomUUID()
  const key = `uploads/${id}`;
  const statementObject = db.prepare(`insert into uploads (id, key, filename, content_type, size, status, created_at, completed_at) values(@id, @key, @filename, @content_type, @size, 'pending', @created_at, null)`)
  statementObject.run({id, key, filename, content_type: contentType, size, created_at: Date.now()})

  const upload = await createPresignedPost(client, {
    Bucket: config.s3.bucket,
    Key: key,
    Conditions: [
        ["content-length-range", 1, config.maxFileSizeBytes],
        ["eq", "$Content-Type", config.allowedContentType],
    ],
    Fields: {
      "Content_Type": contentType
    },
    Expires: config.uploadUrlTtlSeconds,   // seconds
  });

  return res.status(200).send({
    id,
    key,
    upload: upload
  })
})

app.post("/uploads/:id/complete", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.sendStatus(400);
  }

  const results = db.prepare(`select * from uploads where id = @id`).all({ id: id });

  if (results.length === 0) {
    return res.sendStatus(404);
  }
  // aws header statemeent
  const key = `uploads/${id}`;
  try {
    const header = await client.send(
        new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key })
    )
  } catch(e) {
    if (e.$metadata.httpStatusCode === 404) {
      return res.sendStatus(409);
    }
    return res.sendStatus(500);
  }

  db.prepare(`update uploads set status = 'uploaded', completed_at = @completed_at where id = @id`).run({ id: id, completed_at: Date.now()})

  return res.sendStatus(200)


})

app.listen(config.port, () => {
  console.log(
    `s3-presigned-post-uploads (express-rebuild) listening on http://localhost:${config.port}`,
  );
});
