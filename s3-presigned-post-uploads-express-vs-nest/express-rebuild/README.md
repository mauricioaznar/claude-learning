# express-rebuild

From-scratch rebuild of the Express presigned-POST upload module. Same behaviour
as `../express/` (the answer key); the point is to rebuild it unaided and walk
the refactor arc **everything mixed → seams extracted → storage fully isolated
behind a single folder boundary** (the Express-native equivalent of Nest's
private-token dynamic module — same end state, no DI container). The phased path
lives in [`CLAUDE.md`](./CLAUDE.md).

Runs on **port 3004** so it can run beside the reference (`../express/`, port
3001) and the Nest modules (3002 / 3003); all share the same MinIO bucket.

## Run it

```bash
# 1. shared dev storage (MinIO) — from any module folder; one instance serves all
docker compose up -d

# 2. env
cp .env.example .env

# 3. backend
npm install
npm run dev        # node --watch, http://localhost:3004

# 4. client (separate terminal) — dev server with HMR + API proxy
cd client && npm install && npm run dev     # http://localhost:5173

# or build the client into public/ and let Express serve it:
cd client && npm run build && cd .. && npm start
```

At the scaffold (Phase 0) the app boots and serves the client, but `/uploads`
404s — the routes are yours to build. Start Phase 1 in `server.js`.

## Verify (runtime)

Signing and validation are offline crypto, so `POST /uploads` works with no
network. `complete` and the actual upload need MinIO up. Prove the size cap by
pushing an oversized file — S3/MinIO rejects it from the signed policy, not just
the server's early `413`. See `../express/README.md` and `../CLAUDE.md` for the
CORS / lifecycle / oversized-upload details.
