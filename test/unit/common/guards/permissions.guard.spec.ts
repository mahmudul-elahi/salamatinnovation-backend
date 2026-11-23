import { describe, expect, it } from 'vitest';
import { Controller, Get, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequirePermissions } from '../../../../src/common/decorators/permissions.decorator.js';
import { Roles } from '../../../../src/common/decorators/roles.decorator.js';
import { PermissionsGuard } from '../../../../src/common/guards/permissions.guard.js';
import { RolesGuard } from '../../../../src/common/guards/roles.guard.js';

@Controller()
class TestController {
  @Get()
  open() {}

  @RequirePermissions('users:read', 'users:write')
  @Get()
  needsPermissions() {}

  @Roles('manager')
  @Get()
  needsRole() {}
}

const userWith = (slug: string, permissions: string[]) => ({
  id: 'u',
  email: 'u@example.com',
  firstName: 'U',
  lastName: 'U',
  role: { id: 'r', name: slug, slug },
  permissions,
});

function contextFor(
  handler: keyof TestController,
  user?: unknown,
): ExecutionContext {
  return {
    getHandler: () => TestController.prototype[handler],
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('allows routes without permission metadata', () => {
    expect(guard.canActivate(contextFor('open'))).toBe(true);
  });

  it('requires every listed permission', () => {
    expect(
      guard.canActivate(
        contextFor('needsPermissions', userWith('manager', ['users:read'])),
      ),
    ).toBe(false);
    expect(
      guard.canActivate(
        contextFor(
          'needsPermissions',
          userWith('manager', ['users:read', 'users:write']),
        ),
      ),
    ).toBe(true);
  });

  it('lets the super admin role through', () => {
    expect(
      guard.canActivate(contextFor('needsPermissions', userWith('admin', []))),
    ).toBe(true);
  });

  it('denies when there is no user', () => {
    expect(guard.canActivate(contextFor('needsPermissions'))).toBe(false);
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows routes without role metadata', () => {
    expect(guard.canActivate(contextFor('open'))).toBe(true);
  });

  it('matches on role slug', () => {
    expect(
      guard.canActivate(contextFor('needsRole', userWith('manager', []))),
    ).toBe(true);
    expect(
      guard.canActivate(contextFor('needsRole', userWith('cashier', []))),
    ).toBe(false);
    expect(guard.canActivate(contextFor('needsRole'))).toBe(false);
  });
});
