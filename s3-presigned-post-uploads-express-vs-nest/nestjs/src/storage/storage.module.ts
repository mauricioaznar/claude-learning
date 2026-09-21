import { DynamicModule, Module, Provider } from "@nestjs/common";

import { s3Provider } from "./s3.provider";
import { StorageService } from "./storage.service";
import { S3_OPTIONS, S3Options, S3AsyncOptions } from "./s3-options";

// A DYNAMIC module: it takes its options at the IMPORT SITE (forRoot/forRootAsync)
// and returns a computed provider set. That import-time configuration is what
// makes it dynamic — NOT the fact that it gets imported (UploadsModule is imported
// too, and is static), and NOT that it behaves differently per environment
// (UploadsModule does that while staying static, by injecting ConfigService).
//
// It exports ONLY the StorageService facade. Because a provider escapes a module
// solely through `exports`, the S3_CLIENT and S3_OPTIONS tokens stay private to
// this module — the facade is the single door to S3.
@Module({})
export class StorageModule {
  // Static config: caller passes the options as literals.
  static forRoot(options: S3Options): DynamicModule {
    return this.build({ provide: S3_OPTIONS, useValue: options });
  }

  // Async config: caller supplies `inject` + `useFactory`, so the options can be
  // computed from other providers — e.g. the global ConfigService. This is the
  // form UploadsModule uses. Mirrors TypeOrmModule.forRootAsync.
  static forRootAsync(options: S3AsyncOptions): DynamicModule {
    return this.build({
      provide: S3_OPTIONS,
      inject: options.inject ?? [],
      useFactory: options.useFactory,
    });
  }

  // Both entry points differ only in how S3_OPTIONS is provided; the rest of the
  // graph (client + facade) is identical.
  private static build(optionsProvider: Provider): DynamicModule {
    return {
      module: StorageModule,
      providers: [optionsProvider, s3Provider, StorageService],
      exports: [StorageService], // the facade ONLY — tokens stay private
    };
  }
}
