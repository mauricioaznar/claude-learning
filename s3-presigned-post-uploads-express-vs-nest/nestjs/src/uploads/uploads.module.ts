import { Module } from "@nestjs/common";

import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";
import { UploadsRepository } from "./uploads.repository";
import { s3Provider } from "./s3.provider";

// The module is the wiring manifest: it declares which controller handles
// requests and which providers can be injected. Express has no equivalent —
// wiring there is just imports at the top of server.js.
@Module({
  controllers: [UploadsController],
  providers: [UploadsService, UploadsRepository, s3Provider],
})
export class UploadsModule {}
