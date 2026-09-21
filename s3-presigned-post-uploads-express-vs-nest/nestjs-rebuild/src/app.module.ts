import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import configuration from "./config/configuration";
import { UploadsModule } from "./uploads/uploads.module";

// The root module. ConfigModule.forRoot(...) is a DYNAMIC module — configured by
// its caller (here, with `isGlobal` + `load`) at the import site; that's what
// makes it dynamic, not the fact that it's imported. `isGlobal: true` exports
// ConfigService into every module's context, so it injects anywhere without
// re-importing. UploadsModule, by contrast, is a plain STATIC module.
//
// In Phase 3 a *dynamic* StorageModule joins this picture — StorageModule.forRoot
// (configured at its import site) vs. UploadsModule (static, varies only by the
// ConfigService it injects). Keep that contrast visible in comments there.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    UploadsModule,
  ],
})
export class AppModule {}
