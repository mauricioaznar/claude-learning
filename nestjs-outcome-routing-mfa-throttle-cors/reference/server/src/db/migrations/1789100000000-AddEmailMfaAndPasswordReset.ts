import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailMfaAndPasswordReset1789100000000
    implements MigrationInterface
{
    // Phase 3 schema: email MFA + the super-user forced-password-change gate.
    //
    // Two flags on `users` and one new table. A separate migration from the
    // Phase 2 lockout one (`AddLoginLockoutColumns`) for the same reason that one
    // was separate from `CreateRefreshTokens`: each shipped migration is frozen
    // once it has run anywhere, so new schema is a new file, never an edit.
    public async up(queryRunner: QueryRunner): Promise<void> {
        // `mfa_enabled` — the admin checkbox. `1` ⇒ this account must pass an
        // emailed one-time code on every login; `0` ⇒ it skips MFA entirely and
        // stays on the password-only path that already works. Default 0 is what
        // keeps the blast radius of the email dependency bounded to the accounts
        // an admin has deliberately enrolled.
        //
        // `must_change_password` — set by the super-user reset; forces the target
        // to choose a new password on their next login, and is cleared once they
        // do. TINYINT(1) is MySQL's boolean, matching the house convention for
        // the other flag columns on this table.
        await queryRunner.query(`
      ALTER TABLE \`users\`
          ADD COLUMN \`mfa_enabled\`           tinyint(1) NOT NULL DEFAULT '0',
          ADD COLUMN \`must_change_password\`  tinyint(1) NOT NULL DEFAULT '0';
    `);

        // One row per issued email code. Only the SHA-256 hash is stored, never
        // the raw six digits — same reasoning as `refresh_tokens.token_hash`: a
        // database dump must not hand an attacker a code it could still redeem
        // inside the TTL.
        //
        // `consumed_at` makes a code single-use; `expires_at` gives it a short
        // life; `attempts` is the per-code brute-force cap (a 6-digit code is
        // only ~20 bits, so the code itself must be attempt-limited on top of the
        // per-IP throttle on the verify route).
        //
        // The FK has no `ON DELETE` clause (MySQL defaults to RESTRICT), matching
        // `refresh_tokens`. ⚠️ That means the Jest global teardown must delete
        // `email_mfa_codes` before `users` — handled in `setup-database.ts`, the
        // same fix Phase 1.5.1 made for `refresh_tokens`.
        await queryRunner.query(`
      CREATE TABLE \`email_mfa_codes\`
      (
          \`id\`          int unsigned NOT NULL AUTO_INCREMENT,
          \`user_id\`     int unsigned NOT NULL,
          \`code_hash\`   char(64)     NOT NULL,
          \`expires_at\`  datetime     NOT NULL,
          \`consumed_at\` datetime     NULL DEFAULT NULL,
          \`attempts\`    int          NOT NULL DEFAULT '0',
          \`created_at\`  datetime     NULL DEFAULT NULL,
          PRIMARY KEY (\`id\`),
          KEY \`email_mfa_codes_user_id_foreign\` (\`user_id\`),
          CONSTRAINT \`email_mfa_codes_user_id_foreign\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`)
      ) ENGINE = InnoDB
        AUTO_INCREMENT = 1
        DEFAULT CHARSET = utf8
        COLLATE = utf8_unicode_ci;
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS \`email_mfa_codes\`;`);
        await queryRunner.query(`
      ALTER TABLE \`users\`
          DROP COLUMN \`mfa_enabled\`,
          DROP COLUMN \`must_change_password\`;
    `);
    }
}
