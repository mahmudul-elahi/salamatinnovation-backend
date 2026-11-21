import type { UserWithPermissions } from '../../src/modules/users/users.service.js';

export function makeUser(
  overrides: Partial<UserWithPermissions> = {},
): UserWithPermissions {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: 'user-1',
    email: 'jane@example.com',
    password: 'hashed',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    isActive: true,
    tokenVersion: 0,
    roleId: 'role-1',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    role: {
      id: 'role-1',
      name: 'Store Manager',
      slug: 'manager',
      description: null,
      isSystem: true,
      createdAt: now,
      updatedAt: now,
      permissions: [
        {
          roleId: 'role-1',
          permissionId: 'perm-1',
          permission: {
            id: 'perm-1',
            name: 'users:read',
            description: null,
            module: 'users',
            createdAt: now,
            updatedAt: now,
          },
        },
      ],
    },
    ...overrides,
  };
}
