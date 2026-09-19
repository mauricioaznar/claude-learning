import { Injectable, Logger } from '@nestjs/common';

// A trivially "shared" service. Its only job is to normalise a name.
// The interesting part is `instanceId`: it logs a fresh random number every
// time NestJS constructs this class. In Phase 1 you will see this line printed
// MORE THAN ONCE at boot — proof that the app is holding several copies of a
// service that is supposed to be shared. Phase 4 fixes that.
@Injectable()
export class AuthorNameService {
  readonly instanceId = Math.floor(Math.random() * 100000);
  private readonly logger = new Logger(AuthorNameService.name);

  constructor() {
    this.logger.log(`constructed (instanceId=${this.instanceId})`);
  }

  format(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
  }
}
