import "reflect-metadata";
import { join } from "node:path";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // NOTE: the global ValidationPipe is a *Phase 2* addition (DTO-based
  // validation). Phase 1 ("everything mixed") validates by hand in the handler,
  // so the pipe is intentionally absent here — add it when you introduce the DTO.
  //   app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Serve the compiled Svelte client. __dirname is dist/, so ../public resolves
  // to the project's public/ folder (created by `cd client && npm run build`).
  app.useStaticAssets(join(__dirname, "..", "public"));

  const config = app.get(ConfigService);
  const port = config.get<number>("port");
  await app.listen(port);
  console.log(`s3-rebuild (nestjs) listening on http://localhost:${port}`);
}
bootstrap();
