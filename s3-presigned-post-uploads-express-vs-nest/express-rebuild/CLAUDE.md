# express-rebuild — the Express S3 module, rebuilt from scratch

A from-scratch, **unaided** rebuild of the Express presigned-POST upload module.
The sibling `../express/` is the **answer key** — the goal here is that Mau can
reproduce it without looking, and *feel the refactor arc* the reference presents
as a finished result: start with everything tangled in `server.js`, then extract
the seams, then seal storage behind a single folder boundary so the vendor SDK
and the client are **fully isolated** — nothing outside `src/storage/` can reach
them.

The feature set is identical to `../express/` (sign → upload → complete →
download → delete, all direct-to-storage). **Nothing about the behaviour changes
between the phases — only the structure does.** Each phase is a pure refactor of
the one before: the same five endpoints keep working, the code just moves.

Read `../CLAUDE.md` (the parent s3 project) for the design background: control vs.
data plane, presigned POST, the size-cap policy, the facade/adapter distinction,
and `grep` as the portability proof. This file only tracks the rebuild path.

## Full isolation, without a DI container — the Express-vs-Nest contrast

`../nestjs-rebuild/` reaches full isolation with a *dynamic `StorageModule`*: the
`S3_CLIENT` / `S3_OPTIONS` tokens are **private to the module** because a provider
escapes only through `exports`, so only the facade is reachable. That privacy is
enforced by the DI **container**.

Express has no container — but it must reach the **same end state**: the S3
client and the `@aws-sdk` imports reachable from *one place only*. The
Express-native mechanism is a **folder boundary**: put everything storage under
`src/storage/`, expose a single `src/storage/index.js` that exports only the
contract, and keep the client + SDK in sibling files that nothing outside the
folder imports. The isolation is enforced by convention + `grep`, not by a
container keeping a token private. Same goal, different machinery — that contrast
*is* the lesson, so Phase 3 does not get skipped.

## Scaffold boundary

The scaffold (Phase 0) is done: `server.js` boots Express, serves the compiled
client from `public/`, and exposes `/health` — nothing more. `src/config.js`
(env) and `src/db.js` (connection + `uploads` table) are given as shell. The
React client, `docker-compose.yml`, and `.env.example` all exist. Everything
under the `/uploads` routes — and the files under `src/storage/` and
`src/repository.js` — is yours to write. The backend runs on **port 3004** so it
can run beside the reference (3001) and the Nest modules; all share the same
MinIO bucket.

## Exercises (phases)

Same marker set as the rest of the repo: **✅ done**, **🚧 in progress**,
**⬜ not started**.

0. **✅ Scaffold** — `server.js` (boot + static + `/health`, no `/uploads`),
   `src/config.js`, `src/db.js`, the React client, `docker-compose.yml` (MinIO),
   `.env.example`. Boots and serves the client; `/uploads` 404s until Phase 1.

1. **⬜ Everything mixed** — do *all* of it inline in `server.js`:
   `import ... from "@aws-sdk/..."` at the top, `new S3Client({ ... })` built once
   from `config.s3`, hand-written `typeof`/type/size checks returning status
   codes, and `better-sqlite3` calls (via the `db` from `src/db.js`) inline in
   each handler. No factory, no contract, no `repository`. Implement all five
   endpoints. Goal: a working, deliberately tangled `server.js` — feel *why* the
   seams are worth adding before you add them.
   - [ ] `POST /uploads` — validate (400 missing filename / 415 wrong type / 413
         too big), create the row, sign a presigned POST with the
         `content-length-range` policy, return `{ id, key, upload }`
   - [ ] `POST /uploads/:id/complete` — HEAD-verify the object exists (409 if
         not), mark `uploaded`
   - [ ] `GET /uploads/:id/url` — presigned GET (download), with the original
         filename as the download name
   - [ ] `GET /uploads` — list
   - [ ] `DELETE /uploads/:id` — file first (idempotent at S3), then row; 204 /
         404 on unknown id

2. **⬜ Extract the seams** — refactor Phase 1 *without changing behaviour* into a
   `createS3Storage(config)` **factory** and a `repository`, but they can still
   live as plain files the handlers import directly:
   - `src/storage/s3.js` — `createS3Storage(config)` returning the four-verb
     contract (`signUpload` / `headObject` / `getDownloadUrl` / `deleteObject`).
     The client + `@aws-sdk` imports live here.
   - `src/repository.js` — an exported `repository` (`create` / `list` /
     `getById` / `markUploaded` / `remove`) wrapping the `db` queries, mapping the
     snake_case columns to the camelCase (`createdAt`) the client renders.
   - `server.js` builds `const storage = createS3Storage(config.s3)` once and
     coordinates `storage` + `repository`; key generation (`uploads/${id}.pdf`)
     stays in the handler because it needs the id from the repository.
   - Acceptance: `grep -rln 'from "@aws-sdk' src server.js` → only under
     `src/storage/`. Behaviour identical to Phase 1.

3. **⬜ Full isolation — seal storage behind a folder boundary** — the end state
   that matches `../nestjs/`'s dynamic `StorageModule`, done the Express way:
   - Everything storage lives under `src/storage/`; a single `src/storage/index.js`
     is the **only** public surface, exporting *only* the storage contract (the
     result of `createS3Storage`, or the factory itself). The `S3Client` and the
     SDK stay in sibling files (`src/storage/s3.js` / `src/storage/client.js`)
     that **nothing outside `src/storage/` imports**.
   - `server.js` imports storage *only* from `./src/storage/index.js` — never the
     raw client, never `@aws-sdk`.
   - **Make the contrast explicit in a comment:** this is the same isolation Nest
     gets from a dynamic `StorageModule` (token private, only the facade
     `exports`ed), but there's no container — the folder's single entry point +
     `grep` is what keeps the client private.
   - Acceptance (the isolation proof, not taste):
     `grep -rln 'from "@aws-sdk' src server.js` → only files *inside*
     `src/storage/`, **and** the only `src/storage/...` path imported from
     `server.js` (or anywhere outside the folder) is `src/storage/index.js`.

   > Note — factory ≠ swappability. `createS3Storage` vs. a hypothetical
   > `createGcsStorage` are two factories satisfying one contract (Strategy),
   > chosen at boot, not runtime. A singleton with exported functions is *equally*
   > swappable — you change which module you import. The factory's real wins are
   > testing (inject a fake config/client), multiplicity (two buckets), and
   > explicit deps. Portability comes from the **contract shape**, not from
   > factory-vs-singleton. (See `../CLAUDE.md` Learnings.)

## Failures

*(symptom → cause → fix — record them as they happen, especially the embarrassing
ones)*

- _none yet — Phase 1 not started._

## Learnings

*(rebuild-specific notes; the conceptual background lives in `../CLAUDE.md`)*

- _Seed:_ each phase is a **pure refactor** — same five endpoints, same
  behaviour, only the structure moves. If a phase changes what the API does,
  something went wrong.
- _Seed:_ full isolation is reachable in both frameworks; only the *enforcement*
  differs. Nest makes the client unreachable with a DI token kept private inside a
  dynamic module (the container enforces it). Express makes it unreachable with a
  single-entry-point folder and a `grep` (convention enforces it). The end state —
  the SDK reachable from one place only — is identical. Note here whatever the
  rebuild made concrete for you.
