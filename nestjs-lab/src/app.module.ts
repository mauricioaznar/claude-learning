import { join } from 'path';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';

import { AuthorModule } from './author/author.module';
import { BookModule } from './book/book.module';
import { ReviewModule } from './review/review.module';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      playground: false,
      // Modern in-browser query UI at http://localhost:3000/graphql
      plugins: [ApolloServerPluginLandingPageLocalDefault()],
    }),
    AuthorModule,
    BookModule,
    ReviewModule,
  ],
})
export class AppModule {}
