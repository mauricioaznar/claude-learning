import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import configuration from "./config/configuration";
import { UploadsModule } from "./uploads/uploads.module";

@Module({
  imports: [
    // isGlobal so ConfigService can be injected anywhere without re-importing.
    // `load` registers our typed configuration factory.
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    UploadsModule,
  ],
})
export class AppModule {}
