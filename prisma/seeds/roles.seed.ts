import { PrismaClient } from '@prisma/client';

export const INITIAL_PERMISSIONS = [
  // User Management
  {
    name: 'users:read',
    module: 'users',
    description: 'View user list and user profiles',
  },
  {
    name: 'users:write',
    module: 'users',
    description: 'Create, update, and manage user accounts',
  },

  // Role Management
  {
    name: 'roles:read',
    module: 'roles',
    description: 'View system roles and permissions',
  },
  {
    name: 'roles:write',
    module: 'roles',
    description: 'Manage roles and assign permissions',
  },
];

interface RoleSeed {
  slug: string;
  name: string;
  description: string;
  isSystem: boolean;
  /** Permission names to link. The admin role also bypasses checks via SUPER_ADMIN_ROLE_SLUG. */
  permissions: string[];
}

export const INITIAL_ROLES: RoleSeed[] = [
  {
    slug: 'admin',
    name: 'Administrator',
    description: 'Full system access with all administrative privileges',
    isSystem: true,
    permissions: INITIAL_PERMISSIONS.map((p) => p.name),
  },
  {
    slug: 'manager',
    name: 'Store Manager',
    description: 'Manages day-to-day store operations and views staff accounts',
    isSystem: true,
    permissions: ['users:read', 'roles:read'],
  },
];

/**
 * Idempotent: upserts permissions and roles and adds missing role-permission
 * links. It never deletes anything, so permissions or links created at runtime
 * survive re-seeding.
 */
export async function seedRolesAndPermissions(prisma: PrismaClient) {
  console.log('[SEED] Seeding permissions and roles...');

  const permissionIds = new Map<string, string>();
  for (const perm of INITIAL_PERMISSIONS) {
    const record = await prisma.permission.upsert({
      where: { name: perm.name },
      update: { description: perm.description, module: perm.module },
      create: perm,
    });
    permissionIds.set(record.name, record.id);
  }

  const roles: Record<string, { id: string; name: string; slug: string }> = {};
  for (const roleSeed of INITIAL_ROLES) {
    const { permissions, ...data } = roleSeed;
    const role = await prisma.role.upsert({
      where: { slug: data.slug },
      update: {
        name: data.name,
        description: data.description,
        isSystem: data.isSystem,
      },
      create: data,
    });
    roles[role.slug] = role;

    await prisma.rolePermission.createMany({
      data: permissions.map((name) => {
        const permissionId = permissionIds.get(name);
        if (!permissionId) {
          throw new Error(
            `[SEED] Role "${data.slug}" references unknown permission "${name}"`,
          );
        }
        return { roleId: role.id, permissionId };
      }),
      skipDuplicates: true,
    });

    console.log(
      `[SEED] Role "${role.name}" configured with ${permissions.length} permissions.`,
    );
  }

  return { adminRole: roles['admin'], managerRole: roles['manager'] };
}
