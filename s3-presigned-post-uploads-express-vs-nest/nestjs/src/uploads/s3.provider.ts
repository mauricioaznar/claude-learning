import { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { S3Client } from "@aws-sdk/client-s3";

// The Express module makes the S3 client a module-level singleton. Nest makes it
// a PROVIDER instead: built once by a factory, then injected wherever it's asked
// for via the S3_CLIENT token. Same object, different wiring.
export const S3_CLIENT = "S3_CLIENT";

export const s3Provider: Provider = {
  provide: S3_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new S3Client({
      region: config.get<string>("s3.region"),
      endpoint: config.get<string>("s3.endpoint"),
      forcePathStyle: config.get<boolean>("s3.forcePathStyle"),
      credentials: {
        accessKeyId: config.get<string>("s3.accessKeyId"),
        secretAccessKey: config.get<string>("s3.secretAccessKey"),
      },
    }),
};
