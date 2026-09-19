import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { CreateUploadDto } from "./dto/create-upload.dto";
import { UploadsRepository } from "./uploads.repository";
import { S3_CLIENT } from "./s3.provider";

// All the upload logic. Note how the collaborators arrive: injected through the
// constructor, not imported. And how status codes are expressed: by throwing
// Nest's built-in HTTP exceptions instead of calling res.status(...).
@Injectable()
export class UploadsService {
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly config: ConfigService,
    private readonly repo: UploadsRepository
  ) {}

  list() {
    return this.repo.list();
  }

  // E2 — Sign an upload.
  async sign(dto: CreateUploadDto) {
    const allowed = this.config.get<string>("allowedContentType");
    const cap = this.config.get<number>("maxFileSizeBytes");

    if (dto.contentType !== allowed) {
      throw new UnsupportedMediaTypeException(`contentType must be ${allowed}`);
    }
    if (dto.size > cap) {
      throw new PayloadTooLargeException(`size must be <= ${cap} bytes`);
    }

    const id = randomUUID();
    const key = `uploads/${id}.pdf`;

    this.repo.create({
      id,
      key,
      filename: dto.filename,
      contentType: dto.contentType,
      size: dto.size,
    });

    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.config.get<string>("s3.bucket"),
      Key: key,
      Conditions: [
        ["content-length-range", 1, cap],
        ["eq", "$Content-Type", allowed],
      ],
      Fields: { "Content-Type": allowed },
      Expires: this.config.get<number>("uploadUrlTtlSeconds"),
    });

    return { id, key, upload: { url, fields } };
  }

  // E4 — Complete + verify.
  async complete(id: string) {
    const record = this.repo.getById(id);
    if (!record) throw new NotFoundException("unknown upload");

    let head;
    try {
      head = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.config.get<string>("s3.bucket"),
          Key: record.key,
        })
      );
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
        throw new ConflictException("object not found in storage");
      }
      throw err;
    }

    if (head.ContentLength > this.config.get<number>("maxFileSizeBytes")) {
      throw new PayloadTooLargeException("stored object exceeds cap");
    }

    return this.repo.markUploaded(id);
  }

  // E5 — Download.
  async downloadUrl(id: string) {
    const record = this.repo.getById(id);
    if (!record) throw new NotFoundException("unknown upload");

    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.config.get<string>("s3.bucket"),
        Key: record.key,
        ResponseContentDisposition: `attachment; filename="${record.filename}"`,
      }),
      { expiresIn: this.config.get<number>("downloadUrlTtlSeconds") }
    );

    return { url };
  }
}
