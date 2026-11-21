import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator.js';
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js';
import { SUPER_ADMIN_ROLE_SLUG } from '../constants/roles.constants.js';

/**
 * Registered globally. Routes without `@RequirePermissions()` pass through;
 * routes with it require every listed permission.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<
      string[] | undefined
    >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) {
      return false;
    }

    if (user.role.slug === SUPER_ADMIN_ROLE_SLUG) {
      return true;
    }

    return requiredPermissions.every((perm) => user.permissions.includes(perm));
  }
}
