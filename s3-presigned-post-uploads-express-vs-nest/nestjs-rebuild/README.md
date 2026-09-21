# nestjs-rebuild

From-scratch rebuild of the NestJS presigned-POST upload module. Same behaviour as
`../nestjs/` (the answer key); the point is to rebuild it unaided and walk the
refactor arc **everything mixed → seams extracted → storage fully isolated**. The
phased path lives in [`CLAUDE.md`](./CLAUDE.md).

Runs on **port 3003** so it can run beside the reference (`../nestjs/`, port 3002);
both share the same MinIO bucket.

## Run it

```bash
# 1. shared dev storage (MinIO) — from either module folder; one instance serves both
docker compose up -d

# 2. env
cp .env.example .env

# 3. backend
npm install
npm run start:dev        # nest watch mode, http://localhost:3003

# 4. client (separate terminal) — dev server with HMR + API proxy
cd client && npm install && npm run dev     # http://localhost:5173

# or build the client into public/ and let Nest serve it:
cd client && npm run build && cd .. && npm run start:prod
```

At Phase 0 the app boots and serves the client, but `/uploads` 404s — the
`UploadsModule` is empty on purpose. Start Phase 1 in `src/uploads/`.

## Verify (runtime)

Signing and validation are offline crypto, so `POST /uploads` works with no
network. `complete` and the actual upload need MinIO up. Prove the size cap by
pushing an oversized file — S3/MinIO rejects it from the signed policy, not just
the server's early `413`. See `../nestjs/README.md` and `../CLAUDE.md` for the
CORS / lifecycle / oversized-upload details.
