# s3-presigned-post-uploads · express + react

Presigned-POST uploads to S3-compatible storage. The server only signs and
records; the file goes **browser → storage directly**. The UI is a **React**
(Vite) app in `client/` that builds into `public/`, which the server serves.
This folder is self-contained — zip it and drop it into a live app.

## Run it

**Storage + backend:**

```sh
docker compose up -d          # MinIO on :9000, console :9001, bucket auto-created
cp .env.example .env
npm install
npm run dev                   # API on http://localhost:3001
```

**React client** (separate Vite app):

```sh
cd client
npm install
npm run dev                   # dev UI on http://localhost:5173, proxies API to :3001
```

Open http://localhost:5173, pick a PDF, upload.

Or serve the built SPA from the backend itself (production-style):

```sh
cd client && npm run build    # outputs to ../public
# then open http://localhost:3001
```

## Verify against what actually runs

Use `curl -i` / the network tab, not the code:

- `POST /uploads` → `201` with a tiny JSON `{ id, key, upload: { url, fields } }`.
- The **file** request goes to `localhost:9000` (MinIO), **not** this server —
  that's the control/data-plane split, visible in the network tab.
- Push a >10 MB file → MinIO returns **403 EntityTooLarge**: the
  `content-length-range` policy condition rejecting it server-side.

```sh
# sign only (works with no storage running — signing is local crypto)
curl -s -X POST localhost:3001/uploads -H 'content-type: application/json' \
  -d '{"filename":"doc.pdf","contentType":"application/pdf","size":50000}'

curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3001/uploads \
  -H 'content-type: application/json' \
  -d '{"filename":"x.png","contentType":"image/png","size":50000}'   # 415
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`  | `/uploads` | list records |
| `POST` | `/uploads` | validate + return a presigned POST |
| `POST` | `/uploads/:id/complete` | HEAD-verify the object, mark uploaded |
| `GET`  | `/uploads/:id/url` | presigned GET (download) |
| `DELETE` | `/uploads/:id` | delete object then row (`204`; `404` if unknown) |

## Going to real AWS

No code changes — only `.env`:

```
S3_ENDPOINT=            # blank
S3_FORCE_PATH_STYLE=false
S3_REGION=<region>
S3_BUCKET=<bucket>
S3_ACCESS_KEY_ID=<...>
S3_SECRET_ACCESS_KEY=<...>
```

Then on the bucket (MinIO gave these for free in dev):

1. **CORS** — the browser POSTs cross-origin, so allow it:
   ```json
   [{ "AllowedOrigins": ["http://localhost:3001"],
      "AllowedMethods": ["POST", "GET"],
      "AllowedHeaders": ["*"], "MaxAgeSeconds": 3000 }]
   ```
2. **Block Public Access** — leave ON; everything flows through signed URLs.
3. **Lifecycle rule** — expire objects after N days; abort incomplete multipart.
4. **No versioning** — every version is billed storage.
