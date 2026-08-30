import { Module } from '@nestjs/common';
import { AuthorResolver } from './author.resolver';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorNameService } from '../shared/author-name.service';

@Module({
  // WRONG #1: PrismaService and AuthorNameService are re-declared here AND in
  // BookModule — each `providers` entry mints a brand-new instance.
  providers: [AuthorResolver, PrismaService, AuthorNameService],
  // WRONG #2: exporting the RESOLVER. Resolvers are entry points, not things
  // other modules consume. Nothing imports AuthorModule to use this, so the
  // export does nothing.
  exports: [AuthorResolver],
})
export class AuthorModule {}
