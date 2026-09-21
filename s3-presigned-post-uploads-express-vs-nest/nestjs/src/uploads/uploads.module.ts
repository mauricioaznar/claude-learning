import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";
import { UploadsRepository } from "./uploads.repository";
import { StorageModule } from "../storage/storage.module";

// UploadsModule is STATIC: its shape is fixed by this decorator. It imports the
// DYNAMIC StorageModule, configuring it right here from the injected global
// ConfigService via forRootAsync — that import-time configuration is what makes
// StorageModule dynamic. UploadsModule itself takes no options; it varies only by
// the ConfigService its providers inject, which is exactly why it stays static.
//
// Only StorageService is visible from StorageModule (it's the module's single
// export), so nothing here can reach the raw S3 client or its options.
@Module({
  imports: [
    StorageModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.get("s3"),
    }),
  ],
  controllers: [UploadsController],
  providers: [UploadsService, UploadsRepository],
})
export class UploadsModule {}
