import { Module } from '@nestjs/common';
import { AuthorResolver } from './author.resolver';
import { AuthorService } from './author.service';
import { SharedModule } from '../shared/shared.module';

// Phase 4 circular-dependency exercise (see CLAUDE.md): AuthorService and
// BookService used to inject each other (module + provider cycle). Fixed the
// clean way — the shared piece was extracted into BookCountService (SharedModule),
// so both now depend on that leaf and the author↔book cycle is gone. No
// forwardRef and no BookModule import remain.
@Module({
  providers: [AuthorResolver, AuthorService],
  imports: [SharedModule],
  exports: [AuthorService],
})
export class AuthorModule {}
