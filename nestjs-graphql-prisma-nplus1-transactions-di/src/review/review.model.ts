import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Book } from '../book/book.model';

@ObjectType()
export class Review {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  rating: number;

  @Field()
  comment: string;

  @Field(() => Int)
  bookId: number;

  // Resolved by ReviewResolver.book — one Prisma query PER review (N+1).
  @Field(() => Book)
  book: Book;
}
