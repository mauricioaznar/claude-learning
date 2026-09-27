import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';
import { IsString } from 'class-validator';
import { Role, RoleInput } from './role.dto';

@ObjectType({ isAbstract: true })
@InputType({ isAbstract: true })
export class UserBase {
    @Field()
    email: string;

    @Field()
    first_name: string;

    @Field()
    last_name: string;
}

// No GraphQL consumer any more — the `login` mutation was deleted, so this input
// type is no longer reachable from any resolver and never reaches the generated
// schema. It survives as the shape `AuthController` validates its request body
// into, which is the only place credentials are accepted now.
@InputType('loginInput')
export class LoginInput {
    @Field()
    @IsString()
    password: string;

    @Field()
    @IsString()
    email: string;
}

@InputType('CreateUserInput')
export class CreateUserInput extends UserBase {
    @Field(() => Int, { nullable: true })
    id?: number | null;

    @Field()
    password: string;

    @Field(() => [RoleInput])
    roles: RoleInput[];

    // Phase 3: admin enrols the account into email MFA. Optional — omitted means
    // the default (off).
    @Field(() => Boolean, { nullable: true })
    mfa_enabled?: boolean | null;

    // Blocks login for the account without deleting it. Optional; omitted ⇒ off.
    // Note there is deliberately no `is_root` input on either create or update:
    // the root flag is DB-only and cannot be set through GraphQL.
    @Field(() => Boolean, { nullable: true })
    login_disabled?: boolean | null;
}

@InputType('UpdateUserInput')
export class UpdateUserInput extends UserBase {
    @Field({ nullable: false })
    id: number;

    @Field(() => String, { nullable: true })
    password?: string | null;

    @Field(() => [RoleInput])
    roles: RoleInput[];

    // Phase 3: the MFA-enforcement checkbox. Optional so an update that does not
    // touch it leaves the flag as-is.
    @Field(() => Boolean, { nullable: true })
    mfa_enabled?: boolean | null;

    // The login-disable checkbox. Optional so an update that does not touch it
    // leaves the flag as-is. `is_root` is intentionally absent — it is DB-only.
    @Field(() => Boolean, { nullable: true })
    login_disabled?: boolean | null;
}

@ObjectType('User')
export class User extends UserBase {
    @Field({ nullable: false })
    id: number;

    @Field()
    fullname: string;

    // Phase 3 MFA-enforcement flag, surfaced so the admin panel can show and
    // toggle it. Stored as TINYINT(1); the GraphQL Boolean scalar coerces the
    // 0/1 the resolver returns.
    @Field(() => Boolean)
    mfa_enabled: boolean;

    // Read-only surface of the two DB flags from the migration. `is_root` drives
    // the "only editable by itself" protection (enforced in the resolver) and its
    // UI badge; `login_disabled` drives the disable checkbox and the access
    // column. `is_root` is never on an input type, so it can be read here but
    // only written in the database.
    @Field(() => Boolean)
    is_root: boolean;

    @Field(() => Boolean)
    login_disabled: boolean;

    static isUserSalesman({ roles }: { roles: Role[] }): boolean {
        return !!roles.find((role) => {
            return role.id === 5;
        });
    }

    static isUserSuper({ roles }: { roles: Role[] }) {
        return !!roles.find((role) => {
            return role.id === 1;
        });
    }

    static isUserAdmin({ roles }: { roles: Role[] }) {
        return !!roles.find((role) => {
            return role.id === 1 || role.id === 2;
        });
    }

    static isUserProduction({ roles }: { roles: Role[] }) {
        return !!roles.find((role) => {
            return role.id === 4;
        });
    }
}

@ObjectType('UserWithRoles')
export class UserWithRoles extends User {
    user_roles: {
        id: number;
        role_id?: number | null;
    }[];

    password?: string;

    // `mfa_enabled` is inherited from `User` (a GraphQL `@Field`). This one is the
    // internal-only forced-password-change flag: a plain property (not `@Field`)
    // like `password` above, travelling on the object `validateUser` returns so the
    // post-password decision can read it without it becoming part of the GraphQL
    // `User` type. Surfaced as a boolean by Prisma (TINYINT(1) → Boolean). Optional
    // because a `select` may omit it; the gate check is a truthiness test, so an
    // absent flag reads as "off".
    must_change_password?: boolean;
}

// What the access token actually carries. Deliberately minimal: a JWT is only
// base64 — everything in it is readable by anyone holding the token, and it is
// copied on every single request. The whole `users` row used to travel in here.
export interface AccessTokenPayload {
    sub: number;
    email: string;
    role_ids: number[];
}

// What a login or a rotation produces. Only `accessToken` ever reaches the
// response body; the refresh token is written straight into an httpOnly cookie
// so no JavaScript on the page can read it (that is the whole point of moving
// off localStorage).
export interface TokenPair {
    accessToken: string;
    refreshToken: string;
    refreshExpiresAt: Date;
}

// Whatever we can learn about the client that opened this session. Purely
// informational today; it is what a future "active sessions" screen would list.
export interface SessionMeta {
    userAgent?: string | null;
    ip?: string | null;

    // Log-only, and the one field here that is never persisted. Mixing it in
    // beats a second parallel parameter on three service methods, and it cannot
    // leak into `refresh_tokens` by accident: `issueTokenPair` writes an
    // explicit allowlist (`meta.userAgent`, `meta.ip`) field by field rather
    // than spreading `meta`.
    requestId?: string;
}

// What `req.user` is after `JwtStrategy#validate` — i.e. what `@CurrentUser()`
// and the role guard receive. `id` mirrors the payload's `sub` so the ~50
// existing `currentUser.id` call sites keep working unchanged.
export interface AuthenticatedUser {
    id: number;
    email: string;
    role_ids: number[];
}
