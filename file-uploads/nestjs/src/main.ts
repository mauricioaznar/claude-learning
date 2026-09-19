import "reflect-metadata";
import { join } from "node:path";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Global pipe: validates every incoming DTO, strips unknown properties.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Serve the demo page. __dirname is dist/, so ../public resolves to the
  // project's public/ folder.
  app.useStaticAssets(join(__dirname, "..", "public"));

  const config = app.get(ConfigService);
  const port = config.get<number>("port");
  await app.listen(port);
  console.log(`file-uploads (nestjs) listening on http://localhost:${port}`);
}
bootstrap();
