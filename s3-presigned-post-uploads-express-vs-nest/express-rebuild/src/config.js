import "dotenv/config";

// Central place to read the environment. Keep boot resilient: the S3 fields are
// read here but only *needed* once you sign an upload (Phase 1), so a missing
// key shouldn't stop the server from starting during the scaffold.
//
// Shell (given). Same shape as ../express/src/config.js — only the default PORT
// differs (3004 so this can run beside the reference on 3001).

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 3004),

  s3: {
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET || "inopack-s3lab-uploads-dev",
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  },

  maxFileSizeBytes: num(process.env.MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024),
  allowedContentType: process.env.ALLOWED_CONTENT_TYPE || "application/pdf",

  uploadUrlTtlSeconds: num(process.env.UPLOAD_URL_TTL_SECONDS, 300),
  downloadUrlTtlSeconds: num(process.env.DOWNLOAD_URL_TTL_SECONDS, 300),
};
