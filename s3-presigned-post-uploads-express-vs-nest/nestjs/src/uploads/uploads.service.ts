import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { CreateUploadDto } from "./dto/create-upload.dto";
import { UploadsRepository } from "./uploads.repository";
import { StorageService } from "./storage.service";

// All the upload logic. Note how the collaborators arrive: injected through the
// constructor, not imported. Status codes are expressed by throwing Nest's
// built-in HTTP exceptions instead of calling res.status(...). The @aws-sdk now
// lives entirely behind StorageService — this file speaks only the four verbs.
@Injectable()
export class UploadsService {
  constructor(
    private readonly storage: StorageService,
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

    const { url, fields } = await this.storage.signUpload({
      key,
      contentType: allowed,
      maxBytes: cap,
      expiresIn: this.config.get<number>("uploadUrlTtlSeconds"),
    });

    return { id, key, upload: { url, fields } };
  }

  // E4 — Complete + verify.
  async complete(id: string) {
    const record = this.repo.getById(id);
    if (!record) throw new NotFoundException("unknown upload");

    const head = await this.storage.headObject(record.key);
    if (!head) throw new ConflictException("object not found in storage");
    if (head.contentLength > this.config.get<number>("maxFileSizeBytes")) {
      throw new PayloadTooLargeException("stored object exceeds cap");
    }

    return this.repo.markUploaded(id);
  }

  // E5 — Download.
  async downloadUrl(id: string) {
    const record = this.repo.getById(id);
    if (!record) throw new NotFoundException("unknown upload");

    const url = await this.storage.getDownloadUrl({
      key: record.key,
      filename: record.filename,
      expiresIn: this.config.get<number>("downloadUrlTtlSeconds"),
    });

    return { url };
  }

  // E7 — Delete. File first (idempotent at S3), then the row. If the storage
  // delete throws we bail before touching the row — a live row still pointing at
  // the object is a loud failure, not a silent orphan. Hard delete, so a repeat
  // call finds no row and 404s; full 204-on-repeat would need a soft-delete
  // tombstone this lab opted out of.
  async remove(id: string) {
    const record = this.repo.getById(id);
    if (!record) throw new NotFoundException("unknown upload");

    await this.storage.deleteObject(record.key);
    this.repo.remove(record.id);
  }
}
