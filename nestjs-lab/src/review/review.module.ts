import { Module } from '@nestjs/common';
import { ReviewResolver } from './review.resolver';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  // WRONG: PrismaService re-declared a third time.
  providers: [ReviewResolver, PrismaService],
  // WRONG: exporting the resolver.
  exports: [ReviewResolver],
})
export class ReviewModule {}
