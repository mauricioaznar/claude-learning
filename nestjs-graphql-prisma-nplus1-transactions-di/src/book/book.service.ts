import {Injectable} from '@nestjs/common';
import {BookCountService} from "../shared/book-count.service";

// ...and the other half of the cycle: BookService needs AuthorService to
// describe a book together with its author summary. A -> B and B -> A.
@Injectable()
export class BookService {

  constructor(private readonly bookCountService: BookCountService) {}

  describe(bookId: number, authorId: number): string {
    return `book ${bookId} — ${this.bookCountService.bookCountLabel(authorId)}`;
  }
}
