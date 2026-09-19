import { S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";

// A single S3 client for the whole module (module-level singleton — this is the
// Express way; Nest injects the same object as a provider instead).
//
// The SAME code talks to MinIO or real AWS. The only difference lives in .env:
//   - MinIO: endpoint=http://localhost:9000, forcePathStyle=true
//   - AWS:   endpoint blank,               forcePathStyle=false
export const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});
