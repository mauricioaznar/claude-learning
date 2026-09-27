import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefreshTokens1788804218804 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // One row per issued refresh token. Rotation writes a new row and
        // revokes the old one, so a session is a *chain* of rows sharing a
        // `family_id`; that is what makes replay detectable.
        //
        // `token_hash` is a SHA-256 of the raw token, never the token itself: a
        // database dump must not hand an attacker live sessions. The raw value
        // only ever exists in the httpOnly cookie.
        //
        // No `active` column here — unlike the domain tables, this one is not
        // soft-deleted. `revoked_at` / `expires_at` already carry the state, and
        // conflating them with the house soft-delete flag would let a row look
        // "live" while being expired.
        await queryRunner.query(`
      CREATE TABLE \`refresh_tokens\`
      (
          \`id\`         int unsigned NOT NULL AUTO_INCREMENT,
          \`user_id\`    int unsigned NOT NULL,
          \`token_hash\` char(64)     NOT NULL,
          \`family_id\`  char(36)     NOT NULL,
          \`expires_at\` datetime     NOT NULL,
          \`revoked_at\` datetime     NULL DEFAULT NULL,
          \`created_at\` datetime     NULL DEFAULT NULL,
          \`updated_at\` datetime     NULL DEFAULT NULL,
          \`user_agent\` varchar(255) NULL DEFAULT NULL,
          \`ip\`         varchar(45)  NULL DEFAULT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`refresh_tokens_token_hash_unique\` (\`token_hash\`),
          KEY \`refresh_tokens_user_id_foreign\` (\`user_id\`),
          KEY \`refresh_tokens_family_id_index\` (\`family_id\`),
          CONSTRAINT \`refresh_tokens_user_id_foreign\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`)
      ) ENGINE = InnoDB
        AUTO_INCREMENT = 1
        DEFAULT CHARSET = utf8
        COLLATE = utf8_unicode_ci;
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS \`refresh_tokens\`;`);
    }
}
