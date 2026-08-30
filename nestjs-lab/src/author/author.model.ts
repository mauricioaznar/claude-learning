import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Book } from '../book/book.model';

@ObjectType()
export class Author {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  // Computed by AuthorResolver.displayName (uses the shared AuthorNameService).
  @Field()
  displayName: string;

  // Resolved by AuthorResolver.books — one Prisma query PER author (N+1).
  @Field(() => [Book])
  books: Book[];
}
