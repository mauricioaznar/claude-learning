import express from "express";

import { config } from "./src/config.js";

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

app.listen(config.port, () => {
  console.log(
    `s3-presigned-post-uploads (express-rebuild) listening on http://localhost:${config.port}`,
  );
});
