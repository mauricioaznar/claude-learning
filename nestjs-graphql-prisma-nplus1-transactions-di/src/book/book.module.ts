import {forwardRef, Module} from '@nestjs/common';
import { BookResolver } from './book.resolver';
import { BookService } from './book.service';
import { SharedModule } from '../shared/shared.module';
import { AuthorModule } from '../author/author.module';

// Other half of the deliberate cycle — see author.module.ts for the exercise.
@Module({
  providers: [BookResolver, BookService],
  imports: [SharedModule],
  exports: [BookService],
})
export class BookModule {}
