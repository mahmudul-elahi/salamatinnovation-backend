import { PrismaClient } from '@prisma/client';

export const INITIAL_PERMISSIONS = [
  // User Management
  { name: 'users:read', module: 'users', description: 'View user list and user profiles' },
  { name: 'users:write', module: 'users', description: 'Create, update, and manage user accounts' },

  // Role Management
  { name: 'roles:read', module: 'roles', description: 'View system roles and permissions' },
  { name: 'roles:write', module: 'roles', description: 'Manage roles and assign permissions' },
];

export async function seedRolesAndPermissions(prisma: PrismaClient) {
  console.log('[SEED] Seeding simplified permissions and roles...');

  // 1. Remove obsolete permissions no longer in the list
  const activeNames = INITIAL_PERMISSIONS.map((p) => p.name);
  await prisma.permission.deleteMany({
    where: {
      name: {
        notIn: activeNames,
      },
    },
  });

  // 2. Upsert active permissions
  const permissionRecords: { id: string; name: string }[] = [];
  for (const perm of INITIAL_PERMISSIONS) {
    const record = await prisma.permission.upsert({
      where: { name: perm.name },
      update: {
        description: perm.description,
        module: perm.module,
      },
      create: {
        name: perm.name,
        description: perm.description,
        module: perm.module,
      },
    });
    permissionRecords.push(record);
  }

  // 3. Upsert Administrator Role
  const adminRole = await prisma.role.upsert({
    where: { slug: 'admin' },
    update: {
      name: 'Administrator',
      description: 'Full system access with all administrative privileges',
      isSystem: true,
    },
    create: {
      name: 'Administrator',
      slug: 'admin',
      description: 'Full system access with all administrative privileges',
      isSystem: true,
    },
  });

  // 4. Link active permissions to Administrator Role
  for (const permission of permissionRecords) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: permission.id,
      },
    });
  }

  console.log(`[SEED] Administrator role configured with ${permissionRecords.length} permissions.`);
  return { adminRole, permissionRecords };
}
