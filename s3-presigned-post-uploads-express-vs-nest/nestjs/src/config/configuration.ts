// Same shape as the Express src/config.js, loaded via ConfigModule (see
// app.module.ts). Injected everywhere as ConfigService instead of an imported
// singleton — that's the Nest difference: config is a provider, not a module import.

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export default () => ({
  port: num(process.env.PORT, 3002),

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
});
