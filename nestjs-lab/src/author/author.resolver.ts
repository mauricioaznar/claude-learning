import { Resolver, Query, ResolveField, Parent } from '@nestjs/graphql';
import { Author } from './author.model';
import { Book } from '../book/book.model';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorNameService } from '../shared/author-name.service';

@Resolver(() => Author)
export class AuthorResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly names: AuthorNameService,
  ) {}

  @Query(() => [Author])
  authors() {
    return this.prisma.author.findMany();
  }

  @ResolveField(() => String)
  displayName(@Parent() author: Author) {
    return this.names.format(author.name);
  }

  // N+1: fires once for EVERY author in the parent list.
  @ResolveField(() => [Book])
  books(@Parent() author: Author) {
    return this.prisma.book.findMany({ where: { authorId: author.id } });
  }
}
