import { Resolver, Query, ResolveField, Parent } from '@nestjs/graphql';
import { Review } from './review.model';
import { Book } from '../book/book.model';
import { PrismaService } from '../prisma/prisma.service';

@Resolver(() => Review)
export class ReviewResolver {
  constructor(private readonly prisma: PrismaService) {}

  @Query(() => [Review])
  reviews() {
    return this.prisma.review.findMany();
  }

  // N+1: one lookup PER review.
  @ResolveField(() => Book)
  book(@Parent() review: Review) {
    return this.prisma.book.findUnique({ where: { id: review.bookId } });
  }
}
