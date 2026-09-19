# s3-presigned-post-uploads-express-vs-nest

Two independent modules — one Express, one NestJS — that solve the **same**
problem: uploading files to S3-compatible storage. Logic-wise they behave
identically; the point is to see how each framework reshapes the same code.

The problem is deliberately small: upload a PDF (10–15 pages, ~10 MB max),
verify it landed, download it back. Every design choice optimizes for **cost**
and **performance**.

## The one idea worth internalizing

**Separate the control plane from the data plane.**

- **Control plane = your server.** Small JSON requests only. It checks the rules
  (is this a PDF? under the size cap?), generates a random storage key, asks the
  storage service for a short-lived *signed URL*, records metadata. **No file
  bytes ever pass through the server.**
- **Data plane = browser ↔ storage, directly.** The browser sends the actual
  file straight to S3 using the signed URL. Download is the mirror image.

Why: bytes never touch your app host, so you don't pay compute or double
bandwidth, and there's one network hop instead of two. This *is* the
presigned-URL pattern.

We use **presigned POST** (not PUT), because its policy can carry a
`content-length-range` condition — S3 itself rejects an oversized or wrong-type
upload. The client cannot lie about the file size.

## Local dev without AWS

Both modules point at **MinIO** (S3-compatible, runs in Docker) during
development. The AWS SDK talks to it unchanged — you just set `endpoint` and
`forcePathStyle` in `.env`. Going to real AWS at the end is a pure `.env` swap,
no code change, no charges while learning.

## Modules

| Module | Backend | Frontend | Status |
| --- | --- | --- | --- |
| `express/` | Express 5 + better-sqlite3 | React (Vite) | complete (E1–E6) |
| `nestjs/` | NestJS 10 + better-sqlite3 | Svelte (Vite) | complete (E1–E6) |

Two comparison axes: **backend** (Express vs Nest) and **frontend** (React vs
Svelte). The upload logic (`client/src/api.js`) is identical across both clients;
only the component layer differs. Full comparison in `DESIGN.md`.

Each module is fully self-contained (own deps, own SQLite file, own `client/`
app, own `docker-compose.yml` + `README.md`) so it can be zipped and dropped into a
live app with minimal coupling. Dev tooling is duplicated per module on purpose —
either folder stands alone. Cross-cutting design decisions and the full
Express-vs-Nest comparison live in `DESIGN.md`.

## Exercises

Both modules are complete. **This project was a deliberate exception to the repo
conventions in the root `CLAUDE.md`** ("scaffold, don't implement" and "review
statically; Mau runs the code"): at Mau's request the whole thing was implemented
and verified by running it, to serve as a reference he'll recreate from scratch
in a separate project. The root conventions still stand for every other lab.

1. **✅ Scaffold + config** — skeleton, `.env` loading, SQLite table + repository,
   demo page.
2. **✅ Sign an upload** — `POST /uploads` validates filename/type/size, returns a
   presigned POST with the size-cap policy. *The core step.*
3. **✅ Data plane** — demo page sends the file straight to storage via the
   returned form fields.
4. **✅ Complete + verify** — `POST /uploads/:id/complete` HEAD-checks the object
   really exists, updates status. Closes the "signed but never uploaded" gap.
5. **✅ Download** — `GET /uploads/:id/url` returns a presigned GET URL.
6. **✅ Cost + hardening** — bucket CORS, lifecycle expiry, block public access;
   prove the cap by pushing an oversized file (documented in each module's
   `README.md`;
   MinIO gives CORS for free in dev, real AWS needs the config there).

**✅ Final** — repoint `.env` from MinIO to a real S3 bucket; no code change.

### Express-only extension (post-reference, driven by Mau)

7. **✅ Storage contract via factory + delete** (`express/` only) — refactor
   `src/s3.js` from a bare exported `S3Client` singleton into a
   `createS3Storage(config)` **factory** returning the contract
   (`signUpload` / `headObject` / `getDownloadUrl` / `deleteObject`). The AWS SDK
   now imports *only* in `src/s3.js` — the handlers speak the contract. Adds
   `DELETE /uploads/:id` (file first, then row; `204` on success, `404` on
   unknown id) and `repository.remove`. React client wired too: `deleteUpload(id)`
   in `api.js` (no body to parse on 204) + a `confirm()`-gated Delete button per
   row in `App.jsx`. Acceptance test:
   `grep -rln 'from "@aws-sdk' src server.js` prints only `src/s3.js`.
   *(NestJS module still on the singleton/inline shape — a future exercise mirrors
   this there as a provider, the Nest-native form of the same factory.)*

8. **⬜ Mirror the storage contract into NestJS** (`nestjs/`, do when reviewing
   Nest) — the Nest module *already* has the factory (`s3.provider.ts` builds the
   client via `useFactory` + `S3_CLIENT` token), so the creational lesson is
   done. What it lacks is the **facade**: `uploads.service.ts` still imports
   `@aws-sdk` and calls `createPresignedPost`/`HeadObjectCommand`/`getSignedUrl`
   inline, so the SDK leaks into the service and there's no `delete`. To match
   Express: add a `StorageService` (a provider wrapping the client, exposing
   `signUpload`/`headObject`/`getDownloadUrl`/`deleteObject`), have `UploadsService`
   depend on *that* instead of the raw client, add `DELETE /uploads/:id` +
   `repo.remove`. Acceptance test (same idea, TS): `@aws-sdk` imports only in the
   storage provider file. Not new learning vs. Ex 7 — it's the Nest-shaped repeat,
   worth doing only when comparing the two frameworks side by side.

## Express vs NestJS — the same logic, two shapes

The AWS SDK calls are byte-for-byte identical. Everything that differs is
structure:

| Concern | Express | NestJS |
| --- | --- | --- |
| Config | `src/config.js`, an imported singleton reading `process.env` | `ConfigModule.forRoot({ load })` + injected `ConfigService` |
| Validation (shape) | manual `typeof` checks in the handler | `CreateUploadDto` + global `ValidationPipe` |
| Validation (policy) | `res.status(415/413)` in the handler | thrown `UnsupportedMediaTypeException` / `PayloadTooLargeException` |
| S3 client | module-level `new S3Client(...)` | provider (`S3_CLIENT` token) built by a factory, injected |
| Data access | imported `repository` object | `@Injectable()` `UploadsRepository`, injected |
| Routing | handlers inline in `server.js` | thin `@Controller` → `UploadsService` |
| Wiring | top-of-file imports | `@Module({ controllers, providers })` |
| Static files | `express.static("public")` | `app.useStaticAssets(...)` on `NestExpressApplication` |
| Run | `node server.js` | `nest build` → `node dist/main` (TypeScript) |

The takeaway: Express keeps request-handling and logic together and wires by
importing; Nest splits shape-validation (pipe/DTO) from policy (service), maps
status codes to *thrown exceptions*, and wires by declaring providers a
container injects. Nest is more files for the same behaviour — the payoff is the
seams are explicit and swappable.

## Failures

*(symptom → cause → fix — record them as they happen)*

- _none hit during the build. The two most likely ones to hit when running it
  live are recorded as learnings below (FormData field order, bucket CORS)._

## Learnings

*(concepts that stuck, in plain words)*

- **Control vs data plane** — the server's job is to *authorize and describe* an
  upload (issue a signed URL), not to *carry* it. Carrying bytes is the storage
  service's job. Getting this split right is the whole cost/perf story.
- **Presigned POST enforces the size cap for real.** The `content-length-range`
  condition is baked into the signed policy, so S3 rejects an oversized file even
  if the client lies about `size`. The server-side `413` check is just a cheap
  early bounce; the policy is the real gate.
- **Signing is offline.** `createPresignedPost` / `getSignedUrl` are local crypto
  over your credentials — they don't call AWS. So `POST /uploads` and
  `GET /:id/url` work with no network; only `HEAD` (complete) and the actual
  upload need a live endpoint. That's why most of this was verifiable without
  Docker/MinIO.
- **FormData field order matters** — when POSTing to S3, append all the policy
  fields first and the `file` field **last**. S3 ignores anything after `file`.
- **Bucket CORS is invisible until it isn't.** The browser→S3 request is
  cross-origin. MinIO allows it by default, so dev "just works"; real AWS returns
  an opaque CORS failure in the network tab until you add the bucket CORS rule
  (see each module's `README.md`).
- **Status codes carry meaning** — wrong type is `415` (well-formed request,
  unsupported media), too big is `413`, signed-but-not-uploaded is `409`. Express
  sets these by hand; Nest maps them from thrown exception classes.
- **The client is a separate Vite app that builds into `public/`.** The backend
  just serves the compiled SPA; in dev, Vite runs on :5173 and proxies only the
  API calls (`/uploads`) to the backend. The direct-to-storage upload isn't
  proxied — the browser POSTs to the absolute MinIO URL the backend returned.
- **A facade's boundary is grep-checkable.** The storage contract is portable
  exactly when the vendor SDK imports in one file and nowhere else. `grep -rln
  'from "@aws-sdk' src server.js` returning only `src/s3.js` *is* the proof — not
  a matter of taste. Portability comes from the **contract shape**, not from
  factory-vs-singleton; the constructor choice only affects injection/testing.
- **Factory ≠ swappability.** `createS3Storage` vs `createGcsStorage` are two
  factories satisfying one contract (Strategy); you pick one at boot, not at
  runtime. A singleton-with-exported-functions is *equally* swappable — change
  which module you import. The factory's real wins are testing (inject a fake),
  multiplicity (two buckets), and explicit deps.
- **Presigned POST inverts the "rollback on failure" instinct.** For a
  through-the-server upload you'd save the row, write the file, and delete the
  row if the write fails. Here the server never touches the file, so it can't
  observe the failure synchronously — the row is `pending`, the browser uploads
  out-of-band, and `/complete` reconciles. Rollback becomes a *sweep*, not a
  `catch`.
- **Delete order = make the failure loud.** File first, then row. Row-first-then-
  file-fails leaves a silent orphan (billed storage nothing references);
  file-first-then-row-fails leaves a dangling row that announces itself on the
  next read. Prefer the visible failure over the silent-costly one.
- **Idempotency lives at two layers.** S3 `DeleteObject` is idempotent (success
  on a missing key) — that's what makes retrying the delete safe. The *resource*
  endpoint `DELETE /uploads/:id` is not, once the row is hard-deleted: a repeat
  call is `404`. Full `204`-on-repeat would need a soft-delete tombstone.
- **The upload logic isn't framework code.** `client/src/api.js` (sign → POST to
  storage → complete) is plain `fetch`, identical in the React and Svelte
  clients. Only the component layer (state, rendering) differs — which is exactly
  the axis worth comparing. React keeps state explicit (hooks + setters) and
  ships the framework (~145 KB); Svelte makes state plain assignment and compiles
  itself away (~9 KB).

## Caveat on verification

Docker wasn't available on the build machine, so the live browser→MinIO upload
and the `HEAD`-based complete step were **not** run end-to-end. Everything up to
and including signing, validation, and download-URL generation was verified with
`curl`. To exercise the full loop: `docker compose up -d`, then run a module and
upload a PDF (see the module's `README.md`).
