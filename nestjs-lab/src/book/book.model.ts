import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Author } from '../author/author.model';
import { Review } from '../review/review.model';

@ObjectType()
export class Book {
  @Field(() => Int)
  id: number;

  @Field()
  title: string;

  @Field(() => Int)
  authorId: number;

  // Resolved by BookResolver — a Prisma lookup PER book, then formatted (N+1).
  @Field()
  authorName: string;

  // Resolved by BookResolver.author — one Prisma query PER book (N+1).
  @Field(() => Author)
  author: Author;

  // Resolved by BookResolver.reviews — one Prisma query PER book (N+1).
  @Field(() => [Review])
  reviews: Review[];
}
