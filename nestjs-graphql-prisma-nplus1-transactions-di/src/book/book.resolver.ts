import {
  Resolver,
  Query,
  Mutation,
  Args,
  ResolveField,
  Parent,
} from '@nestjs/graphql';
import { Book } from './book.model';
import { Author } from '../author/author.model';
import { Review } from '../review/review.model';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorNameService } from '../shared/author-name.service';
import { CreateBookWithReviewsInput } from './create-book.input';

@Resolver(() => Book)
export class BookResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly names: AuthorNameService,
  ) {}

  @Query(() => [Book])
  books() {
    return this.prisma.book.findMany();
  }

  // N+1: one lookup PER book.
  @ResolveField(() => Author)
  author(@Parent() book: Book) {
    return this.prisma.author.findUnique({ where: { id: book.authorId } });
  }

  // N+1: another lookup PER book, then formatted with the shared service.
  @ResolveField(() => String, { name: 'authorName' })
  async resolveAuthorName(@Parent() book: Book) {
    const author = await this.prisma.author.findUnique({
      where: { id: book.authorId },
    });
    return this.names.format(author?.name ?? '');
  }

  // N+1: one lookup PER book.
  @ResolveField(() => [Review])
  reviews(@Parent() book: Book) {
    return this.prisma.review.findMany({ where: { bookId: book.id } });
  }

  // WRONG (for Phase 3): writes the book, then writes each review in a loop with
  // NO transaction. If a later write fails, the book (and earlier reviews) stay
  // committed — a partial write.
  @Mutation(() => Book)
  async createBookWithReviews(
    @Args('input') input: CreateBookWithReviewsInput,
  ) {
    const book = await this.prisma.book.create({
      data: { title: input.title, authorId: input.authorId },
    });

    for (const r of input.reviews) {
      await this.prisma.review.create({
        data: { rating: r.rating, comment: r.comment, bookId: book.id },
      });
    }

    return book;
  }
}
