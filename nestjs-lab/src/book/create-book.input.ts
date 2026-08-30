import { InputType, Field, Int } from '@nestjs/graphql';

@InputType()
export class ReviewInput {
  @Field(() => Int)
  rating: number;

  @Field()
  comment: string;
}

@InputType()
export class CreateBookWithReviewsInput {
  @Field(() => Int)
  authorId: number;

  @Field()
  title: string;

  @Field(() => [ReviewInput])
  reviews: ReviewInput[];
}
