import { Module } from '@nestjs/common';
import { AuthorNameService } from './author-name.service';
import {BookCountService} from "./book-count.service";

@Module({
    providers: [AuthorNameService, BookCountService],
    exports: [AuthorNameService, BookCountService],
})
export class SharedModule {}
