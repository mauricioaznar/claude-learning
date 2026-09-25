# s3-presigned-post-uploads-express-vs-nest — design decisions & module comparison

Two modules, `express/` and `nestjs/`, that solve the **same** problem: upload a
PDF to S3-compatible storage, verify it landed, download it back. Behaviour is
identical; the point is to see how each framework reshapes the same logic. This
doc records *why* the design is the way it is, then compares the two modules
file-by-file.

There are **two comparison axes**:

- **Backend:** Express (plain JS) vs NestJS (TypeScript, DI).
- **Frontend:** the Express module's UI is **React**; the NestJS module's is
  **Svelte**. Both are Vite apps in `client/` that build into the server's
  `public/`. The upload *logic* (`client/src/api.js`) is identical in both — only
  the component layer differs.

---

## 1. Design decisions

### 1.1 Separate the control plane from the data plane

The single most important decision. The server never touches file bytes.

- **Control plane = the server.** Small JSON requests only. It checks the rules,
  mints a storage key, asks storage for a short-lived *signed URL*, records
  metadata.
- **Data plane = browser ↔ storage, directly.** The browser sends the actual
  file straight to S3 using the signed URL. Download is the mirror image.

**Why:** bytes never flow through the app host, so you pay no compute and no
double bandwidth (in *and* out of your server), and there's one network hop
instead of two. This is the presigned-URL pattern, and it's the whole cost/perf
story.

### 1.2 Presigned POST, not presigned PUT

Two ways to sign a direct upload. We use **POST**.

- **Presigned POST** (`createPresignedPost`) returns a URL + form fields, and its
  policy can carry a `content-length-range` condition. Storage itself rejects an
  oversized or wrong-type file — **the client cannot lie about the size.**
- **Presigned PUT** is one simple URL, but size enforcement leans on the client
  being honest.

Because we care about capping cost and abuse, POST's server-enforced policy wins.

### 1.3 Size cap: 10 MB, PDF only

A 10–15 page PDF fits comfortably under 10 MB even when image-heavy. Enforced in
three places, weakest to strongest:

1. Client: `<input accept="application/pdf">` (a hint, trivially bypassed).
2. Server: a `413` / `415` check before signing (cheap early bounce).
3. Storage: the `content-length-range` + `eq $Content-Type` policy conditions
   (the real gate — can't be bypassed).

Both the cap and the allowed type are `.env`-configurable.

### 1.4 Local dev on MinIO, real AWS is a `.env` swap

Both modules point at **MinIO** (S3-compatible, runs in Docker) during dev. The
AWS SDK talks to it unchanged — you only set `endpoint` + `forcePathStyle`.
Moving to real AWS at the end changes **no code**, only `.env`. Zero charges
while learning.

### 1.5 Metadata in SQLite, behind a repository

Each module keeps its own SQLite file behind a small repository, so the "where
metadata lives" seam is swappable (a real app points it at Postgres, etc.). The
server records a row at *sign* time (`pending`) and flips it to `uploaded` only
after it verifies the object exists.

### 1.6 A verify/complete step

After the browser uploads, it calls `POST /uploads/:id/complete`. The server
does a `HEAD` on the object to prove it really landed (and is within the cap)
before trusting the row. Without this, a client could get a signed URL and never
upload, leaving a dangling `pending` row.

This client-driven complete is the reference build's only completion signal, and
it's the weak link — a browser that closes mid-flow never calls it. See §6 for
how you'd harden this (S3 event callback as the primary signal, a sweep, staging
lifecycle) when taking the pattern to production.

### 1.7 Cost decisions, in one place

- **No bytes through the server** (§1.1) — the big one.
- **Server-enforced size cap** (§1.2) — no runaway upload cost.
- **Single POST, no multipart** — unneeded under 5 GB; avoids orphaned
  multipart-part storage leaks.
- **Block all public access**; everything via signed URLs. No public bucket, no
  CloudFront needed for a lab.
- **Lifecycle rule** to expire objects after N days (documented per module).
- **No versioning** — every version is billed storage.
- **Random, unguessable keys + short URL TTLs** (minutes).

### 1.8 Status codes

Chosen to carry meaning rather than defaulting to `400`/`500`:

| Situation | Code | Why |
| --- | --- | --- |
| Missing/blank filename, bad shape | `400` | malformed request |
| Wrong media type (not PDF) | `415` | request is well-formed, *type* unsupported |
| Over the size cap | `413` | payload too large |
| Signed but object not in storage | `409` | state conflict on complete |
| Unknown upload id | `404` | not found |
| Valid sign | `201` | a record was created |

---

## 2. The flow (identical in both modules)

```
browser                        server (control plane)          storage (data plane)
   │  POST /uploads {name,type,size}  │                               │
   │─────────────────────────────────►  validate, make key,          │
   │                                  │  create row (pending),        │
   │  201 { id, upload:{url,fields} } │  sign a POST                  │
   │◄─────────────────────────────────                               │
   │  POST url  (file bytes)  ────────────────────────────────────────►  stores object
   │◄──────────────────────────────────────────────────────────────── 204 (or 403 if too big)
   │  POST /uploads/:id/complete      │                               │
   │─────────────────────────────────►  HEAD object ─────────────────►│
   │                                  │◄──────────────────────────────  exists?
   │  200 { ...status: uploaded }     │  mark uploaded                │
   │◄─────────────────────────────────                               │
   │  GET /uploads/:id/url            │                               │
   │─────────────────────────────────►  sign a GET                   │
   │  200 { url }  ── then browser GETs bytes straight from storage ──►│
```

---

## 3. What each module contains

### 3.1 Express (`express/`) — plain JS, Express 5

| File | Contains |
| --- | --- |
| `server.js` | All routes + logic inline: list, sign (E2), complete (E4), download (E5). Manual validation, manual status codes. |
| `src/config.js` | Reads `process.env`, applies defaults. An imported singleton. |
| `src/s3-storage.js` | A module-level `S3Client` singleton built from config. |
| `src/db.js` | Opens the SQLite file, creates the `uploads` table. |
| `src/repository.js` | Plain object with `create / getById / list / markUploaded`. |
| `client/` | **React** (Vite) app: `src/App.jsx`, `src/main.jsx`, `src/api.js`, `src/styles.css`. Builds into `public/`. |
| `public/` | Build output (git-ignored) — the compiled SPA the server serves. |
| `.env.example` | Connection + policy + TTL settings. |
| `docker-compose.yml` | MinIO + auto-created bucket for dev. |
| `README.md` | Run + verify + real-AWS notes. |

### 3.2 NestJS (`nestjs/`) — TypeScript, Nest 10

| File | Contains |
| --- | --- |
| `src/main.ts` | Bootstrap: global `ValidationPipe`, static assets, reads port from `ConfigService`. |
| `src/app.module.ts` | Root module: loads `ConfigModule` (global) + `UploadsModule`. |
| `src/config/configuration.ts` | Same config shape as Express, loaded as a Nest config factory. |
| `src/uploads/uploads.controller.ts` | Thin `@Controller` mapping HTTP → service. No logic. |
| `src/uploads/uploads.service.ts` | All logic: sign / complete / download. Throws Nest HTTP exceptions for status codes. |
| `src/uploads/dto/create-upload.dto.ts` | `class-validator` DTO — validates request *shape*. |
| `src/uploads/s3.provider.ts` | `S3Client` as an injectable provider (factory + token). |
| `src/uploads/uploads.repository.ts` | `@Injectable()` repository over the same SQLite table. |
| `src/uploads/uploads.module.ts` | Wiring manifest: declares controller + providers. |
| `client/` | **Svelte** (Vite) app: `src/App.svelte`, `src/main.js`, `src/api.js`, `src/styles.css`. Builds into `public/`. |
| `public/` | Build output (git-ignored) — the compiled SPA the server serves. |
| `.env.example`, `docker-compose.yml`, `README.md` | Same as Express (duplicated on purpose — each folder stands alone). |
| `tsconfig.json`, `nest-cli.json` | TypeScript + Nest build config. |

---

## 4. Express vs NestJS — same logic, two shapes

The AWS SDK calls are byte-for-byte identical. Everything below is *structure*:

| Concern | Express | NestJS |
| --- | --- | --- |
| Language / run | JS · `node server.js` | TypeScript · `nest build` → `node dist/main` |
| Config | imported singleton reading `process.env` | `ConfigModule.forRoot({ load })` + injected `ConfigService` |
| Validation — shape | manual `typeof` checks in the handler | `CreateUploadDto` + global `ValidationPipe` |
| Validation — policy | `res.status(415/413)` in the handler | thrown `UnsupportedMediaTypeException` / `PayloadTooLargeException` |
| S3 client | module-level `new S3Client(...)` | provider (`S3_CLIENT` token), factory-built, injected |
| Data access | imported `repository` object | `@Injectable()` `UploadsRepository`, injected |
| Routing | handlers inline in `server.js` | thin `@Controller` → `UploadsService` |
| Wiring | top-of-file imports | `@Module({ controllers, providers })` — a container injects |
| Static files | `express.static("public")` | `app.useStaticAssets(...)` on `NestExpressApplication` |
| Files for the same job | ~5 | ~10 |

**Takeaway:** Express keeps request-handling and logic together and wires by
importing. Nest splits shape-validation (pipe/DTO) from policy (service), maps
status codes to *thrown exception classes*, and wires by declaring providers a
container injects. Nest is more files for the same behaviour — the payoff is that
each seam (config, storage, S3 client, validation) is explicit and swappable.

---

## 5. React vs Svelte — same UI, two shapes

The upload logic lives in `client/src/api.js` and is **identical** in both — it's
plain `fetch`, no framework in it. Only the component layer differs.

| Concern | React (`express/client`) | Svelte (`nestjs/client`) |
| --- | --- | --- |
| Component file | `App.jsx` (JSX) | `App.svelte` (template + `<script>`) |
| State | `useState(...)` hooks | plain `let` variables (reactive by compiler) |
| On mount | `useEffect(() => {...}, [])` | `onMount(...)` |
| Update UI | call the setter (`setRows(...)`) | assign the variable (`rows = ...`) |
| Refer to the input | `useRef` + `ref={fileRef}` | `bind:this={fileInput}` |
| List rendering | `rows.map(r => <li key=...>)` | `{#each rows as r (r.id)}` |
| Conditional | `{cond && <x/>}` | `{#if cond}...{/if}` |
| Events | `onClick={fn}` | `on:click={fn}` |
| Entry | `createRoot(el).render(<App/>)` | `new App({ target: el })` |
| Build tool | Vite + `@vitejs/plugin-react` | Vite + `@sveltejs/vite-plugin-svelte` |
| Prod bundle (this app) | ~145 KB | ~9 KB |

**Takeaway:** React re-renders a function on every state change, so state is
explicit (hooks + setters) and the framework ships in the bundle. Svelte
compiles the component to direct DOM updates — reactivity is just assignment, and
almost nothing framework-shaped is left at runtime (hence the ~16× smaller
bundle). Same three-step upload flow underneath either.

## 6. Hardening the reconciliation (advisory — not built)

*Everything in this section is guidance to weigh when taking the pattern to
production, **not** rules the reference build follows. The lab's only completion
signal is the client calling `/complete` (§1.6), and that's the weak link: a
browser that uploads and then closes never reconciles, leaving a `pending` row
and possibly an orphaned object. These four moves harden it, roughly in order of
how much they buy you.*

- **Row first, key minted server-side.** The server writes the `pending` row and
  generates the key *before* handing back a signed URL (already true here, §1.5).
  This is what keeps an orphaned object traceable: every key in the bucket maps
  back to a row, so a leaked file is never anonymous — you can always find and
  bill/delete it.
- **S3 event callback becomes the primary signal.** Wire an S3 event
  notification (`s3:ObjectCreated:*`) to the server (directly, or via a
  queue/Lambda) and let *that* flip the row to `uploaded`. Once it exists, the
  client's `/complete` call is optional — a convenience for snappy UI, not the
  source of truth. The server learns the object landed even if the browser
  vanished mid-flow.
- **Sweep is the backstop.** A periodic job reconciles rows against the bucket:
  `pending` rows older than the URL TTL with no object → mark failed/expire;
  objects with no matching row → delete. It catches whatever the event callback
  misses (dropped events, misconfig). Backstop, not the primary path.
- **Staging prefix + lifecycle is the cost cap.** Sign uploads into a `staging/`
  prefix carrying an aggressive lifecycle rule (expire after hours/days); on a
  successful reconcile, move the object to its permanent prefix. Anything that
  never reconciles ages out on its own — the cost ceiling when every other
  mechanism has failed.

*How they stack: the callback is the main completion path, the sweep backs it up,
and the staging lifecycle caps cost when both miss. Today the build has only the
client `/complete` and a plain lifecycle rule (§1.7); server-side key minting is
already in place.*

---

## 7. Verification status

Docker was not available on the build machine, so the live browser→MinIO upload
and the `HEAD`-based complete step were **not** run end-to-end. Everything that
is local crypto — signing (`POST /uploads`), validation (`415/413/400`), and
download-URL generation (`GET /:id/url`) — was verified with `curl` and behaves
identically in both modules. To exercise the full loop: `docker compose up -d`,
run a module, upload a PDF.
