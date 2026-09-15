import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class BookCountService {

    bookCountLabel(authorId: number): string {
        const n = this.countForAuthor(authorId);
        return `author ${authorId} has ${n} book(s)`;
    }

    countForAuthor(_authorId: number): number {
        return 0;
    }
}
