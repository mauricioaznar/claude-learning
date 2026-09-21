import { Module } from "@nestjs/common";

// ── PHASE 1 STARTS HERE ──────────────────────────────────────────────────────
// This is the only concept file the scaffold leaves empty. Build the upload flow
// "everything mixed" first, then refactor across the phases in ../../CLAUDE.md:
//
//   Phase 1 — everything mixed: a single UploadsController (or one service) that
//     imports @aws-sdk directly, does `new S3Client()` inline, validates by hand,
//     and talks to better-sqlite3 inline. No DTO, no facade, no StorageModule.
//     Implement all five endpoints: POST /uploads (sign), POST /uploads/:id/
//     complete, GET /uploads/:id/url, GET /uploads, DELETE /uploads/:id.
//   Phase 2 — extract seams, still in THIS module: DTO + ValidationPipe, thrown
//     HTTP exceptions, an @Injectable repository, a StorageService facade, the
//     S3_CLIENT token provider — all listed here in providers.
//   Phase 3 — full isolation: move storage into a dynamic StorageModule
//     (forRoot/forRootAsync) that exports only the facade; keep S3_CLIENT private.
//
// The sibling ../../nestjs/ is the answer key — resist reading it until you've
// tried each phase.
@Module({})
export class UploadsModule {}
