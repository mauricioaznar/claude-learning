# nestjs-rebuild — the NestJS S3 module, rebuilt from scratch

A from-scratch, **unaided** rebuild of the NestJS presigned-POST upload module.
The sibling `../nestjs/` is the **answer key** — the goal here is that Mau can
reproduce it without looking, and, more importantly, *feel the refactor arc* that
the reference skips: start with everything tangled, then extract the seams one
layer at a time until storage is fully isolated.

The feature set is identical to `../nestjs/` (sign → upload → complete → download
→ delete, all direct-to-storage). **Nothing about the behaviour changes across
the phases — only the structure does.** Each phase is a pure refactor of the one
before, which is the whole point: you watch the same working code migrate from a
mixed handler into a facade behind a dynamic module.

Read `../CLAUDE.md` (the parent s3 project) for the design background: control vs.
data plane, presigned POST, the facade/adapter distinction, the two Nest DI
styles, and static vs. dynamic modules. This file only tracks the rebuild path.

## Scaffold boundary

The scaffold (Phase 0) is done: the app shell, config, Svelte client, docker, and
an **empty** `src/uploads/uploads.module.ts` all exist and the app boots. Every
concept file under `src/uploads/` is yours to write — that's the exercise. The
backend runs on **port 3003** (the reference is 3002) so both can run at once;
they share the same MinIO bucket.

## Exercises (phases)

Same marker set as the rest of the repo: **✅ done**, **🚧 in progress**,
**⬜ not started**.

0. **✅ Scaffold** — Nest app shell (`main.ts` without the global pipe yet,
   `app.module.ts` with `ConfigModule.forRoot`), `configuration.ts`, the Svelte
   client, `docker-compose.yml` (MinIO), and an empty `UploadsModule`. Boots and
   serves the client; `/uploads` 404s until Phase 1.

1. **⬜ Everything mixed** — one `UploadsController` (or a single service) that
   does *all* of it inline: `import ... from "@aws-sdk/..."` right in the file,
   `new S3Client({ ... })` built from `process.env`/`ConfigService`, hand-written
   `typeof`/size checks returning status codes, and `better-sqlite3` calls inline.
   No DTO, no `ValidationPipe`, no facade, no repository class, no `StorageModule`.
   Implement all five endpoints. Goal: a working, deliberately tangled module —
   feel *why* the seams are worth adding before you add them.
   - [ ] `POST /uploads` — validate + sign a presigned POST
   - [ ] `POST /uploads/:id/complete` — HEAD-verify, mark uploaded
   - [ ] `GET /uploads/:id/url` — presigned GET
   - [ ] `GET /uploads` — list
   - [ ] `DELETE /uploads/:id` — file first, then row; 204 / 404

2. **⬜ Extract the seams — still one module (not isolated)** — refactor Phase 1
   *without changing behaviour* into the idiomatic Nest shape, but keep everything
   declared in `UploadsModule.providers`: a `CreateUploadDto` + the global
   `ValidationPipe` (add it in `main.ts`), thrown HTTP exceptions in place of
   manual status codes, an `@Injectable() UploadsRepository`, a `StorageService`
   **facade** (the only file that imports `@aws-sdk`), and the `S3_CLIENT` token
   provider built by `useFactory`. This is exactly the `../nestjs/` reference (its
   Ex 8). Acceptance: `grep -rln 'from "@aws-sdk' src` → only the storage
   provider + facade files; behaviour identical to Phase 1.

3. **⬜ Full isolation — a *dynamic* `StorageModule`** — lift the storage wiring
   into its own module **configured at import time** and exporting *only* the
   facade:
   - `StorageModule.forRoot(options)` (or `forRootAsync({ inject: [ConfigService],
     useFactory })`) returns a `DynamicModule` whose providers include an
     `S3_OPTIONS` value, the `s3Provider`, and `StorageService`; `exports:
     [StorageService]` — **not** the token.
   - `UploadsModule` `imports: [StorageModule.forRoot(...)]` and drops the storage
     providers from its own list.
   - Because a provider escapes a module only when `exports`ed, `S3_CLIENT`/
     `S3_OPTIONS` become **private** to `StorageModule` — the facade is the only
     door (the airtight isolation Phase 2 lacked).
   - **Make the static/dynamic distinction visible in comments:** `StorageModule`
     is dynamic because it takes *import-time options from the caller* — not
     because it's imported (static modules are too), and not because it varies per
     environment (`UploadsModule` does that while staying static, via injected
     `ConfigService`). Put that contrast in a comment on each module.
   - Acceptance: `UploadsModule` imports `StorageModule.forRoot(...)`;
     `S3_CLIENT`/`S3_OPTIONS` importable only within `src/storage/`; Nest boots.

   > Optional variant (option A): instead of the `S3_CLIENT` token, have
   > `StorageService` build the client in its own constructor from injected
   > options/config. Benefit: correct typing, no string/symbol token; the client
   > becomes a truly private field. Cost: loses the custom-token demonstration.
   > Orthogonal to the dynamic-module change.

## Failures

*(symptom → cause → fix — record them as they happen, especially the embarrassing
ones)*

- _none yet — Phase 1 not started._

## Learnings

*(rebuild-specific notes; the conceptual background lives in `../CLAUDE.md`)*

- _Seed:_ the phases are **pure refactors** — same five endpoints, same
  behaviour, only the structure moves. If a phase changes what the API does,
  something went wrong. The parent `../CLAUDE.md` Learnings cover facade vs.
  adapter, the two DI styles (class provider vs. token + `useFactory`), and static
  vs. dynamic modules — add anything the rebuild taught *you* here.
