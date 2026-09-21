import { Provider } from "@nestjs/common";
import { S3Client } from "@aws-sdk/client-s3";

import { S3_OPTIONS, S3Options } from "./s3-options";

// The S3 client as a PROVIDER, built once by a factory and injected via the
// S3_CLIENT token. It now builds from the module's own S3_OPTIONS (not the global
// ConfigService) — so StorageModule is self-contained on whatever options its
// importer supplied through forRoot/forRootAsync.
export const S3_CLIENT = "S3_CLIENT";

export const s3Provider: Provider = {
  provide: S3_CLIENT,
  inject: [S3_OPTIONS],
  useFactory: (options: S3Options) =>
    new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    }),
};
