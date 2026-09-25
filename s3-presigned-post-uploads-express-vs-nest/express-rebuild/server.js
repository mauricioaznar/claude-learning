import express from "express";
import crypto from "node:crypto"
import {config} from "./src/config.js";
import {createS3Storage} from "./src/storage/index.js";
import {createRepository} from "./src/repository.js";
import {db} from "./src/db.js";


// Shell (given): boots Express, serves the compiled client from public/, and
// exposes /health. That's ALL — the upload flow is yours to build.

const app = express();
app.use(express.json());
app.use(express.static("public"));

const s3Storage = createS3Storage(config);
const repository = createRepository(db);

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/uploads", async (req, res) => {
  const { filename, contentType, size } = req.body ?? {};
  if (!filename || !size || !contentType) {
    return res.sendStatus(400);
  }
  if (size > config.maxFileSizeBytes) {
    return res.sendStatus(413);
  }
  if (contentType !== config.allowedContentType) {
    return res.sendStatus(415);
  }


  const id = crypto.randomUUID()
  const key = `uploads/${id}`;

  repository.create({
    id, key, filename, contentType, size
  })

  const upload = await s3Storage.signUpload({ key})

  return res.status(200).send({
    id,
    key,
    upload: upload
  })
})

app.post("/uploads/:id/complete", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.sendStatus(400);
  }

  const record = repository.getById(id)

  if (!record) {
    return res.sendStatus(404);
  }
  // aws header statemeent
  const key = `uploads/${id}`;
  try {
    const header = await s3Storage.headObject({ key })
  } catch(e) {
    if (e.$metadata.httpStatusCode === 404) {
      return res.sendStatus(409);
    }
    return res.sendStatus(500);
  }

  repository.markUploaded(id)

  return res.sendStatus(200)


})

app.get('/uploads/:id/url', async (req, res) => {
  const id = req.params.id;
  const row = repository.getById(id)
  if (!row) {
    return res.sendStatus(404);
  }
  const key = `uploads/${id}`;
  const url = await s3Storage.getDownloadUrl({ key, filename: row.filename });
  res.status(200).send({ url })
})

app.get('/uploads', async (req, res) => {
  const rows = repository.list();
  return res.status(200).send(rows)
})

app.delete('/uploads/:id', async (req, res) => {
  const id = req.params.id;
  const key = `uploads/${id}`;
  const row = repository.getById(id);
  if (!row) {
    return res.sendStatus(404);
  }
  try {
    await s3Storage.deleteObject({ key })
  } catch (e) {
    return res.sendStatus(500);
  }
  repository.remove(id)
  return res.sendStatus(204)
})

app.listen(config.port, () => {
  console.log(
      `s3-presigned-post-uploads (express-rebuild) listening on http://localhost:${config.port}`,
  );
});