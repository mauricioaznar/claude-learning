import { Module } from '@nestjs/common';
import { ReviewResolver } from './review.resolver';

// ReviewResolver injects only PrismaService, which is global (PrismaModule is
// @Global and imported once in AppModule) — so this module needs no imports.
// It does not use AuthorNameService, so it does NOT import SharedModule.
@Module({
  providers: [ReviewResolver],
})
export class ReviewModule {}
