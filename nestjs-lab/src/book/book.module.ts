import { Module } from '@nestjs/common';
import { BookResolver } from './book.resolver';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorNameService } from '../shared/author-name.service';

@Module({
  // WRONG: AuthorNameService re-declared here (second copy), PrismaService too.
  providers: [BookResolver, PrismaService, AuthorNameService],
  // WRONG: exporting the resolver again.
  exports: [BookResolver],
})
export class BookModule {}
