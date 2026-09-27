import {
    Args,
    Mutation,
    Parent,
    Query,
    ResolveField,
    Resolver,
    Subscription,
} from '@nestjs/graphql';
import {
    ActivityEntityName,
    ActivityTypeName,
    CreateUserInput,
    UpdateUserInput,
    User,
} from '../../common/dto/entities';
import { ForbiddenException, Injectable, UseGuards } from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';
import { UserService } from './users/user.service';
import { AuthService } from './auth.service';
import { GqlAuthGuard } from './guards/gql-auth.guard';
import { Role, RoleId } from '../../common/dto/entities/auth/role.dto';
import { PubSubService } from '../../common/modules/pub-sub/pub-sub.service';
import {
    captureSnapshotSafely,
    INTENTIONALLY_ABSENT,
} from '../../common/modules/pub-sub/activity-audit';
import { RolesDecorator } from './decorators/role.decorator';

@Resolver(() => User)
@Injectable()
export class AuthResolver {
    constructor(
        private userService: UserService,
        private pubSubService: PubSubService,
        // Re-added after 1.6.4 removed it: the Phase 3 super-user password reset
        // is a session/auth operation (it revokes refresh families), so it lives
        // in AuthService, not UserService.
        private authService: AuthService,
    ) {}

    @Query(() => User)
    @UseGuards(GqlAuthGuard)
    async currentUser(@CurrentUser() currentUser: User) {
        return this.userService.findOneByEmail({
            email: currentUser.email,
        });
    }

    @Query(() => [User])
    @UseGuards(GqlAuthGuard)
    async users() {
        return this.userService.findAll();
    }

    @Query(() => User, { nullable: true })
    @RolesDecorator(RoleId.SUPER)
    async getUser(@Args('UserId') userId: number): Promise<User | null> {
        return this.userService.findUser({
            user_id: userId,
        });
    }

    @Query(() => String, { nullable: true })
    @UseGuards(GqlAuthGuard)
    async getServerVersion() {
        return process.env.npm_package_version;
    }

    @Query(() => Boolean)
    @UseGuards(GqlAuthGuard)
    async isEmailOccupied(
        @Args('Email') email: string,
        @Args('UserId', { nullable: true }) userId: number,
    ): Promise<boolean> {
        return this.userService.isEmailOccupied({ email, user_id: userId });
    }

    @Mutation(() => User)
    @UseGuards(GqlAuthGuard)
    @RolesDecorator(RoleId.SUPER)
    async createUser(
        @Args('CreateUserInput') input: CreateUserInput,
        @CurrentUser() currentUser: User,
    ) {
        // OUTSIDE every audit guard — a real create failure still fails.
        const user = await this.userService.create(input);

        // Always a create, so the old side is intentionally absent and the whole
        // snapshot renders as added. getUserSnapshot — never the raw row —
        // because `users` holds password and remember_token.
        const newCapture = await captureSnapshotSafely(
            {
                entityName: ActivityEntityName.USER,
                entityId: user.id,
                activityType: ActivityTypeName.CREATE,
                userId: currentUser.id,
            },
            'new_snapshot',
            () => this.userService.getUserSnapshot({ user_id: user.id }),
        );
        await this.pubSubService.user({
            user,
            userId: currentUser.id,
            type: ActivityTypeName.CREATE,
            oldCapture: INTENTIONALLY_ABSENT,
            newCapture,
        });

        return user;
    }

    @Mutation(() => User)
    @UseGuards(GqlAuthGuard)
    @RolesDecorator(RoleId.SUPER)
    async updateUser(
        @Args('UpdateUserInput') input: UpdateUserInput,
        @CurrentUser() currentUser: User,
    ) {
        await this.assertEditableBy(input.id, currentUser);

        const auditContext = {
            entityName: ActivityEntityName.USER,
            entityId: input.id,
            activityType: ActivityTypeName.UPDATE,
            userId: currentUser.id,
        };
        // Audit: capture the row BEFORE the write. getUserSnapshot — never the
        // raw row — because `users` holds password and remember_token. Guarded:
        // a snapshot read that throws must not stop the save from happening.
        const oldCapture = await captureSnapshotSafely(
            auditContext,
            'old_snapshot',
            () => this.userService.getUserSnapshot({ user_id: input.id }),
        );
        // OUTSIDE every audit guard — a real save failure still fails.
        const user = await this.userService.update(input);

        // Disabling a user ends their access now: revoke every refresh family so
        // a live session cannot be refreshed (the access token still lives out
        // its ≤15-min TTL, but cannot be renewed, and every other token-issuing
        // path reads the user through `readActiveUser`, which now excludes
        // disabled accounts). Idempotent — re-running on an already-disabled
        // account simply finds no live rows to revoke.
        if (user.login_disabled) {
            await this.authService.revokeAllForUser(user.id);
        }

        const newCapture = await captureSnapshotSafely(
            auditContext,
            'new_snapshot',
            () => this.userService.getUserSnapshot({ user_id: user.id }),
        );

        await this.pubSubService.user({
            user,
            userId: currentUser.id,
            type: ActivityTypeName.UPDATE,
            oldCapture,
            newCapture,
        });

        return user;
    }

    // Phase 3 §3.3. A super-user forces the target to set a new password on
    // their next login: no new password is set here, the account is flagged and
    // its sessions revoked. The target logs in with their current password and
    // is then routed through the change-password gate. Super-only, matching the
    // other user-administration mutations.
    @Mutation(() => User, { nullable: true })
    @UseGuards(GqlAuthGuard)
    @RolesDecorator(RoleId.SUPER)
    async resetUserPassword(
        @Args('UserId') userId: number,
        @CurrentUser() currentUser: User,
    ): Promise<User | null> {
        await this.assertEditableBy(userId, currentUser);
        await this.authService.requirePasswordChange(userId);
        return this.userService.findUser({ user_id: userId });
    }

    // A root account may be edited (updated, reset, disabled) only by itself. Any
    // other actor — Super included — is refused. The `is_root` flag is DB-only
    // (on no GraphQL input), so this resolver check plus the missing input field
    // are the whole of its protection; the only way to grant or move root is in
    // the database.
    private async assertEditableBy(
        targetUserId: number,
        currentUser: User,
    ): Promise<void> {
        const target = await this.userService.findUser({
            user_id: targetUserId,
        });
        if (target?.is_root && currentUser.id !== target.id) {
            throw new ForbiddenException(
                'Esta cuenta solo puede ser modificada por sí misma.',
            );
        }
    }

    @ResolveField(() => [Role])
    @UseGuards(GqlAuthGuard)
    async roles(@Parent() user: User): Promise<Role[]> {
        return this.userService.getUserRoles({ user_id: user.id });
    }

    @ResolveField(() => [RoleId])
    @UseGuards(GqlAuthGuard)
    async role_ids(@Parent() user: User): Promise<RoleId[]> {
        const roles = await this.userService.getUserRoles({ user_id: user.id });
        return roles.map((role) => role.id);
    }

    @Subscription(() => User)
    @UseGuards(GqlAuthGuard)
    @RolesDecorator(RoleId.SUPER)
    async user() {
        return this.pubSubService.listenForUser();
    }
}
