# file-uploads

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

Both modules are complete. (Originally an exercise path for Mau to write; on
request the whole thing was implemented as a reference to recreate from scratch.)

1. **Scaffold + config** — skeleton, `.env` loading, SQLite table + repository,
   demo page.
2. **Sign an upload** — `POST /uploads` validates filename/type/size, returns a
   presigned POST with the size-cap policy. *The core step.*
3. **Data plane** — demo page sends the file straight to storage via the
   returned form fields.
4. **Complete + verify** — `POST /uploads/:id/complete` HEAD-checks the object
   really exists, updates status. Closes the "signed but never uploaded" gap.
5. **Download** — `GET /uploads/:id/url` returns a presigned GET URL.
6. **Cost + hardening** — bucket CORS, lifecycle expiry, block public access;
   prove the cap by pushing an oversized file (documented in each module's
   `README.md`;
   MinIO gives CORS for free in dev, real AWS needs the config there).

**Final** — repoint `.env` from MinIO to a real S3 bucket; no code change.

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
