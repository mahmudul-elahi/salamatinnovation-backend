import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  role: {
    id: string;
    name: string;
    slug: string;
  };
  permissions: string[];
}

/** What the JWT strategy puts on `request.user`. */
export interface RequestUser extends AuthenticatedUser {
  /** The login session the access token belongs to. */
  sessionId: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as RequestUser;
    return data ? user?.[data] : user;
  },
);
