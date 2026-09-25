import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// The storage CONTRACT, built by a factory.
//
// This is the *only* file in the app that imports `@aws-sdk`. Everything outside
// speaks the four verbs this factory returns — sign / head / download / delete —
// and never sees the SDK. That's the whole portability claim, and it has a
// one-line acceptance test:
//
//     grep -rl '@aws-sdk' src server.js   # must print only src/s3-storage.js
//
// Why a factory (not the old module-level singleton)?
//   - Injection/testing: hand it a fake config in a test; no global to reset.
//   - Multiplicity: two buckets or two providers = two calls.
//   - Explicit deps: everything it needs arrives through the argument.
// The swap-provider ability comes from the *contract*, not the factory: write a
// `createGcsStorage(config)` returning the same shape, and only the wiring line
// in server.js changes. That interchangeability is the Strategy pattern.
//
// `config` here is the `config.s3` sub-object: { endpoint, region, bucket,
// accessKeyId, secretAccessKey, forcePathStyle }.
export function createS3Storage(config) {
  // Created once per factory call and closed over by the methods below — private,
  // never exported. (Still a singleton; just scoped to the instance, not the
  // module.) The SAME client talks to MinIO or real AWS — only .env differs.
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    // Sign a presigned POST. The content-length-range condition is baked into
    // the signed policy, so S3 rejects an oversized file even if the client lies
    // about `size`. Returns exactly what the browser needs: { url, fields }.
    async signUpload({ key, contentType, maxBytes, expiresIn }) {
      return createPresignedPost(client, {
        Bucket: config.bucket,
        Key: key,
        Conditions: [
          ["content-length-range", 1, maxBytes],
          ["eq", "$Content-Type", contentType],
        ],
        Fields: { "Content-Type": contentType },
        Expires: expiresIn,
      });
    },

    // Prove an object really landed. Returns { contentLength } or `null` when the
    // object isn't there — the caller maps `null` to "signed but never uploaded".
    // Swallowing the 404 here keeps SDK error-shapes out of the request handler.
    async headObject(key) {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key })
        );
        return { contentLength: head.ContentLength };
      } catch (err) {
        if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
          return null;
        }
        throw err;
      }
    },

    // Short-lived signed GET URL. ResponseContentDisposition makes the browser
    // save with the original filename instead of the opaque key.
    async getDownloadUrl({ key, filename, expiresIn }) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${filename}"`,
        }),
        { expiresIn }
      );
    },

    // Delete the object. Idempotent at the S3 layer: S3 returns success even if
    // the key was never there, which is exactly why "file first, then row" is a
    // safe delete order — a retry can't fail on an already-gone object.
    async deleteObject(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key })
      );
    },
  };
}
