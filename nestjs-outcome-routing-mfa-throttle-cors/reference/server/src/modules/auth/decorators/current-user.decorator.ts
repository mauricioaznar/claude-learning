import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthenticatedUser } from '../../../common/dto/entities';

// Always resolves to the `AuthenticatedUser` built by `JwtStrategy#validate` —
// id, email and role ids, nothing more. Resolvers that still annotate the
// parameter as `User` only read `id`/`email`, which are present.
export const CurrentUser = createParamDecorator(
    (data: unknown = {}, context: ExecutionContext): AuthenticatedUser => {
        const ctx = GqlExecutionContext.create(context);
        return ctx.getContext().req.user;
    },
);
