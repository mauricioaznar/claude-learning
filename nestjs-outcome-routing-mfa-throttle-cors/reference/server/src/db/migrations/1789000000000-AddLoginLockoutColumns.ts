import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoginLockoutColumns1789000000000
    implements MigrationInterface
{
    // Phase 2 per-account lockout. Two columns on `users`, no new table: the
    // user count is small and this state is one-per-account, so DB columns are
    // the right weight (no Redis in this stack).
    //
    // A separate migration rather than an edit to `CreateRefreshTokens`: that one
    // has already run in production, so its file is frozen — editing an applied
    // migration in place would desync the tracked history from the live schema.
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE \`users\`
          ADD COLUMN \`failed_login_count\` int          NOT NULL DEFAULT '0',
          ADD COLUMN \`lockout_until\`      datetime     NULL DEFAULT NULL;
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE \`users\`
          DROP COLUMN \`failed_login_count\`,
          DROP COLUMN \`lockout_until\`;
    `);
    }
}
