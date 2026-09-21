// The options a StorageModule instance is configured with — passed at the import
// site (that's what makes StorageModule a *dynamic* module). Kept here, private to
// storage/, alongside the token they're provided under.
export const S3_OPTIONS = "S3_OPTIONS";

export interface S3Options {
  region: string;
  endpoint?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

// forRootAsync's argument: the caller gives an `inject` list + a `useFactory`, so
// the options can be *computed* from other providers (e.g. the global
// ConfigService) instead of passed as literals. Same idea as TypeOrmModule.
export interface S3AsyncOptions {
  inject?: any[];
  useFactory: (...args: any[]) => S3Options | Promise<S3Options>;
}
