import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { S3_CLIENT } from "./s3.provider";

// The storage FACADE — the Nest mirror of Express's createS3Storage. Together
// with s3.provider.ts this is the only place that touches @aws-sdk; it exposes
// four domain verbs (sign / head / download / delete) so UploadsService never
// sees the SDK.
//
// Two DI styles meet in this constructor: the raw client arrives BY TOKEN
// (@Inject(S3_CLIENT) — a third-party class Nest builds via useFactory), while
// this class is an ordinary @Injectable, resolved BY TYPE wherever it's asked
// for. There is no declared interface, so this is a facade, not a port + adapter
// — you swap storage by changing the provider, not by implementing a contract.
@Injectable()
export class StorageService {
  constructor(
    @Inject(S3_CLIENT) private readonly client: S3Client,
    private readonly config: ConfigService
  ) {}

  private get bucket() {
    return this.config.get<string>("s3.bucket");
  }

  // Sign a presigned POST. The content-length-range condition is baked into the
  // signed policy, so S3 rejects an oversized file even if the client lies about
  // `size`. Returns exactly what the browser needs: { url, fields }.
  async signUpload({
    key,
    contentType,
    maxBytes,
    expiresIn,
  }: {
    key: string;
    contentType: string;
    maxBytes: number;
    expiresIn: number;
  }) {
    return createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ["content-length-range", 1, maxBytes],
        ["eq", "$Content-Type", contentType],
      ],
      Fields: { "Content-Type": contentType },
      Expires: expiresIn,
    });
  }

  // Prove an object really landed. Returns { contentLength } or null when the
  // object isn't there — the caller maps null to "signed but never uploaded".
  // Swallowing the 404 here keeps SDK error shapes out of the service.
  async headObject(key: string): Promise<{ contentLength: number } | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return { contentLength: head.ContentLength };
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
        return null;
      }
      throw err;
    }
  }

  // Short-lived signed GET URL. ResponseContentDisposition makes the browser
  // save with the original filename instead of the opaque key.
  async getDownloadUrl({
    key,
    filename,
    expiresIn,
  }: {
    key: string;
    filename: string;
    expiresIn: number;
  }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
      }),
      { expiresIn }
    );
  }

  // Delete the object. Idempotent at the S3 layer: success even if the key was
  // never there — which is what makes "file first, then row" a safe delete order.
  async deleteObject(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }
}
