import {Injectable} from '@nestjs/common';
import {BookCountService} from "../shared/book-count.service";

// Part of the DELIBERATE circular dependency (see author.module.ts).
// AuthorService needs BookService to answer "how many books?"...
@Injectable()
export class AuthorService {
  constructor(private readonly bookCountService: BookCountService) {}

  bookCountLabel(authorId: number): string {
    return this.bookCountService.bookCountLabel(authorId);
  }
}
